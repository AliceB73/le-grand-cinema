import { describe, expect, it, jest } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../app.js';
import {
  AdminAuthenticationError,
  type AdminAuthenticator,
} from '../auth/admin-auth.js';
import {
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
    listMovies: mockFn(async () => []),
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
    expect(adminService.listShowtimes).not.toHaveBeenCalled();
  });

  it('confirms the admin role', async () => {
    const { app, authorize } = buildApp();
    authorize.mockResolvedValue(undefined);
    const response = await request(app).get('/api/admin/me');
    expect(response.body).toEqual({ role: 'ADMIN' });
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
});
