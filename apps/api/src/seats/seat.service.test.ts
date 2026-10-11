import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { Prisma } from '@prisma/client';
import { prisma } from '../data/prisma.js';
import {
  createTemporarySeatHold,
  getSeatMap,
  SEAT_HOLD_DURATION_MS,
  SeatUnavailableError,
  type SeatRepository,
} from './seat.service.js';

const now = new Date('2026-10-11T10:00:00.000Z');
const sessionToken = '7e4cbf13-f749-4b7d-8fa6-28e9fa88f38b';

type SeatFixture = {
  id: string;
  rowNumber: string;
  seatNumber: number;
  bookingId: string | null;
  holdTokenHash: string | null;
  holdExpiresAt: Date | null;
};

function createRepository(
  seats: SeatFixture[] = [
    {
      id: 'seat-free',
      rowNumber: 'A',
      seatNumber: 1,
      bookingId: null,
      holdTokenHash: null,
      holdExpiresAt: null,
    },
    {
      id: 'seat-booked',
      rowNumber: 'A',
      seatNumber: 2,
      bookingId: 'booking-1',
      holdTokenHash: null,
      holdExpiresAt: null,
    },
    {
      id: 'seat-held',
      rowNumber: 'A',
      seatNumber: 3,
      bookingId: null,
      holdTokenHash:
        'c0620acca9d2a3ed0a2383694af18c9d057faa89191268bf9082ca15b98ba421',
      holdExpiresAt: new Date('2026-10-11T10:10:00.000Z'),
    },
  ],
): jest.Mocked<SeatRepository> {
  return {
    findShowtimeSeats: jest
      .fn<SeatRepository['findShowtimeSeats']>()
      .mockResolvedValue({
        exists: true,
        seats,
      }),
    createTemporaryHold: jest
      .fn<SeatRepository['createTemporaryHold']>()
      .mockResolvedValue(),
  };
}

