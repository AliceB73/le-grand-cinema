import { describe, expect, it, jest } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../app.js';
import {
  AdminAuthenticationError,
  type AdminAuthenticator,
} from '../auth/admin-auth.js';
import {
  AdminNotFoundError,
  AdminRuleError,
  ShowtimeConflictError,
  type AdminService,
} from './admin.service.js';

type AnyFn = (...args: unknown[]) => Promise<unknown>;
const mockFn = (implementation?: AnyFn) => jest.fn<AnyFn>(implementation);

function buildApp(
  overrides: Partial<Record<keyof AdminService, unknown>> = {},
) {
  const authorize = jest.fn<AdminAuthenticator['authorize']>();
  const adminService = {
    listShowtimes: mockFn(async () => []),
    listRooms: mockFn(async () => []),
    listSpecialRates: mockFn(async () => []),
    listMovies: mockFn(async () => []),
    getSalesReport: mockFn(async () => ({
      totals: { revenueCents: 0, ticketsSold: 0 },
      daily: [],
      showtimes: [],
    })),
    createShowtime: mockFn(),
    updateShowtimePrice: mockFn(),
    cancelShowtime: mockFn(),
    createMovie: mockFn(),
    updateMovie: mockFn(),
    deleteMovie: mockFn(),
    ...overrides,
  } as unknown as AdminService;
  const app = createApp(
    undefined,
    undefined,
    undefined,
    undefined,
    { authorize },
    undefined,
    undefined,
    adminService,
  );
  return { app, authorize, adminService };
}

