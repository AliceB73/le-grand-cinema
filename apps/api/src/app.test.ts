import { describe, expect, it, jest } from '@jest/globals';
import { Genre } from '@prisma/client';
import request from 'supertest';
import { createApp, type SeatService } from './app.js';
import * as programmeService from './programme/programme.service.js';
import { SeatUnavailableError } from './seats/seat.service.js';
import type { PaymentService } from './payments/payment.service.js';
import {
  InvalidStripeWebhookError,
  StripeConfigurationError,
} from './payments/stripe-gateway.js';
import { InvalidCheckoutError } from './payments/payment.service.js';
import {
  AdminAuthenticationError,
  type AdminAuthenticator,
} from './auth/admin-auth.js';
import type { TicketService } from './tickets/ticket.service.js';

describe('API baseline', () => {
  it('returns a healthy status', async () => {
    const response = await request(createApp()).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('requires staff auth and rejects a previously consumed ticket', async () => {
    const authorize = jest.fn<AdminAuthenticator['authorize']>();
    const checkIn = jest
      .fn<TicketService['checkIn']>()
      .mockResolvedValueOnce('accepted')
      .mockResolvedValueOnce('already_used');
    const app = createApp(
      undefined,
      undefined,
      undefined,
      { checkIn },
      {
        authorize,
      },
    );
    const requestBody = {
      qrCode: `lgc1_${'a'.repeat(43)}`,
    };

    const accepted = await request(app)
      .post('/api/tickets/check-in')
      .set('Authorization', 'Bearer staff-token')
      .send(requestBody);
    const repeated = await request(app)
      .post('/api/tickets/check-in')
      .set('Authorization', 'Bearer staff-token')
      .send(requestBody);

    expect(accepted.status).toBe(200);
    expect(accepted.body).toEqual({ status: 'accepted' });
    expect(repeated.status).toBe(409);
    expect(repeated.body.error).toBe('TICKET_ALREADY_USED');
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(checkIn).toHaveBeenCalledTimes(2);
  });

  it('does not process a check-in when staff authorization fails', async () => {
    const authorize = jest
      .fn<AdminAuthenticator['authorize']>()
      .mockRejectedValue(new AdminAuthenticationError('forbidden'));
    const checkIn = jest.fn<TicketService['checkIn']>();
    const app = createApp(
      undefined,
      undefined,
      undefined,
      { checkIn },
      {
        authorize,
      },
    );
    const response = await request(app)
      .post('/api/tickets/check-in')
      .set('Authorization', 'Bearer user-token')
      .send({ qrCode: `lgc1_${'a'.repeat(43)}` });

    expect(response.status).toBe(403);
    expect(checkIn).not.toHaveBeenCalled();
  });

  it('requires staff authentication before validating the QR shape', async () => {
    const authorize = jest
      .fn<AdminAuthenticator['authorize']>()
      .mockRejectedValue(new AdminAuthenticationError('missing'));
    const checkIn = jest.fn<TicketService['checkIn']>();
    const app = createApp(
      undefined,
      undefined,
      undefined,
      { checkIn },
      {
        authorize,
      },
    );

    const response = await request(app)
      .post('/api/tickets/check-in')
      .send({ qrCode: 'not-a-ticket' });

    expect(response.status).toBe(401);
    expect(checkIn).not.toHaveBeenCalled();
  });

  it('publishes the OpenAPI document', async () => {
    const response = await request(createApp()).get('/api/openapi.json');

    expect(response.status).toBe(200);
    expect(response.body.openapi).toBe('3.0.0');
    expect(response.body.paths['/api/health']).toBeDefined();
    expect(response.body.paths['/api/me/account'].delete).toBeDefined();
    expect(response.body.paths['/api/tickets/check-in'].post).toBeDefined();
    expect(response.body.paths['/api/programme']).toBeDefined();
    expect(
      response.body.paths['/api/showtimes/{showtimeId}/seats'],
    ).toBeDefined();
    expect(
      response.body.paths['/api/showtimes/{showtimeId}/seats/holds'],
    ).toBeDefined();
    expect(
      response.body.paths['/api/showtimes/{showtimeId}/seats/holds'].delete,
    ).toBeDefined();
    expect(
      response.body.paths['/api/showtimes/{showtimeId}/checkout'].post,
    ).toBeDefined();
    expect(
      response.body.paths['/api/payments/sessions/{sessionId}/status'].get,
    ).toBeDefined();
    expect(
      response.body.paths['/api/showtimes/{showtimeId}/seats'].get.parameters,
    ).toContainEqual(
      expect.objectContaining({
        name: 'x-seat-session-token',
        in: 'header',
      }),
    );
    expect(
      response.body.paths['/api/showtimes/{showtimeId}/seats/holds'].post
        .requestBody,
    ).toBeDefined();
  });

  it('returns the validated public programme', async () => {
    const app = createApp(async () => [
      {
        id: 'screening-1',
        title: 'Les Veilleurs du Phare',
        genre: Genre.THRILLER,
        genreLabel: 'Thriller',
        duration: 108,
        posterUrl: '/posters/veilleurs-du-phare.svg',
        roomName: 'Salle A',
        occupancyStatus: 'AVAILABLE',
        startTime: '2026-10-04T15:00:00.000Z',
      },
    ]);

    const response = await request(app).get('/api/programme');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      title: 'Les Veilleurs du Phare',
      genre: 'THRILLER',
      genreLabel: 'Thriller',
      roomName: 'Salle A',
      occupancyStatus: 'AVAILABLE',
    });
  });

  it('uses the default programme provider', async () => {
    const getUpcomingProgramme = jest
      .spyOn(programmeService, 'getUpcomingProgramme')
      .mockResolvedValue([]);

    const response = await request(createApp()).get('/api/programme');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(getUpcomingProgramme).toHaveBeenCalled();
    getUpcomingProgramme.mockRestore();
  });

  it('returns an explicit error and logs when programme retrieval fails', async () => {
    const logError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const app = createApp(async () => {
      throw new Error('database unavailable');
    });

    const response = await request(app).get('/api/programme');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'PROGRAMME_UNAVAILABLE',
      message: 'La programmation est momentanément indisponible.',
    });
    expect(logError).toHaveBeenCalled();
    logError.mockRestore();
  });

  it('returns the seat map for an anonymous session', async () => {
    const seatService: SeatService = {
      getSeatMap: async () => ({
        showtimeId: 'showtime-1',
        priceCents: 950,
        seats: [
          {
            id: 'seat-1',
            rowNumber: 'A',
            seatNumber: 1,
            status: 'available',
            heldByCurrentSession: false,
            expiresAt: null,
          },
        ],
      }),
      createTemporarySeatHold: async () => null,
      releaseTemporarySeatHold: async () => true,
    };

    const response = await request(createApp(undefined, seatService))
      .get('/api/showtimes/showtime-1/seats')
      .set('x-seat-session-token', '7e4cbf13-f749-4b7d-8fa6-28e9fa88f38b');

    expect(response.status).toBe(200);
    expect(response.body.seats[0]).toMatchObject({
      id: 'seat-1',
      status: 'available',
    });
  });

  it('rejects seat-map requests without a valid anonymous session token', async () => {
    const response = await request(createApp()).get(
      '/api/showtimes/showtime-1/seats',
    );

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_SEAT_MAP_REQUEST');
  });

  it('creates a temporary seat hold for ten minutes', async () => {
    const seatService: SeatService = {
      getSeatMap: async () => null,
      createTemporarySeatHold: async () => ({
        heldSeatIds: ['seat-1'],
        expiresAt: '2026-10-11T10:10:00.000Z',
      }),
      releaseTemporarySeatHold: async () => true,
    };

    const response = await request(createApp(undefined, seatService))
      .post('/api/showtimes/showtime-1/seats/holds')
      .set('x-seat-session-token', '7e4cbf13-f749-4b7d-8fa6-28e9fa88f38b')
      .send({ seatIds: ['seat-1'] });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      heldSeatIds: ['seat-1'],
      expiresAt: '2026-10-11T10:10:00.000Z',
    });
  });

  it('rejects duplicate seats in a hold request', async () => {
    const response = await request(createApp())
      .post('/api/showtimes/showtime-1/seats/holds')
      .set('x-seat-session-token', '7e4cbf13-f749-4b7d-8fa6-28e9fa88f38b')
      .send({ seatIds: ['seat-1', 'seat-1'] });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_SEAT_HOLD_REQUEST');
  });

  it('returns a conflict when seats became unavailable', async () => {
    const seatService: SeatService = {
      getSeatMap: async () => null,
      createTemporarySeatHold: async () => {
        throw new SeatUnavailableError(['seat-1']);
      },
      releaseTemporarySeatHold: async () => true,
    };

    const response = await request(createApp(undefined, seatService))
      .post('/api/showtimes/showtime-1/seats/holds')
      .set('x-seat-session-token', '7e4cbf13-f749-4b7d-8fa6-28e9fa88f38b')
      .send({ seatIds: ['seat-1'] });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('SEATS_UNAVAILABLE');
  });

  it('releases session-owned holds idempotently', async () => {
    const releaseTemporarySeatHold = jest
      .fn<SeatService['releaseTemporarySeatHold']>()
      .mockResolvedValue(true);
    const seatService: SeatService = {
      getSeatMap: async () => null,
      createTemporarySeatHold: async () => null,
      releaseTemporarySeatHold,
    };

    const response = await request(createApp(undefined, seatService))
      .delete('/api/showtimes/showtime-1/seats/holds')
      .set('x-seat-session-token', '7e4cbf13-f749-4b7d-8fa6-28e9fa88f38b')
      .send({ seatIds: ['seat-1'] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ released: true });
    expect(releaseTemporarySeatHold).toHaveBeenCalledWith(
      'showtime-1',
      ['seat-1'],
      '7e4cbf13-f749-4b7d-8fa6-28e9fa88f38b',
    );
  });

  it('rejects invalid release requests', async () => {
    const response = await request(createApp())
      .delete('/api/showtimes/showtime-1/seats/holds')
      .send({ seatIds: ['seat-1'] });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_SEAT_RELEASE_REQUEST');
  });

  it('creates a Checkout session from the anonymous seat session', async () => {
    const createCheckout = jest
      .fn<PaymentService['createCheckout']>()
      .mockResolvedValue({
        id: 'cs_test_checkout-1',
        url: 'https://checkout.stripe.com/test',
      });
    const paymentService: PaymentService = {
      createCheckout,
      handleWebhook: jest.fn<PaymentService['handleWebhook']>(),
      getCheckoutStatus: jest
        .fn<PaymentService['getCheckoutStatus']>()
        .mockResolvedValue(null),
    };

    const response = await request(
      createApp(undefined, undefined, paymentService),
    )
      .post('/api/showtimes/showtime-1/checkout')
      .set('x-seat-session-token', '7e4cbf13-f749-4b7d-8fa6-28e9fa88f38b')
      .send({ tickets: [{ seatId: 'seat-1', fare: 'full' }] });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: 'cs_test_checkout-1',
      url: 'https://checkout.stripe.com/test',
    });
    expect(createCheckout).toHaveBeenCalledWith({
      showtimeId: 'showtime-1',
      sessionToken: '7e4cbf13-f749-4b7d-8fa6-28e9fa88f38b',
      tickets: [{ seatId: 'seat-1', fare: 'full' }],
    });
  });

  it('returns an actionable service-unavailable response when Stripe is not configured', async () => {
    const paymentService: PaymentService = {
      createCheckout: jest
        .fn<PaymentService['createCheckout']>()
        .mockRejectedValue(
          new StripeConfigurationError('Stripe test key is missing.'),
        ),
      handleWebhook: jest.fn<PaymentService['handleWebhook']>(),
      getCheckoutStatus: jest
        .fn<PaymentService['getCheckoutStatus']>()
        .mockResolvedValue(null),
    };
    const logError = jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(
      createApp(undefined, undefined, paymentService),
    )
      .post('/api/showtimes/showtime-1/checkout')
      .set('x-seat-session-token', '7e4cbf13-f749-4b7d-8fa6-28e9fa88f38b')
      .send({ tickets: [{ seatId: 'seat-1', fare: 'full' }] });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: 'STRIPE_NOT_CONFIGURED',
      message:
        'Le paiement par carte n’est pas encore configuré. Ajoutez les clés Stripe de test dans le fichier .env.',
    });
    expect(logError).toHaveBeenCalled();
  });

  it('validates Checkout requests and reports missing screenings or expired seats', async () => {
    const createCheckout = jest
      .fn<PaymentService['createCheckout']>()
      .mockRejectedValueOnce(new InvalidCheckoutError('showtime'))
      .mockRejectedValueOnce(new InvalidCheckoutError('seats'));
    const paymentService: PaymentService = {
      createCheckout,
      handleWebhook: jest.fn<PaymentService['handleWebhook']>(),
      getCheckoutStatus: jest
        .fn<PaymentService['getCheckoutStatus']>()
        .mockResolvedValue(null),
    };
    const app = createApp(undefined, undefined, paymentService);
    const invalid = await request(app)
      .post('/api/showtimes/showtime-1/checkout')
      .send({ tickets: [{ seatId: 'seat-1', fare: 'full' }] });
    const missing = await request(app)
      .post('/api/showtimes/showtime-1/checkout')
      .set('x-seat-session-token', '7e4cbf13-f749-4b7d-8fa6-28e9fa88f38b')
      .send({ tickets: [{ seatId: 'seat-1', fare: 'full' }] });
    const unavailable = await request(app)
      .post('/api/showtimes/showtime-1/checkout')
      .set('x-seat-session-token', '7e4cbf13-f749-4b7d-8fa6-28e9fa88f38b')
      .send({ tickets: [{ seatId: 'seat-1', fare: 'full' }] });

    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe('INVALID_CHECKOUT_REQUEST');
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe('SHOWTIME_NOT_FOUND');
    expect(unavailable.status).toBe(409);
    expect(unavailable.body.error).toBe('SEATS_UNAVAILABLE');
  });

  it('reports a logged error when Checkout creation fails unexpectedly', async () => {
    const paymentService: PaymentService = {
      createCheckout: jest
        .fn<PaymentService['createCheckout']>()
        .mockRejectedValue(new Error('Stripe unavailable')),
      handleWebhook: jest.fn<PaymentService['handleWebhook']>(),
      getCheckoutStatus: jest
        .fn<PaymentService['getCheckoutStatus']>()
        .mockResolvedValue(null),
    };
    const logError = jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(
      createApp(undefined, undefined, paymentService),
    )
      .post('/api/showtimes/showtime-1/checkout')
      .set('x-seat-session-token', '7e4cbf13-f749-4b7d-8fa6-28e9fa88f38b')
      .send({ tickets: [{ seatId: 'seat-1', fare: 'full' }] });

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('CHECKOUT_UNAVAILABLE');
    expect(logError).toHaveBeenCalled();
  });

  it('returns the persisted Checkout status', async () => {
    const paymentService: PaymentService = {
      createCheckout: jest.fn<PaymentService['createCheckout']>(),
      handleWebhook: jest.fn<PaymentService['handleWebhook']>(),
      getCheckoutStatus: jest
        .fn<PaymentService['getCheckoutStatus']>()
        .mockResolvedValue('CONFIRMED'),
    };

    const response = await request(
      createApp(undefined, undefined, paymentService),
    ).get('/api/payments/sessions/cs_test_checkout-1/status');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'confirmed' });
  });

  it('returns bad-request, not-found, and server-error Checkout status responses', async () => {
    const getCheckoutStatus = jest
      .fn<PaymentService['getCheckoutStatus']>()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('Database unavailable'));
    const paymentService: PaymentService = {
      createCheckout: jest.fn<PaymentService['createCheckout']>(),
      handleWebhook: jest.fn<PaymentService['handleWebhook']>(),
      getCheckoutStatus,
    };
    const logError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const app = createApp(undefined, undefined, paymentService);

    const invalid = await request(app).get(
      '/api/payments/sessions/invalid/status',
    );
    const missing = await request(app).get(
      '/api/payments/sessions/cs_test_missing/status',
    );
    const failed = await request(app).get(
      '/api/payments/sessions/cs_test_error/status',
    );

    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe('INVALID_CHECKOUT_SESSION');
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe('CHECKOUT_SESSION_NOT_FOUND');
    expect(failed.status).toBe(500);
    expect(failed.body.error).toBe('CHECKOUT_STATUS_UNAVAILABLE');
    expect(logError).toHaveBeenCalled();
  });

  it('passes the raw request body and signature to the Stripe webhook service', async () => {
    const handleWebhook = jest
      .fn<PaymentService['handleWebhook']>()
      .mockResolvedValue();
    const paymentService: PaymentService = {
      createCheckout: jest.fn<PaymentService['createCheckout']>(),
      handleWebhook,
      getCheckoutStatus: jest
        .fn<PaymentService['getCheckoutStatus']>()
        .mockResolvedValue(null),
    };
    const rawPayload = Buffer.from('{"type":"checkout.session.completed"}');

    const response = await request(
      createApp(undefined, undefined, paymentService),
    )
      .post('/api/payments/webhook')
      .set('stripe-signature', 'verified-by-mock')
      .set('Content-Type', 'application/json')
      .send(rawPayload.toString());

    expect(response.status).toBe(200);
    expect(handleWebhook).toHaveBeenCalledWith(
      expect.any(Buffer),
      'verified-by-mock',
    );
    expect(handleWebhook.mock.calls[0]?.[0].toString()).toBe(
      rawPayload.toString(),
    );
  });

  it('rejects an invalid Stripe webhook signature', async () => {
    const paymentService: PaymentService = {
      createCheckout: jest.fn<PaymentService['createCheckout']>(),
      handleWebhook: jest
        .fn<PaymentService['handleWebhook']>()
        .mockRejectedValue(new InvalidStripeWebhookError('Invalid signature')),
      getCheckoutStatus: jest
        .fn<PaymentService['getCheckoutStatus']>()
        .mockResolvedValue(null),
    };
    const logError = jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(
      createApp(undefined, undefined, paymentService),
    )
      .post('/api/payments/webhook')
      .set('stripe-signature', 'invalid')
      .set('Content-Type', 'application/json')
      .send(Buffer.from('{}'));

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_STRIPE_WEBHOOK');
    expect(logError).toHaveBeenCalled();
  });

  it('rejects a webhook without a signature and reports webhook service failures', async () => {
    const paymentService: PaymentService = {
      createCheckout: jest.fn<PaymentService['createCheckout']>(),
      handleWebhook: jest
        .fn<PaymentService['handleWebhook']>()
        .mockRejectedValue(new Error('Database unavailable')),
      getCheckoutStatus: jest
        .fn<PaymentService['getCheckoutStatus']>()
        .mockResolvedValue(null),
    };
    const logError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const app = createApp(undefined, undefined, paymentService);

    const missingSignature = await request(app)
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .send('{}');
    const failed = await request(app)
      .post('/api/payments/webhook')
      .set('stripe-signature', 'valid-shape')
      .set('Content-Type', 'application/json')
      .send('{}');

    expect(missingSignature.status).toBe(400);
    expect(missingSignature.body.error).toBe('INVALID_STRIPE_WEBHOOK');
    expect(failed.status).toBe(500);
    expect(failed.body.error).toBe('STRIPE_WEBHOOK_UNAVAILABLE');
    expect(logError).toHaveBeenCalled();
  });

  it('returns a service-unavailable response when webhook Stripe credentials are missing', async () => {
    const paymentService: PaymentService = {
      createCheckout: jest.fn<PaymentService['createCheckout']>(),
      handleWebhook: jest
        .fn<PaymentService['handleWebhook']>()
        .mockRejectedValue(
          new StripeConfigurationError('Webhook secret is missing.'),
        ),
      getCheckoutStatus: jest
        .fn<PaymentService['getCheckoutStatus']>()
        .mockResolvedValue(null),
    };
    const logError = jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(
      createApp(undefined, undefined, paymentService),
    )
      .post('/api/payments/webhook')
      .set('stripe-signature', 'present')
      .set('Content-Type', 'application/json')
      .send('{}');

    expect(response.status).toBe(503);
    expect(response.body.error).toBe('STRIPE_NOT_CONFIGURED');
    expect(logError).toHaveBeenCalled();
  });
});
