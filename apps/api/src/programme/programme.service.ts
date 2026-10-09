import { Genre } from '@prisma/client';
import { BookingStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { prisma } from '../data/prisma.js';
import { genreLabels } from './genre.js';
import { getProgrammeWindow, PROGRAMME_TIME_ZONE } from './programme-window.js';

type ShowtimeWithMovie = Prisma.ShowtimeGetPayload<{
  include: {
    movie: true;
    room: true;
    bookings: {
      where: { status: typeof BookingStatus.CONFIRMED };
      select: { _count: { select: { seats: true } } };
    };
  };
}>;

export type OccupancyStatus = 'AVAILABLE' | 'LAST_SEATS' | 'FULL';

export interface ProgrammeRepository {
  findUpcomingShowtimes(from: Date, until: Date): Promise<ShowtimeWithMovie[]>;
}

const prismaProgrammeRepository: ProgrammeRepository = {
  findUpcomingShowtimes: (from, until) =>
    prisma.showtime.findMany({
      where: {
        startTime: {
          gte: from,
          lt: until,
        },
      },
      include: {
        movie: true,
        room: true,
        bookings: {
          where: { status: BookingStatus.CONFIRMED },
          select: { _count: { select: { seats: true } } },
        },
      },
      orderBy: {
        startTime: 'asc',
      },
    }),
};

export interface ProgrammeItem {
  id: string;
  title: string;
  genre: Genre;
  genreLabel: string;
  duration: number;
  posterUrl: string | null;
  roomName: string;
  occupancyStatus: OccupancyStatus;
  startTime: string;
}

function getOccupancyStatus(
  confirmedSeats: number,
  capacity: number,
): OccupancyStatus {
  const occupancy = confirmedSeats / capacity;

  if (occupancy >= 1) {
    return 'FULL';
  }

  return occupancy >= 0.8 ? 'LAST_SEATS' : 'AVAILABLE';
}

export async function getUpcomingProgramme(
  repository: ProgrammeRepository = prismaProgrammeRepository,
  now: Date = new Date(),
): Promise<ProgrammeItem[]> {
  const window = getProgrammeWindow(now);
  const showtimes = await repository.findUpcomingShowtimes(now, window.until);

  return showtimes.map(({ id, movie, room, bookings, startTime }) => {
    const confirmedSeats = bookings.reduce(
      (total, booking) => total + booking._count.seats,
      0,
    );

    return {
      id,
      title: movie.title,
      genre: movie.genre,
      genreLabel: genreLabels[movie.genre],
      duration: movie.duration,
      posterUrl: movie.posterUrl,
      roomName: room.name,
      occupancyStatus: getOccupancyStatus(confirmedSeats, room.capacity),
      startTime: DateTime.fromJSDate(startTime, { zone: PROGRAMME_TIME_ZONE })
        .toUTC()
        .toISO()!,
    };
  });
}
