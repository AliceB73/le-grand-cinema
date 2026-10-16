import { z } from 'zod';
import { apiBaseUrl } from './api-config';

const checkoutResponseSchema = z.object({
  id: z.string().startsWith('cs_test_'),
  url: z.url(),
});
const checkoutStatusSchema = z.object({
  status: z.enum(['pending', 'confirmed', 'cancelled', 'refund_required']),
});
const apiErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
});

type PaymentFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

export class PaymentApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PaymentApiError';
  }
}

async function parseResponse<T>(
  response: Pick<Response, 'ok' | 'status' | 'json'>,
  schema: z.ZodType<T>,
) {
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = apiErrorSchema.safeParse(body);
    if (!error.success) {
      throw new PaymentApiError(
        response.status,
        'UNKNOWN_PAYMENT_API_ERROR',
        `La requête de paiement a échoué (HTTP ${response.status}).`,
      );
    }
    throw new PaymentApiError(
      response.status,
      error.data.error,
      error.data.message,
    );
  }
  return schema.parse(body);
}

export async function createCheckout(
  showtimeId: string,
  sessionToken: string,
  tickets: Array<{ seatId: string; fare: 'full' | 'reduced' }>,
  fetcher: PaymentFetcher = fetch,
) {
  const response = await fetcher(
    `${apiBaseUrl}/api/showtimes/${encodeURIComponent(showtimeId)}/checkout`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-seat-session-token': sessionToken,
      },
      body: JSON.stringify({ tickets }),
    },
  );
  return parseResponse(response, checkoutResponseSchema);
}

export async function getCheckoutStatus(
  sessionId: string,
  fetcher: PaymentFetcher = fetch,
) {
  const response = await fetcher(
    `${apiBaseUrl}/api/payments/sessions/${encodeURIComponent(sessionId)}/status`,
  );
  return parseResponse(response, checkoutStatusSchema);
}
