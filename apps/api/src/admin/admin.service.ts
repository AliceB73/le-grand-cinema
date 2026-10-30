import { Genre, Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { prisma } from '../data/prisma.js';
import { buildSeatLayout } from '../seats/seat-layout.js';
import {
  dayRangeToPeriod,
  periodToDayRange,
  periodsOverlap,
  resolveShowtimePrice,
} from './rates.js';

const MINUTE_MS = 60_000;
const MAX_MOVIE_DURATION_MINUTES = 24 * 60;
const PARIS_TIME_ZONE = 'Europe/Paris';

export class AdminNotFoundError extends Error {
  constructor(readonly entity: 'movie' | 'room' | 'showtime' | 'rate') {
    super(`${entity} not found`);
    this.name = 'AdminNotFoundError';
  }
}

export class ShowtimeConflictError extends Error {
  constructor(
    readonly conflict: { movieTitle: string; startTime: Date; endTime: Date },
  ) {
    super('The showtime overlaps an existing showtime in the same room.');
    this.name = 'ShowtimeConflictError';
  }
}

export class AdminRuleError extends Error {
  constructor(
    readonly reason:
      | 'PAST_START'
      | 'SHOWTIME_CANCELLED'
      | 'MOVIE_HAS_SHOWTIMES'
      | 'ROOM_HAS_BOOKINGS'
      | 'INVALID_PERIOD'
      | 'RATE_OVERLAP',
  ) {
    super(reason);
    this.name = 'AdminRuleError';
  }
}

export interface ScheduledSlot {
  startTime: Date;
  durationMinutes: number;
  movieTitle: string;
}

export function slotEnd(startTime: Date, durationMinutes: number) {
  return new Date(startTime.getTime() + durationMinutes * MINUTE_MS);
}

export function findOverlap(
  candidate: { startTime: Date; durationMinutes: number },
  existing: ScheduledSlot[],
) {
  const candidateEnd = slotEnd(candidate.startTime, candidate.durationMinutes);
  return existing.find(
    (slot) =>
      slot.startTime < candidateEnd &&
      slotEnd(slot.startTime, slot.durationMinutes) > candidate.startTime,
  );
}

export interface AdminShowtime {
  id: string;
  movieId: string;
  movieTitle: string;
  roomName: string;
  startTime: string;
  endTime: string;
  price: number;
  status: 'SCHEDULED' | 'CANCELLED';
  confirmedBookings: number;
}

export interface AdminMovie {
  id: string;
  title: string;
  genre: Genre;
  description: string;
  duration: number;
  posterUrl: string | null;
}

export interface AdminRoom {
  name: string;
  category: string;
  capacity: number;
  rows: number;
  columns: number;
  defaultPrice: number;
}

export interface AdminSpecialRate {
  id: string;
  roomName: string;
  label: string;
  startDate: string;
  endDate: string;
  price: number;
}

export interface SpecialRateInput {
  roomName: string;
  label: string;
  startDate: string;
  endDate: string;
  price: number;
}

function toAdminRate(rate: {
  id: string;
  roomId: string;
  label: string;
  startsAt: Date;
  endsAt: Date;
  price: number;
}): AdminSpecialRate {
  return {
    id: rate.id,
    roomName: rate.roomId,
    label: rate.label,
    ...periodToDayRange(rate),
    price: rate.price,
  };
}

export interface MovieInput {
  title: string;
  genre: Genre;
  description: string;
  duration: number;
  posterUrl?: string | null;
}

export interface SalesReportInput {
  startDate: string;
  endDate: string;
  genre?: Genre;
  movieId?: string;
  roomId?: string;
  showtimeId?: string;
}

interface SalesAggregateRow {
  showtimeId: string;
  startTime: Date;
  movieId: string;
  movieTitle: string;
  genre: Genre;
  roomName: string;
  revenueCents: bigint;
  ticketsSold: bigint;
}

function toSafeInteger(value: bigint, field: string) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new RangeError(`${field} exceeds the supported integer range.`);
  }
  return number;
}

type ShowtimeRow = Prisma.ShowtimeGetPayload<{ include: { movie: true } }>;

function toAdminShowtime(
  showtime: ShowtimeRow,
  confirmedBookings: number,
): AdminShowtime {
  return {
    id: showtime.id,
    movieId: showtime.movieId,
    movieTitle: showtime.movie.title,
    roomName: showtime.roomId,
    startTime: showtime.startTime.toISOString(),
    endTime: slotEnd(showtime.startTime, showtime.movie.duration).toISOString(),
    price: showtime.price,
    status: showtime.status,
    confirmedBookings,
  };
}

