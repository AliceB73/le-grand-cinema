import { describe, expect, it, jest } from '@jest/globals';
import { prisma } from '../data/prisma.js';
import {
  createTicketEmailWorker,
  prismaTicketEmailRepository,
  startTicketEmailWorker,
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

  it('does not claim an empty queue and marks exhausted deliveries as failed', async () => {
    const update = jest
      .fn<(args: unknown) => Promise<unknown>>()
      .mockResolvedValue(undefined);
    const transaction = {
      $queryRaw: jest
        .fn<() => Promise<unknown[]>>()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'delivery-1', attempts: 5 }]),
      emailDelivery: { update },
    };
    const transactionSpy = jest
      .spyOn(prisma, '$transaction')
      .mockImplementation(((callback: (client: never) => Promise<unknown>) =>
        callback(transaction as never)) as never);

    await expect(
      prismaTicketEmailRepository.claimNext(new Date('2026-10-16T12:00:00Z')),
    ).resolves.toBeNull();
    await expect(
      prismaTicketEmailRepository.claimNext(new Date('2026-10-16T12:00:00Z')),
    ).resolves.toBeNull();
    expect(update).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      data: {
        status: 'FAILED',
        lockedUntil: null,
        lastError: 'MAX_ATTEMPTS_EXCEEDED',
      },
    });
    transactionSpy.mockRestore();
  });

  it('claims a retryable delivery with a lease and increments its attempt count', async () => {
    const now = new Date('2026-10-16T12:00:00Z');
    const update = jest
      .fn<(args: unknown) => Promise<unknown>>()
      .mockResolvedValue({ id: 'delivery-1', attempts: 2 });
    const transaction = {
      $queryRaw: jest
        .fn<() => Promise<unknown[]>>()
        .mockResolvedValue([{ id: 'delivery-1', attempts: 1 }]),
      emailDelivery: { update },
    };
    const transactionSpy = jest
      .spyOn(prisma, '$transaction')
      .mockImplementation(((callback: (client: never) => Promise<unknown>) =>
        callback(transaction as never)) as never);

    await expect(prismaTicketEmailRepository.claimNext(now)).resolves.toEqual({
      id: 'delivery-1',
      attempts: 2,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      data: {
        status: 'SENDING',
        attempts: { increment: 1 },
        lockedUntil: new Date(now.getTime() + 60_000),
      },
      select: { id: true, attempts: true },
    });
    transactionSpy.mockRestore();
  });

  it('loads only confirmed bookings with valid ticket details', async () => {
    const now = new Date('2026-10-16T18:00:00Z');
    const findUnique = jest
      .spyOn(prisma.emailDelivery, 'findUnique')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'delivery-1',
        booking: {
          id: 'booking-1',
          guestEmail: 'spectateur@example.com',
          ticketTokenHash: 'ticket-hash',
          status: 'CONFIRMED',
          showtime: {
            startTime: now,
            movie: { title: 'Le Film' },
            room: { name: 'Salle A' },
          },
          seats: [{ rowNumber: 'A', seatNumber: 3 }],
        },
      } as never);

    await expect(
      prismaTicketEmailRepository.getEmailData('missing'),
    ).resolves.toBeNull();
    await expect(
      prismaTicketEmailRepository.getEmailData('delivery-1'),
    ).resolves.toEqual({
      deliveryId: 'delivery-1',
      bookingId: 'booking-1',
      email: 'spectateur@example.com',
      ticketTokenHash: 'ticket-hash',
      movieTitle: 'Le Film',
      startTime: now,
      roomName: 'Salle A',
      seats: [{ rowNumber: 'A', seatNumber: 3 }],
    });
    findUnique.mockRestore();
  });

  it('records sent and retriable or terminal delivery states', async () => {
    const update = jest
      .spyOn(prisma.emailDelivery, 'update')
      .mockResolvedValue({} as never);
    const now = new Date('2026-10-16T12:00:00Z');

    await prismaTicketEmailRepository.markSent('delivery-1', now);
    await prismaTicketEmailRepository.recordFailure(
      'delivery-1',
      2,
      'EMAIL_DELIVERY_FAILED',
      now,
      true,
    );
    await prismaTicketEmailRepository.recordFailure(
      'delivery-1',
      5,
      'EMAIL_DELIVERY_FAILED',
      now,
      true,
    );
    await prismaTicketEmailRepository.recordFailure(
      'delivery-1',
      1,
      'TICKET_DATA_UNAVAILABLE',
      now,
      false,
    );

    expect(update).toHaveBeenNthCalledWith(1, {
      where: { id: 'delivery-1', status: 'SENDING' },
      data: {
        status: 'SENT',
        sentAt: now,
        lockedUntil: null,
        lastError: null,
      },
    });
    expect(update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING',
          nextAttemptAt: new Date(now.getTime() + 2_000),
        }),
      }),
    );
    expect(update).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          nextAttemptAt: now,
        }),
      }),
    );
    expect(update).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          nextAttemptAt: now,
        }),
      }),
    );
    update.mockRestore();
  });

  it('records missing ticket data and token mismatches as terminal failures', async () => {
    const repository: TicketEmailRepository = {
      claimNext: jest
        .fn<(now: Date) => Promise<ClaimedDelivery | null>>()
        .mockResolvedValue({ id: 'delivery-1', attempts: 1 }),
      getEmailData: jest
        .fn<(deliveryId: string) => Promise<TicketEmailData | null>>()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          deliveryId: 'delivery-1',
          bookingId: 'booking-1',
          email: 'spectateur@example.com',
          ticketTokenHash: 'not-the-matching-hash',
          movieTitle: 'Le Film',
          startTime: new Date('2026-10-16T18:00:00Z'),
          roomName: 'Salle A',
          seats: [],
        }),
      markSent: jest.fn<TicketEmailRepository['markSent']>(),
      recordFailure: jest.fn<TicketEmailRepository['recordFailure']>(),
    };
    const logError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const worker = createTicketEmailWorker(
      repository,
      { send: jest.fn<TicketEmailSender['send']>() },
      tokenSecret,
      jest
        .fn<(token: string) => Promise<Buffer>>()
        .mockResolvedValue(Buffer.from('png')),
    );

    await worker.processNext();
    await worker.processNext();

    expect(repository.recordFailure).toHaveBeenNthCalledWith(
      1,
      'delivery-1',
      1,
      'TICKET_DATA_UNAVAILABLE',
      expect.any(Date),
      false,
    );
    expect(repository.recordFailure).toHaveBeenNthCalledWith(
      2,
      'delivery-1',
      1,
      'TICKET_TOKEN_MISMATCH',
      expect.any(Date),
      false,
    );
    logError.mockRestore();
  });

  it('handles an invalid ticket secret without attempting to load or send the ticket', async () => {
    const repository: TicketEmailRepository = {
      claimNext: jest
        .fn<(now: Date) => Promise<ClaimedDelivery | null>>()
        .mockResolvedValue({ id: 'delivery-1', attempts: 1 }),
      getEmailData: jest.fn<TicketEmailRepository['getEmailData']>(),
      markSent: jest.fn<TicketEmailRepository['markSent']>(),
      recordFailure: jest.fn<TicketEmailRepository['recordFailure']>(),
    };
    const logError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const worker = createTicketEmailWorker(
      repository,
      { send: jest.fn<TicketEmailSender['send']>() },
      'short',
      jest.fn<(token: string) => Promise<Buffer>>(),
    );

    await expect(worker.processNext()).resolves.toBe(true);
    expect(repository.getEmailData).not.toHaveBeenCalled();
    expect(repository.recordFailure).toHaveBeenCalledWith(
      'delivery-1',
      1,
      'TICKET_TOKEN_SECRET_NOT_CONFIGURED',
      expect.any(Date),
      true,
    );
    logError.mockRestore();
  });

  it('polls sequentially until the queue is empty and waits for in-flight work on stop', async () => {
    const processNext = jest
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const stop = startTicketEmailWorker({ processNext }, 60_000);

    await new Promise<void>((resolve) => setImmediate(resolve));
    await stop();

    expect(processNext).toHaveBeenCalledTimes(2);
  });

  it('logs a queue processing failure and shuts down cleanly', async () => {
    const processNext = jest
      .fn<() => Promise<boolean>>()
      .mockRejectedValue(new Error('database unavailable'));
    const logError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const stop = startTicketEmailWorker({ processNext }, 60_000);

    await new Promise<void>((resolve) => setImmediate(resolve));
    await stop();

    expect(logError).toHaveBeenCalledWith(
      'Ticket email queue processing failed.',
      expect.any(Error),
    );
    logError.mockRestore();
  });
});
