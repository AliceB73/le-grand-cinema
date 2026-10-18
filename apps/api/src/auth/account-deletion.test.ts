import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  AccountDeletionError,
  createAccountDeletionService,
} from './account-deletion.js';

const userId = '11111111-1111-4111-8111-111111111111';

describe('account deletion service', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('anonymizes local records before deleting the Supabase identity', async () => {
    const prepareDeletion = jest
      .fn<(id: string, email: string) => Promise<void>>()
      .mockResolvedValue();
    const fetcher = jest
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const service = createAccountDeletionService({
      supabaseUrl: 'http://localhost:54321',
      serviceRoleKey: 'server-only-key',
      prepareDeletion,
      fetcher,
    });

    await service.deleteAccount(userId, 'alice@example.com');

    expect(prepareDeletion).toHaveBeenCalledWith(userId, 'alice@example.com');
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

  it('does not call Auth Admin when local anonymization fails', async () => {
    const fetcher = jest.fn<typeof fetch>();
    const service = createAccountDeletionService({
      supabaseUrl: 'http://localhost:54321',
      serviceRoleKey: 'server-only-key',
      prepareDeletion: jest
        .fn<(id: string, email: string) => Promise<void>>()
        .mockRejectedValue(new Error('database unavailable')),
      fetcher,
    });

    await expect(
      service.deleteAccount(userId, 'alice@example.com'),
    ).rejects.toMatchObject({ reason: 'database' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps local anonymization retryable when Auth Admin is unavailable', async () => {
    const prepareDeletion = jest
      .fn<(id: string, email: string) => Promise<void>>()
      .mockResolvedValue();
    const service = createAccountDeletionService({
      supabaseUrl: 'http://localhost:54321',
      serviceRoleKey: 'server-only-key',
      prepareDeletion,
      fetcher: jest
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 503 })),
    });

    await expect(
      service.deleteAccount(userId, 'alice@example.com'),
    ).rejects.toMatchObject({ reason: 'unavailable' });
    expect(prepareDeletion).toHaveBeenCalledTimes(1);
  });

  it('requires server-side Auth Admin configuration', async () => {
    const service = createAccountDeletionService({
      supabaseUrl: 'http://localhost:54321',
      serviceRoleKey: '',
      prepareDeletion: jest
        .fn<(id: string, email: string) => Promise<void>>()
        .mockResolvedValue(),
      fetcher: jest.fn<typeof fetch>(),
    });

    await expect(
      service.deleteAccount(userId, 'alice@example.com'),
    ).rejects.toBeInstanceOf(AccountDeletionError);
  });
});
