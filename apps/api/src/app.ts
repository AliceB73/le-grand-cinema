import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import { Genre } from '@prisma/client';
import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from './docs/openapi.js';
import {
  createPaymentService,
  InvalidCheckoutError,
  type PaymentService,
} from './payments/payment.service.js';
import {
  AdminAuthenticationError,
  createAdminAuthenticator,
  type AdminAuthenticator,
} from './auth/admin-auth.js';
import {
  createTicketService,
  type TicketService,
} from './tickets/ticket.service.js';
import {
  InvalidStripeWebhookError,
  StripeConfigurationError,
} from './payments/stripe-gateway.js';
import { getUpcomingProgramme } from './programme/programme.service.js';
import {
  createTemporarySeatHold,
  getSeatMap,
  releaseTemporarySeatHold,
  SeatUnavailableError,
  type SeatHoldResult,
  type SeatMap,
} from './seats/seat.service.js';

const programmeItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  genre: z.nativeEnum(Genre),
  genreLabel: z.string(),
  duration: z.number().int().positive(),
  posterUrl: z.string().nullable(),
  roomName: z.string(),
  occupancyStatus: z.enum(['AVAILABLE', 'LAST_SEATS', 'FULL']),
  startTime: z.string().datetime(),
});

const programmeProviderSchema = z.array(programmeItemSchema);
const seatSessionTokenSchema = z.string().uuid();
const showtimeIdSchema = z.string().min(1).max(120);
const holdRequestSchema = z.object({
  seatIds: z
    .array(z.string().min(1).max(120))
    .min(1)
    .max(300)
    .refine((seatIds) => new Set(seatIds).size === seatIds.length),
});
const checkoutRequestSchema = z.object({
  tickets: z
    .array(
      z.object({
        seatId: z.string().min(1).max(120),
        fare: z.enum(['full', 'reduced']),
      }),
    )
    .min(1)
    .max(300)
    .refine(
      (tickets) =>
        new Set(tickets.map(({ seatId }) => seatId)).size === tickets.length,
    ),
});
const checkoutSessionIdSchema = z.string().startsWith('cs_test_').max(255);
const ticketCheckInRequestSchema = z.object({
  qrCode: z.string().regex(/^lgc1_[A-Za-z0-9_-]{43}$/),
});

type ProgrammeProvider = () => ReturnType<typeof getUpcomingProgramme>;
export interface SeatService {
  getSeatMap(showtimeId: string, sessionToken: string): Promise<SeatMap | null>;
  createTemporarySeatHold(
    showtimeId: string,
    seatIds: string[],
    sessionToken: string,
  ): Promise<SeatHoldResult | null>;
  releaseTemporarySeatHold(
    showtimeId: string,
    seatIds: string[],
    sessionToken: string,
  ): Promise<boolean>;
}

const defaultSeatService: SeatService = {
  getSeatMap,
  createTemporarySeatHold,
  releaseTemporarySeatHold,
};

