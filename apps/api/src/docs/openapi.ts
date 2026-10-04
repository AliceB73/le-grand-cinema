import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from '@asteasolutions/zod-to-openapi';
import { Genre } from '@prisma/client';
import { z } from 'zod';

const registry = new OpenAPIRegistry();
const genreValues = Object.values(Genre);

const programmeItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  genre: z.enum(genreValues),
  genreLabel: z.string(),
  duration: z.number().int().positive(),
  posterUrl: z.string().nullable(),
  roomName: z.string(),
  startTime: z.string().datetime(),
});

registry.registerPath({
  method: 'get',
  path: '/api/health',
  summary: 'Vérifier la disponibilité de l’API',
  responses: {
    200: {
      description: 'API disponible',
      content: {
        'application/json': {
          schema: z.object({ status: z.literal('ok') }),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/programme',
  summary: 'Consulter la programmation des sept jours locaux',
  description:
    'Retourne les séances futures à partir de maintenant jusqu’au début du huitième jour calendaire, selon le fuseau Europe/Paris.',
  responses: {
    200: {
      description: 'Séances futures triées par date et heure',
      content: {
        'application/json': {
          schema: z.array(programmeItemSchema),
        },
      },
    },
    500: {
      description: 'La programmation est momentanément indisponible',
    },
  },
});

const generator = new OpenApiGeneratorV3(registry.definitions);

export const openApiDocument = generator.generateDocument({
  openapi: '3.0.0',
  info: {
    title: 'Le Grand Cinéma API',
    version: '1.0.0',
    description: 'API de réservation du cinéma.',
  },
  servers: [
    { url: 'http://localhost:3000', description: 'Développement local' },
  ],
});
