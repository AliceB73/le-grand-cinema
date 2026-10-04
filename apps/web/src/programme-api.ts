import { z } from 'zod';

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
  startTime: z.iso.datetime(),
});

export type ProgrammeItem = z.infer<typeof programmeItemSchema>;

const programmeSchema = z.array(programmeItemSchema);

export async function getProgramme(
  signal?: AbortSignal,
): Promise<ProgrammeItem[]> {
  const apiBaseUrl =
    import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';
  const response = await fetch(`${apiBaseUrl}/api/programme`, { signal });

  if (!response.ok) {
    throw new Error(`Programme request failed with status ${response.status}.`);
  }

  return programmeSchema.parse(await response.json());
}
