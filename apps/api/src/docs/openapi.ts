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
  summary: 'CrÃ©er une session Stripe Checkout',
  description:
    'VÃ©rifie les siÃ¨ges verrouillÃ©s par la session anonyme et calcule les tarifs cÃ´tÃ© serveur avant de rediriger vers Stripe Checkout en mode carte.',
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
      description: 'URL hÃ©bergÃ©e de Stripe Checkout',
      content: { 'application/json': { schema: checkoutResponseSchema } },
    },
    400: { description: 'Demande de paiement invalide' },
    404: { description: 'SÃ©ance inconnue' },
    409: { description: 'Un ou plusieurs siÃ¨ges ne sont plus verrouillÃ©s' },
    500: { description: 'CrÃ©ation du paiement momentanÃ©ment indisponible' },
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
      description: 'Statut de la rÃ©servation liÃ©e Ã  la session Stripe',
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
    'VÃ©rifie la signature Stripe sur le corps brut. Seul cet endpoint peut confirmer une rÃ©servation et attribuer ses siÃ¨ges.',
  request: {
    headers: z.object({ 'stripe-signature': z.string() }),
    body: {
      content: { 'application/json': { schema: z.unknown() } },
      required: true,
    },
  },
  responses: {
    200: { description: 'Notification Stripe traitÃ©e' },
    400: { description: 'Signature ou notification invalide' },
    500: { description: 'Traitement de la notification Ã  rÃ©essayer' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/tickets/check-in',
  summary: 'ContrÃ´ler un billet Ã  lâ€™entrÃ©e',
  description:
    'RÃ©servÃ© au personnel authentifiÃ© ayant le rÃ´le administrateur. Le premier contrÃ´le dâ€™un QR code confirmÃ© consomme le billet ; les contrÃ´les suivants sont refusÃ©s.',
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
      description: 'Billet acceptÃ© et marquÃ© comme utilisÃ©',
      content: {
        'application/json': {
          schema: z.object({ status: z.literal('accepted') }),
        },
      },
    },
    401: { description: 'Authentification du personnel requise ou invalide' },
    403: { description: 'RÃ´le administrateur requis' },
    404: { description: 'Billet inconnu ou non confirmÃ©' },
    409: { description: 'Billet dÃ©jÃ  utilisÃ©' },
    503: { description: 'Service dâ€™authentification indisponible' },
  },
});

