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
  CustomerAuthenticationError,
  createCustomerAuthenticator,
  type CustomerAuthenticator,
} from './auth/customer-auth.js';
import {
  AccountDeletionError,
  createAccountDeletionService,
  type AccountDeletionService,
} from './auth/account-deletion.js';
import {
  createCustomerTicketService,
  type CustomerTicketService,
} from './tickets/customer-ticket.service.js';
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
  AdminNotFoundError,
  AdminRuleError,
  ShowtimeConflictError,
  createAdminService,
  type AdminService,
} from './admin/admin.service.js';
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
const adminShowtimeCreateSchema = z.object({
  movieId: z.string().min(1).max(120),
  roomId: z.string().min(1).max(120),
  startTime: z.string().datetime(),
  price: z.number().positive().max(1000),
});
const adminShowtimeUpdateSchema = z.object({
  price: z.number().positive().max(1000),
});
const adminMovieSchema = z.object({
  title: z.string().trim().min(1).max(200),
  genre: z.nativeEnum(Genre),
  description: z.string().trim().min(1).max(2000),
  duration: z.number().int().min(1).max(600),
  posterUrl: z.string().trim().max(500).nullable().optional(),
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
  customerAuthenticator: CustomerAuthenticator = createCustomerAuthenticator(),
  customerTicketService: CustomerTicketService = createCustomerTicketService(),
  adminService: AdminService = createAdminService(),
  accountDeletionService: AccountDeletionService = createAccountDeletionService(),
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
  async function authorizeCustomer(
    request: express.Request,
    response: express.Response,
  ) {
    try {
      return await customerAuthenticator.authorize(
        request.get('authorization'),
      );
    } catch (error) {
      if (error instanceof CustomerAuthenticationError) {
        if (error.reason === 'unavailable') {
          console.error('Customer authentication is unavailable.');
          response.status(503).json({
            error: 'AUTHENTICATION_UNAVAILABLE',
            message: 'L’espace client est momentanément indisponible.',
          });
          return null;
        }
        const forbidden = error.reason === 'forbidden';
        response.status(forbidden ? 403 : 401).json({
          error: forbidden ? 'CUSTOMER_REQUIRED' : 'AUTHENTICATION_REQUIRED',
          message: forbidden
            ? 'L’espace client est réservé aux comptes spectateurs.'
            : 'Une authentification est nécessaire.',
        });
        return null;
      }
      console.error('Customer authorization failed.', error);
      response.status(500).json({
        error: 'AUTHORIZATION_UNAVAILABLE',
        message: 'L’espace client est momentanément indisponible.',
      });
      return null;
    }
  }
  app.get('/api/me/bookings', async (request, response) => {
    const customer = await authorizeCustomer(request, response);
    if (!customer) {
      return;
    }
    try {
      response.json({
        bookings: await customerTicketService.listBookings(customer.email),
      });
    } catch (error) {
      console.error('Failed to list customer bookings.', error);
      response.status(500).json({
        error: 'BOOKINGS_UNAVAILABLE',
        message: 'Vos réservations sont momentanément indisponibles.',
      });
    }
  });
  app.delete('/api/me/account', async (request, response) => {
    const customer = await authorizeCustomer(request, response);
    if (!customer) {
      return;
    }
    try {
      await accountDeletionService.deleteAccount(customer.id, customer.email);
      response.status(204).end();
    } catch (error) {
      if (error instanceof AccountDeletionError) {
        if (error.reason === 'unavailable') {
          console.error('Account deletion is unavailable.');
          response.status(503).json({
            error: 'ACCOUNT_DELETION_UNAVAILABLE',
            message:
              'La suppression du compte est momentanément indisponible. Réessayez plus tard.',
          });
          return;
        }
        console.error('Failed to anonymize customer account data.');
        response.status(500).json({
          error: 'ACCOUNT_DATA_UNAVAILABLE',
          message:
            'Les données du compte n’ont pas pu être préparées pour suppression.',
        });
        return;
      }

      console.error('Failed to delete a customer account.', error);
      response.status(500).json({
        error: 'ACCOUNT_DELETION_UNAVAILABLE',
        message:
          'La suppression du compte est momentanément indisponible. Réessayez plus tard.',
      });
    }
  });
  app.get('/api/me/bookings/:bookingId/ticket', async (request, response) => {
    const customer = await authorizeCustomer(request, response);
    if (!customer) {
      return;
    }
    const bookingId = z.string().uuid().safeParse(request.params.bookingId);
    if (!bookingId.success) {
      response.status(404).json({
        error: 'TICKET_NOT_FOUND',
        message: 'Ce billet est introuvable.',
      });
      return;
    }
    try {
      const ticket = await customerTicketService.getTicketQr(
        customer.email,
        bookingId.data,
      );
      if (!ticket) {
        response.status(404).json({
          error: 'TICKET_NOT_FOUND',
          message: 'Ce billet est introuvable.',
        });
        return;
      }
      response.set('Cache-Control', 'no-store');
      response.json(ticket);
    } catch (error) {
      console.error('Failed to render a customer ticket.', error);
      response.status(500).json({
        error: 'TICKET_UNAVAILABLE',
        message: 'Votre billet est momentanément indisponible.',
      });
    }
  });
  async function authorizeAdmin(
    request: express.Request,
    response: express.Response,
  ) {
    try {
      await adminAuthenticator.authorize(request.get('authorization'));
      return true;
    } catch (error) {
      if (error instanceof AdminAuthenticationError) {
        if (error.reason === 'unavailable') {
          response.status(503).json({
            error: 'AUTHENTICATION_UNAVAILABLE',
            message: 'L’espace administrateur est momentanément indisponible.',
          });
          return false;
        }
        const forbidden = error.reason === 'forbidden';
        response.status(forbidden ? 403 : 401).json({
          error: forbidden ? 'ADMIN_REQUIRED' : 'AUTHENTICATION_REQUIRED',
          message: forbidden
            ? 'Un accès administrateur est nécessaire.'
            : 'Une authentification est nécessaire.',
        });
        return false;
      }
      console.error('Admin authorization failed.', error);
      response.status(500).json({
        error: 'AUTHORIZATION_UNAVAILABLE',
        message: 'L’espace administrateur est momentanément indisponible.',
      });
      return false;
    }
  }

  function adminRoute(
    handler: (
      request: express.Request,
      response: express.Response,
    ) => Promise<void>,
  ): express.RequestHandler {
    return async (request, response) => {
      if (!(await authorizeAdmin(request, response))) {
        return;
      }
      try {
        await handler(request, response);
      } catch (error) {
        if (error instanceof ShowtimeConflictError) {
          const format = (date: Date) =>
            new Intl.DateTimeFormat('fr-FR', {
              dateStyle: 'short',
              timeStyle: 'short',
              timeZone: 'Europe/Paris',
            }).format(date);
          response.status(409).json({
            error: 'SHOWTIME_CONFLICT',
            message: `Cette salle est déjà occupée par « ${error.conflict.movieTitle} » de ${format(error.conflict.startTime)} à ${format(error.conflict.endTime)}.`,
          });
          return;
        }
        if (error instanceof AdminNotFoundError) {
          response.status(404).json({
            error: 'NOT_FOUND',
            message: 'Élément introuvable.',
          });
          return;
        }
        if (error instanceof AdminRuleError) {
          const messages = {
            PAST_START: 'La séance doit commencer dans le futur.',
            SHOWTIME_CANCELLED: 'Cette séance est annulée et non modifiable.',
            MOVIE_HAS_SHOWTIMES:
              'Ce film a des séances : annulez-les ou conservez le film.',
          } as const;
          response.status(error.reason === 'PAST_START' ? 400 : 409).json({
            error: error.reason,
            message: messages[error.reason],
          });
          return;
        }
        console.error('Admin request failed.', error);
        response.status(500).json({
          error: 'ADMIN_UNAVAILABLE',
          message: 'L’espace administrateur est momentanément indisponible.',
        });
      }
    };
  }

  function invalid(response: express.Response) {
    response.status(400).json({
      error: 'INVALID_ADMIN_REQUEST',
      message: 'Les informations saisies sont invalides.',
    });
  }

  app.get(
    '/api/admin/me',
    adminRoute(async (_request, response) => {
      response.json({ role: 'ADMIN' });
    }),
  );
  app.get(
    '/api/admin/showtimes',
    adminRoute(async (_request, response) => {
      response.json({ showtimes: await adminService.listShowtimes() });
    }),
  );
  app.get(
    '/api/admin/rooms',
    adminRoute(async (_request, response) => {
      response.json({ rooms: await adminService.listRooms() });
    }),
  );
  app.get(
    '/api/admin/movies',
    adminRoute(async (_request, response) => {
      response.json({ movies: await adminService.listMovies() });
    }),
  );
  app.post(
    '/api/admin/showtimes',
    adminRoute(async (request, response) => {
      const body = adminShowtimeCreateSchema.safeParse(request.body);
      if (!body.success) {
        invalid(response);
        return;
      }
      const showtime = await adminService.createShowtime({
        ...body.data,
        startTime: new Date(body.data.startTime),
      });
      response.status(201).json({ showtime });
    }),
  );
  app.patch(
    '/api/admin/showtimes/:showtimeId',
    adminRoute(async (request, response) => {
      const id = showtimeIdSchema.safeParse(request.params.showtimeId);
      const body = adminShowtimeUpdateSchema.safeParse(request.body);
      if (!id.success || !body.success) {
        invalid(response);
        return;
      }
      response.json({
        showtime: await adminService.updateShowtimePrice(
          id.data,
          body.data.price,
        ),
      });
    }),
  );
  app.post(
    '/api/admin/showtimes/:showtimeId/cancel',
    adminRoute(async (request, response) => {
      const id = showtimeIdSchema.safeParse(request.params.showtimeId);
      if (!id.success) {
        invalid(response);
        return;
      }
      response.json(await adminService.cancelShowtime(id.data));
    }),
  );
  app.post(
    '/api/admin/movies',
    adminRoute(async (request, response) => {
      const body = adminMovieSchema.safeParse(request.body);
      if (!body.success) {
        invalid(response);
        return;
      }
      response
        .status(201)
        .json({ movie: await adminService.createMovie(body.data) });
    }),
  );
  app.put(
    '/api/admin/movies/:movieId',
    adminRoute(async (request, response) => {
      const id = showtimeIdSchema.safeParse(request.params.movieId);
      const body = adminMovieSchema.safeParse(request.body);
      if (!id.success || !body.success) {
        invalid(response);
        return;
      }
      response.json({
        movie: await adminService.updateMovie(id.data, body.data),
      });
    }),
  );
  app.delete(
    '/api/admin/movies/:movieId',
    adminRoute(async (request, response) => {
      const id = showtimeIdSchema.safeParse(request.params.movieId);
      if (!id.success) {
        invalid(response);
        return;
      }
      await adminService.deleteMovie(id.data);
      response.status(204).end();
    }),
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