async function loadShowtime(id: string): Promise<AdminShowtime> {
  const showtime = await prisma.showtime.findUnique({
    where: { id },
    include: { movie: true },
  });
  if (!showtime) {
    throw new AdminNotFoundError('showtime');
  }
  const confirmed = await prisma.booking.count({
    where: { showtimeId: id, status: 'CONFIRMED' },
  });
  return toAdminShowtime(showtime, confirmed);
}

export function createAdminService(now: () => Date = () => new Date()) {
  return {
    async listShowtimes(): Promise<AdminShowtime[]> {
      const showtimes = await prisma.showtime.findMany({
        include: { movie: true },
        orderBy: { startTime: 'asc' },
      });
      const confirmed = await prisma.booking.groupBy({
        by: ['showtimeId'],
        where: { status: 'CONFIRMED' },
        _count: { _all: true },
      });
      const counts = new Map(
        confirmed.map((row) => [row.showtimeId, row._count._all]),
      );
      return showtimes.map((showtime) =>
        toAdminShowtime(showtime, counts.get(showtime.id) ?? 0),
      );
    },

    async listRooms(): Promise<AdminRoom[]> {
      return prisma.room.findMany({ orderBy: { name: 'asc' } });
    },

    async updateRoom(
      name: string,
      input: { rows: number; columns: number; defaultPrice: number },
    ): Promise<AdminRoom> {
      return prisma.$transaction(async (transaction) => {
        const room = await transaction.room.findUnique({ where: { name } });
        if (!room) {
          throw new AdminNotFoundError('room');
        }
        const layoutChanged =
          room.rows !== input.rows || room.columns !== input.columns;
        if (layoutChanged) {
          // Same lock as showtime creation: no new showtime while seats are regenerated.
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${room.name}))`;
          const upcoming = await transaction.showtime.findMany({
            where: {
              roomId: name,
              status: 'SCHEDULED',
              startTime: { gt: now() },
            },
            select: { id: true },
          });
          const showtimeIds = upcoming.map(({ id }) => id);
          const bookings = await transaction.booking.count({
            where: {
              showtimeId: { in: showtimeIds },
              status: { in: ['PENDING', 'CONFIRMED'] },
            },
          });
          if (bookings > 0) {
            throw new AdminRuleError('ROOM_HAS_BOOKINGS');
          }
          await transaction.seat.deleteMany({
            where: { showtimeId: { in: showtimeIds } },
          });
          await transaction.seat.createMany({
            data: showtimeIds.flatMap((showtimeId) =>
              buildSeatLayout(showtimeId, input.rows, input.columns),
            ),
          });
        }
        return transaction.room.update({
          where: { name },
          data: {
            rows: input.rows,
            columns: input.columns,
            capacity: input.rows * input.columns,
            defaultPrice: input.defaultPrice,
          },
        });
      });
    },

    async listSpecialRates(): Promise<AdminSpecialRate[]> {
      const rates = await prisma.specialRate.findMany({
        orderBy: [{ roomId: 'asc' }, { startsAt: 'asc' }],
      });
      return rates.map(toAdminRate);
    },

    async saveSpecialRate(
      input: SpecialRateInput,
      id?: string,
    ): Promise<AdminSpecialRate> {
      const period = dayRangeToPeriod(input.startDate, input.endDate);
      if (!period) {
        throw new AdminRuleError('INVALID_PERIOD');
      }
      const saved = await prisma.$transaction(async (transaction) => {
        const room = await transaction.room.findUnique({
          where: { name: input.roomName },
        });
        if (!room) {
          throw new AdminNotFoundError('room');
        }
        if (
          id &&
          !(await transaction.specialRate.findUnique({ where: { id } }))
        ) {
          throw new AdminNotFoundError('rate');
        }
        const others = await transaction.specialRate.findMany({
          where: { roomId: room.name, ...(id ? { id: { not: id } } : {}) },
        });
        if (others.some((other) => periodsOverlap(other, period))) {
          throw new AdminRuleError('RATE_OVERLAP');
        }
        const data = {
          roomId: room.name,
          label: input.label,
          price: input.price,
          ...period,
        };
        return id
          ? transaction.specialRate.update({ where: { id }, data })
          : transaction.specialRate.create({ data });
      });
      return toAdminRate(saved);
    },

    async deleteSpecialRate(id: string): Promise<void> {
      const existing = await prisma.specialRate.findUnique({ where: { id } });
      if (!existing) {
        throw new AdminNotFoundError('rate');
      }
      await prisma.specialRate.delete({ where: { id } });
    },

    async listMovies(): Promise<AdminMovie[]> {
      return prisma.movie.findMany({
        select: {
          id: true,
          title: true,
          genre: true,
          description: true,
          duration: true,
          posterUrl: true,
        },
        orderBy: { title: 'asc' },
      });
    },

    async getSalesReport(input: SalesReportInput) {
      const period = dayRangeToPeriod(input.startDate, input.endDate);
      if (!period) {
        throw new AdminRuleError('INVALID_PERIOD');
      }

      const conditions = [
        Prisma.sql`b."status" = 'CONFIRMED'::"BookingStatus"`,
        Prisma.sql`st."startTime" >= ${period.startsAt}`,
        Prisma.sql`st."startTime" < ${period.endsAt}`,
      ];
      if (input.genre) {
        conditions.push(Prisma.sql`m."genre" = ${input.genre}::"Genre"`);
      }
      if (input.movieId) {
        conditions.push(Prisma.sql`st."movieId" = ${input.movieId}`);
      }
      if (input.roomId) {
        conditions.push(Prisma.sql`st."roomId" = ${input.roomId}`);
      }
      if (input.showtimeId) {
        conditions.push(Prisma.sql`st."id" = ${input.showtimeId}`);
      }

      const rows = await prisma.$queryRaw<SalesAggregateRow[]>(Prisma.sql`
        SELECT
          st."id" AS "showtimeId",
          st."startTime",
          st."movieId",
          m."title" AS "movieTitle",
          m."genre",
          st."roomId" AS "roomName",
          COALESCE(SUM(b."totalAmountCents"), 0)::bigint AS "revenueCents",
          COALESCE(SUM(CARDINALITY(b."seatIds")), 0)::bigint AS "ticketsSold"
        FROM "Booking" b
        INNER JOIN "Showtime" st ON st."id" = b."showtimeId"
        INNER JOIN "Movie" m ON m."id" = st."movieId"
        WHERE ${Prisma.join(conditions, ' AND ')}
        GROUP BY st."id", st."startTime", st."movieId", m."title", m."genre", st."roomId"
        ORDER BY st."startTime" ASC, m."title" ASC
      `);

      const dailyTotals = new Map<
        string,
        { revenueCents: bigint; ticketsSold: bigint }
      >();
      let totalRevenueCents = 0n;
      let totalTicketsSold = 0n;
      const showtimes = rows.map((row) => {
        const date = DateTime.fromJSDate(row.startTime, { zone: 'utc' })
          .setZone(PARIS_TIME_ZONE)
          .toISODate();
        if (!date) {
          throw new RangeError('Unable to format the showtime date.');
        }
        const daily = dailyTotals.get(date) ?? {
          revenueCents: 0n,
          ticketsSold: 0n,
        };
        daily.revenueCents += row.revenueCents;
        daily.ticketsSold += row.ticketsSold;
        dailyTotals.set(date, daily);
        totalRevenueCents += row.revenueCents;
        totalTicketsSold += row.ticketsSold;

        return {
          showtimeId: row.showtimeId,
          startTime: row.startTime.toISOString(),
          movieId: row.movieId,
          movieTitle: row.movieTitle,
          genre: row.genre,
          roomName: row.roomName,
          revenueCents: toSafeInteger(row.revenueCents, 'Showtime revenue'),
          ticketsSold: toSafeInteger(row.ticketsSold, 'Showtime ticket count'),
        };
      });

      return {
        totals: {
          revenueCents: toSafeInteger(totalRevenueCents, 'Total revenue'),
          ticketsSold: toSafeInteger(totalTicketsSold, 'Total ticket count'),
        },
        daily: [...dailyTotals.entries()].map(([date, totals]) => ({
          date,
          revenueCents: toSafeInteger(totals.revenueCents, 'Daily revenue'),
          ticketsSold: toSafeInteger(totals.ticketsSold, 'Daily ticket count'),
        })),
        showtimes,
      };
    },

    async createShowtime(input: {
      movieId: string;
      roomId: string;
      startTime: Date;
      price?: number;
    }): Promise<AdminShowtime> {
      if (input.startTime <= now()) {
        throw new AdminRuleError('PAST_START');
      }
      const id = await prisma.$transaction(async (transaction) => {
        const [movie, room] = await Promise.all([
          transaction.movie.findUnique({ where: { id: input.movieId } }),
          transaction.room.findUnique({ where: { name: input.roomId } }),
        ]);
        if (!movie) {
          throw new AdminNotFoundError('movie');
        }
        if (!room) {
          throw new AdminNotFoundError('room');
        }

        // Serialise concurrent creations in the same room.
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${room.name}))`;
        const neighbours = await transaction.showtime.findMany({
          where: {
            roomId: room.name,
            status: 'SCHEDULED',
            startTime: {
              gte: new Date(
                input.startTime.getTime() -
                  MAX_MOVIE_DURATION_MINUTES * MINUTE_MS,
              ),
              lt: slotEnd(input.startTime, movie.duration),
            },
          },
          include: { movie: { select: { title: true, duration: true } } },
        });
        const conflict = findOverlap(
          { startTime: input.startTime, durationMinutes: movie.duration },
          neighbours.map((showtime) => ({
            startTime: showtime.startTime,
            durationMinutes: showtime.movie.duration,
            movieTitle: showtime.movie.title,
          })),
        );
        if (conflict) {
          throw new ShowtimeConflictError({
            movieTitle: conflict.movieTitle,
            startTime: conflict.startTime,
            endTime: slotEnd(conflict.startTime, conflict.durationMinutes),
          });
        }

        const price =
          input.price ??
          resolveShowtimePrice(
            input.startTime,
            room.defaultPrice,
            await transaction.specialRate.findMany({
              where: { roomId: room.name },
              orderBy: { startsAt: 'asc' },
            }),
          );
        const created = await transaction.showtime.create({
          data: {
            movieId: movie.id,
            roomId: room.name,
            startTime: input.startTime,
            price,
          },
        });
        await transaction.seat.createMany({
          data: buildSeatLayout(created.id, room.rows, room.columns),
        });
        return created.id;
      });
      return loadShowtime(id);
    },

    async updateShowtimePrice(
      id: string,
      price: number,
    ): Promise<AdminShowtime> {
      const existing = await prisma.showtime.findUnique({ where: { id } });
      if (!existing) {
        throw new AdminNotFoundError('showtime');
      }
      if (existing.status === 'CANCELLED') {
        throw new AdminRuleError('SHOWTIME_CANCELLED');
      }
      await prisma.showtime.update({ where: { id }, data: { price } });
      return loadShowtime(id);
    },

    async cancelShowtime(
      id: string,
    ): Promise<{ showtime: AdminShowtime; notifiedBookings: number }> {
      const notifiedBookings = await prisma.$transaction(
        async (transaction) => {
          const showtime = await transaction.showtime.findUnique({
            where: { id },
          });
          if (!showtime) {
            throw new AdminNotFoundError('showtime');
          }
          if (showtime.status === 'CANCELLED') {
            return 0;
          }

          await transaction.showtime.update({
            where: { id },
            data: { status: 'CANCELLED', cancelledAt: now() },
          });
          const bookings = await transaction.booking.findMany({
            where: { showtimeId: id, status: 'CONFIRMED' },
            select: {
              id: true,
              guestEmail: true,
              user: { select: { email: true } },
            },
          });
          await transaction.booking.updateMany({
            where: { id: { in: bookings.map((booking) => booking.id) } },
            data: { status: 'REFUND_REQUIRED' },
          });
          await transaction.emailDelivery.createMany({
            data: bookings.map((booking) => {
              const hasRecipient = Boolean(
                booking.guestEmail ?? booking.user?.email,
              );
              return {
                bookingId: booking.id,
                kind: 'SHOWTIME_CANCELLED' as const,
                status: hasRecipient
                  ? ('PENDING' as const)
                  : ('FAILED' as const),
                lastError: hasRecipient ? null : 'MISSING_RECIPIENT_EMAIL',
              };
            }),
            skipDuplicates: true,
          });
          return bookings.length;
        },
      );
      return { showtime: await loadShowtime(id), notifiedBookings };
    },

    async createMovie(input: MovieInput): Promise<AdminMovie> {
      return prisma.movie.create({
        data: { ...input, posterUrl: input.posterUrl ?? null },
      });
    },

    async updateMovie(id: string, input: MovieInput): Promise<AdminMovie> {
      const existing = await prisma.movie.findUnique({ where: { id } });
      if (!existing) {
        throw new AdminNotFoundError('movie');
      }
      return prisma.movie.update({
        where: { id },
        data: { ...input, posterUrl: input.posterUrl ?? null },
      });
    },

    async deleteMovie(id: string): Promise<void> {
      const movie = await prisma.movie.findUnique({
        where: { id },
        include: { _count: { select: { showtimes: true } } },
      });
      if (!movie) {
        throw new AdminNotFoundError('movie');
      }
      if (movie._count.showtimes > 0) {
        throw new AdminRuleError('MOVIE_HAS_SHOWTIMES');
      }
      await prisma.movie.delete({ where: { id } });
    },
  };
}

export type AdminService = ReturnType<typeof createAdminService>;
