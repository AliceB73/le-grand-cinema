import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { BookingStatus, type Prisma } from '@prisma/client';
import { prisma } from '../data/prisma.js';
import { createTicketToken, hashTicketToken } from '../tickets/ticket-token.js';
import {
  createPaymentService,
  InvalidCheckoutError,
  prismaPaymentRepository,
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
    const service = createPaymentService(
      repository,
      gateway,
      undefined,
      'unit-test-ticket-token-secret-32chars',
    );

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
      hashTicketToken(
        createTicketToken('booking-1', 'unit-test-ticket-token-secret-32chars'),
      ),
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
    const service = createPaymentService(
      repository,
      gateway,
      undefined,
      'unit-test-ticket-token-secret-32chars',
    );

    await service.handleWebhook(Buffer.from('{}'), 'signature');

    expect(logError).toHaveBeenCalledWith(
      'A Stripe payment needs a refund because its seat holds have expired.',
    );
  });

  it('loads checkout details from Prisma and rounds prices to cents', async () => {
    const findUnique = jest
      .spyOn(prisma.showtime, 'findUnique')
      .mockResolvedValue({
        price: 9.505,
        movie: { title: 'Film' },
        seats: [],
      } as unknown as Awaited<ReturnType<typeof prisma.showtime.findUnique>>);

    await expect(
      prismaPaymentRepository.getCheckoutData('showtime-1', ['seat-1']),
    ).resolves.toEqual({
      priceCents: 951,
      movieTitle: 'Film',
      seats: [],
    });
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'showtime-1', status: 'SCHEDULED' },
      }),
    );

    findUnique.mockResolvedValue(null);
    await expect(
      prismaPaymentRepository.getCheckoutData('missing', ['seat-1']),
    ).resolves.toBeNull();
  });

  it('persists pending guest bookings and manages their Checkout session', async () => {
    const create = jest
      .spyOn(prisma.booking, 'create')
      .mockResolvedValue(
        {} as Awaited<ReturnType<typeof prisma.booking.create>>,
      );
    const update = jest
      .spyOn(prisma.booking, 'update')
      .mockResolvedValue(
        {} as Awaited<ReturnType<typeof prisma.booking.update>>,
      );
    const deleteMany = jest
      .spyOn(prisma.booking, 'deleteMany')
      .mockResolvedValue({ count: 1 });
    const booking = {
      id: 'booking-1',
      showtimeId: 'showtime-1',
      seatHoldTokenHash: sessionTokenHash,
      seatIds: ['seat-1'],
      totalAmountCents: 950,
    };

    await prismaPaymentRepository.createPendingBooking(booking);
    await prismaPaymentRepository.setCheckoutSession(
      'booking-1',
      'cs_test_checkout-1',
    );
    await prismaPaymentRepository.deletePendingBooking('booking-1');

    expect(create).toHaveBeenCalledWith({
      data: {
        ...booking,
        status: BookingStatus.PENDING,
      },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'booking-1', status: BookingStatus.PENDING },
      data: { stripeCheckoutSessionId: 'cs_test_checkout-1' },
    });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: 'booking-1', status: BookingStatus.PENDING },
    });
  });

  it('confirms the booking and assigns its held seats in a transaction', async () => {
    const booking = {
      id: 'booking-1',
      showtimeId: 'showtime-1',
      seatIds: ['seat-1'],
      seatHoldTokenHash: sessionTokenHash,
      stripeCheckoutSessionId: 'cs_test_checkout-1',
      status: BookingStatus.PENDING,
    };
    const findUnique = jest
      .fn<(args: object) => Promise<unknown>>()
      .mockResolvedValue(booking);
    const bookingUpdateMany = jest
      .fn<(args: object) => Promise<{ count: number }>>()
      .mockResolvedValue({ count: 1 });
    const seatUpdateMany = jest
      .fn<(args: object) => Promise<{ count: number }>>()
      .mockResolvedValue({ count: 1 });
    const transaction = {
      booking: { findUnique, updateMany: bookingUpdateMany },
      seat: { updateMany: seatUpdateMany },
      emailDelivery: {
        create: jest
          .fn<(args: object) => Promise<unknown>>()
          .mockResolvedValue({}),
      },
    } as unknown as Prisma.TransactionClient;
    jest
      .spyOn(prisma, '$transaction')
      .mockImplementation((callback) => callback(transaction));
    const now = new Date();

    await expect(
      prismaPaymentRepository.confirmPaidBooking(
        'booking-1',
        'cs_test_checkout-1',
        'spectateur@example.com',
        now,
        'ticket-token-hash',
      ),
    ).resolves.toBe('confirmed');

    expect(bookingUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'booking-1',
        stripeCheckoutSessionId: 'cs_test_checkout-1',
        status: BookingStatus.PENDING,
      },
      data: {
        status: BookingStatus.CONFIRMED,
        guestEmail: 'spectateur@example.com',
        ticketTokenHash: 'ticket-token-hash',
      },
    });
    expect(transaction.emailDelivery.create).toHaveBeenCalledWith({
      data: { bookingId: 'booking-1', status: 'PENDING', lastError: null },
    });
    expect(seatUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          showtimeId: 'showtime-1',
          id: { in: ['seat-1'] },
          hold: {
            is: {
              tokenHash: sessionTokenHash,
              expiresAt: { gt: now },
            },
          },
        }),
        data: { bookingId: 'booking-1', holdId: null },
      }),
    );
  });

  it('keeps a paid reservation confirmed but records delivery failure without an email', async () => {
    const transaction = {
      booking: {
        findUnique: jest
          .fn<(args: object) => Promise<unknown>>()
          .mockResolvedValue({
            id: 'booking-1',
            showtimeId: 'showtime-1',
            seatIds: ['seat-1'],
            seatHoldTokenHash: sessionTokenHash,
            stripeCheckoutSessionId: 'cs_test_checkout-1',
            status: BookingStatus.PENDING,
          }),
        updateMany: jest
          .fn<(args: object) => Promise<{ count: number }>>()
          .mockResolvedValue({ count: 1 }),
      },
      seat: {
        updateMany: jest
          .fn<(args: object) => Promise<{ count: number }>>()
          .mockResolvedValue({ count: 1 }),
      },
      emailDelivery: {
        create: jest
          .fn<(args: object) => Promise<unknown>>()
          .mockResolvedValue({}),
      },
    } as unknown as Prisma.TransactionClient;
    jest
      .spyOn(prisma, '$transaction')
      .mockImplementation((callback) => callback(transaction));

    await expect(
      prismaPaymentRepository.confirmPaidBooking(
        'booking-1',
        'cs_test_checkout-1',
        null,
        new Date(),
        'ticket-token-hash',
      ),
    ).resolves.toBe('confirmed_email_missing');
    expect(transaction.emailDelivery.create).toHaveBeenCalledWith({
      data: {
        bookingId: 'booking-1',
        status: 'FAILED',
        lastError: 'MISSING_RECIPIENT_EMAIL',
      },
    });
  });

  it('requires a refund and releases any partially assigned seats when a hold expires', async () => {
    const findUnique = jest
      .fn<(args: object) => Promise<unknown>>()
      .mockResolvedValue({
        id: 'booking-1',
        showtimeId: 'showtime-1',
        seatIds: ['seat-1', 'seat-2'],
        seatHoldTokenHash: sessionTokenHash,
        stripeCheckoutSessionId: 'cs_test_checkout-1',
        status: BookingStatus.PENDING,
      });
    const bookingUpdate = jest
      .fn<(args: object) => Promise<unknown>>()
      .mockResolvedValue({});
    const seatUpdateMany = jest
      .fn<(args: object) => Promise<{ count: number }>>()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const transaction = {
      booking: {
        findUnique,
        updateMany: jest
          .fn<(args: object) => Promise<{ count: number }>>()
          .mockResolvedValue({ count: 1 }),
        update: bookingUpdate,
      },
      seat: { updateMany: seatUpdateMany },
    } as unknown as Prisma.TransactionClient;
    jest
      .spyOn(prisma, '$transaction')
      .mockImplementation((callback) => callback(transaction));

    await expect(
      prismaPaymentRepository.confirmPaidBooking(
        'booking-1',
        'cs_test_checkout-1',
        'spectateur@example.com',
        new Date(),
        'ticket-token-hash',
      ),
    ).resolves.toBe('refund_required');
    expect(seatUpdateMany).toHaveBeenLastCalledWith({
      where: {
        showtimeId: 'showtime-1',
        id: { in: ['seat-1', 'seat-2'] },
        bookingId: 'booking-1',
      },
      data: { bookingId: null },
    });
    expect(bookingUpdate).toHaveBeenCalledWith({
      where: { id: 'booking-1' },
      data: { status: BookingStatus.REFUND_REQUIRED },
    });
  });

  it('makes webhook handling idempotent for confirmed bookings and ignores mismatches', async () => {
    const findUnique = jest
      .fn<(args: object) => Promise<unknown>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'booking-1',
        showtimeId: 'showtime-1',
        seatIds: ['seat-1'],
        seatHoldTokenHash: sessionTokenHash,
        stripeCheckoutSessionId: 'cs_test_checkout-1',
        status: BookingStatus.CONFIRMED,
      })
      .mockResolvedValueOnce({
        id: 'booking-1',
        showtimeId: 'showtime-1',
        seatIds: ['seat-1'],
        seatHoldTokenHash: sessionTokenHash,
        stripeCheckoutSessionId: 'cs_test_checkout-1',
        status: BookingStatus.REFUND_REQUIRED,
      })
      .mockResolvedValueOnce({
        id: 'booking-1',
        showtimeId: 'showtime-1',
        seatIds: ['seat-1'],
        seatHoldTokenHash: null,
        stripeCheckoutSessionId: 'cs_test_checkout-1',
        status: BookingStatus.PENDING,
      });
    const transaction = {
      booking: {
        findUnique,
        updateMany: jest.fn<(args: object) => Promise<{ count: number }>>(),
      },
      seat: {
        updateMany: jest.fn<(args: object) => Promise<{ count: number }>>(),
      },
    } as unknown as Prisma.TransactionClient;
    jest
      .spyOn(prisma, '$transaction')
      .mockImplementation((callback) => callback(transaction));

    await expect(
      prismaPaymentRepository.confirmPaidBooking(
        'booking-1',
        'wrong-session',
        null,
        new Date(),
        'ticket-token-hash',
      ),
    ).resolves.toBe('ignored');
    await expect(
      prismaPaymentRepository.confirmPaidBooking(
        'booking-1',
        'cs_test_checkout-1',
        null,
        new Date(),
        'ticket-token-hash',
      ),
    ).resolves.toBe('confirmed');
    await expect(
      prismaPaymentRepository.confirmPaidBooking(
        'booking-1',
        'cs_test_checkout-1',
        null,
        new Date(),
        'ticket-token-hash',
      ),
    ).resolves.toBe('refund_required');
    await expect(
      prismaPaymentRepository.confirmPaidBooking(
        'booking-1',
        'cs_test_checkout-1',
        null,
        new Date(),
        'ticket-token-hash',
      ),
    ).resolves.toBe('ignored');
  });

  it('handles lost webhook claims based on the persisted booking state', async () => {
    const firstBooking = {
      id: 'booking-1',
      showtimeId: 'showtime-1',
      seatIds: ['seat-1'],
      seatHoldTokenHash: sessionTokenHash,
      stripeCheckoutSessionId: 'cs_test_checkout-1',
      status: BookingStatus.PENDING,
    };
    const findUnique = jest
      .fn<(args: object) => Promise<unknown>>()
      .mockResolvedValueOnce(firstBooking)
      .mockResolvedValueOnce({ status: BookingStatus.CONFIRMED })
      .mockResolvedValueOnce(firstBooking)
      .mockResolvedValueOnce({ status: BookingStatus.REFUND_REQUIRED })
      .mockResolvedValueOnce(firstBooking)
      .mockResolvedValueOnce({ status: BookingStatus.CANCELLED });
    const transaction = {
      booking: {
        findUnique,
        updateMany: jest
          .fn<(args: object) => Promise<{ count: number }>>()
          .mockResolvedValue({ count: 0 }),
      },
      seat: {
        updateMany: jest.fn<(args: object) => Promise<{ count: number }>>(),
      },
    } as unknown as Prisma.TransactionClient;
    jest
      .spyOn(prisma, '$transaction')
      .mockImplementation((callback) => callback(transaction));

    const confirm = () =>
      prismaPaymentRepository.confirmPaidBooking(
        'booking-1',
        'cs_test_checkout-1',
        null,
        new Date(),
        'ticket-token-hash',
      );
    await expect(confirm()).resolves.toBe('confirmed');
    await expect(confirm()).resolves.toBe('refund_required');
    await expect(confirm()).resolves.toBe('ignored');
  });

  it('cancels only pending matching Checkout bookings and looks up session status', async () => {
    const updateMany = jest
      .spyOn(prisma.booking, 'updateMany')
      .mockResolvedValue({ count: 1 });
    const findUnique = jest
      .spyOn(prisma.booking, 'findUnique')
      .mockResolvedValue({ status: BookingStatus.CANCELLED } as never);

    await prismaPaymentRepository.cancelPendingBooking(
      'booking-1',
      'cs_test_checkout-1',
    );
    await expect(
      prismaPaymentRepository.getBookingStatus('cs_test_checkout-1'),
    ).resolves.toBe(BookingStatus.CANCELLED);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'booking-1',
        stripeCheckoutSessionId: 'cs_test_checkout-1',
        status: BookingStatus.PENDING,
      },
      data: { status: BookingStatus.CANCELLED },
    });
    findUnique.mockResolvedValue(null);
    await expect(
      prismaPaymentRepository.getBookingStatus('missing'),
    ).resolves.toBeNull();
  });
});
