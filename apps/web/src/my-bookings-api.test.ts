import { describe, expect, it, jest } from '@jest/globals';
import {
  CustomerApiError,
  getMyBookings,
  getMyTicket,
} from './my-bookings-api';

function reply(status: number, body: unknown) {
  return jest.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
    void args;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  });
}

describe('my-bookings-api', () => {
  it('sends the bearer token and parses bookings', async () => {
    const fetcher = reply(200, { bookings: [] });
    await expect(getMyBookings('tok', fetcher)).resolves.toEqual([]);
    expect(fetcher.mock.calls[0][1]).toEqual({
      headers: { authorization: 'Bearer tok' },
    });
  });

  it('fetches a ticket and rejects non-PNG payloads', async () => {
    await expect(
      getMyTicket(
        'b 1',
        'tok',
        reply(200, { qrCodeDataUrl: 'data:image/png;base64,AAA', used: false }),
      ),
    ).resolves.toEqual({
      qrCodeDataUrl: 'data:image/png;base64,AAA',
      used: false,
    });
    await expect(
      getMyTicket(
        'b1',
        'tok',
        reply(200, { qrCodeDataUrl: 'javascript:alert(1)', used: false }),
      ),
    ).rejects.toBeTruthy();
  });

  it('uses the global fetch by default', async () => {
    const original = globalThis.fetch;
    const globalFetch = reply(200, { bookings: [] });
    globalThis.fetch = globalFetch as unknown as typeof fetch;
    try {
      await expect(getMyBookings('tok')).resolves.toEqual([]);
      await expect(getMyTicket('b1', 'tok')).rejects.toBeTruthy();
      expect(globalFetch).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('throws CustomerApiError with the status on failure', async () => {
    await expect(getMyBookings('tok', reply(403, {}))).rejects.toMatchObject({
      status: 403,
    } satisfies Partial<CustomerApiError>);
  });
});
