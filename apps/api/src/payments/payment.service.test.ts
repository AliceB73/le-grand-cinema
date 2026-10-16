import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  createPaymentService,
  InvalidCheckoutError,
  type PaymentGateway,
  type PaymentRepository,
} from './payment.service.js';

const sessionToken = '7e4cbf13-f749-4b7d-8fa6-28e9fa88f38b';
const sessionTokenHash =
  'c0620acca9d2a3ed0a2383694af18c9d057faa89191268bf9082ca15b98ba421';

function createRepository(
  overrides: Partial<jest.Mocked<PaymentRepository>> = {},
) {
  const repository: jest.Mocked<PaymentRepository> = {
    getCheckoutData: jest.fn<PaymentRepository['getCheckoutData']>(),
    createPendingBooking: jest
      .fn<PaymentRepository['createPendingBooking']>()
      .mockResolvedValue(),
    setCheckoutSession: jest
      .fn<PaymentRepository['setCheckoutSession']>()
      .mockResolvedValue(),
    deletePendingBooking: jest
      .fn<PaymentRepository['deletePendingBooking']>()
      .mockResolvedValue(),
    confirmPaidBooking: jest
      .fn<PaymentRepository['confirmPaidBooking']>()
      .mockResolvedValue('confirmed'),
    cancelPendingBooking: jest
      .fn<PaymentRepository['cancelPendingBooking']>()
      .mockResolvedValue(),
    getBookingStatus: jest
      .fn<PaymentRepository['getBookingStatus']>()
      .mockResolvedValue(null),
  };
  return Object.assign(repository, overrides);
}

function createGateway(overrides: Partial<jest.Mocked<PaymentGateway>> = {}) {
  const gateway: jest.Mocked<PaymentGateway> = {
    createCheckoutSession: jest
      .fn<PaymentGateway['createCheckoutSession']>()
      .mockResolvedValue({
        id: 'cs_test_checkout-1',
        url: 'https://checkout.stripe.com/test',
      }),
    constructWebhookEvent: jest
      .fn<PaymentGateway['constructWebhookEvent']>()
      .mockReturnValue({ type: 'ignored' }),
  };
  return Object.assign(gateway, overrides);
}

