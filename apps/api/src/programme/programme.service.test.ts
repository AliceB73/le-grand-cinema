import { Genre } from '@prisma/client';
import { describe, expect, it, jest } from '@jest/globals';
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
          roomName: 'Salle A',
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
        startTime: '2026-10-04T15:00:00.000Z',
      },
    ]);
  });
});
