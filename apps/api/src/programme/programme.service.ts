import { Genre } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { prisma } from '../data/prisma.js';
import { genreLabels } from './genre.js';
import { getProgrammeWindow, PROGRAMME_TIME_ZONE } from './programme-window.js';

type ShowtimeWithMovie = Prisma.ShowtimeGetPayload<{
  include: { movie: true };
}>;

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
  startTime: string;
}

export async function getUpcomingProgramme(
  repository: ProgrammeRepository = prismaProgrammeRepository,
  now: Date = new Date(),
): Promise<ProgrammeItem[]> {
  const window = getProgrammeWindow(now);
  const showtimes = await repository.findUpcomingShowtimes(now, window.until);

  return showtimes.map(({ id, movie, roomName, startTime }) => ({
    id,
    title: movie.title,
    genre: movie.genre,
    genreLabel: genreLabels[movie.genre],
    duration: movie.duration,
    posterUrl: movie.posterUrl,
    roomName,
    startTime: DateTime.fromJSDate(startTime, { zone: PROGRAMME_TIME_ZONE })
      .toUTC()
      .toISO()!,
  }));
}
