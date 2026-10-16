import { createHash, randomUUID } from 'node:crypto';
import { BookingStatus } from '@prisma/client';
import { prisma } from '../data/prisma.js';
import { hashTicketToken, createTicketToken } from '../tickets/ticket-token.js';
import { stripeGateway, type StripeGateway } from './stripe-gateway.js';

export type TicketFare = 'full' | 'reduced';

export interface CheckoutTicket {
  seatId: string;
  fare: TicketFare;
}

export interface CheckoutRequest {
  showtimeId: string;
  sessionToken: string;
  tickets: CheckoutTicket[];
}

interface CheckoutSeat {
  id: string;
  rowNumber: string;
  seatNumber: number;
  bookingId: string | null;
  hold: { tokenHash: string; expiresAt: Date } | null;
}

interface CheckoutData {
  priceCents: number;
  movieTitle: string;
  seats: CheckoutSeat[];
}

export interface PaymentRepository {
  getCheckoutData(
    showtimeId: string,
    seatIds: string[],
  ): Promise<CheckoutData | null>;
  createPendingBooking(input: {
    id: string;
    showtimeId: string;
    seatHoldTokenHash: string;
    seatIds: string[];
    totalAmountCents: number;
  }): Promise<void>;
  setCheckoutSession(bookingId: string, sessionId: string): Promise<void>;
  deletePendingBooking(bookingId: string): Promise<void>;
  confirmPaidBooking(
    bookingId: string,
    sessionId: string,
    email: string | null,
    now: Date,
    ticketTokenHash: string,
  ): Promise<
    'confirmed' | 'confirmed_email_missing' | 'refund_required' | 'ignored'
  >;
  cancelPendingBooking(bookingId: string, sessionId: string): Promise<void>;
  getBookingStatus(sessionId: string): Promise<BookingStatus | null>;
}

export interface PaymentGateway {
  createCheckoutSession(input: {
    bookingId: string;
    showtimeId: string;
    movieTitle: string;
    tickets: Array<{
      fare: TicketFare;
      amountCents: number;
    }>;
    successUrl: string;
    cancelUrl: string;
    expiresAt: number;
  }): Promise<{ id: string; url: string }>;
  constructWebhookEvent(
    payload: Buffer,
    signature: string,
  ): ReturnType<StripeGateway['constructWebhookEvent']>;
}

export const prismaPaymentRepository: PaymentRepository = {
  getCheckoutData: async (showtimeId, seatIds) => {
    const showtime = await prisma.showtime.findUnique({
      where: { id: showtimeId },
      select: {
        price: true,
        movie: { select: { title: true } },
        seats: {
          where: { id: { in: seatIds } },
          select: {
            id: true,
            rowNumber: true,
            seatNumber: true,
            bookingId: true,
            hold: { select: { tokenHash: true, expiresAt: true } },
          },
        },
      },
    });

    if (!showtime) {
      return null;
    }

    return {
      priceCents: Math.round((showtime.price + Number.EPSILON) * 100),
      movieTitle: showtime.movie.title,
      seats: showtime.seats,
    };
  },
  createPendingBooking: async (input) => {
    await prisma.booking.create({
      data: {
        id: input.id,
        showtimeId: input.showtimeId,
        status: BookingStatus.PENDING,
        seatHoldTokenHash: input.seatHoldTokenHash,
        seatIds: input.seatIds,
        totalAmountCents: input.totalAmountCents,
      },
    });
  },
  setCheckoutSession: async (bookingId, sessionId) => {
    await prisma.booking.update({
      where: { id: bookingId, status: BookingStatus.PENDING },
      data: { stripeCheckoutSessionId: sessionId },
    });
  },
  deletePendingBooking: async (bookingId) => {
    await prisma.booking.deleteMany({
      where: { id: bookingId, status: BookingStatus.PENDING },
    });
  },
  confirmPaidBooking: async (
    bookingId,
    sessionId,
    email,
    now,
    ticketTokenHash,
  ) =>
    prisma.$transaction(async (transaction) => {
      const booking = await transaction.booking.findUnique({
        where: { id: bookingId },
        select: {
          id: true,
          showtimeId: true,
          seatIds: true,
          seatHoldTokenHash: true,
          stripeCheckoutSessionId: true,
          status: true,
        },
      });

      if (!booking || booking.stripeCheckoutSessionId !== sessionId) {
        return 'ignored';
      }
      if (booking.status === BookingStatus.CONFIRMED) {
        return 'confirmed';
      }
      if (booking.status === BookingStatus.REFUND_REQUIRED) {
        return 'refund_required';
      }
      if (
        booking.status !== BookingStatus.PENDING ||
        !booking.seatHoldTokenHash
      ) {
        return 'ignored';
      }

      const claimedBooking = await transaction.booking.updateMany({
        where: {
          id: booking.id,
          stripeCheckoutSessionId: sessionId,
          status: BookingStatus.PENDING,
        },
        data: {
          status: BookingStatus.CONFIRMED,
          guestEmail: email,
          ticketTokenHash,
        },
      });
      if (claimedBooking.count !== 1) {
        const latestBooking = await transaction.booking.findUnique({
          where: { id: booking.id },
          select: { status: true },
        });
        if (latestBooking?.status === BookingStatus.CONFIRMED) {
          return 'confirmed';
        }
        if (latestBooking?.status === BookingStatus.REFUND_REQUIRED) {
          return 'refund_required';
        }
        return 'ignored';
      }

      const updatedSeats = await transaction.seat.updateMany({
        where: {
          showtimeId: booking.showtimeId,
          id: { in: booking.seatIds },
          bookingId: null,
          hold: {
            is: {
              tokenHash: booking.seatHoldTokenHash,
              expiresAt: { gt: now },
            },
          },
        },
        data: { bookingId: booking.id, holdId: null },
      });

      if (updatedSeats.count !== booking.seatIds.length) {
        await transaction.seat.updateMany({
          where: {
            showtimeId: booking.showtimeId,
            id: { in: booking.seatIds },
            bookingId: booking.id,
          },
          data: { bookingId: null },
        });
        await transaction.booking.update({
          where: { id: booking.id },
          data: { status: BookingStatus.REFUND_REQUIRED },
        });
        return 'refund_required';
      }

      await transaction.emailDelivery.create({
        data: {
          bookingId: booking.id,
          status: email ? 'PENDING' : 'FAILED',
          lastError: email ? null : 'MISSING_RECIPIENT_EMAIL',
        },
      });

      return email ? 'confirmed' : 'confirmed_email_missing';
    }),
  cancelPendingBooking: async (bookingId, sessionId) => {
    await prisma.booking.updateMany({
      where: {
        id: bookingId,
        stripeCheckoutSessionId: sessionId,
        status: BookingStatus.PENDING,
      },
      data: { status: BookingStatus.CANCELLED },
    });
  },
  getBookingStatus: async (sessionId) => {
    const booking = await prisma.booking.findUnique({
      where: { stripeCheckoutSessionId: sessionId },
      select: { status: true },
    });
    return booking?.status ?? null;
  },
};

