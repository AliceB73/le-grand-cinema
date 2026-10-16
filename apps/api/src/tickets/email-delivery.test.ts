import { describe, expect, it, jest } from '@jest/globals';
import {
  createTicketEmailWorker,
  type ClaimedDelivery,
  type TicketEmailData,
  type TicketEmailRepository,
  type TicketEmailSender,
} from './email-delivery.js';
import { createTicketToken, hashTicketToken } from './ticket-token.js';

const tokenSecret = 'unit-test-ticket-token-secret-32chars';

describe('ticket email delivery', () => {
  it('renders the QR locally and sends a French ticket with a stable idempotency key', async () => {
    const bookingId = 'booking-1';
    const repository: TicketEmailRepository = {
      claimNext: jest
        .fn<(now: Date) => Promise<ClaimedDelivery | null>>()
        .mockResolvedValue({ id: 'delivery-1', attempts: 1 }),
      getEmailData: jest
        .fn<(deliveryId: string) => Promise<TicketEmailData | null>>()
        .mockResolvedValue({
          deliveryId: 'delivery-1',
          bookingId,
          email: 'spectateur@example.com',
          ticketTokenHash: hashTicketToken(
            createTicketToken(bookingId, tokenSecret),
          ),
          movieTitle: 'Le Film',
          startTime: new Date('2026-10-16T18:00:00.000Z'),
          roomName: 'Salle A',
          seats: [{ rowNumber: 'A', seatNumber: 3 }],
        }),
      markSent: jest
        .fn<TicketEmailRepository['markSent']>()
        .mockResolvedValue(undefined),
      recordFailure: jest
        .fn<TicketEmailRepository['recordFailure']>()
        .mockResolvedValue(undefined),
    };
    const send = jest
      .fn<TicketEmailSender['send']>()
      .mockResolvedValue(undefined);
    const qrEncoder = jest
      .fn<(token: string) => Promise<Buffer>>()
      .mockResolvedValue(Buffer.from('png'));
    const worker = createTicketEmailWorker(
      repository,
      { send },
      tokenSecret,
      qrEncoder,
    );

    await expect(
      worker.processNext(new Date('2026-10-16T17:00:00.000Z')),
    ).resolves.toBe(true);

    expect(qrEncoder).toHaveBeenCalledWith(
      createTicketToken(bookingId, tokenSecret),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'spectateur@example.com',
        subject: 'Votre billet pour Le Film',
        idempotencyKey: 'delivery-1',
        qrImage: Buffer.from('png'),
      }),
    );
    expect(send.mock.calls[0]?.[0].text).toContain('Salle : Salle A');
    expect(repository.markSent).toHaveBeenCalled();
    expect(repository.recordFailure).not.toHaveBeenCalled();
  });

  it('retries provider failures without logging the recipient or QR token', async () => {
    const repository: TicketEmailRepository = {
      claimNext: jest
        .fn<(now: Date) => Promise<ClaimedDelivery | null>>()
        .mockResolvedValue({ id: 'delivery-1', attempts: 2 }),
      getEmailData: jest
        .fn<(deliveryId: string) => Promise<TicketEmailData | null>>()
        .mockResolvedValue({
          deliveryId: 'delivery-1',
          bookingId: 'booking-1',
          email: 'private@example.com',
          ticketTokenHash: hashTicketToken(
            createTicketToken('booking-1', tokenSecret),
          ),
          movieTitle: 'Le Film',
          startTime: new Date('2026-10-16T18:00:00.000Z'),
          roomName: 'Salle A',
          seats: [{ rowNumber: 'A', seatNumber: 3 }],
        }),
      markSent: jest
        .fn<TicketEmailRepository['markSent']>()
        .mockResolvedValue(undefined),
      recordFailure: jest
        .fn<TicketEmailRepository['recordFailure']>()
        .mockResolvedValue(undefined),
    };
    const send = jest
      .fn<TicketEmailSender['send']>()
      .mockRejectedValue(new Error('provider returned private data'));
    const logError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const worker = createTicketEmailWorker(
      repository,
      { send },
      tokenSecret,
      jest
        .fn<(token: string) => Promise<Buffer>>()
        .mockResolvedValue(Buffer.from('png')),
    );

    await expect(worker.processNext()).resolves.toBe(true);

    expect(repository.recordFailure).toHaveBeenCalledWith(
      'delivery-1',
      2,
      'EMAIL_DELIVERY_FAILED',
      expect.any(Date),
      true,
    );
    expect(logError).toHaveBeenCalledWith('Ticket email delivery failed.', {
      deliveryId: 'delivery-1',
      attempt: 2,
      errorCode: 'EMAIL_DELIVERY_FAILED',
    });
    logError.mockRestore();
  });
});