describe('admin routes', () => {
  it('requires an authenticated administrator', async () => {
    const { app, authorize, adminService } = buildApp();
    authorize.mockRejectedValueOnce(new AdminAuthenticationError('missing'));
    const unauthenticated = await request(app).get('/api/admin/showtimes');
    expect(unauthenticated.status).toBe(401);

    authorize.mockRejectedValueOnce(new AdminAuthenticationError('forbidden'));
    const forbidden = await request(app).get('/api/admin/me');
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error).toBe('ADMIN_REQUIRED');
    authorize.mockRejectedValueOnce(new AdminAuthenticationError('missing'));
    const sales = await request(app).get(
      '/api/admin/sales?startDate=2026-12-01&endDate=2026-12-31',
    );
    expect(sales.status).toBe(401);
    expect(adminService.listShowtimes).not.toHaveBeenCalled();
    expect(adminService.getSalesReport).not.toHaveBeenCalled();
  });

  it('confirms the admin role', async () => {
    const { app, authorize } = buildApp();
    authorize.mockResolvedValue(undefined);
    const response = await request(app).get('/api/admin/me');
    expect(response.body).toEqual({ role: 'ADMIN' });
  });

  it('returns a filtered sales report to administrators', async () => {
    const report = {
      totals: { revenueCents: 1250, ticketsSold: 2 },
      daily: [{ date: '2026-12-01', revenueCents: 1250, ticketsSold: 2 }],
      showtimes: [],
    };
    const getSalesReport = mockFn(async () => report);
    const { app, authorize, adminService } = buildApp({ getSalesReport });
    authorize.mockResolvedValue(undefined);
    const response = await request(app).get(
      '/api/admin/sales?startDate=2026-12-01&endDate=2026-12-31&genre=DRAME&movieId=m1&roomId=Salle%20A&showtimeId=s1',
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual(report);
    expect(adminService.getSalesReport).toHaveBeenCalledWith({
      startDate: '2026-12-01',
      endDate: '2026-12-31',
      genre: 'DRAME',
      movieId: 'm1',
      roomId: 'Salle A',
      showtimeId: 's1',
    });
  });

  it('rejects invalid sales report filters', async () => {
    const { app, authorize, adminService } = buildApp();
    authorize.mockResolvedValue(undefined);
    const response = await request(app).get(
      '/api/admin/sales?startDate=2026-02-31&endDate=2026-12-31&genre=UNKNOWN',
    );
    expect(response.status).toBe(400);
    expect(adminService.getSalesReport).not.toHaveBeenCalled();
  });

  it('creates a showtime', async () => {
    const showtime = { id: 's1' };
    const createShowtime = mockFn(async () => showtime);
    const { app, authorize } = buildApp({ createShowtime });
    authorize.mockResolvedValue(undefined);
    const response = await request(app).post('/api/admin/showtimes').send({
      movieId: 'm1',
      roomId: 'Salle A',
      startTime: '2027-01-01T18:00:00.000Z',
      price: 9.5,
    });
    expect(response.status).toBe(201);
    expect(createShowtime).toHaveBeenCalledWith({
      movieId: 'm1',
      roomId: 'Salle A',
      startTime: new Date('2027-01-01T18:00:00.000Z'),
      price: 9.5,
    });
  });

  it('rejects invalid showtime input', async () => {
    const { app, authorize } = buildApp();
    authorize.mockResolvedValue(undefined);
    const response = await request(app)
      .post('/api/admin/showtimes')
      .send({ movieId: 'm1', roomId: 'A', startTime: 'demain', price: -1 });
    expect(response.status).toBe(400);
  });

  it('reports an overlap with a clear message', async () => {
    const createShowtime = mockFn(async () => {
      throw new ShowtimeConflictError({
        movieTitle: 'Le Dernier Tram',
        startTime: new Date('2027-01-01T18:00:00.000Z'),
        endTime: new Date('2027-01-01T19:41:00.000Z'),
      });
    });
    const { app, authorize } = buildApp({ createShowtime });
    authorize.mockResolvedValue(undefined);
    const response = await request(app).post('/api/admin/showtimes').send({
      movieId: 'm1',
      roomId: 'Salle A',
      startTime: '2027-01-01T18:30:00.000Z',
      price: 9.5,
    });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe('SHOWTIME_CONFLICT');
    expect(response.body.message).toContain('Le Dernier Tram');
  });

  it('only accepts a price on update and refuses cancelled showtimes', async () => {
    const updateShowtimePrice = mockFn(async () => {
      throw new AdminRuleError('SHOWTIME_CANCELLED');
    });
    const { app, authorize } = buildApp({ updateShowtimePrice });
    authorize.mockResolvedValue(undefined);
    const response = await request(app)
      .patch('/api/admin/showtimes/s1')
      .send({ price: 10 });
    expect(response.status).toBe(409);
    expect(updateShowtimePrice).toHaveBeenCalledWith('s1', 10);
  });

  it('cancels a showtime and reports notified bookings', async () => {
    const cancelShowtime = mockFn(async () => ({
      showtime: { id: 's1', status: 'CANCELLED' },
      notifiedBookings: 3,
    }));
    const { app, authorize } = buildApp({ cancelShowtime });
    authorize.mockResolvedValue(undefined);
    const response = await request(app).post('/api/admin/showtimes/s1/cancel');
    expect(response.status).toBe(200);
    expect(response.body.notifiedBookings).toBe(3);
  });

  it('refuses to delete a movie that still has showtimes', async () => {
    const deleteMovie = mockFn(async () => {
      throw new AdminRuleError('MOVIE_HAS_SHOWTIMES');
    });
    const { app, authorize } = buildApp({ deleteMovie });
    authorize.mockResolvedValue(undefined);
    const response = await request(app).delete('/api/admin/movies/m1');
    expect(response.status).toBe(409);
  });

  it('deletes a movie, lists rooms and movies', async () => {
    const { app, authorize } = buildApp();
    authorize.mockResolvedValue(undefined);
    expect((await request(app).delete('/api/admin/movies/m1')).status).toBe(
      204,
    );
    expect((await request(app).get('/api/admin/rooms')).body).toEqual({
      rooms: [],
    });
    expect((await request(app).get('/api/admin/movies')).body).toEqual({
      movies: [],
    });
  });

  it('creates and updates movies', async () => {
    const movie = {
      title: 'Film',
      genre: 'DRAME',
      description: 'd',
      duration: 100,
    };
    const createMovie = mockFn(async () => ({ id: 'm1', ...movie }));
    const updateMovie = mockFn(async () => ({ id: 'm1', ...movie }));
    const { app, authorize } = buildApp({ createMovie, updateMovie });
    authorize.mockResolvedValue(undefined);
    expect(
      (await request(app).post('/api/admin/movies').send(movie)).status,
    ).toBe(201);
    expect(
      (await request(app).put('/api/admin/movies/m1').send(movie)).status,
    ).toBe(200);
    expect(
      (await request(app).post('/api/admin/movies').send({ title: '' })).status,
    ).toBe(400);
    expect(
      (await request(app).put('/api/admin/movies/m1').send({})).status,
    ).toBe(400);
  });

  it('configures rooms and manages special rates', async () => {
    const updateRoom = mockFn(async () => ({ name: 'Salle A' }));
    const saveSpecialRate = mockFn(async () => ({ id: 'r1' }));
    const deleteSpecialRate = mockFn(async () => undefined);
    const { app, authorize } = buildApp({
      updateRoom,
      saveSpecialRate,
      deleteSpecialRate,
    });
    authorize.mockResolvedValue(undefined);
    const rate = {
      roomName: 'Salle A',
      label: 'Festival',
      startDate: '2026-12-01',
      endDate: '2026-12-07',
      price: 12,
    };

    expect(
      (
        await request(app)
          .patch('/api/admin/rooms/Salle%20A')
          .send({ rows: 10, columns: 12, defaultPrice: 9 })
      ).status,
    ).toBe(200);
    expect(updateRoom).toHaveBeenCalledWith('Salle A', {
      rows: 10,
      columns: 12,
      defaultPrice: 9,
    });
    expect(
      (
        await request(app)
          .patch('/api/admin/rooms/Salle%20A')
          .send({ rows: 27, columns: 12, defaultPrice: 9 })
      ).status,
    ).toBe(400);
    expect((await request(app).get('/api/admin/rates')).body).toEqual({
      rates: [],
    });
    expect(
      (await request(app).post('/api/admin/rates').send(rate)).status,
    ).toBe(201);
    expect(
      (await request(app).put('/api/admin/rates/r1').send(rate)).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post('/api/admin/rates')
          .send({ ...rate, startDate: 'demain' })
      ).status,
    ).toBe(400);
    expect((await request(app).delete('/api/admin/rates/r1')).status).toBe(204);
  });

  it('rejects invalid rate updates and unknown rates', async () => {
    const deleteSpecialRate = mockFn(async () => {
      throw new AdminNotFoundError('rate');
    });
    const { app, authorize } = buildApp({ deleteSpecialRate });
    authorize.mockResolvedValue(undefined);
    expect(
      (await request(app).put('/api/admin/rates/r1').send({ price: 1 })).status,
    ).toBe(400);
    expect(
      (await request(app).patch('/api/admin/rooms/A').send({})).status,
    ).toBe(400);
    expect((await request(app).delete('/api/admin/rates/r1')).status).toBe(404);
  });

  it('maps room and rate rule errors', async () => {
    const updateRoom = mockFn(async () => {
      throw new AdminRuleError('ROOM_HAS_BOOKINGS');
    });
    const saveSpecialRate = mockFn(async () => {
      throw new AdminRuleError('INVALID_PERIOD');
    });
    const { app, authorize } = buildApp({ updateRoom, saveSpecialRate });
    authorize.mockResolvedValue(undefined);
    expect(
      (
        await request(app)
          .patch('/api/admin/rooms/A')
          .send({ rows: 1, columns: 1, defaultPrice: 9 })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app).post('/api/admin/rates').send({
          roomName: 'A',
          label: 'F',
          startDate: '2026-12-01',
          endDate: '2026-12-02',
          price: 9,
        })
      ).status,
    ).toBe(400);
  });

  it('rejects invalid price updates', async () => {
    const { app, authorize } = buildApp();
    authorize.mockResolvedValue(undefined);
    const response = await request(app)
      .patch('/api/admin/showtimes/s1')
      .send({ price: -1 });
    expect(response.status).toBe(400);
  });

  it('maps missing items to 404 and a past start to 400', async () => {
    const cancelShowtime = mockFn(async () => {
      throw new AdminNotFoundError('showtime');
    });
    const createShowtime = mockFn(async () => {
      throw new AdminRuleError('PAST_START');
    });
    const { app, authorize } = buildApp({ cancelShowtime, createShowtime });
    authorize.mockResolvedValue(undefined);
    expect(
      (await request(app).post('/api/admin/showtimes/s1/cancel')).status,
    ).toBe(404);
    const past = await request(app).post('/api/admin/showtimes').send({
      movieId: 'm1',
      roomId: 'Salle A',
      startTime: '2027-01-01T18:00:00.000Z',
      price: 9.5,
    });
    expect(past.status).toBe(400);
  });

  it('hides unexpected failures behind a generic 500', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const listShowtimes = mockFn(async () => {
      throw new Error('db down');
    });
    const { app, authorize } = buildApp({ listShowtimes });
    authorize.mockResolvedValue(undefined);
    const response = await request(app).get('/api/admin/showtimes');
    expect(response.status).toBe(500);
    expect(response.body.error).toBe('ADMIN_UNAVAILABLE');
    expect(JSON.stringify(response.body)).not.toContain('db down');
  });

  it('reports unavailable or failing authentication', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { app, authorize } = buildApp();
    authorize.mockRejectedValueOnce(
      new AdminAuthenticationError('unavailable'),
    );
    expect((await request(app).get('/api/admin/me')).status).toBe(503);
    authorize.mockRejectedValueOnce(new Error('boom'));
    expect((await request(app).get('/api/admin/me')).status).toBe(500);
  });
});
