import { createHash } from 'node:crypto';
import { prisma } from '../data/prisma.js';

export const SEAT_HOLD_DURATION_MS = 10 * 60 * 1000;

export type SeatAvailability = 'available' | 'occupied' | 'held';

export interface SeatMapItem {
  id: string;
  rowNumber: string;
  seatNumber: number;
  status: SeatAvailability;
  heldByCurrentSession: boolean;
  expiresAt: string | null;
}

export interface SeatMap {
  showtimeId: string;
  priceCents: number;
  seats: SeatMapItem[];
}

export interface SeatHoldResult {
  heldSeatIds: string[];
  expiresAt: string;
}

interface SeatRecord {
  id: string;
  rowNumber: string;
  seatNumber: number;
  bookingId: string | null;
  holdTokenHash: string | null;
  holdExpiresAt: Date | null;
}

interface ShowtimeSeats {
  exists: boolean;
  priceCents: number;
  seats: SeatRecord[];
}

export interface SeatRepository {
  findShowtimeSeats(showtimeId: string): Promise<ShowtimeSeats>;
  createTemporaryHold(
    showtimeId: string,
    seatIds: string[],
    tokenHash: string,
    expiresAt: Date,
    now: Date,
  ): Promise<void>;
  releaseTemporaryHold(
    showtimeId: string,
    seatIds: string[],
    tokenHash: string,
    now: Date,
  ): Promise<void>;
}

export class SeatUnavailableError extends Error {
  constructor(readonly seatIds: string[]) {
    super('One or more seats are no longer available.');
    this.name = 'SeatUnavailableError';
  }
}

const prismaSeatRepository: SeatRepository = {
  findShowtimeSeats: async (showtimeId) => {
    const showtime = await prisma.showtime.findUnique({
      where: { id: showtimeId },
      select: { id: true, price: true },
    });

    if (!showtime) {
      return { exists: false, priceCents: 0, seats: [] };
    }

    const seats = await prisma.seat.findMany({
      where: { showtimeId },
      include: { hold: true },
      orderBy: [{ rowNumber: 'asc' }, { seatNumber: 'asc' }],
    });

    return {
      exists: true,
      priceCents: priceInCents(showtime.price),
      seats: seats.map(({ id, rowNumber, seatNumber, bookingId, hold }) => ({
        id,
        rowNumber,
        seatNumber,
        bookingId,
        holdTokenHash: hold?.tokenHash ?? null,
        holdExpiresAt: hold?.expiresAt ?? null,
      })),
    };
  },
  createTemporaryHold: async (
    showtimeId,
    seatIds,
    tokenHash,
    expiresAt,
    now,
  ) => {
    await prisma.$transaction(async (transaction) => {
      await transaction.seatHold.deleteMany({
        where: { expiresAt: { lte: now } },
      });

      const hold = await transaction.seatHold.create({
        data: { tokenHash, expiresAt },
      });
      const result = await transaction.seat.updateMany({
        where: {
          showtimeId,
          id: { in: seatIds },
          bookingId: null,
          holdId: null,
        },
        data: { holdId: hold.id },
      });

      if (result.count !== seatIds.length) {
        throw new SeatUnavailableError(seatIds);
      }
    });
  },
  releaseTemporaryHold: async (showtimeId, seatIds, tokenHash, now) => {
    await prisma.$transaction(async (transaction) => {
      await transaction.seat.updateMany({
        where: {
          showtimeId,
          id: { in: seatIds },
          bookingId: null,
          hold: {
            is: {
              tokenHash,
              expiresAt: { gt: now },
            },
          },
        },
        data: { holdId: null },
      });
      await transaction.seatHold.deleteMany({
        where: {
          tokenHash,
          expiresAt: { gt: now },
          seats: { none: {} },
        },
      });
    });
  },
};

function hashSessionToken(sessionToken: string) {
  return createHash('sha256').update(sessionToken).digest('hex');
}

function priceInCents(price: number) {
  return Math.round((price + Number.EPSILON) * 100);
}

export async function getSeatMap(
  showtimeId: string,
  sessionToken: string,
  repository: SeatRepository = prismaSeatRepository,
  now: Date = new Date(),
): Promise<SeatMap | null> {
  const { exists, seats, priceCents } =
    await repository.findShowtimeSeats(showtimeId);

  if (!exists) {
    return null;
  }

  const tokenHash = hashSessionToken(sessionToken);

  return {
    showtimeId,
    priceCents,
    seats: seats.map((seat) => {
      const isHeld = seat.holdExpiresAt !== null && seat.holdExpiresAt > now;
      const status =
        seat.bookingId !== null ? 'occupied' : isHeld ? 'held' : 'available';

      return {
        id: seat.id,
        rowNumber: seat.rowNumber,
        seatNumber: seat.seatNumber,
        status,
        heldByCurrentSession: isHeld && seat.holdTokenHash === tokenHash,
        expiresAt: isHeld ? (seat.holdExpiresAt?.toISOString() ?? null) : null,
      };
    }),
  };
}

export async function releaseTemporarySeatHold(
  showtimeId: string,
  seatIds: string[],
  sessionToken: string,
  repository: SeatRepository = prismaSeatRepository,
  now: Date = new Date(),
): Promise<boolean> {
  const { exists } = await repository.findShowtimeSeats(showtimeId);

  if (!exists) {
    return false;
  }

  await repository.releaseTemporaryHold(
    showtimeId,
    seatIds,
    hashSessionToken(sessionToken),
    now,
  );

  return true;
}

export async function createTemporarySeatHold(
  showtimeId: string,
  seatIds: string[],
  sessionToken: string,
  repository: SeatRepository = prismaSeatRepository,
  now: Date = new Date(),
): Promise<SeatHoldResult | null> {
  const { exists, seats } = await repository.findShowtimeSeats(showtimeId);

  if (!exists) {
    return null;
  }

  const requestedSeats = new Set(seatIds);
  const unavailableSeatIds = seatIds.filter((seatId) => {
    const seat = seats.find((candidate) => candidate.id === seatId);

    return (
      !seat ||
      seat.bookingId !== null ||
      (seat.holdExpiresAt !== null && seat.holdExpiresAt > now)
    );
  });

  if (unavailableSeatIds.length > 0 || requestedSeats.size !== seatIds.length) {
    throw new SeatUnavailableError(unavailableSeatIds);
  }

  const expiresAt = new Date(now.getTime() + SEAT_HOLD_DURATION_MS);

  await repository.createTemporaryHold(
    showtimeId,
    seatIds,
    hashSessionToken(sessionToken),
    expiresAt,
    now,
  );

  return { heldSeatIds: seatIds, expiresAt: expiresAt.toISOString() };
}