export function createApp(
  programmeProvider: ProgrammeProvider = () => getUpcomingProgramme(),
  seatService: SeatService = defaultSeatService,
  paymentService: PaymentService = createPaymentService(),
  ticketService: TicketService = createTicketService(),
  adminAuthenticator: AdminAuthenticator = createAdminAuthenticator(),
) {
  const app = express();

  app.post(
    '/api/payments/webhook',
    express.raw({ type: 'application/json' }),
    async (request, response) => {
      const signature = request.get('stripe-signature');
      if (!signature || !Buffer.isBuffer(request.body)) {
        response.status(400).json({
          error: 'INVALID_STRIPE_WEBHOOK',
          message: 'La notification de paiement est invalide.',
        });
        return;
      }

      try {
        await paymentService.handleWebhook(request.body, signature);
        response.json({ received: true });
      } catch (error) {
        if (error instanceof InvalidStripeWebhookError) {
          console.error('Rejected an invalid Stripe webhook.');
          response.status(400).json({
            error: 'INVALID_STRIPE_WEBHOOK',
            message: 'La notification de paiement est invalide.',
          });
          return;
        }

        if (error instanceof StripeConfigurationError) {
          console.error('Stripe webhook handling is not configured.');
          response.status(503).json({
            error: 'STRIPE_NOT_CONFIGURED',
            message:
              'Le traitement du paiement Stripe n’est pas encore configuré.',
          });
          return;
        }

        console.error('Failed to process a Stripe webhook.', error);
        response.status(500).json({
          error: 'STRIPE_WEBHOOK_UNAVAILABLE',
          message:
            'La confirmation du paiement est momentanément indisponible.',
        });
      }
    },
  );
  app.use(express.json());
  app.use(
    cors({
      origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    }),
  );
  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' });
  });
  app.post('/api/tickets/check-in', async (request, response) => {
    try {
      await adminAuthenticator.authorize(request.get('authorization'));
    } catch (error) {
      if (error instanceof AdminAuthenticationError) {
        if (error.reason === 'unavailable') {
          console.error('Ticket check-in authentication is unavailable.');
          response.status(503).json({
            error: 'AUTHENTICATION_UNAVAILABLE',
            message: 'Le contrôle d’accès est momentanément indisponible.',
          });
          return;
        }
        const forbidden = error.reason === 'forbidden';
        response.status(forbidden ? 403 : 401).json({
          error: forbidden ? 'ADMIN_REQUIRED' : 'AUTHENTICATION_REQUIRED',
          message: forbidden
            ? 'Un accès administrateur est nécessaire.'
            : 'Une authentification du personnel est nécessaire.',
        });
        return;
      }
      console.error('Ticket check-in authorization failed.', error);
      response.status(500).json({
        error: 'AUTHORIZATION_UNAVAILABLE',
        message: 'Le contrôle d’accès est momentanément indisponible.',
      });
      return;
    }

    const body = ticketCheckInRequestSchema.safeParse(request.body);
    if (!body.success) {
      response.status(400).json({
        error: 'INVALID_TICKET_QR',
        message: 'Le QR code présenté est invalide.',
      });
      return;
    }

    try {
      const result = await ticketService.checkIn(body.data.qrCode);
      if (result === 'invalid') {
        response.status(404).json({
          error: 'TICKET_NOT_FOUND',
          message: 'Ce billet est invalide ou n’est pas confirmé.',
        });
        return;
      }
      if (result === 'already_used') {
        response.status(409).json({
          error: 'TICKET_ALREADY_USED',
          message: 'Ce billet a déjà été utilisé.',
        });
        return;
      }
      response.json({ status: 'accepted' });
    } catch (error) {
      console.error('Failed to validate a ticket at check-in.', error);
      response.status(500).json({
        error: 'TICKET_CHECK_IN_UNAVAILABLE',
        message: 'Le contrôle du billet est momentanément indisponible.',
      });
    }
  });
  app.post('/api/showtimes/:showtimeId/checkout', async (request, response) => {
    const showtimeId = showtimeIdSchema.safeParse(request.params.showtimeId);
    const sessionToken = seatSessionTokenSchema.safeParse(
      request.get('x-seat-session-token'),
    );
    const body = checkoutRequestSchema.safeParse(request.body);

    if (!showtimeId.success || !sessionToken.success || !body.success) {
      response.status(400).json({
        error: 'INVALID_CHECKOUT_REQUEST',
        message: 'La demande de paiement est invalide.',
      });
      return;
    }

    try {
      const checkout = await paymentService.createCheckout({
        showtimeId: showtimeId.data,
        sessionToken: sessionToken.data,
        tickets: body.data.tickets,
      });
      response.status(201).json(checkout);
    } catch (error) {
      if (error instanceof InvalidCheckoutError) {
        response.status(error.reason === 'showtime' ? 404 : 409).json({
          error:
            error.reason === 'showtime'
              ? 'SHOWTIME_NOT_FOUND'
              : 'SEATS_UNAVAILABLE',
          message:
            error.reason === 'showtime'
              ? 'Cette séance n’existe pas.'
              : 'Un ou plusieurs sièges ne sont plus verrouillés. Actualisez le plan et choisissez à nouveau.',
        });
        return;
      }

      if (error instanceof StripeConfigurationError) {
        console.error('Stripe Checkout is not configured.');
        response.status(503).json({
          error: 'STRIPE_NOT_CONFIGURED',
          message:
            'Le paiement par carte n’est pas encore configuré. Ajoutez les clés Stripe de test dans le fichier .env.',
        });
        return;
      }

      console.error('Failed to create a Stripe Checkout session.', error);
      response.status(500).json({
        error: 'CHECKOUT_UNAVAILABLE',
        message: 'Le paiement est momentanément indisponible. Réessayez.',
      });
    }
  });
  app.get(
    '/api/payments/sessions/:sessionId/status',
    async (request, response) => {
      const sessionId = checkoutSessionIdSchema.safeParse(
        request.params.sessionId,
      );
      if (!sessionId.success) {
        response.status(400).json({
          error: 'INVALID_CHECKOUT_SESSION',
          message: 'La session de paiement est invalide.',
        });
        return;
      }

      try {
        const status = await paymentService.getCheckoutStatus(sessionId.data);
        if (!status) {
          response.status(404).json({
            error: 'CHECKOUT_SESSION_NOT_FOUND',
            message: 'Cette session de paiement est introuvable.',
          });
          return;
        }
        response.json({ status: status.toLowerCase() });
      } catch (error) {
        console.error('Failed to retrieve the Checkout status.', error);
        response.status(500).json({
          error: 'CHECKOUT_STATUS_UNAVAILABLE',
          message: 'Le statut du paiement est momentanément indisponible.',
        });
      }
    },
  );
  app.get('/api/programme', async (_request, response, next) => {
    try {
      const programme = await programmeProvider();
      response.json(programmeProviderSchema.parse(programme));
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/showtimes/:showtimeId/seats', async (request, response) => {
    const showtimeId = showtimeIdSchema.safeParse(request.params.showtimeId);
    const sessionToken = seatSessionTokenSchema.safeParse(
      request.get('x-seat-session-token'),
    );

    if (!showtimeId.success || !sessionToken.success) {
      response.status(400).json({
        error: 'INVALID_SEAT_MAP_REQUEST',
        message: 'La demande de plan de salle est invalide.',
      });
      return;
    }

    try {
      const seatMap = await seatService.getSeatMap(
        showtimeId.data,
        sessionToken.data,
      );

      if (!seatMap) {
        response.status(404).json({
          error: 'SHOWTIME_NOT_FOUND',
          message: 'Cette séance n’existe pas.',
        });
        return;
      }

      response.json(seatMap);
    } catch (error) {
      console.error('Failed to serve the seat map.', error);
      response.status(500).json({
        error: 'SEAT_MAP_UNAVAILABLE',
        message: 'Le plan de salle est momentanément indisponible.',
      });
    }
  });
  app.post(
    '/api/showtimes/:showtimeId/seats/holds',
    async (request, response) => {
      const showtimeId = showtimeIdSchema.safeParse(request.params.showtimeId);
      const sessionToken = seatSessionTokenSchema.safeParse(
        request.get('x-seat-session-token'),
      );
      const body = holdRequestSchema.safeParse(request.body);

      if (!showtimeId.success || !sessionToken.success || !body.success) {
        response.status(400).json({
          error: 'INVALID_SEAT_HOLD_REQUEST',
          message: 'La demande de réservation temporaire est invalide.',
        });
        return;
      }

      try {
        const hold = await seatService.createTemporarySeatHold(
          showtimeId.data,
          body.data.seatIds,
          sessionToken.data,
        );

        if (!hold) {
          response.status(404).json({
            error: 'SHOWTIME_NOT_FOUND',
            message: 'Cette séance n’existe pas.',
          });
          return;
        }

        response.status(201).json(hold);
      } catch (error) {
        if (error instanceof SeatUnavailableError) {
          response.status(409).json({
            error: 'SEATS_UNAVAILABLE',
            message:
              'Un ou plusieurs sièges ne sont plus disponibles. Actualisez le plan et choisissez à nouveau.',
          });
          return;
        }

        console.error('Failed to create a temporary seat hold.', error);
        response.status(500).json({
          error: 'SEAT_HOLD_UNAVAILABLE',
          message: 'La réservation temporaire est momentanément indisponible.',
        });
      }
    },
  );
  app.delete(
    '/api/showtimes/:showtimeId/seats/holds',
    async (request, response) => {
      const showtimeId = showtimeIdSchema.safeParse(request.params.showtimeId);
      const sessionToken = seatSessionTokenSchema.safeParse(
        request.get('x-seat-session-token'),
      );
      const body = holdRequestSchema.safeParse(request.body);

      if (!showtimeId.success || !sessionToken.success || !body.success) {
        response.status(400).json({
          error: 'INVALID_SEAT_RELEASE_REQUEST',
          message: 'La demande de libération des sièges est invalide.',
        });
        return;
      }

      try {
        const released = await seatService.releaseTemporarySeatHold(
          showtimeId.data,
          body.data.seatIds,
          sessionToken.data,
        );

        if (!released) {
          response.status(404).json({
            error: 'SHOWTIME_NOT_FOUND',
            message: 'Cette séance n’existe pas.',
          });
          return;
        }

        response.json({ released: true });
      } catch (error) {
        console.error('Failed to release temporary seat holds.', error);
        response.status(500).json({
          error: 'SEAT_RELEASE_UNAVAILABLE',
          message: 'La libération des sièges est momentanément indisponible.',
        });
      }
    },
  );
  app.get('/api/openapi.json', (_request, response) => {
    response.json(openApiDocument);
  });
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));
  app.use(
    (
      error: Error,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      void _next;
      console.error('Failed to serve the public programme.', error);
      response.status(500).json({
        error: 'PROGRAMME_UNAVAILABLE',
        message: 'La programmation est momentanément indisponible.',
      });
    },
  );

  return app;
}
