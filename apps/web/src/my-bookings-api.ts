import { z } from 'zod';
import { apiBaseUrl } from './api-config';

const bookingSchema = z.object({
  id: z.string(),
  movieTitle: z.string(),
  roomName: z.string(),
  startTime: z.string(),
  seats: z.array(z.object({ rowNumber: z.string(), seatNumber: z.number() })),
  seatCount: z.number(),
  used: z.boolean(),
  isUpcoming: z.boolean(),
});
const bookingsResponseSchema = z.object({ bookings: z.array(bookingSchema) });
const ticketResponseSchema = z.object({
  qrCodeDataUrl: z.string().startsWith('data:image/png;base64,'),
  used: z.boolean(),
});

export type CustomerBooking = z.infer<typeof bookingSchema>;

type CustomerFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

export class CustomerApiError extends Error {
  constructor(readonly status: number) {
    super(`Customer API request failed (HTTP ${status}).`);
    this.name = 'CustomerApiError';
  }
}

async function get<T>(
  path: string,
  accessToken: string,
  schema: z.ZodType<T>,
  fetcher: CustomerFetcher,
) {
  const response = await fetcher(`${apiBaseUrl}${path}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new CustomerApiError(response.status);
  }
  return schema.parse(await response.json());
}

export async function getMyBookings(
  accessToken: string,
  fetcher: CustomerFetcher = fetch,
) {
  const { bookings } = await get(
    '/api/me/bookings',
    accessToken,
    bookingsResponseSchema,
    fetcher,
  );
  return bookings;
}

export function getMyTicket(
  bookingId: string,
  accessToken: string,
  fetcher: CustomerFetcher = fetch,
) {
  return get(
    `/api/me/bookings/${encodeURIComponent(bookingId)}/ticket`,
    accessToken,
    ticketResponseSchema,
    fetcher,
  );
}
