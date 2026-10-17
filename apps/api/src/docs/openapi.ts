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
const checkoutRequestSchema = z.object({
  tickets: z
    .array(
      z.object({
        seatId: z.string(),
        fare: z.enum(['full', 'reduced']),
      }),
    )
    .min(1)
    .max(300),
});
const checkoutResponseSchema = z.object({
  id: z.string(),
  url: z.url(),
});
const checkoutStatusSchema = z.object({
  status: z.enum(['pending', 'confirmed', 'cancelled', 'refund_required']),
});

const customerBookingSchema = z.object({
  id: z.string().uuid(),
  movieTitle: z.string(),
  roomName: z.string(),
  startTime: z.string().datetime(),
  seats: z.array(
    z.object({ rowNumber: z.string(), seatNumber: z.number().int() }),
  ),
  seatCount: z.number().int(),
  used: z.boolean(),
  isUpcoming: z.boolean(),
});

registry.registerPath({
  method: 'post',
  path: '/api/showtimes/{showtimeId}/checkout',
  summary: 'Créer une session Stripe Checkout',
  description:
    'Vérifie les sièges verrouillés par la session anonyme et calcule les tarifs côté serveur avant de rediriger vers Stripe Checkout en mode carte.',
  request: {
    params: z.object({ showtimeId: z.string() }),
    headers: seatSessionHeaderSchema,
    body: {
      content: { 'application/json': { schema: checkoutRequestSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      description: 'URL hébergée de Stripe Checkout',
      content: { 'application/json': { schema: checkoutResponseSchema } },
    },
    400: { description: 'Demande de paiement invalide' },
    404: { description: 'Séance inconnue' },
    409: { description: 'Un ou plusieurs sièges ne sont plus verrouillés' },
    500: { description: 'Création du paiement momentanément indisponible' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/payments/sessions/{sessionId}/status',
  summary: 'Consulter le statut de Checkout',
  request: {
    params: z.object({ sessionId: z.string() }),
  },
  responses: {
    200: {
      description: 'Statut de la réservation liée à la session Stripe',
      content: { 'application/json': { schema: checkoutStatusSchema } },
    },
    404: { description: 'Session Stripe inconnue' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/payments/webhook',
  summary: 'Recevoir les notifications Stripe',
  description:
    'Vérifie la signature Stripe sur le corps brut. Seul cet endpoint peut confirmer une réservation et attribuer ses sièges.',
  request: {
    headers: z.object({ 'stripe-signature': z.string() }),
    body: {
      content: { 'application/json': { schema: z.unknown() } },
      required: true,
    },
  },
  responses: {
    200: { description: 'Notification Stripe traitée' },
    400: { description: 'Signature ou notification invalide' },
    500: { description: 'Traitement de la notification à réessayer' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/tickets/check-in',
  summary: 'Contrôler un billet à l’entrée',
  description:
    'Réservé au personnel authentifié ayant le rôle administrateur. Le premier contrôle d’un QR code confirmé consomme le billet ; les contrôles suivants sont refusés.',
  request: {
    headers: z.object({
      authorization: z.string().startsWith('Bearer '),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            qrCode: z.string().regex(/^lgc1_[A-Za-z0-9_-]{43}$/),
          }),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'Billet accepté et marqué comme utilisé',
      content: {
        'application/json': {
          schema: z.object({ status: z.literal('accepted') }),
        },
      },
    },
    401: { description: 'Authentification du personnel requise ou invalide' },
    403: { description: 'Rôle administrateur requis' },
    404: { description: 'Billet inconnu ou non confirmé' },
    409: { description: 'Billet déjà utilisé' },
    503: { description: 'Service d’authentification indisponible' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/me/bookings',
  summary: 'Lister les réservations confirmées du spectateur connecté',
  description:
    'Réservé aux comptes de rôle spectateur. Les réservations sont rattachées par e-mail ; les séances à venir précèdent les séances passées.',
  request: {
    headers: z.object({ authorization: z.string().startsWith('Bearer ') }),
  },
  responses: {
    200: {
      description: 'Réservations confirmées du compte',
      content: {
        'application/json': {
          schema: z.object({ bookings: z.array(customerBookingSchema) }),
        },
      },
    },
    401: { description: 'Authentification requise ou invalide' },
    403: { description: 'Compte non spectateur' },
    503: { description: 'Service d’authentification indisponible' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/me/bookings/{bookingId}/ticket',
  summary: 'Consulter le QR code d’un e-billet',
  description:
    'Retourne le QR code (image PNG en data URL) uniquement au propriétaire de la réservation confirmée.',
  request: {
    params: z.object({ bookingId: z.string().uuid() }),
    headers: z.object({ authorization: z.string().startsWith('Bearer ') }),
  },
  responses: {
    200: {
      description: 'QR code du billet',
      content: {
        'application/json': {
          schema: z.object({
            qrCodeDataUrl: z.string(),
            used: z.boolean(),
          }),
        },
      },
    },
    401: { description: 'Authentification requise ou invalide' },
    403: { description: 'Compte non spectateur' },
    404: { description: 'Billet introuvable' },
    503: { description: 'Service d’authentification indisponible' },
  },
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
