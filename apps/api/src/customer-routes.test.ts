import { describe, expect, it, jest } from '@jest/globals';
import request from 'supertest';
import { createApp } from './app.js';
import {
  CustomerAuthenticationError,
  type CustomerAuthenticator,
} from './auth/customer-auth.js';
import {
  AccountDeletionError,
  type AccountDeletionService,
} from './auth/account-deletion.js';
import type { CustomerTicketService } from './tickets/customer-ticket.service.js';

const bookingId = '11111111-1111-4111-8111-111111111111';
const customerId = '22222222-2222-4222-8222-222222222222';

function buildApp(
  authorize: CustomerAuthenticator['authorize'],
  accountDeletionService: AccountDeletionService = {
    deleteAccount: jest.fn<AccountDeletionService['deleteAccount']>(),
  },
) {
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
    undefined,
    accountDeletionService,
  );
  return { app, service, accountDeletionService };
}

describe('customer booking routes', () => {
  it('scopes bookings and tickets to the authenticated e-mail', async () => {
    const { app, service } = buildApp(
      jest.fn<CustomerAuthenticator['authorize']>().mockResolvedValue({
        id: customerId,
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
        .mockResolvedValue({ id: customerId, email: 'alice@example.com' }),
    );
    service.getTicketQr.mockResolvedValue(null);

    const malformed = await request(app).get('/api/me/bookings/nope/ticket');
    const foreign = await request(app).get(
      `/api/me/bookings/${bookingId}/ticket`,
    );

    expect(malformed.status).toBe(404);
    expect(foreign.status).toBe(404);
  });

  it('reports unexpected authorization and service failures', async () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const unexpected = buildApp(
      jest
        .fn<CustomerAuthenticator['authorize']>()
        .mockRejectedValue(new Error('boom')),
    );
    expect((await request(unexpected.app).get('/api/me/bookings')).status).toBe(
      500,
    );

    const failing = buildApp(
      jest
        .fn<CustomerAuthenticator['authorize']>()
        .mockResolvedValue({ id: customerId, email: 'alice@example.com' }),
    );
    failing.service.listBookings.mockRejectedValue(new Error('db'));
    failing.service.getTicketQr.mockRejectedValue(new Error('qr'));
    const list = await request(failing.app).get('/api/me/bookings');
    const ticket = await request(failing.app).get(
      `/api/me/bookings/${bookingId}/ticket`,
    );

    expect(list.status).toBe(500);
    expect(list.body.error).toBe('BOOKINGS_UNAVAILABLE');
    expect(ticket.status).toBe(500);
    expect(ticket.body.error).toBe('TICKET_UNAVAILABLE');
    consoleError.mockRestore();
  });

  it('does not render a ticket for an unauthenticated request', async () => {
    const { app, service } = buildApp(
      jest
        .fn<CustomerAuthenticator['authorize']>()
        .mockRejectedValue(new CustomerAuthenticationError('missing')),
    );

    const response = await request(app).get(
      `/api/me/bookings/${bookingId}/ticket`,
    );

    expect(response.status).toBe(401);
    expect(service.getTicketQr).not.toHaveBeenCalled();
  });

  it('deletes only the authenticated customer account', async () => {
    const { app, accountDeletionService } = buildApp(
      jest
        .fn<CustomerAuthenticator['authorize']>()
        .mockResolvedValue({ id: customerId, email: 'alice@example.com' }),
    );

    const response = await request(app)
      .delete('/api/me/account')
      .set('Authorization', 'Bearer customer-token');

    expect(response.status).toBe(204);
    expect(accountDeletionService.deleteAccount).toHaveBeenCalledWith(
      customerId,
      'alice@example.com',
    );
  });

  it('does not delete an account when customer authorization fails', async () => {
    const { app, accountDeletionService } = buildApp(
      jest
        .fn<CustomerAuthenticator['authorize']>()
        .mockRejectedValue(new CustomerAuthenticationError('missing')),
    );

    const response = await request(app).delete('/api/me/account');

    expect(response.status).toBe(401);
    expect(accountDeletionService.deleteAccount).not.toHaveBeenCalled();
  });

  it('reports unavailable deletion dependencies explicitly', async () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { app } = buildApp(
      jest
        .fn<CustomerAuthenticator['authorize']>()
        .mockResolvedValue({ id: customerId, email: 'alice@example.com' }),
      {
        deleteAccount: jest
          .fn<AccountDeletionService['deleteAccount']>()
          .mockRejectedValue(new AccountDeletionError('unavailable')),
      },
    );

    const response = await request(app)
      .delete('/api/me/account')
      .set('Authorization', 'Bearer customer-token');

    expect(response.status).toBe(503);
    expect(response.body.error).toBe('ACCOUNT_DELETION_UNAVAILABLE');
    consoleError.mockRestore();
  });
});
