import { Role } from '@prisma/client';
import { describe, expect, it, jest } from '@jest/globals';
import {
  AdminAuthenticationError,
  createAdminAuthenticator,
} from './admin-auth.js';

describe('admin authenticator', () => {
  it('verifies the Supabase bearer token and requires the persisted ADMIN role', async () => {
    const fetcher = jest.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ email: 'ADMIN@example.com' }), {
        status: 200,
      }),
    );
    const findRoleByEmail = jest
      .fn<(email: string) => Promise<Role | null>>()
      .mockResolvedValue(Role.ADMIN);
    const authenticator = createAdminAuthenticator({
      supabaseUrl: 'https://example.supabase.co/',
      supabaseAnonKey: 'anon-key',
      fetcher,
      findRoleByEmail,
    });

    await expect(authenticator.authorize('Bearer access-token')).resolves.toBe(
      undefined,
    );
    expect(fetcher).toHaveBeenCalledWith(
      new URL('https://example.supabase.co/auth/v1/user'),
      {
        headers: {
          apikey: 'anon-key',
          authorization: 'Bearer access-token',
        },
      },
    );
    expect(findRoleByEmail).toHaveBeenCalledWith('admin@example.com');
  });

  it('rejects missing, invalid and non-admin credentials explicitly', async () => {
    const authenticator = createAdminAuthenticator({
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon-key',
      fetcher: jest.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ email: 'user@example.com' }), {
          status: 200,
        }),
      ),
      findRoleByEmail: jest
        .fn<(email: string) => Promise<Role | null>>()
        .mockResolvedValue(Role.USER),
    });

    await expect(authenticator.authorize(undefined)).rejects.toMatchObject({
      reason: 'missing',
    } satisfies Partial<AdminAuthenticationError>);
    await expect(
      authenticator.authorize('Bearer access-token'),
    ).rejects.toMatchObject({ reason: 'forbidden' });
  });

  it('surfaces a Supabase outage as unavailable rather than unauthenticated', async () => {
    const authenticator = createAdminAuthenticator({
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon-key',
      fetcher: jest.fn<typeof fetch>().mockRejectedValue(new Error('offline')),
    });

    await expect(
      authenticator.authorize('Bearer access-token'),
    ).rejects.toBeInstanceOf(AdminAuthenticationError);
    await expect(
      authenticator.authorize('Bearer access-token'),
    ).rejects.toMatchObject({ reason: 'unavailable' });
  });

  it('rejects malformed authorization and missing Supabase configuration', async () => {
    const missingConfiguration = createAdminAuthenticator({
      supabaseUrl: '',
      supabaseAnonKey: '',
      fetcher: jest.fn<typeof fetch>(),
    });

    await expect(
      missingConfiguration.authorize('not-a-bearer-token'),
    ).rejects.toMatchObject({ reason: 'missing' });
    await expect(
      missingConfiguration.authorize('Bearer token'),
    ).rejects.toMatchObject({ reason: 'unavailable' });
  });

  it('distinguishes invalid credentials from an unavailable Supabase response', async () => {
    for (const status of [401, 403]) {
      const authenticator = createAdminAuthenticator({
        supabaseUrl: 'https://example.supabase.co',
        supabaseAnonKey: 'anon-key',
        fetcher: jest
          .fn<typeof fetch>()
          .mockResolvedValue(new Response(null, { status })),
      });

      await expect(
        authenticator.authorize('Bearer token'),
      ).rejects.toMatchObject({ reason: 'invalid' });
    }

    const unavailable = createAdminAuthenticator({
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon-key',
      fetcher: jest
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 503 })),
    });
    await expect(unavailable.authorize('Bearer token')).rejects.toMatchObject({
      reason: 'unavailable',
    });
  });

  it('rejects malformed Supabase profiles and reports role lookup failures', async () => {
    const malformedProfiles = [
      'not-json',
      JSON.stringify(null),
      JSON.stringify({ email: '' }),
      JSON.stringify({ email: 123 }),
    ];
    for (const body of malformedProfiles) {
      const authenticator = createAdminAuthenticator({
        supabaseUrl: 'https://example.supabase.co',
        supabaseAnonKey: 'anon-key',
        fetcher: jest.fn<typeof fetch>().mockResolvedValue(
          new Response(body, {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
        findRoleByEmail: jest
          .fn<(email: string) => Promise<Role | null>>()
          .mockResolvedValue(null),
      });
      await expect(
        authenticator.authorize('Bearer token'),
      ).rejects.toMatchObject({
        reason: body === 'not-json' ? 'unavailable' : 'invalid',
      });
    }

    const roleLookupFailure = createAdminAuthenticator({
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon-key',
      fetcher: jest.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ email: 'staff@example.com' }), {
          status: 200,
        }),
      ),
      findRoleByEmail: jest
        .fn<(email: string) => Promise<Role | null>>()
        .mockRejectedValue(new Error('database down')),
    });
    await expect(
      roleLookupFailure.authorize('Bearer token'),
    ).rejects.toMatchObject({ reason: 'unavailable' });
  });
});