describe('seat service', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns free, occupied, held, and expired states without exposing session tokens', async () => {
    const baseRepository = createRepository();
    const { seats } = await baseRepository.findShowtimeSeats('showtime-1');
    const repository = createRepository([
      ...seats.map((seat) =>
        seat.id === 'seat-held'
          ? { ...seat, holdTokenHash: 'another-session-hash' }
          : seat,
      ),
      {
        id: 'seat-expired',
        rowNumber: 'B',
        seatNumber: 1,
        bookingId: null,
        holdTokenHash: 'expired-token',
        holdExpiresAt: new Date('2026-10-11T09:59:59.000Z'),
      },
    ]);

    const result = await getSeatMap(
      'showtime-1',
      sessionToken,
      repository,
      now,
    );

    expect(result?.seats.map(({ id, status }) => [id, status])).toEqual([
      ['seat-free', 'available'],
      ['seat-booked', 'occupied'],
      ['seat-held', 'held'],
      ['seat-expired', 'available'],
    ]);
    expect(result?.seats[2]).toMatchObject({
      heldByCurrentSession: false,
      expiresAt: '2026-10-11T10:10:00.000Z',
    });
    expect(JSON.stringify(result)).not.toContain(sessionToken);
  });

  it('marks a hold as owned by the matching anonymous session', async () => {
    const repository = createRepository([
      {
        id: 'seat-held',
        rowNumber: 'A',
        seatNumber: 1,
        bookingId: null,
        holdTokenHash:
          'c0620acca9d2a3ed0a2383694af18c9d057faa89191268bf9082ca15b98ba421',
        holdExpiresAt: new Date('2026-10-11T10:10:00.000Z'),
      },
    ]);

    const result = await getSeatMap(
      'showtime-1',
      sessionToken,
      repository,
      now,
    );

    expect(result?.seats[0]?.heldByCurrentSession).toBe(true);
  });

  it('creates an atomic ten-minute hold for available seats', async () => {
    const repository = createRepository();

    const result = await createTemporarySeatHold(
      'showtime-1',
      ['seat-free'],
      sessionToken,
      repository,
      now,
    );

    expect(result).toEqual({
      heldSeatIds: ['seat-free'],
      expiresAt: '2026-10-11T10:10:00.000Z',
    });
    expect(repository.createTemporaryHold).toHaveBeenCalledWith(
      'showtime-1',
      ['seat-free'],
      'c0620acca9d2a3ed0a2383694af18c9d057faa89191268bf9082ca15b98ba421',
      new Date(now.getTime() + SEAT_HOLD_DURATION_MS),
      now,
    );
  });

  it('rejects occupied and temporarily held seats before persisting a hold', async () => {
    const repository = createRepository();

    await expect(
      createTemporarySeatHold(
        'showtime-1',
        ['seat-booked', 'seat-held'],
        sessionToken,
        repository,
        now,
      ),
    ).rejects.toEqual(new SeatUnavailableError(['seat-booked', 'seat-held']));
    expect(repository.createTemporaryHold).not.toHaveBeenCalled();
  });

  it('returns null when the screening does not exist', async () => {
    const repository = createRepository();
    repository.findShowtimeSeats.mockResolvedValue({
      exists: false,
      seats: [],
    });

    await expect(
      getSeatMap('missing-showtime', sessionToken, repository, now),
    ).resolves.toBeNull();
    await expect(
      createTemporarySeatHold(
        'missing-showtime',
        ['seat-free'],
        sessionToken,
        repository,
        now,
      ),
    ).resolves.toBeNull();
  });

  it('loads and maps seats using the Prisma repository by default', async () => {
    const findUnique = jest
      .spyOn(prisma.showtime, 'findUnique')
      .mockResolvedValue({
        id: 'showtime-1',
        startTime: now,
        movieId: 'movie-1',
        roomId: 'Salle A',
        price: 9.5,
        createdAt: now,
        updatedAt: now,
      });
    const findMany = jest.spyOn(prisma.seat, 'findMany').mockResolvedValue([
      {
        id: 'seat-free',
        rowNumber: 'A',
        seatNumber: 1,
        showtimeId: 'showtime-1',
        bookingId: null,
        holdId: null,
      },
    ]);

    await expect(
      getSeatMap('showtime-1', sessionToken, undefined, now),
    ).resolves.toEqual({
      showtimeId: 'showtime-1',
      seats: [
        {
          id: 'seat-free',
          rowNumber: 'A',
          seatNumber: 1,
          status: 'available',
          heldByCurrentSession: false,
          expiresAt: null,
        },
      ],
    });

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'showtime-1' },
      select: { id: true },
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { showtimeId: 'showtime-1' },
      include: { hold: true },
      orderBy: [{ rowNumber: 'asc' }, { seatNumber: 'asc' }],
    });
  });

  it('does not query seats when the Prisma repository cannot find the screening', async () => {
    const findUnique = jest
      .spyOn(prisma.showtime, 'findUnique')
      .mockResolvedValue(null);
    const findMany = jest.spyOn(prisma.seat, 'findMany');

    await expect(
      getSeatMap('missing-showtime', sessionToken, undefined, now),
    ).resolves.toBeNull();
    expect(findUnique).toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('persists a temporary hold in a transaction and removes expired holds', async () => {
    const findUnique = jest
      .spyOn(prisma.showtime, 'findUnique')
      .mockResolvedValue({
        id: 'showtime-1',
        startTime: now,
        movieId: 'movie-1',
        roomId: 'Salle A',
        price: 9.5,
        createdAt: now,
        updatedAt: now,
      });
    jest.spyOn(prisma.seat, 'findMany').mockResolvedValue([
      {
        id: 'seat-free',
        rowNumber: 'A',
        seatNumber: 1,
        showtimeId: 'showtime-1',
        bookingId: null,
        holdId: null,
      },
    ]);
    const deleteMany = jest
      .fn<(args: object) => Promise<{ count: number }>>()
      .mockResolvedValue({ count: 1 });
    const create = jest
      .fn<(args: object) => Promise<{ id: string }>>()
      .mockResolvedValue({ id: 'hold-1' });
    const updateMany = jest
      .fn<(args: object) => Promise<{ count: number }>>()
      .mockResolvedValue({ count: 1 });
    const transaction = {
      seatHold: { deleteMany, create },
      seat: { updateMany },
    } as unknown as Prisma.TransactionClient;
    const transactionSpy = jest
      .spyOn(prisma, '$transaction')
      .mockImplementation((callback) => callback(transaction));

    await expect(
      createTemporarySeatHold(
        'showtime-1',
        ['seat-free'],
        sessionToken,
        undefined,
        now,
      ),
    ).resolves.toEqual({
      heldSeatIds: ['seat-free'],
      expiresAt: '2026-10-11T10:10:00.000Z',
    });

    expect(findUnique).toHaveBeenCalled();
    expect(deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lte: now } },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        tokenHash:
          'c0620acca9d2a3ed0a2383694af18c9d057faa89191268bf9082ca15b98ba421',
        expiresAt: new Date('2026-10-11T10:10:00.000Z'),
      },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        showtimeId: 'showtime-1',
        id: { in: ['seat-free'] },
        bookingId: null,
        holdId: null,
      },
      data: { holdId: 'hold-1' },
    });
    expect(transactionSpy).toHaveBeenCalledTimes(1);
  });

  it('rolls back the transaction when a seat is concurrently unavailable', async () => {
    jest.spyOn(prisma.showtime, 'findUnique').mockResolvedValue({
      id: 'showtime-1',
      startTime: now,
      movieId: 'movie-1',
      roomId: 'Salle A',
      price: 9.5,
      createdAt: now,
      updatedAt: now,
    });
    jest.spyOn(prisma.seat, 'findMany').mockResolvedValue([
      {
        id: 'seat-free',
        rowNumber: 'A',
        seatNumber: 1,
        showtimeId: 'showtime-1',
        bookingId: null,
        holdId: null,
      },
    ]);
    const updateMany = jest
      .fn<(args: object) => Promise<{ count: number }>>()
      .mockResolvedValue({ count: 0 });
    const transaction = {
      seatHold: {
        deleteMany: jest
          .fn<(args: object) => Promise<{ count: number }>>()
          .mockResolvedValue({ count: 0 }),
        create: jest
          .fn<(args: object) => Promise<{ id: string }>>()
          .mockResolvedValue({ id: 'hold-1' }),
      },
      seat: { updateMany },
    } as unknown as Prisma.TransactionClient;
    jest
      .spyOn(prisma, '$transaction')
      .mockImplementation((callback) => callback(transaction));

    await expect(
      createTemporarySeatHold(
        'showtime-1',
        ['seat-free'],
        sessionToken,
        undefined,
        now,
      ),
    ).rejects.toEqual(new SeatUnavailableError(['seat-free']));
  });
});
