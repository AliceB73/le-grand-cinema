import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { prisma } from '../data/prisma.js';
import {
  AdminNotFoundError,
  AdminRuleError,
  ShowtimeConflictError,
  createAdminService,
} from './admin.service.js';

const now = new Date('2026-10-17T10:00:00.000Z');
const future = new Date('2026-12-01T18:00:00.000Z');
const movie = {
  id: 'm1',
  title: 'Film A',
  genre: 'DRAME' as const,
  description: 'd',
  duration: 120,
  posterUrl: null,
};
const showtimeRow = {
  id: 's1',
  movieId: 'm1',
  roomId: 'Salle A',
  startTime: future,
  price: 9.5,
  status: 'SCHEDULED' as const,
  cancelledAt: null,
  movie,
};

const service = createAdminService(() => now);

function mockTransaction(tx: Record<string, unknown>) {
  return jest
    .spyOn(prisma, '$transaction')
    .mockImplementation((async (callback: (client: unknown) => unknown) =>
      callback(tx)) as never);
}

function mockLoadShowtime(row: object = showtimeRow, confirmed = 0) {
  jest.spyOn(prisma.showtime, 'findUnique').mockResolvedValue(row as never);
  jest.spyOn(prisma.booking, 'count').mockResolvedValue(confirmed);
}

function createTx(neighbours: object[] = []) {
  return {
    movie: {
      findUnique: jest.fn<(...args: unknown[]) => Promise<unknown>>(
        async () => movie,
      ),
    },
    room: {
      findUnique: jest.fn<(...args: unknown[]) => Promise<unknown>>(
        async () => ({
          name: 'Salle A',
          category: 'STANDARD',
          capacity: 30,
          rows: 3,
          columns: 10,
          defaultPrice: 8,
        }),
      ),
    },
    specialRate: {
      findMany: jest.fn<(...args: unknown[]) => Promise<unknown>>(
        async () => [],
      ),
    },
    $executeRaw: jest.fn<(...args: unknown[]) => Promise<unknown>>(
      async () => 1,
    ),
    showtime: {
      findMany: jest.fn<(...args: unknown[]) => Promise<unknown>>(
        async () => neighbours,
      ),
      create: jest.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
        id: 's1',
      })),
    },
    seat: {
      createMany: jest.fn<(...args: unknown[]) => Promise<unknown>>(
        async () => ({ count: 30 }),
      ),
    },
  };
}

