import { z } from 'zod';
import { apiBaseUrl } from './api-config';
import { supabase } from './supabase-client';

export const GENRES = [
  ['ACTION', 'Action'],
  ['ANIMATION', 'Animation'],
  ['AVENTURE', 'Aventure'],
  ['COMEDIE', 'Comédie'],
  ['DOCUMENTAIRE', 'Documentaire'],
  ['DRAME', 'Drame'],
  ['FANTASTIQUE', 'Fantastique'],
  ['HORREUR', 'Horreur'],
  ['ROMANCE', 'Romance'],
  ['SCIENCE_FICTION', 'Science-fiction'],
  ['THRILLER', 'Thriller'],
] as const;

const showtimeSchema = z.object({
  id: z.string(),
  movieId: z.string(),
  movieTitle: z.string(),
  roomName: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  price: z.number(),
  status: z.enum(['SCHEDULED', 'CANCELLED']),
  confirmedBookings: z.number(),
});
const movieSchema = z.object({
  id: z.string(),
  title: z.string(),
  genre: z.string(),
  description: z.string(),
  duration: z.number(),
  posterUrl: z.string().nullable(),
});
const roomSchema = z.object({
  name: z.string(),
  category: z.string(),
  capacity: z.number(),
  rows: z.number(),
  columns: z.number(),
  defaultPrice: z.number(),
});
const rateSchema = z.object({
  id: z.string(),
  roomName: z.string(),
  label: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  price: z.number(),
});

export type AdminShowtime = z.infer<typeof showtimeSchema>;
export type AdminMovie = z.infer<typeof movieSchema>;
export type AdminRoom = z.infer<typeof roomSchema>;
export type AdminSpecialRate = z.infer<typeof rateSchema>;
export type SpecialRateInput = Omit<AdminSpecialRate, 'id'>;
export interface MovieInput {
  title: string;
  genre: string;
  description: string;
  duration: number;
  posterUrl: string | null;
}

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly serverMessage: string | null,
  ) {
    super(`Admin API request failed (HTTP ${status}).`);
    this.name = 'AdminApiError';
  }
}

export async function getAccessToken() {
  const { data } = (await supabase?.auth.getSession()) ?? {
    data: { session: null },
  };
  return data.session?.access_token ?? null;
}

async function call<T>(
  method: string,
  path: string,
  schema: z.ZodType<T> | null,
  body?: unknown,
): Promise<T> {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    throw new AdminApiError(401, null);
  }
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    let message: string | null = null;
    try {
      const payload: unknown = await response.json();
      message = z.object({ message: z.string() }).parse(payload).message;
    } catch {
      message = null;
    }
    throw new AdminApiError(response.status, message);
  }
  return schema ? schema.parse(await response.json()) : (undefined as T);
}

export async function checkAdminAccess() {
  await call('GET', '/api/admin/me', z.object({ role: z.literal('ADMIN') }));
}

export async function listShowtimes() {
  return (
    await call(
      'GET',
      '/api/admin/showtimes',
      z.object({ showtimes: z.array(showtimeSchema) }),
    )
  ).showtimes;
}

export async function listMovies() {
  return (
    await call(
      'GET',
      '/api/admin/movies',
      z.object({ movies: z.array(movieSchema) }),
    )
  ).movies;
}

export async function listRooms() {
  return (
    await call(
      'GET',
      '/api/admin/rooms',
      z.object({ rooms: z.array(roomSchema) }),
    )
  ).rooms;
}

export async function updateRoom(
  name: string,
  input: { rows: number; columns: number; defaultPrice: number },
) {
  return (
    await call(
      'PATCH',
      `/api/admin/rooms/${encodeURIComponent(name)}`,
      z.object({ room: roomSchema }),
      input,
    )
  ).room;
}

export async function listSpecialRates() {
  return (
    await call(
      'GET',
      '/api/admin/rates',
      z.object({ rates: z.array(rateSchema) }),
    )
  ).rates;
}

export async function createSpecialRate(input: SpecialRateInput) {
  return (
    await call(
      'POST',
      '/api/admin/rates',
      z.object({ rate: rateSchema }),
      input,
    )
  ).rate;
}

export function deleteSpecialRate(id: string) {
  return call('DELETE', `/api/admin/rates/${encodeURIComponent(id)}`, null);
}

export async function createShowtime(input: {
  movieId: string;
  roomId: string;
  startTime: string;
  price?: number;
}) {
  return (
    await call(
      'POST',
      '/api/admin/showtimes',
      z.object({ showtime: showtimeSchema }),
      input,
    )
  ).showtime;
}

export async function updateShowtimePrice(id: string, price: number) {
  return (
    await call(
      'PATCH',
      `/api/admin/showtimes/${encodeURIComponent(id)}`,
      z.object({ showtime: showtimeSchema }),
      { price },
    )
  ).showtime;
}

export function cancelShowtime(id: string) {
  return call(
    'POST',
    `/api/admin/showtimes/${encodeURIComponent(id)}/cancel`,
    z.object({ showtime: showtimeSchema, notifiedBookings: z.number() }),
  );
}

export async function createMovie(input: MovieInput) {
  return (
    await call(
      'POST',
      '/api/admin/movies',
      z.object({ movie: movieSchema }),
      input,
    )
  ).movie;
}

export async function updateMovie(id: string, input: MovieInput) {
  return (
    await call(
      'PUT',
      `/api/admin/movies/${encodeURIComponent(id)}`,
      z.object({ movie: movieSchema }),
      input,
    )
  ).movie;
}

export function deleteMovie(id: string) {
  return call('DELETE', `/api/admin/movies/${encodeURIComponent(id)}`, null);
}

// The API refuses non-admin sessions; this only drives UI visibility.
export async function hasAdminAccess() {
  try {
    await checkAdminAccess();
    return true;
  } catch {
    return false;
  }
}

export function describeAdminError(error: unknown) {
  if (error instanceof AdminApiError && error.serverMessage) {
    return error.serverMessage;
  }
  return 'L’opération a échoué. Réessayez dans quelques instants.';
}
