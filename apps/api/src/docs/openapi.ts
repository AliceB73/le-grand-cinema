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
  occupancyStatus: z.enum(['AVAILABLE', 'LAST_SEATS', 'FULL']),
  startTime: z.string().datetime(),
});
const seatSessionHeaderSchema = z.object({
  'x-seat-session-token': z.string().uuid(),
});
const seatMapItemSchema = z.object({
  id: z.string(),
  rowNumber: z.string(),
  seatNumber: z.number().int().positive(),
  status: z.enum(['available', 'occupied', 'held']),
  heldByCurrentSession: z.boolean(),
  expiresAt: z.string().datetime().nullable(),
});
const seatMapSchema = z.object({
  showtimeId: z.string(),
  priceCents: z.number().int().nonnegative(),
  seats: z.array(seatMapItemSchema),
});
const seatHoldRequestSchema = z.object({
  seatIds: z.array(z.string()).min(1).max(300),
});
const seatHoldResponseSchema = z.object({
  heldSeatIds: z.array(z.string()),
  expiresAt: z.string().datetime(),
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

registry.registerPath({
  method: 'get',
  path: '/api/showtimes/{showtimeId}/seats',
  summary: 'Consulter le plan et la disponibilité des sièges',
  request: {
    params: z.object({ showtimeId: z.string() }),
    headers: seatSessionHeaderSchema,
  },
  responses: {
    200: {
      description: 'Plan de salle, tarif plein en centimes et états des sièges',
      content: { 'application/json': { schema: seatMapSchema } },
    },
    400: { description: 'Identifiant de séance ou session invalide' },
    404: { description: 'Séance inconnue' },
    500: { description: 'Plan de salle momentanément indisponible' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/showtimes/{showtimeId}/seats/holds',
  summary: 'Verrouiller temporairement des sièges',
  description:
    'Verrouille atomiquement les sièges disponibles pour la session anonyme pendant 10 minutes.',
  request: {
    params: z.object({ showtimeId: z.string() }),
    headers: seatSessionHeaderSchema,
    body: {
      content: {
        'application/json': {
          schema: seatHoldRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    201: {
      description: 'Sièges verrouillés temporairement',
      content: { 'application/json': { schema: seatHoldResponseSchema } },
    },
    400: { description: 'Demande de verrouillage invalide' },
    404: { description: 'Séance inconnue' },
    409: { description: 'Un ou plusieurs sièges sont indisponibles' },
    500: { description: 'Verrouillage temporaire indisponible' },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/showtimes/{showtimeId}/seats/holds',
  summary: 'Libérer des sièges verrouillés par la session',
  description:
    'Libère les sièges demandés uniquement s’ils sont verrouillés par le jeton de la session anonyme. Une demande répétée est sans effet.',
  request: {
    params: z.object({ showtimeId: z.string() }),
    headers: seatSessionHeaderSchema,
    body: {
      content: {
        'application/json': {
          schema: seatHoldRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description:
        'Demande traitée ; seuls les verrous de cette session ont été libérés',
      content: {
        'application/json': { schema: z.object({ released: z.literal(true) }) },
      },
    },
    400: { description: 'Demande de libération invalide' },
    404: { description: 'Séance inconnue' },
    500: { description: 'Libération des sièges momentanément indisponible' },
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