describe('admin service', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('lists showtimes with their confirmed booking counts', async () => {
    jest
      .spyOn(prisma.showtime, 'findMany')
      .mockResolvedValue([showtimeRow] as never);
    jest
      .spyOn(prisma.booking, 'groupBy')
      .mockResolvedValue([{ showtimeId: 's1', _count: { _all: 4 } }] as never);

    const [listed] = await service.listShowtimes();

    expect(listed).toMatchObject({
      id: 's1',
      movieTitle: 'Film A',
      roomName: 'Salle A',
      confirmedBookings: 4,
      endTime: '2026-12-01T20:00:00.000Z',
    });
  });

  it('defaults to zero confirmed bookings', async () => {
    jest
      .spyOn(prisma.showtime, 'findMany')
      .mockResolvedValue([showtimeRow] as never);
    jest.spyOn(prisma.booking, 'groupBy').mockResolvedValue([] as never);
    expect((await service.listShowtimes())[0]?.confirmedBookings).toBe(0);
  });

  it('lists rooms and movies', async () => {
    jest
      .spyOn(prisma.room, 'findMany')
      .mockResolvedValue([{ name: 'Salle A' }] as never);
    jest.spyOn(prisma.movie, 'findMany').mockResolvedValue([movie] as never);
    expect(await service.listRooms()).toHaveLength(1);
    expect(await service.listMovies()).toEqual([movie]);
  });

  describe('createShowtime', () => {
    const input = {
      movieId: 'm1',
      roomId: 'Salle A',
      startTime: future,
      price: 10,
    };

    it('rejects a start in the past', async () => {
      await expect(
        service.createShowtime({ ...input, startTime: now }),
      ).rejects.toMatchObject({ reason: 'PAST_START' });
    });

    it('creates the showtime and its seats', async () => {
      const tx = createTx();
      mockTransaction(tx);
      mockLoadShowtime();

      const created = await service.createShowtime(input);

      expect(created.id).toBe('s1');
      expect(tx.$executeRaw).toHaveBeenCalled();
      expect(tx.showtime.create).toHaveBeenCalledWith({
        data: {
          movieId: 'm1',
          roomId: 'Salle A',
          startTime: future,
          price: 10,
        },
      });
      expect(tx.seat.createMany).toHaveBeenCalledTimes(1);
    });

    it('uses the special rate, then the room default, when no price is given', async () => {
      const tx = createTx();
      tx.specialRate.findMany.mockResolvedValueOnce([
        {
          startsAt: new Date('2026-11-30T23:00:00.000Z'),
          endsAt: new Date('2026-12-07T23:00:00.000Z'),
          price: 12.5,
        },
      ] as never);
      mockTransaction(tx);
      mockLoadShowtime();
      await service.createShowtime({ ...input, price: undefined });
      expect(tx.showtime.create).toHaveBeenLastCalledWith({
        data: expect.objectContaining({ price: 12.5 }),
      });

      await service.createShowtime({
        ...input,
        price: undefined,
        startTime: new Date('2027-02-01T18:00:00.000Z'),
      });
      expect(tx.showtime.create).toHaveBeenLastCalledWith({
        data: expect.objectContaining({ price: 8 }),
      });
    });

    it('refuses an overlapping showtime in the same room', async () => {
      const tx = createTx([
        {
          startTime: new Date('2026-12-01T17:00:00.000Z'),
          movie: { title: 'Film B', duration: 120 },
        },
      ]);
      mockTransaction(tx);

      const error = await service.createShowtime(input).catch((e) => e);

      expect(error).toBeInstanceOf(ShowtimeConflictError);
      expect(error.conflict.movieTitle).toBe('Film B');
      expect(tx.showtime.create).not.toHaveBeenCalled();
    });

    it('fails for an unknown movie or room', async () => {
      const unknownMovie = createTx();
      unknownMovie.movie.findUnique.mockResolvedValue(null as never);
      mockTransaction(unknownMovie);
      await expect(service.createShowtime(input)).rejects.toBeInstanceOf(
        AdminNotFoundError,
      );

      jest.restoreAllMocks();
      const unknownRoom = createTx();
      unknownRoom.room.findUnique.mockResolvedValue(null as never);
      mockTransaction(unknownRoom);
      await expect(service.createShowtime(input)).rejects.toBeInstanceOf(
        AdminNotFoundError,
      );
    });
  });

  describe('updateShowtimePrice', () => {
    it('updates the price', async () => {
      mockLoadShowtime({ ...showtimeRow, price: 12 });
      const update = jest
        .spyOn(prisma.showtime, 'update')
        .mockResolvedValue({} as never);

      expect((await service.updateShowtimePrice('s1', 12)).price).toBe(12);
      expect(update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { price: 12 },
      });
    });

    it('fails for an unknown showtime', async () => {
      jest.spyOn(prisma.showtime, 'findUnique').mockResolvedValue(null);
      await expect(service.updateShowtimePrice('x', 12)).rejects.toBeInstanceOf(
        AdminNotFoundError,
      );
    });

    it('refuses to edit a cancelled showtime', async () => {
      jest
        .spyOn(prisma.showtime, 'findUnique')
        .mockResolvedValue({ ...showtimeRow, status: 'CANCELLED' } as never);
      await expect(service.updateShowtimePrice('s1', 12)).rejects.toMatchObject(
        { reason: 'SHOWTIME_CANCELLED' },
      );
    });
  });

  describe('cancelShowtime', () => {
    function cancellationTx(status: 'SCHEDULED' | 'CANCELLED' | null) {
      return {
        showtime: {
          findUnique: jest.fn<(...args: unknown[]) => Promise<unknown>>(
            async () => (status ? { ...showtimeRow, status } : null),
          ),
          update: jest.fn<(...args: unknown[]) => Promise<unknown>>(
            async () => ({}),
          ),
        },
        booking: {
          findMany: jest.fn<(...args: unknown[]) => Promise<unknown>>(
            async () => [
              { id: 'b1', guestEmail: 'a@example.com', user: null },
              { id: 'b2', guestEmail: null, user: { email: 'u@example.com' } },
              { id: 'b3', guestEmail: null, user: null },
            ],
          ),
          updateMany: jest.fn<(...args: unknown[]) => Promise<unknown>>(
            async () => ({ count: 3 }),
          ),
        },
        emailDelivery: {
          createMany: jest.fn<(...args: unknown[]) => Promise<unknown>>(
            async () => ({ count: 3 }),
          ),
        },
      };
    }

    it('cancels, flags refunds and queues notifications', async () => {
      const tx = cancellationTx('SCHEDULED');
      mockTransaction(tx);
      mockLoadShowtime({ ...showtimeRow, status: 'CANCELLED' });

      const result = await service.cancelShowtime('s1');

      expect(result.notifiedBookings).toBe(3);
      expect(tx.showtime.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { status: 'CANCELLED', cancelledAt: now },
      });
      expect(tx.booking.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['b1', 'b2', 'b3'] } },
        data: { status: 'REFUND_REQUIRED' },
      });
      const [{ data }] = tx.emailDelivery.createMany.mock
        .calls[0] as unknown as [
        { data: { status: string; lastError: string | null }[] },
      ];
      expect(data.map((row) => row.status)).toEqual([
        'PENDING',
        'PENDING',
        'FAILED',
      ]);
      expect(data[2]?.lastError).toBe('MISSING_RECIPIENT_EMAIL');
    });

    it('is idempotent for an already cancelled showtime', async () => {
      const tx = cancellationTx('CANCELLED');
      mockTransaction(tx);
      mockLoadShowtime({ ...showtimeRow, status: 'CANCELLED' });

      expect((await service.cancelShowtime('s1')).notifiedBookings).toBe(0);
      expect(tx.showtime.update).not.toHaveBeenCalled();
    });

    it('fails for an unknown showtime', async () => {
      mockTransaction(cancellationTx(null));
      await expect(service.cancelShowtime('x')).rejects.toBeInstanceOf(
        AdminNotFoundError,
      );
    });
  });

  describe('movies', () => {
    const input = {
      title: 'Film A',
      genre: 'DRAME' as const,
      description: 'd',
      duration: 120,
    };

    it('creates a movie without poster', async () => {
      const create = jest
        .spyOn(prisma.movie, 'create')
        .mockResolvedValue(movie as never);
      await service.createMovie(input);
      expect(create).toHaveBeenCalledWith({
        data: { ...input, posterUrl: null },
      });
    });

    it('updates an existing movie only', async () => {
      jest.spyOn(prisma.movie, 'findUnique').mockResolvedValue(movie as never);
      const update = jest
        .spyOn(prisma.movie, 'update')
        .mockResolvedValue(movie as never);
      await service.updateMovie('m1', { ...input, posterUrl: '/p.svg' });
      expect(update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { ...input, posterUrl: '/p.svg' },
      });

      jest.spyOn(prisma.movie, 'findUnique').mockResolvedValue(null);
      await expect(service.updateMovie('x', input)).rejects.toBeInstanceOf(
        AdminNotFoundError,
      );
    });

    it('deletes a movie without showtimes', async () => {
      jest
        .spyOn(prisma.movie, 'findUnique')
        .mockResolvedValue({ ...movie, _count: { showtimes: 0 } } as never);
      const remove = jest
        .spyOn(prisma.movie, 'delete')
        .mockResolvedValue(movie as never);
      await service.deleteMovie('m1');
      expect(remove).toHaveBeenCalledWith({ where: { id: 'm1' } });
    });

    it('refuses to delete a movie that has showtimes', async () => {
      jest
        .spyOn(prisma.movie, 'findUnique')
        .mockResolvedValue({ ...movie, _count: { showtimes: 2 } } as never);
      const error = await service.deleteMovie('m1').catch((e) => e);
      expect(error).toBeInstanceOf(AdminRuleError);
      expect(error.reason).toBe('MOVIE_HAS_SHOWTIMES');
    });

    it('fails to delete an unknown movie', async () => {
      jest.spyOn(prisma.movie, 'findUnique').mockResolvedValue(null);
      await expect(service.deleteMovie('x')).rejects.toBeInstanceOf(
        AdminNotFoundError,
      );
    });
  });
});
