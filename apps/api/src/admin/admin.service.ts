import { Genre, type Prisma } from '@prisma/client';
import { prisma } from '../data/prisma.js';
import { buildSeatLayout } from '../seats/seat-layout.js';

const MINUTE_MS = 60_000;
const MAX_MOVIE_DURATION_MINUTES = 24 * 60;

export class AdminNotFoundError extends Error {
  constructor(readonly entity: 'movie' | 'room' | 'showtime') {
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
      'PAST_START' | 'SHOWTIME_CANCELLED' | 'MOVIE_HAS_SHOWTIMES',
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
}

export interface MovieInput {
  title: string;
  genre: Genre;
  description: string;
  duration: number;
  posterUrl?: string | null;
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

    async createShowtime(input: {
      movieId: string;
      roomId: string;
      startTime: Date;
      price: number;
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

        const created = await transaction.showtime.create({
          data: {
            movieId: movie.id,
            roomId: room.name,
            startTime: input.startTime,
            price: input.price,
          },
        });
        await transaction.seat.createMany({
          data: buildSeatLayout(created.id, room.capacity, room.category),
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
