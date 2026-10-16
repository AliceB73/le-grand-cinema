import { describe, expect, it } from '@jest/globals';
import {
  createCheckout,
  getCheckoutStatus,
  PaymentApiError,
} from './payment-api';

describe('payment API', () => {
  it('sends the ticket selection with the anonymous session token', async () => {
    let requestUrl = '';
    let requestInit: RequestInit | undefined;
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      requestInit = init;
      return {
        ok: true,
        status: 201,
        json: async () => ({
          id: 'cs_test_checkout-1',
          url: 'https://checkout.stripe.com/test',
        }),
      };
    };

    await expect(
      createCheckout(
        'showtime/1',
        'anonymous-session',
        [{ seatId: 'seat-1', fare: 'reduced' }],
        fetcher,
      ),
    ).resolves.toEqual({
      id: 'cs_test_checkout-1',
      url: 'https://checkout.stripe.com/test',
    });
    expect(requestUrl).toContain('/api/showtimes/showtime%2F1/checkout');
    expect(requestInit?.headers).toEqual({
      'content-type': 'application/json',
      'x-seat-session-token': 'anonymous-session',
    });
    expect(requestInit?.body).toBe(
      JSON.stringify({ tickets: [{ seatId: 'seat-1', fare: 'reduced' }] }),
    );
  });

  it('returns the persisted webhook-confirmed status', async () => {
    let requestUrl = '';
    const fetcher = async (input: RequestInfo | URL) => {
      requestUrl = String(input);
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'confirmed' }),
      };
    };

    await expect(
      getCheckoutStatus('cs_test_checkout-1', fetcher),
    ).resolves.toEqual({ status: 'confirmed' });
    expect(requestUrl).toContain(
      '/api/payments/sessions/cs_test_checkout-1/status',
    );
  });

  it('surfaces server errors instead of treating them as successful checkouts', async () => {
    const fetcher = async () => ({
      ok: false,
      status: 409,
      json: async () => ({
        error: 'SEATS_UNAVAILABLE',
        message: 'Les sièges ne sont plus disponibles.',
      }),
    });

    await expect(
      createCheckout(
        'showtime-1',
        'anonymous-session',
        [{ seatId: 'seat-1', fare: 'full' }],
        fetcher,
      ),
    ).rejects.toEqual(
      new PaymentApiError(
        409,
        'SEATS_UNAVAILABLE',
        'Les sièges ne sont plus disponibles.',
      ),
    );
  });

  it('reports an invalid error response using a non-success fallback', async () => {
    const fetcher = async () => ({
      ok: false,
      status: 502,
      json: async () => ({ unexpected: true }),
    });

    await expect(
      createCheckout(
        'showtime-1',
        'anonymous-session',
        [{ seatId: 'seat-1', fare: 'full' }],
        fetcher,
      ),
    ).rejects.toEqual(
      new PaymentApiError(
        502,
        'UNKNOWN_PAYMENT_API_ERROR',
        'La requête de paiement a échoué (HTTP 502).',
      ),
    );
  });
});
