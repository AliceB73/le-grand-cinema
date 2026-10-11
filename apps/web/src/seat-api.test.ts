import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  getSeatMap,
  getSeatSessionToken,
  holdSeats,
  releaseSeats,
  SeatApiError,
} from './seat-api';

jest.mock('./api-config', () => ({
  apiBaseUrl: 'http://localhost:3000',
}));

const seatMapResponse = {
  showtimeId: 'showtime/1',
  priceCents: 950,
  seats: [
    {
      id: 'seat-1',
      rowNumber: 'A',
      seatNumber: 1,
      status: 'available',
      heldByCurrentSession: false,
      expiresAt: null,
    },
  ],
};

type TestFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

function createResponse(
  body: unknown,
  ok = true,
  status = ok ? 200 : 500,
): Pick<Response, 'ok' | 'status' | 'json'> {
  return {
    ok,
    status,
    json: async () => body,
  };
}

describe('seat api', () => {
  afterEach(() => {
    sessionStorage.clear();
    jest.restoreAllMocks();
  });

  it('reuses a valid anonymous session token from storage', () => {
    const token = '7e4cbf13-f749-4b7d-8fa6-28e9fa88f38b';
    sessionStorage.setItem('seat-session-token', token);
    const randomUUID = jest.spyOn(crypto, 'randomUUID');

    expect(getSeatSessionToken()).toBe(token);
    expect(randomUUID).not.toHaveBeenCalled();
  });

  it('replaces a missing or invalid session token with a generated UUID', () => {
    const token = '7e4cbf13-f749-4b7d-8fa6-28e9fa88f38b';
    const randomUUID = jest.spyOn(crypto, 'randomUUID').mockReturnValue(token);
    sessionStorage.setItem('seat-session-token', 'not-a-uuid');

    expect(getSeatSessionToken()).toBe(token);
    expect(sessionStorage.getItem('seat-session-token')).toBe(token);
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it('loads a validated seat map with the session header and abort signal', async () => {
    const controller = new AbortController();
    const fetcher = jest
      .fn<TestFetcher>()
      .mockResolvedValue(createResponse(seatMapResponse));

    await expect(
      getSeatMap('showtime/1', 'session-token', controller.signal, fetcher),
    ).resolves.toEqual(seatMapResponse);
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/showtimes\/showtime%2F1\/seats$/),
      {
        headers: { 'x-seat-session-token': 'session-token' },
        signal: controller.signal,
      },
    );
  });

  it('posts selected seats and validates the temporary hold response', async () => {
    const hold = {
      heldSeatIds: ['seat-1'],
      expiresAt: '2026-10-11T10:10:00.000Z',
    };
    const fetcher = jest
      .fn<TestFetcher>()
      .mockResolvedValue(createResponse(hold));

    await expect(
      holdSeats('showtime-1', ['seat-1'], 'session-token', fetcher),
    ).resolves.toEqual(hold);
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/showtimes\/showtime-1\/seats\/holds$/),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-seat-session-token': 'session-token',
        },
        body: JSON.stringify({ seatIds: ['seat-1'] }),
      },
    );
  });

  it('releases selected seats with keepalive when the page is closing', async () => {
    const fetcher = jest
      .fn<TestFetcher>()
      .mockResolvedValue(createResponse({ released: true }));

    await expect(
      releaseSeats(
        'showtime-1',
        ['seat-1', 'seat-2'],
        'session-token',
        true,
        fetcher,
      ),
    ).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/showtimes\/showtime-1\/seats\/holds$/),
      {
        method: 'DELETE',
        headers: {
          'content-type': 'application/json',
          'x-seat-session-token': 'session-token',
        },
        body: JSON.stringify({ seatIds: ['seat-1', 'seat-2'] }),
        keepalive: true,
      },
    );
  });

  it('throws the API error details when the server returns a valid error', async () => {
    const fetcher = jest
      .fn<TestFetcher>()
      .mockResolvedValue(
        createResponse(
          { error: 'SEAT_UNAVAILABLE', message: 'Seat is unavailable.' },
          false,
          409,
        ),
      );

    await expect(
      holdSeats('showtime-1', ['seat-1'], 'session-token', fetcher),
    ).rejects.toEqual(
      expect.objectContaining({
        name: 'SeatApiError',
        status: 409,
        code: 'SEAT_UNAVAILABLE',
        message: 'Seat is unavailable.',
      }),
    );
  });

  it('reports an unknown API error when the error body is malformed', async () => {
    const fetcher = jest
      .fn<TestFetcher>()
      .mockResolvedValue(createResponse({ detail: 'failure' }, false, 503));

    await expect(
      getSeatMap('showtime-1', 'session-token', undefined, fetcher),
    ).rejects.toEqual(
      expect.objectContaining({
        status: 503,
        code: 'UNKNOWN_SEAT_API_ERROR',
        message: 'La requête de plan de salle a échoué (HTTP 503).',
      } satisfies Partial<SeatApiError>),
    );
  });

  it('rejects successful responses that do not match the seat map contract', async () => {
    const fetcher = jest
      .fn<TestFetcher>()
      .mockResolvedValue(createResponse({ showtimeId: 'showtime-1' }));

    await expect(
      getSeatMap('showtime-1', 'session-token', undefined, fetcher),
    ).rejects.toThrow();
  });
});
