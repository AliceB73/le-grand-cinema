import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Prisma } from '@prisma/client';
import { prisma } from '../data/prisma.js';
import { AdminRuleError, createAdminService } from './admin.service.js';

const service = createAdminService();

describe('admin sales report', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('aggregates confirmed sales by Paris calendar day and showtime', async () => {
    jest.spyOn(prisma, '$queryRaw').mockResolvedValue([
      {
        showtimeId: 's1',
        startTime: new Date('2026-12-01T23:30:00.000Z'),
        movieId: 'm1',
        movieTitle: 'Film A',
        genre: 'DRAME',
        roomName: 'Salle A',
        revenueCents: 2500n,
        ticketsSold: 2n,
      },
      {
        showtimeId: 's2',
        startTime: new Date('2026-12-02T18:00:00.000Z'),
        movieId: 'm2',
        movieTitle: 'Film B',
        genre: 'ACTION',
        roomName: 'Salle B',
        revenueCents: 1800n,
        ticketsSold: 1n,
      },
    ] as never);

    await expect(
      service.getSalesReport({
        startDate: '2026-12-01',
        endDate: '2026-12-31',
      }),
    ).resolves.toEqual({
      totals: { revenueCents: 4300, ticketsSold: 3 },
      daily: [{ date: '2026-12-02', revenueCents: 4300, ticketsSold: 3 }],
      showtimes: [
        {
          showtimeId: 's1',
          startTime: '2026-12-01T23:30:00.000Z',
          movieId: 'm1',
          movieTitle: 'Film A',
          genre: 'DRAME',
          roomName: 'Salle A',
          revenueCents: 2500,
          ticketsSold: 2,
        },
        {
          showtimeId: 's2',
          startTime: '2026-12-02T18:00:00.000Z',
          movieId: 'm2',
          movieTitle: 'Film B',
          genre: 'ACTION',
          roomName: 'Salle B',
          revenueCents: 1800,
          ticketsSold: 1,
        },
      ],
    });
  });

  it('rejects invalid date ranges before querying sales', async () => {
    const query = jest.spyOn(prisma, '$queryRaw');

    await expect(
      service.getSalesReport({
        startDate: '2026-12-31',
        endDate: '2026-12-01',
      }),
    ).rejects.toBeInstanceOf(AdminRuleError);
    expect(query).not.toHaveBeenCalled();
  });

  it('uses parameterized query filters for each selected dimension', async () => {
    const query = jest
      .spyOn(prisma, '$queryRaw')
      .mockResolvedValue([] as never);

    await service.getSalesReport({
      startDate: '2026-12-01',
      endDate: '2026-12-31',
      genre: 'DRAME',
      movieId: 'm1',
      roomId: 'Salle A',
      showtimeId: 's1',
    });

    const statement = query.mock.calls[0][0] as Prisma.Sql;
    expect(statement.sql).toContain('b."status"');
    expect(statement.values).toEqual(
      expect.arrayContaining(['DRAME', 'm1', 'Salle A', 's1']),
    );
  });
});
