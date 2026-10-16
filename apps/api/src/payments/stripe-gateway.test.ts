import { afterEach, describe, expect, it } from '@jest/globals';
import Stripe from 'stripe';
import {
  InvalidStripeWebhookError,
  StripeConfigurationError,
  stripeGateway,
} from './stripe-gateway.js';

const secretKey = 'sk_test_example';
const webhookSecret = 'whsec_example';

const previousSecretKey = process.env.STRIPE_SECRET_KEY;
const previousWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

afterEach(() => {
  if (previousSecretKey === undefined) {
    delete process.env.STRIPE_SECRET_KEY;
  } else {
    process.env.STRIPE_SECRET_KEY = previousSecretKey;
  }
  if (previousWebhookSecret === undefined) {
    delete process.env.STRIPE_WEBHOOK_SECRET;
  } else {
    process.env.STRIPE_WEBHOOK_SECRET = previousWebhookSecret;
  }
});

function makeSignature(payload: string, secret: string) {
  return new Stripe(secretKey).webhooks.generateTestHeaderString({
    payload,
    secret,
  });
}

describe('Stripe gateway', () => {
  it('accepts only a correctly signed successful Checkout notification', () => {
    process.env.STRIPE_SECRET_KEY = secretKey;
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    const payload = JSON.stringify({
      id: 'evt_test',
      object: 'event',
      api_version: '2025-09-30.clover',
      created: 1_791_715_200,
      data: {
        object: {
          id: 'cs_test_checkout-1',
          object: 'checkout.session',
          metadata: { bookingId: 'booking-1' },
          customer_details: { email: 'spectateur@example.com' },
          payment_status: 'paid',
        },
      },
      livemode: false,
      pending_webhooks: 1,
      request: { id: null, idempotency_key: null },
      type: 'checkout.session.completed',
    });
    const signature = makeSignature(payload, webhookSecret);

    expect(
      stripeGateway.constructWebhookEvent(Buffer.from(payload), signature),
    ).toEqual({
      type: 'checkout.session.completed',
      bookingId: 'booking-1',
      sessionId: 'cs_test_checkout-1',
      email: 'spectateur@example.com',
      paymentStatus: 'paid',
    });
  });

  it('rejects an invalid webhook signature', () => {
    process.env.STRIPE_SECRET_KEY = secretKey;
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;

    expect(() =>
      stripeGateway.constructWebhookEvent(Buffer.from('{}'), 'invalid'),
    ).toThrow(InvalidStripeWebhookError);
  });

  it('reports when Stripe test credentials are not configured', async () => {
    delete process.env.STRIPE_SECRET_KEY;

    await expect(
      stripeGateway.createCheckoutSession({
        bookingId: 'booking-1',
        showtimeId: 'showtime-1',
        movieTitle: 'Film',
        tickets: [{ fare: 'full', amountCents: 950 }],
        successUrl: 'http://localhost:5173/?payment=success',
        cancelUrl: 'http://localhost:5173/?payment=cancelled',
        expiresAt: Math.floor(Date.now() / 1000) + 31 * 60,
      }),
    ).rejects.toThrow(StripeConfigurationError);
  });
});
