import { z } from 'zod';
import { apiBaseUrl } from './api-config';

const programmeItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  genre: z.enum([
    'ACTION',
    'ANIMATION',
    'AVENTURE',
    'COMEDIE',
    'DOCUMENTAIRE',
    'DRAME',
    'FANTASTIQUE',
    'HORREUR',
    'ROMANCE',
    'SCIENCE_FICTION',
    'THRILLER',
  ]),
  genreLabel: z.string(),
  duration: z.number().int().positive(),
  posterUrl: z.string().nullable(),
  roomName: z.string(),
  occupancyStatus: z.enum(['AVAILABLE', 'LAST_SEATS', 'FULL']),
  startTime: z.iso.datetime(),
});

export type ProgrammeItem = z.infer<typeof programmeItemSchema>;

const programmeSchema = z.array(programmeItemSchema);
type ProgrammeResponse = Pick<Response, 'ok' | 'status' | 'json'>;
export type ProgrammeFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<ProgrammeResponse>;

export async function getProgramme(
  signal?: AbortSignal,
  fetcher: ProgrammeFetcher = fetch,
): Promise<ProgrammeItem[]> {
  const response = await fetcher(`${apiBaseUrl}/api/programme`, { signal });

  if (!response.ok) {
    throw new Error(`Programme request failed with status ${response.status}.`);
  }

  return programmeSchema.parse(await response.json());
}
