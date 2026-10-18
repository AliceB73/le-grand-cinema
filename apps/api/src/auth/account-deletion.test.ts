import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { Prisma } from '@prisma/client';
import {
  AccountDeletionError,
  createAccountDeletionService,
} from './account-deletion.js';

const userId = '11111111-1111-4111-8111-111111111111';
type TransactionRunner = (
  operation: (transaction: Prisma.TransactionClient) => Promise<void>,
) => Promise<void>;

describe('account deletion service', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('anonymizes local records before deleting the Supabase identity', async () => {
    const transaction = {
      booking: {
        findMany: jest
          .fn<(args: unknown) => Promise<{ id: string }[]>>()
          .mockResolvedValue([{ id: 'booking-1' }]),
        updateMany: jest
          .fn<(args: unknown) => Promise<{ count: number }>>()
          .mockResolvedValue({ count: 1 }),
      },
      emailDelivery: {
        updateMany: jest
          .fn<(args: unknown) => Promise<{ count: number }>>()
          .mockResolvedValue({ count: 1 }),
      },
      user: {
        update: jest
          .fn<(args: unknown) => Promise<{ id: string }>>()
          .mockResolvedValue({ id: userId }),
      },
    };
    const runTransaction = jest
      .fn<TransactionRunner>()
      .mockImplementation(async (operation) => operation(transaction as never));
    const fetcher = jest
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const service = createAccountDeletionService({
      supabaseUrl: 'http://localhost:54321',
      serviceRoleKey: 'server-only-key',
      runTransaction,
      fetcher,
    });

    await service.deleteAccount(userId, 'alice@example.com');

    expect(transaction.booking.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { userId },
          {
            guestEmail: {
              equals: 'alice@example.com',
              mode: 'insensitive',
            },
          },
        ],
      },
      select: { id: true },
    });
    expect(transaction.booking.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['booking-1'] } },
      data: {
        guestEmail: null,
        userId: null,
        stripeCheckoutSessionId: null,
      },
    });
    expect(transaction.emailDelivery.updateMany).toHaveBeenCalledWith({
      where: { bookingId: { in: ['booking-1'] } },
      data: { lastError: null },
    });
    expect(transaction.user.update).toHaveBeenCalledWith({
      where: { id: userId },
      data: { email: `erased-${userId}@example.invalid` },
    });
    expect(fetcher).toHaveBeenCalledWith(
      new URL(`/auth/v1/admin/users/${userId}`, 'http://localhost:54321'),
      expect.objectContaining({
        method: 'DELETE',
        headers: {
          apikey: 'server-only-key',
          authorization: 'Bearer server-only-key',
        },
      }),
    );
  });

  it('anonymizes the profile when there are no reservations', async () => {
    const transaction = {
      booking: {
        findMany: jest
          .fn<(args: unknown) => Promise<{ id: string }[]>>()
          .mockResolvedValue([]),
        updateMany: jest.fn(),
      },
      emailDelivery: { updateMany: jest.fn() },
      user: {
        update: jest
          .fn<(args: unknown) => Promise<{ id: string }>>()
          .mockResolvedValue({ id: userId }),
      },
    };
    const service = createAccountDeletionService({
      supabaseUrl: 'http://localhost:54321',
      serviceRoleKey: 'server-only-key',
      runTransaction: (operation) => operation(transaction as never),
      fetcher: jest
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 204 })),
    });

    await service.deleteAccount(userId, 'alice@example.com');

    expect(transaction.booking.updateMany).not.toHaveBeenCalled();
    expect(transaction.emailDelivery.updateMany).not.toHaveBeenCalled();
    expect(transaction.user.update).toHaveBeenCalled();
  });

  it('does not call Auth Admin when local anonymization fails', async () => {
    const fetcher = jest.fn<typeof fetch>();
    const service = createAccountDeletionService({
      supabaseUrl: 'http://localhost:54321',
      serviceRoleKey: 'server-only-key',
      runTransaction: jest
        .fn<TransactionRunner>()
        .mockImplementation(async () => {
          throw new Error('database unavailable');
        }),
      fetcher,
    });

    await expect(
      service.deleteAccount(userId, 'alice@example.com'),
    ).rejects.toMatchObject({ reason: 'database' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps local anonymization retryable when Auth Admin is unavailable', async () => {
    const runTransaction = jest
      .fn<TransactionRunner>()
      .mockResolvedValue(undefined);
    const service = createAccountDeletionService({
      supabaseUrl: 'http://localhost:54321',
      serviceRoleKey: 'server-only-key',
      runTransaction,
      fetcher: jest
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 503 })),
    });

    await expect(
      service.deleteAccount(userId, 'alice@example.com'),
    ).rejects.toMatchObject({ reason: 'unavailable' });
    expect(runTransaction).toHaveBeenCalledTimes(1);
  });

  it('treats an already-deleted Auth identity as a successful retry', async () => {
    const service = createAccountDeletionService({
      supabaseUrl: 'http://localhost:54321',
      serviceRoleKey: 'server-only-key',
      runTransaction: jest.fn<TransactionRunner>().mockResolvedValue(undefined),
      fetcher: jest
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 404 })),
    });

    await expect(
      service.deleteAccount(userId, 'alice@example.com'),
    ).resolves.toBeUndefined();
  });

  it('reports network errors as Auth Admin unavailability', async () => {
    const service = createAccountDeletionService({
      supabaseUrl: 'http://localhost:54321',
      serviceRoleKey: 'server-only-key',
      runTransaction: jest.fn<TransactionRunner>().mockResolvedValue(undefined),
      fetcher: jest.fn<typeof fetch>().mockRejectedValue(new Error('offline')),
    });

    await expect(
      service.deleteAccount(userId, 'alice@example.com'),
    ).rejects.toMatchObject({ reason: 'unavailable' });
  });

  it('reports Auth Admin error responses as unavailable', async () => {
    const service = createAccountDeletionService({
      supabaseUrl: 'http://localhost:54321',
      serviceRoleKey: 'server-only-key',
      runTransaction: jest.fn<TransactionRunner>().mockResolvedValue(undefined),
      fetcher: jest
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 500 })),
    });

    await expect(
      service.deleteAccount(userId, 'alice@example.com'),
    ).rejects.toMatchObject({ reason: 'unavailable' });
  });

  it('requires server-side Auth Admin configuration', async () => {
    const service = createAccountDeletionService({
      supabaseUrl: 'http://localhost:54321',
      serviceRoleKey: '',
      runTransaction: jest.fn<TransactionRunner>(),
      fetcher: jest.fn<typeof fetch>(),
    });

    await expect(
      service.deleteAccount(userId, 'alice@example.com'),
    ).rejects.toBeInstanceOf(AccountDeletionError);
  });
});
