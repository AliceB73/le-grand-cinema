import Stripe from 'stripe';
import type { PaymentGateway } from './payment.service.js';

export interface StripeGateway extends PaymentGateway {
  constructWebhookEvent(
    payload: Buffer,
    signature: string,
  ):
    | {
        type: 'checkout.session.completed';
        bookingId: string;
        sessionId: string;
        email: string | null;
        paymentStatus: string;
      }
    | {
        type: 'checkout.session.expired';
        bookingId: string;
        sessionId: string;
      }
    | { type: 'ignored' };
}

export class InvalidStripeWebhookError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'InvalidStripeWebhookError';
  }
}

export class StripeConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeConfigurationError';
  }
}

function getStripeClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey?.startsWith('sk_test_')) {
    throw new StripeConfigurationError(
      'Configure STRIPE_SECRET_KEY with a Stripe test key (sk_test_...) to enable card payments.',
    );
  }

  return new Stripe(secretKey);
}

export function createStripeGateway(
  getClient: () => Stripe = getStripeClient,
): StripeGateway {
  return {
    async createCheckoutSession(input) {
      const session = await getClient().checkout.sessions.create(
        {
          mode: 'payment',
          allowed_payment_method_types: ['card'],
          line_items: Array.from(
            input.tickets.reduce((grouped, ticket) => {
              const existing = grouped.get(ticket.fare);
              grouped.set(ticket.fare, {
                quantity: (existing?.quantity ?? 0) + 1,
                amountCents: ticket.amountCents,
              });
              return grouped;
            }, new Map<'full' | 'reduced', { quantity: number; amountCents: number }>()),
            ([fare, item]) => ({
              quantity: item.quantity,
              price_data: {
                currency: 'eur',
                unit_amount: item.amountCents,
                product_data: {
                  name: `${fare === 'reduced' ? 'Tarif réduit' : 'Plein tarif'} — ${input.movieTitle}`,
                },
              },
            }),
          ),
          metadata: {
            bookingId: input.bookingId,
            showtimeId: input.showtimeId,
          },
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          expires_at: input.expiresAt,
        },
        { idempotencyKey: input.bookingId },
      );

      if (!session.url) {
        throw new Error('Stripe did not return a Checkout URL.');
      }

      return { id: session.id, url: session.url };
    },
    constructWebhookEvent(payload, signature) {
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!webhookSecret?.startsWith('whsec_')) {
        throw new StripeConfigurationError(
          'Configure STRIPE_WEBHOOK_SECRET with the signing secret provided by Stripe CLI.',
        );
      }

      let event: Stripe.Event;
      try {
        event = getClient().webhooks.constructEvent(
          payload,
          signature,
          webhookSecret,
        );
      } catch (error) {
        throw new InvalidStripeWebhookError(
          'Stripe webhook signature verification failed.',
          { cause: error },
        );
      }
      if (
        event.type === 'checkout.session.completed' ||
        event.type === 'checkout.session.async_payment_succeeded'
      ) {
        const session = event.data.object;
        const bookingId = session.metadata?.bookingId;
        if (!bookingId) {
          throw new InvalidStripeWebhookError(
            'Stripe Checkout session is missing booking metadata.',
          );
        }
        return {
          type: 'checkout.session.completed',
          bookingId,
          sessionId: session.id,
          email: session.customer_details?.email ?? null,
          paymentStatus: session.payment_status,
        };
      }
      if (event.type === 'checkout.session.expired') {
        const session = event.data.object;
        const bookingId = session.metadata?.bookingId;
        if (!bookingId) {
          throw new InvalidStripeWebhookError(
            'Expired Stripe Checkout session is missing booking metadata.',
          );
        }
        return {
          type: 'checkout.session.expired',
          bookingId,
          sessionId: session.id,
        };
      }

      return { type: 'ignored' };
    },
  };
}

export const stripeGateway = createStripeGateway();
