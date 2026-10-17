import { describe, expect, it, jest } from '@jest/globals';
import request from 'supertest';
import { createApp } from './app.js';
import {
  CustomerAuthenticationError,
  type CustomerAuthenticator,
} from './auth/customer-auth.js';
import type { CustomerTicketService } from './tickets/customer-ticket.service.js';

const bookingId = '11111111-1111-4111-8111-111111111111';

function buildApp(authorize: CustomerAuthenticator['authorize']) {
  const service: jest.Mocked<CustomerTicketService> = {
    listBookings: jest
      .fn<CustomerTicketService['listBookings']>()
      .mockResolvedValue([]),
    getTicketQr: jest
      .fn<CustomerTicketService['getTicketQr']>()
      .mockResolvedValue({
        qrCodeDataUrl: 'data:image/png;base64,AAA',
        used: false,
      }),
  };
  const app = createApp(
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { authorize },
    service,
  );
  return { app, service };
}

describe('customer booking routes', () => {
  it('scopes bookings and tickets to the authenticated e-mail', async () => {
    const { app, service } = buildApp(
      jest.fn<CustomerAuthenticator['authorize']>().mockResolvedValue({
        email: 'alice@example.com',
      }),
    );

    const list = await request(app)
      .get('/api/me/bookings')
      .set('Authorization', 'Bearer t');
    const ticket = await request(app)
      .get(`/api/me/bookings/${bookingId}/ticket`)
      .set('Authorization', 'Bearer t');

    expect(list.body).toEqual({ bookings: [] });
    expect(service.listBookings).toHaveBeenCalledWith('alice@example.com');
    expect(ticket.status).toBe(200);
    expect(ticket.headers['cache-control']).toBe('no-store');
    expect(service.getTicketQr).toHaveBeenCalledWith(
      'alice@example.com',
      bookingId,
    );
  });

  it('maps authentication failures to 401, 403 and 503', async () => {
    for (const [reason, status] of [
      ['missing', 401],
      ['invalid', 401],
      ['forbidden', 403],
      ['unavailable', 503],
    ] as const) {
      const { app, service } = buildApp(
        jest
          .fn<CustomerAuthenticator['authorize']>()
          .mockRejectedValue(new CustomerAuthenticationError(reason)),
      );
      const response = await request(app).get('/api/me/bookings');
      expect(response.status).toBe(status);
      expect(service.listBookings).not.toHaveBeenCalled();
    }
  });

  it('returns 404 for malformed ids and bookings of other accounts', async () => {
    const { app, service } = buildApp(
      jest
        .fn<CustomerAuthenticator['authorize']>()
        .mockResolvedValue({ email: 'alice@example.com' }),
    );
    service.getTicketQr.mockResolvedValue(null);

    const malformed = await request(app).get('/api/me/bookings/nope/ticket');
    const foreign = await request(app).get(
      `/api/me/bookings/${bookingId}/ticket`,
    );

    expect(malformed.status).toBe(404);
    expect(foreign.status).toBe(404);
  });
});