function hashSessionToken(sessionToken: string) {
  return createHash('sha256').update(sessionToken).digest('hex');
}

export class InvalidCheckoutError extends Error {
  constructor(readonly reason: 'showtime' | 'seats') {
    super('The screening or selected seats are no longer available.');
    this.name = 'InvalidCheckoutError';
  }
}

export class TicketTokenConfigurationError extends Error {
  constructor() {
    super('Configure TICKET_TOKEN_SECRET with at least 32 characters.');
    this.name = 'TicketTokenConfigurationError';
  }
}

export function createPaymentService(
  repository: PaymentRepository = prismaPaymentRepository,
  gateway: PaymentGateway = stripeGateway,
  webBaseUrl = process.env.WEB_BASE_URL ?? 'http://localhost:5173',
  ticketTokenSecret = process.env.TICKET_TOKEN_SECRET,
) {
  return {
    async createCheckout(input: CheckoutRequest) {
      const seatIds = input.tickets.map(({ seatId }) => seatId);
      if (new Set(seatIds).size !== seatIds.length) {
        throw new InvalidCheckoutError('seats');
      }

      const checkoutData = await repository.getCheckoutData(
        input.showtimeId,
        seatIds,
      );
      if (!checkoutData) {
        throw new InvalidCheckoutError('showtime');
      }

      const now = new Date();
      const tokenHash = hashSessionToken(input.sessionToken);
      const seatsById = new Map(
        checkoutData.seats.map((seat) => [seat.id, seat]),
      );
      const tickets = input.tickets.map((ticket) => {
        const seat = seatsById.get(ticket.seatId);
        if (
          !seat ||
          seat.bookingId !== null ||
          !seat.hold ||
          seat.hold.tokenHash !== tokenHash ||
          seat.hold.expiresAt <= now
        ) {
          throw new InvalidCheckoutError('seats');
        }

        return {
          fare: ticket.fare,
          amountCents:
            ticket.fare === 'reduced'
              ? Math.round(checkoutData.priceCents / 2)
              : checkoutData.priceCents,
        };
      });
      const totalAmountCents = tickets.reduce(
        (total, ticket) => total + ticket.amountCents,
        0,
      );
      const bookingId = randomUUID();

      await repository.createPendingBooking({
        id: bookingId,
        showtimeId: input.showtimeId,
        seatHoldTokenHash: tokenHash,
        seatIds,
        totalAmountCents,
      });

      try {
        const checkout = await gateway.createCheckoutSession({
          bookingId,
          showtimeId: input.showtimeId,
          movieTitle: checkoutData.movieTitle,
          tickets,
          successUrl: `${webBaseUrl}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${webBaseUrl}/?payment=cancelled`,
          expiresAt: Math.floor(now.getTime() / 1000) + 31 * 60,
        });
        await repository.setCheckoutSession(bookingId, checkout.id);
        return checkout;
      } catch (error) {
        try {
          await repository.deletePendingBooking(bookingId);
        } catch (cleanupError) {
          console.error(
            'Failed to remove a pending checkout booking.',
            cleanupError,
          );
        }
        throw error;
      }
    },
    async handleWebhook(payload: Buffer, signature: string) {
      const event = gateway.constructWebhookEvent(payload, signature);
      if (event.type === 'checkout.session.completed') {
        if (event.paymentStatus !== 'paid') {
          return;
        }
        if (!ticketTokenSecret || ticketTokenSecret.length < 32) {
          throw new TicketTokenConfigurationError();
        }
        const ticketToken = createTicketToken(
          event.bookingId,
          ticketTokenSecret,
        );
        const result = await repository.confirmPaidBooking(
          event.bookingId,
          event.sessionId,
          event.email,
          new Date(),
          hashTicketToken(ticketToken),
        );
        if (result === 'refund_required') {
          console.error(
            'A Stripe payment needs a refund because its seat holds have expired.',
          );
        } else if (result === 'confirmed_email_missing') {
          console.error(
            'Stripe confirmed payment without a recipient email; the ticket email cannot be delivered.',
          );
        }
        return;
      }

      if (event.type === 'checkout.session.expired') {
        await repository.cancelPendingBooking(event.bookingId, event.sessionId);
      }
    },
    async getCheckoutStatus(sessionId: string) {
      return repository.getBookingStatus(sessionId);
    },
  };
}

export type PaymentService = ReturnType<typeof createPaymentService>;
