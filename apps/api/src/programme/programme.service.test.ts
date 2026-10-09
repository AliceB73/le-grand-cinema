import { Genre, RoomCategory } from '@prisma/client';
import { describe, expect, it, jest } from '@jest/globals';
import { prisma } from '../data/prisma.js';
import {
  getUpcomingProgramme,
  type ProgrammeRepository,
} from './programme.service.js';

describe('getUpcomingProgramme', () => {
  it('queries only future screenings through the end of the seventh Paris date in time order', async () => {
    const now = new Date('2026-10-04T14:00:00.000Z');
    const findUpcomingShowtimes = jest
      .fn<ProgrammeRepository['findUpcomingShowtimes']>()
      .mockResolvedValue([
        {
          id: 'screening-1',
          startTime: new Date('2026-10-04T15:00:00.000Z'),
          roomId: 'Salle A',
          room: {
            name: 'Salle A',
            category: RoomCategory.PREMIUM_IMAX,
            capacity: 300,
          },
          movie: {
            id: 'movie-1',
            title: 'Les Veilleurs du Phare',
            genre: Genre.THRILLER,
            description: 'Un récit fictif.',
            duration: 108,
            posterUrl: '/posters/veilleurs-du-phare.svg',
            createdAt: now,
            updatedAt: now,
          },
          movieId: 'movie-1',
          price: 9.5,
          bookings: [{ _count: { seats: 240 } }],
          createdAt: now,
          updatedAt: now,
        },
      ]);
    const repository = { findUpcomingShowtimes };

    const result = await getUpcomingProgramme(repository, now);

    expect(findUpcomingShowtimes).toHaveBeenCalledWith(
      now,
      new Date('2026-10-10T22:00:00.000Z'),
    );
    expect(result).toEqual([
      {
        id: 'screening-1',
        title: 'Les Veilleurs du Phare',
        genre: Genre.THRILLER,
        genreLabel: 'Thriller',
        duration: 108,
        posterUrl: '/posters/veilleurs-du-phare.svg',
        roomName: 'Salle A',
        occupancyStatus: 'LAST_SEATS',
        startTime: '2026-10-04T15:00:00.000Z',
      },
    ]);
  });

  it('classifies occupancy below 80%, from 80%, and at full capacity', async () => {
    const now = new Date('2026-10-04T14:00:00.000Z');
    const createShowtime = (id: string, confirmedSeats: number) => ({
      id,
      startTime: new Date('2026-10-04T15:00:00.000Z'),
      roomId: 'Salle A',
      room: {
        name: 'Salle A',
        category: RoomCategory.PREMIUM_IMAX,
        capacity: 300,
      },
      movie: {
        id: 'movie-1',
        title: 'Les Veilleurs du Phare',
        genre: Genre.THRILLER,
        description: 'Un récit fictif.',
        duration: 108,
        posterUrl: null,
        createdAt: now,
        updatedAt: now,
      },
      movieId: 'movie-1',
      price: 9.5,
      bookings: [{ _count: { seats: confirmedSeats } }],
      createdAt: now,
      updatedAt: now,
    });
    const findUpcomingShowtimes = jest
      .fn<ProgrammeRepository['findUpcomingShowtimes']>()
      .mockResolvedValue([
        createShowtime('available', 239),
        createShowtime('last-seats', 240),
        createShowtime('full', 300),
      ]);

    const result = await getUpcomingProgramme({ findUpcomingShowtimes }, now);

    expect(result.map(({ occupancyStatus }) => occupancyStatus)).toEqual([
      'AVAILABLE',
      'LAST_SEATS',
      'FULL',
    ]);
  });

  it('uses the Prisma repository when no repository is provided', async () => {
    const now = new Date('2026-10-04T14:00:00.000Z');
    const findMany = jest
      .spyOn(prisma.showtime, 'findMany')
      .mockResolvedValue([]);
    jest.useFakeTimers().setSystemTime(now);

    try {
      await expect(getUpcomingProgramme()).resolves.toEqual([]);
      expect(findMany).toHaveBeenCalledWith({
        where: {
          startTime: {
            gte: now,
            lt: new Date('2026-10-10T22:00:00.000Z'),
          },
        },
        include: {
          movie: true,
          room: true,
          bookings: {
            where: { status: 'CONFIRMED' },
            select: { _count: { select: { seats: true } } },
          },
        },
        orderBy: { startTime: 'asc' },
      });
    } finally {
      findMany.mockRestore();
      jest.useRealTimers();
    }
  });
});
