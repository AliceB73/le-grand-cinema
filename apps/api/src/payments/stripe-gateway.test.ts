import { afterEach, describe, expect, it, jest } from '@jest/globals';
import Stripe from 'stripe';
import {
  createStripeGateway,
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

function signedEvent(type: string, session: Record<string, unknown>) {
  const payload = JSON.stringify({
    id: 'evt_test',
    object: 'event',
    api_version: '2025-09-30.clover',
    created: 1_791_715_200,
    data: { object: session },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
  });
  return {
    payload: Buffer.from(payload),
    signature: makeSignature(payload, webhookSecret),
  };
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

  it('creates a hosted card checkout and groups tickets by fare', async () => {
    const create = jest
      .fn<Stripe['checkout']['sessions']['create']>()
      .mockResolvedValue({
        id: 'cs_test_checkout-1',
        url: 'https://checkout.stripe.com/test',
      } as Stripe.Response<Stripe.Checkout.Session>);
    const client = {
      checkout: { sessions: { create } },
    } as unknown as Stripe;
    const gateway = createStripeGateway(() => client);

    await expect(
      gateway.createCheckoutSession({
        bookingId: 'booking-1',
        showtimeId: 'showtime-1',
        movieTitle: 'Film',
        tickets: [
          { fare: 'full', amountCents: 950 },
          { fare: 'full', amountCents: 950 },
          { fare: 'reduced', amountCents: 475 },
        ],
        successUrl: 'http://localhost:5173/?payment=success',
        cancelUrl: 'http://localhost:5173/?payment=cancelled',
        expiresAt: 1_800_000_000,
      }),
    ).resolves.toEqual({
      id: 'cs_test_checkout-1',
      url: 'https://checkout.stripe.com/test',
    });

    const params = create.mock.calls[0]?.[0];
    expect(params).toMatchObject({
      mode: 'payment',
      allowed_payment_method_types: ['card'],
      metadata: { bookingId: 'booking-1', showtimeId: 'showtime-1' },
      success_url: 'http://localhost:5173/?payment=success',
      cancel_url: 'http://localhost:5173/?payment=cancelled',
      expires_at: 1_800_000_000,
      line_items: [
        {
          quantity: 2,
          price_data: {
            currency: 'eur',
            unit_amount: 950,
            product_data: { name: 'Plein tarif — Film' },
          },
        },
        {
          quantity: 1,
          price_data: {
            currency: 'eur',
            unit_amount: 475,
            product_data: { name: 'Tarif réduit — Film' },
          },
        },
      ],
    });
    expect(create.mock.calls[0]?.[1]).toEqual({
      idempotencyKey: 'booking-1',
    });
  });

  it('rejects when Stripe does not return a Checkout URL', async () => {
    const create = jest
      .fn<Stripe['checkout']['sessions']['create']>()
      .mockResolvedValue({
        id: 'cs_test_checkout-1',
        url: null,
      } as Stripe.Response<Stripe.Checkout.Session>);
    const client = {
      checkout: { sessions: { create } },
    } as unknown as Stripe;

    await expect(
      createStripeGateway(() => client).createCheckoutSession({
        bookingId: 'booking-1',
        showtimeId: 'showtime-1',
        movieTitle: 'Film',
        tickets: [{ fare: 'full', amountCents: 950 }],
        successUrl: 'http://localhost:5173/?payment=success',
        cancelUrl: 'http://localhost:5173/?payment=cancelled',
        expiresAt: 1_800_000_000,
      }),
    ).rejects.toThrow('Stripe did not return a Checkout URL.');
  });

  it('handles asynchronous success, expired sessions, and unrelated events', () => {
    process.env.STRIPE_SECRET_KEY = secretKey;
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    const asyncPayment = signedEvent(
      'checkout.session.async_payment_succeeded',
      {
        id: 'cs_test_async',
        object: 'checkout.session',
        metadata: { bookingId: 'booking-async' },
        customer_details: { email: null },
        payment_status: 'paid',
      },
    );
    expect(
      stripeGateway.constructWebhookEvent(
        asyncPayment.payload,
        asyncPayment.signature,
      ),
    ).toEqual({
      type: 'checkout.session.completed',
      bookingId: 'booking-async',
      sessionId: 'cs_test_async',
      email: null,
      paymentStatus: 'paid',
    });

    const expired = signedEvent('checkout.session.expired', {
      id: 'cs_test_expired',
      object: 'checkout.session',
      metadata: { bookingId: 'booking-expired' },
    });
    expect(
      stripeGateway.constructWebhookEvent(expired.payload, expired.signature),
    ).toEqual({
      type: 'checkout.session.expired',
      bookingId: 'booking-expired',
      sessionId: 'cs_test_expired',
    });

    const unrelated = signedEvent('customer.created', {
      id: 'cus_test',
      object: 'customer',
    });
    expect(
      stripeGateway.constructWebhookEvent(
        unrelated.payload,
        unrelated.signature,
      ),
    ).toEqual({ type: 'ignored' });
  });

  it('rejects supported Checkout events without booking metadata', () => {
    process.env.STRIPE_SECRET_KEY = secretKey;
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    const missingMetadata = signedEvent('checkout.session.completed', {
      id: 'cs_test_no_metadata',
      object: 'checkout.session',
      metadata: null,
      customer_details: null,
      payment_status: 'paid',
    });

    expect(() =>
      stripeGateway.constructWebhookEvent(
        missingMetadata.payload,
        missingMetadata.signature,
      ),
    ).toThrow(InvalidStripeWebhookError);
  });

  it('reports missing webhook configuration before signature verification', () => {
    process.env.STRIPE_SECRET_KEY = secretKey;
    delete process.env.STRIPE_WEBHOOK_SECRET;

    expect(() =>
      stripeGateway.constructWebhookEvent(Buffer.from('{}'), 'signature'),
    ).toThrow(StripeConfigurationError);
  });
});