describe('payment service', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('calculates the total from owned seat holds and creates guest Checkout', async () => {
    const now = new Date(Date.now() + 60_000);
    const repository = createRepository({
      getCheckoutData: jest
        .fn<PaymentRepository['getCheckoutData']>()
        .mockResolvedValue({
          priceCents: 950,
          movieTitle: 'Les Veilleurs du Phare',
          seats: [
            {
              id: 'seat-1',
              rowNumber: 'A',
              seatNumber: 1,
              bookingId: null,
              hold: { tokenHash: sessionTokenHash, expiresAt: now },
            },
            {
              id: 'seat-2',
              rowNumber: 'A',
              seatNumber: 2,
              bookingId: null,
              hold: { tokenHash: sessionTokenHash, expiresAt: now },
            },
          ],
        }),
    });
    const gateway = createGateway();
    const service = createPaymentService(
      repository,
      gateway,
      'http://localhost:5173',
    );

    const result = await service.createCheckout({
      showtimeId: 'showtime-1',
      sessionToken,
      tickets: [
        { seatId: 'seat-1', fare: 'full' },
        { seatId: 'seat-2', fare: 'reduced' },
      ],
    });

    expect(result).toEqual({
      id: 'cs_test_checkout-1',
      url: 'https://checkout.stripe.com/test',
    });
    expect(repository.createPendingBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        showtimeId: 'showtime-1',
        seatHoldTokenHash: sessionTokenHash,
        seatIds: ['seat-1', 'seat-2'],
        totalAmountCents: 1425,
      }),
    );
    expect(gateway.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        movieTitle: 'Les Veilleurs du Phare',
        tickets: [
          { fare: 'full', amountCents: 950 },
          { fare: 'reduced', amountCents: 475 },
        ],
        successUrl:
          'http://localhost:5173/?payment=success&session_id={CHECKOUT_SESSION_ID}',
        cancelUrl: 'http://localhost:5173/?payment=cancelled',
        expiresAt: expect.any(Number),
      }),
    );
    expect(repository.setCheckoutSession).toHaveBeenCalledWith(
      expect.any(String),
      'cs_test_checkout-1',
    );
  });

  it('does not create a Checkout session if the hold expired or belongs to another session', async () => {
    const repository = createRepository({
      getCheckoutData: jest
        .fn<PaymentRepository['getCheckoutData']>()
        .mockResolvedValue({
          priceCents: 950,
          movieTitle: 'Film',
          seats: [
            {
              id: 'seat-1',
              rowNumber: 'A',
              seatNumber: 1,
              bookingId: null,
              hold: {
                tokenHash: 'another-session',
                expiresAt: new Date(Date.now() + 60_000),
              },
            },
          ],
        }),
    });
    const gateway = createGateway();
    const service = createPaymentService(repository, gateway);

    await expect(
      service.createCheckout({
        showtimeId: 'showtime-1',
        sessionToken,
        tickets: [{ seatId: 'seat-1', fare: 'full' }],
      }),
    ).rejects.toEqual(new InvalidCheckoutError('seats'));
    expect(repository.createPendingBooking).not.toHaveBeenCalled();
    expect(gateway.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('rejects a seat hold after its expiration time', async () => {
    const repository = createRepository({
      getCheckoutData: jest
        .fn<PaymentRepository['getCheckoutData']>()
        .mockResolvedValue({
          priceCents: 950,
          movieTitle: 'Film',
          seats: [
            {
              id: 'seat-1',
              rowNumber: 'A',
              seatNumber: 1,
              bookingId: null,
              hold: {
                tokenHash: sessionTokenHash,
                expiresAt: new Date(Date.now() - 1),
              },
            },
          ],
        }),
    });
    const gateway = createGateway();
    const service = createPaymentService(repository, gateway);

    await expect(
      service.createCheckout({
        showtimeId: 'showtime-1',
        sessionToken,
        tickets: [{ seatId: 'seat-1', fare: 'full' }],
      }),
    ).rejects.toEqual(new InvalidCheckoutError('seats'));
    expect(repository.createPendingBooking).not.toHaveBeenCalled();
    expect(gateway.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('removes the pending booking when Stripe session creation fails', async () => {
    const repository = createRepository({
      getCheckoutData: jest
        .fn<PaymentRepository['getCheckoutData']>()
        .mockResolvedValue({
          priceCents: 950,
          movieTitle: 'Film',
          seats: [
            {
              id: 'seat-1',
              rowNumber: 'A',
              seatNumber: 1,
              bookingId: null,
              hold: {
                tokenHash: sessionTokenHash,
                expiresAt: new Date(Date.now() + 60_000),
              },
            },
          ],
        }),
    });
    const gateway = createGateway({
      createCheckoutSession: jest
        .fn<PaymentGateway['createCheckoutSession']>()
        .mockRejectedValue(new Error('Stripe unavailable')),
    });
    const service = createPaymentService(repository, gateway);

    await expect(
      service.createCheckout({
        showtimeId: 'showtime-1',
        sessionToken,
        tickets: [{ seatId: 'seat-1', fare: 'full' }],
      }),
    ).rejects.toThrow('Stripe unavailable');
    expect(repository.deletePendingBooking).toHaveBeenCalledWith(
      expect.any(String),
    );
  });

  it('delegates paid and expired webhook events and exposes checkout status', async () => {
    const repository = createRepository({
      getBookingStatus: jest
        .fn<PaymentRepository['getBookingStatus']>()
        .mockResolvedValue('CONFIRMED'),
    });
    const gateway = createGateway({
      constructWebhookEvent: jest
        .fn<PaymentGateway['constructWebhookEvent']>()
        .mockReturnValueOnce({
          type: 'checkout.session.completed',
          bookingId: 'booking-1',
          sessionId: 'cs_test_checkout-1',
          email: 'spectateur@example.com',
          paymentStatus: 'paid',
        })
        .mockReturnValueOnce({
          type: 'checkout.session.expired',
          bookingId: 'booking-2',
          sessionId: 'cs_test_checkout-2',
        }),
    });
    const service = createPaymentService(repository, gateway);

    await service.handleWebhook(Buffer.from('{}'), 'signature');
    await service.handleWebhook(Buffer.from('{}'), 'signature');
    await expect(service.getCheckoutStatus('cs_test_checkout-1')).resolves.toBe(
      'CONFIRMED',
    );

    expect(repository.confirmPaidBooking).toHaveBeenCalledWith(
      'booking-1',
      'cs_test_checkout-1',
      'spectateur@example.com',
      expect.any(Date),
    );
    expect(repository.cancelPendingBooking).toHaveBeenCalledWith(
      'booking-2',
      'cs_test_checkout-2',
    );
  });

  it('logs and preserves a paid checkout that requires a refund', async () => {
    const repository = createRepository({
      confirmPaidBooking: jest
        .fn<PaymentRepository['confirmPaidBooking']>()
        .mockResolvedValue('refund_required'),
    });
    const gateway = createGateway({
      constructWebhookEvent: jest
        .fn<PaymentGateway['constructWebhookEvent']>()
        .mockReturnValue({
          type: 'checkout.session.completed',
          bookingId: 'booking-1',
          sessionId: 'cs_test_checkout-1',
          email: 'spectateur@example.com',
          paymentStatus: 'paid',
        }),
    });
    const logError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const service = createPaymentService(repository, gateway);

    await service.handleWebhook(Buffer.from('{}'), 'signature');

    expect(logError).toHaveBeenCalledWith(
      'A Stripe payment needs a refund because its seat holds have expired.',
    );
  });
});