const adminHeaders = z.object({
  authorization: z.string().startsWith('Bearer '),
});
const adminErrors = {
  401: { description: 'Authentification requise ou invalide' },
  403: { description: 'RÃ´le administrateur requis' },
  503: { description: 'Service dâ€™authentification indisponible' },
};
const adminShowtimeSchema = z.object({
  id: z.string(),
  movieId: z.string(),
  movieTitle: z.string(),
  roomName: z.string(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  price: z.number(),
  status: z.enum(['SCHEDULED', 'CANCELLED']),
  confirmedBookings: z.number().int(),
});
const adminMovieSchema = z.object({
  title: z.string().min(1).max(200),
  genre: z.enum(genreValues),
  description: z.string().min(1).max(2000),
  duration: z.number().int().min(1).max(600),
  posterUrl: z.string().max(500).nullable().optional(),
});
const adminSpecialRateSchema = z.object({
  roomName: z.string(),
  label: z.string().min(1).max(120),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  price: z.number().positive(),
});
const adminJson = (schema: z.ZodType) => ({
  content: { 'application/json': { schema } },
});

interface AdminRoute {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  summary: string;
  description?: string;
  body?: z.ZodType;
  responses: Record<number, { description: string; content?: object }>;
}

const adminRoutes: AdminRoute[] = [
  {
    method: 'get',
    path: '/api/admin/me',
    summary: 'VÃ©rifier lâ€™accÃ¨s administrateur',
    responses: {
      200: {
        description: 'AccÃ¨s administrateur confirmÃ©',
        ...adminJson(z.object({ role: z.literal('ADMIN') })),
      },
    },
  },
  {
    method: 'get',
    path: '/api/admin/showtimes',
    summary: 'Lister toutes les sÃ©ances (y compris annulÃ©es)',
    responses: {
      200: {
        description: 'SÃ©ances triÃ©es par date',
        ...adminJson(z.object({ showtimes: z.array(adminShowtimeSchema) })),
      },
    },
  },
  {
    method: 'post',
    path: '/api/admin/showtimes',
    summary: 'Programmer une sÃ©ance',
    description:
      'Associe un film, une salle, une date et un prix. Les siÃ¨ges sont gÃ©nÃ©rÃ©s selon la capacitÃ© de la salle. Un chevauchement dans la mÃªme salle est refusÃ© (409).',
    body: z.object({
      movieId: z.string(),
      roomId: z.string(),
      startTime: z.string().datetime(),
      price: z.number().positive().optional(),
    }),
    responses: {
      201: {
        description: 'SÃ©ance crÃ©Ã©e',
        ...adminJson(z.object({ showtime: adminShowtimeSchema })),
      },
      400: { description: 'DonnÃ©es invalides ou date passÃ©e' },
      404: { description: 'Film ou salle introuvable' },
      409: { description: 'Salle dÃ©jÃ  occupÃ©e sur ce crÃ©neau' },
    },
  },
  {
    method: 'patch',
    path: '/api/admin/showtimes/{showtimeId}',
    summary: 'Modifier le prix dâ€™une sÃ©ance',
    description:
      'Seul le prix est modifiable ; film, salle, date et horaire sont figÃ©s (annuler puis recrÃ©er).',
    body: z.object({ price: z.number().positive() }),
    responses: {
      200: {
        description: 'SÃ©ance mise Ã  jour',
        ...adminJson(z.object({ showtime: adminShowtimeSchema })),
      },
      404: { description: 'SÃ©ance introuvable' },
      409: { description: 'SÃ©ance annulÃ©e' },
    },
  },
  {
    method: 'post',
    path: '/api/admin/showtimes/{showtimeId}/cancel',
    summary: 'Annuler une sÃ©ance',
    description:
      'Retire la sÃ©ance du catalogue public, passe les rÃ©servations confirmÃ©es en remboursement requis et met en file un e-mail dâ€™annulation pour chaque spectateur.',
    responses: {
      200: {
        description: 'SÃ©ance annulÃ©e',
        ...adminJson(
          z.object({
            showtime: adminShowtimeSchema,
            notifiedBookings: z.number().int(),
          }),
        ),
      },
      404: { description: 'SÃ©ance introuvable' },
    },
  },
  {
    method: 'get',
    path: '/api/admin/movies',
    summary: 'Lister les films',
    responses: { 200: { description: 'Films' } },
  },
  {
    method: 'get',
    path: '/api/admin/rooms',
    summary: 'Lister les salles',
    responses: { 200: { description: 'Salles' } },
  },
  {
    method: 'patch',
    path: '/api/admin/rooms/{roomName}',
    summary: 'Configurer une salle',
    description:
      'Définit la disposition (lignes × colonnes) et le tarif par défaut. Un changement de disposition régénère les sièges des séances à venir ; il est refusé (409) si elles ont des réservations.',
    body: z.object({
      rows: z.number().int().min(1).max(26),
      columns: z.number().int().min(1).max(40),
      defaultPrice: z.number().positive(),
    }),
    responses: {
      200: { description: 'Salle mise à jour' },
      400: { description: 'Données invalides' },
      404: { description: 'Salle introuvable' },
      409: { description: 'Réservations sur les séances à venir' },
    },
  },
  {
    method: 'get',
    path: '/api/admin/rates',
    summary: 'Lister les tarifs spéciaux',
    responses: { 200: { description: 'Tarifs spéciaux' } },
  },
  {
    method: 'post',
    path: '/api/admin/rates',
    summary: 'Créer un tarif spécial daté',
    description:
      'S’applique automatiquement, à la création, aux séances de la salle dont la date est dans la période (jours inclus, heure de Paris).',
    body: adminSpecialRateSchema,
    responses: {
      201: { description: 'Tarif créé' },
      400: { description: 'Données ou période invalides' },
      404: { description: 'Salle introuvable' },
      409: { description: 'Période chevauchant un autre tarif de la salle' },
    },
  },
  {
    method: 'put',
    path: '/api/admin/rates/{rateId}',
    summary: 'Modifier un tarif spécial',
    body: adminSpecialRateSchema,
    responses: {
      200: { description: 'Tarif mis à jour' },
      404: { description: 'Tarif ou salle introuvable' },
      409: { description: 'Période chevauchant un autre tarif de la salle' },
    },
  },
  {
    method: 'delete',
    path: '/api/admin/rates/{rateId}',
    summary: 'Supprimer un tarif spécial',
    responses: {
      204: { description: 'Tarif supprimé' },
      404: { description: 'Tarif introuvable' },
    },
  },
  {
    method: 'post',
    path: '/api/admin/movies',
    summary: 'CrÃ©er un film',
    body: adminMovieSchema,
    responses: { 201: { description: 'Film crÃ©Ã©' } },
  },
  {
    method: 'put',
    path: '/api/admin/movies/{movieId}',
    summary: 'Modifier un film',
    body: adminMovieSchema,
    responses: {
      200: { description: 'Film mis Ã  jour' },
      404: { description: 'Film introuvable' },
    },
  },
  {
    method: 'delete',
    path: '/api/admin/movies/{movieId}',
    summary: 'Supprimer un film sans sÃ©ance',
    responses: {
      204: { description: 'Film supprimÃ©' },
      404: { description: 'Film introuvable' },
      409: { description: 'Le film a des sÃ©ances' },
    },
  },
];

for (const route of adminRoutes) {
  const pathParam = /\{(\w+)\}/.exec(route.path)?.[1];
  registry.registerPath({
    method: route.method,
    path: route.path,
    summary: route.summary,
    description:
      route.description ?? 'RÃ©servÃ© aux comptes de rÃ´le administrateur.',
    tags: ['Administration'],
    request: {
      headers: adminHeaders,
      ...(pathParam ? { params: z.object({ [pathParam]: z.string() }) } : {}),
      ...(route.body
        ? {
            body: {
              content: { 'application/json': { schema: route.body } },
              required: true,
            },
          }
        : {}),
    },
    responses: { ...route.responses, ...adminErrors },
  });
}

registry.registerPath({
  method: 'get',
  path: '/api/me/bookings',
  summary: 'Lister les rÃ©servations confirmÃ©es du spectateur connectÃ©',
  description:
    'RÃ©servÃ© aux comptes de rÃ´le spectateur. Les rÃ©servations sont rattachÃ©es par e-mail ; les sÃ©ances Ã  venir prÃ©cÃ¨dent les sÃ©ances passÃ©es.',
  request: {
    headers: z.object({ authorization: z.string().startsWith('Bearer ') }),
  },
  responses: {
    200: {
      description: 'RÃ©servations confirmÃ©es du compte',
      content: {
        'application/json': {
          schema: z.object({ bookings: z.array(customerBookingSchema) }),
        },
      },
    },
    401: { description: 'Authentification requise ou invalide' },
    403: { description: 'Compte non spectateur' },
    503: { description: 'Service dâ€™authentification indisponible' },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/me/account',
  summary: 'Supprimer le compte spectateur',
  description:
    'Anonymise les coordonnées des réservations conservées puis supprime le compte Supabase Auth du spectateur connecté.',
  request: {
    headers: z.object({ authorization: z.string().startsWith('Bearer ') }),
  },
  responses: {
    204: { description: 'Compte supprimé et réservations anonymisées' },
    401: { description: 'Authentification requise ou invalide' },
    403: { description: 'Compte non spectateur' },
    500: { description: 'Données du compte indisponibles' },
    503: { description: 'Suppression du compte indisponible' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/me/bookings/{bookingId}/ticket',
  summary: 'Consulter le QR code dâ€™un e-billet',
  description:
    'Retourne le QR code (image PNG en data URL) uniquement au propriÃ©taire de la rÃ©servation confirmÃ©e.',
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
    503: { description: 'Service dâ€™authentification indisponible' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/health',
  summary: 'VÃ©rifier la disponibilitÃ© de lâ€™API',
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
    'Retourne les sÃ©ances futures Ã  partir de maintenant jusquâ€™au dÃ©but du huitiÃ¨me jour calendaire, selon le fuseau Europe/Paris.',
  responses: {
    200: {
      description: 'SÃ©ances futures triÃ©es par date et heure',
      content: {
        'application/json': {
          schema: z.array(programmeItemSchema),
        },
      },
    },
    500: {
      description: 'La programmation est momentanÃ©ment indisponible',
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/showtimes/{showtimeId}/seats',
  summary: 'Consulter le plan et la disponibilitÃ© des siÃ¨ges',
  request: {
    params: z.object({ showtimeId: z.string() }),
    headers: seatSessionHeaderSchema,
  },
  responses: {
    200: {
      description:
        'Plan de salle, tarif plein en centimes et Ã©tats des siÃ¨ges',
      content: { 'application/json': { schema: seatMapSchema } },
    },
    400: { description: 'Identifiant de sÃ©ance ou session invalide' },
    404: { description: 'SÃ©ance inconnue' },
    500: { description: 'Plan de salle momentanÃ©ment indisponible' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/showtimes/{showtimeId}/seats/holds',
  summary: 'Verrouiller temporairement des siÃ¨ges',
  description:
    'Verrouille atomiquement les siÃ¨ges disponibles pour la session anonyme pendant 10 minutes.',
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
      description: 'SiÃ¨ges verrouillÃ©s temporairement',
      content: { 'application/json': { schema: seatHoldResponseSchema } },
    },
    400: { description: 'Demande de verrouillage invalide' },
    404: { description: 'SÃ©ance inconnue' },
    409: { description: 'Un ou plusieurs siÃ¨ges sont indisponibles' },
    500: { description: 'Verrouillage temporaire indisponible' },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/showtimes/{showtimeId}/seats/holds',
  summary: 'LibÃ©rer des siÃ¨ges verrouillÃ©s par la session',
  description:
    'LibÃ¨re les siÃ¨ges demandÃ©s uniquement sâ€™ils sont verrouillÃ©s par le jeton de la session anonyme. Une demande rÃ©pÃ©tÃ©e est sans effet.',
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
        'Demande traitÃ©e ; seuls les verrous de cette session ont Ã©tÃ© libÃ©rÃ©s',
      content: {
        'application/json': { schema: z.object({ released: z.literal(true) }) },
      },
    },
    400: { description: 'Demande de libÃ©ration invalide' },
    404: { description: 'SÃ©ance inconnue' },
    500: { description: 'LibÃ©ration des siÃ¨ges momentanÃ©ment indisponible' },
  },
});

const generator = new OpenApiGeneratorV3(registry.definitions);

export const openApiDocument = generator.generateDocument({
  openapi: '3.0.0',
  info: {
    title: 'Le Grand CinÃ©ma API',
    version: '1.0.0',
    description: 'API de rÃ©servation du cinÃ©ma.',
  },
  servers: [
    { url: 'http://localhost:3000', description: 'DÃ©veloppement local' },
  ],
});
