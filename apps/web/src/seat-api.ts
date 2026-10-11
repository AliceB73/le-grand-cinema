import { z } from 'zod';
import { apiBaseUrl } from './api-config';

const seatMapItemSchema = z.object({
  id: z.string(),
  rowNumber: z.string(),
  seatNumber: z.number().int().positive(),
  status: z.enum(['available', 'occupied', 'held']),
  heldByCurrentSession: z.boolean(),
  expiresAt: z.iso.datetime().nullable(),
});

const seatMapSchema = z.object({
  showtimeId: z.string(),
  priceCents: z.number().int().nonnegative(),
  seats: z.array(seatMapItemSchema),
});

const seatHoldSchema = z.object({
  heldSeatIds: z.array(z.string()),
  expiresAt: z.iso.datetime(),
});
const seatReleaseSchema = z.object({ released: z.literal(true) });

const apiErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
});

export type SeatMapItem = z.infer<typeof seatMapItemSchema>;
export type SeatMap = z.infer<typeof seatMapSchema>;
export type SeatHold = z.infer<typeof seatHoldSchema>;

type SeatFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

export class SeatApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SeatApiError';
  }
}

export function getSeatSessionToken(storage: Storage = sessionStorage) {
  const storageKey = 'seat-session-token';
  const existingToken = storage.getItem(storageKey);

  if (existingToken && z.string().uuid().safeParse(existingToken).success) {
    return existingToken;
  }

  const token = crypto.randomUUID();
  storage.setItem(storageKey, token);

  return token;
}

async function parseResponse<T>(
  response: Pick<Response, 'ok' | 'status' | 'json'>,
  schema: z.ZodType<T>,
) {
  const body: unknown = await response.json();

  if (!response.ok) {
    const error = apiErrorSchema.safeParse(body);

    if (!error.success) {
      throw new SeatApiError(
        response.status,
        'UNKNOWN_SEAT_API_ERROR',
        `La requête de plan de salle a échoué (HTTP ${response.status}).`,
      );
    }

    throw new SeatApiError(
      response.status,
      error.data.error,
      error.data.message,
    );
  }

  return schema.parse(body);
}

export async function getSeatMap(
  showtimeId: string,
  sessionToken: string,
  signal?: AbortSignal,
  fetcher: SeatFetcher = fetch,
): Promise<SeatMap> {
  const response = await fetcher(
    `${apiBaseUrl}/api/showtimes/${encodeURIComponent(showtimeId)}/seats`,
    {
      headers: { 'x-seat-session-token': sessionToken },
      signal,
    },
  );

  return parseResponse(response, seatMapSchema);
}

export async function holdSeats(
  showtimeId: string,
  seatIds: string[],
  sessionToken: string,
  fetcher: SeatFetcher = fetch,
): Promise<SeatHold> {
  const response = await fetcher(
    `${apiBaseUrl}/api/showtimes/${encodeURIComponent(showtimeId)}/seats/holds`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-seat-session-token': sessionToken,
      },
      body: JSON.stringify({ seatIds }),
    },
  );

  return parseResponse(response, seatHoldSchema);
}

export async function releaseSeats(
  showtimeId: string,
  seatIds: string[],
  sessionToken: string,
  keepalive = false,
  fetcher: SeatFetcher = fetch,
): Promise<void> {
  const response = await fetcher(
    `${apiBaseUrl}/api/showtimes/${encodeURIComponent(showtimeId)}/seats/holds`,
    {
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
        'x-seat-session-token': sessionToken,
      },
      body: JSON.stringify({ seatIds }),
      keepalive,
    },
  );

  await parseResponse(response, seatReleaseSchema);
}
