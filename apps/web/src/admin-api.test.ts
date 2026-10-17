import { afterEach, describe, expect, it, jest } from '@jest/globals';
import * as api from './admin-api';
import { supabase } from './supabase-client';

const showtime = {
  id: 's1',
  movieId: 'm1',
  movieTitle: 'Film A',
  roomName: 'Salle A',
  startTime: '2027-01-01T18:00:00.000Z',
  endTime: '2027-01-01T19:48:00.000Z',
  price: 9.5,
  status: 'SCHEDULED',
  confirmedBookings: 0,
};
const movie = {
  id: 'm1',
  title: 'Film A',
  genre: 'DRAME',
  description: 'd',
  duration: 108,
  posterUrl: null,
};

function mockFetch(status: number, body: unknown) {
  const fetchMock = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function signIn() {
  jest.mocked(supabase!.auth.getSession).mockResolvedValue({
    data: { session: { access_token: 'tok' } },
    error: null,
  } as never);
}

describe('admin-api', () => {
  afterEach(() => {
    jest.mocked(supabase!.auth.getSession).mockResolvedValue({
      data: { session: null },
      error: null,
    } as never);
  });

  it('refuses to call the API without a session', async () => {
    const fetchMock = mockFetch(200, {});
    await expect(api.listMovies()).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await api.hasAdminAccess()).toBe(false);
  });

  it('reads showtimes, movies and rooms', async () => {
    signIn();
    mockFetch(200, { showtimes: [showtime] });
    expect(await api.listShowtimes()).toHaveLength(1);
    mockFetch(200, { movies: [movie] });
    expect(await api.listMovies()).toHaveLength(1);
    mockFetch(200, {
      rooms: [{ name: 'Salle A', category: 'STANDARD', capacity: 180 }],
    });
    expect(await api.listRooms()).toHaveLength(1);
  });

  it('sends showtime commands with a bearer token', async () => {
    signIn();
    const fetchMock = mockFetch(200, { showtime });
    await api.createShowtime({
      movieId: 'm1',
      roomId: 'Salle A',
      startTime: '2027-01-01T18:00:00.000Z',
      price: 9.5,
    });
    await api.updateShowtimePrice('s 1', 8);
    const [, createInit] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(createInit.method).toBe('POST');
    expect((createInit.headers as Record<string, string>)['content-type']).toBe(
      'application/json',
    );
    expect((fetchMock.mock.calls as unknown as string[][])[1]?.[0]).toBe(
      'http://localhost:3000/api/admin/showtimes/s%201',
    );

    mockFetch(200, { showtime, notifiedBookings: 3 });
    expect((await api.cancelShowtime('s1')).notifiedBookings).toBe(3);
  });

  it('sends movie commands', async () => {
    signIn();
    const input = {
      title: 'Film A',
      genre: 'DRAME',
      description: 'd',
      duration: 108,
      posterUrl: null,
    };
    mockFetch(200, { movie });
    expect((await api.createMovie(input)).id).toBe('m1');
    expect((await api.updateMovie('m1', input)).id).toBe('m1');
    const fetchMock = mockFetch(204, null);
    await expect(api.deleteMovie('m1')).resolves.toBeUndefined();
    expect((fetchMock.mock.calls as unknown as string[][])[0]?.[0]).toBe(
      'http://localhost:3000/api/admin/movies/m1',
    );
  });

  it('exposes the server message of failed calls', async () => {
    signIn();
    mockFetch(409, { message: 'Conflit.' });
    const error = await api.listMovies().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(api.AdminApiError);
    expect(api.describeAdminError(error)).toBe('Conflit.');
    expect(await api.hasAdminAccess()).toBe(false);
  });

  it('falls back to a generic message', async () => {
    signIn();
    mockFetch(500, 'not json');
    const error = await api.listMovies().catch((reason: unknown) => reason);
    expect((error as api.AdminApiError).serverMessage).toBeNull();
    expect(api.describeAdminError(error)).toContain('échoué');
    expect(api.describeAdminError(new Error('x'))).toContain('échoué');
  });

  it('detects an admin session', async () => {
    signIn();
    mockFetch(200, { role: 'ADMIN' });
    expect(await api.hasAdminAccess()).toBe(true);
  });
});
