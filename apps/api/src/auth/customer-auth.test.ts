import { Role } from '@prisma/client';
import { describe, expect, it, jest } from '@jest/globals';
import { createCustomerAuthenticator } from './customer-auth.js';

function build(
  role: Role | null,
  fetcher: typeof fetch = jest.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify({ email: 'Alice@Example.com' }), {
      status: 200,
    }),
  ),
) {
  return createCustomerAuthenticator({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon-key',
    fetcher,
    findRoleByEmail: jest
      .fn<(email: string) => Promise<Role | null>>()
      .mockResolvedValue(role),
  });
}

describe('customer authenticator', () => {
  it('returns the lowercased e-mail of a USER account', async () => {
    await expect(build(Role.USER).authorize('Bearer token')).resolves.toEqual({
      email: 'alice@example.com',
    });
  });

  it('refuses admins and unknown accounts', async () => {
    await expect(build(Role.ADMIN).authorize('Bearer t')).rejects.toMatchObject(
      { reason: 'forbidden' },
    );
    await expect(build(null).authorize('Bearer t')).rejects.toMatchObject({
      reason: 'forbidden',
    });
  });

  it('distinguishes missing, invalid and unavailable', async () => {
    await expect(build(Role.USER).authorize(undefined)).rejects.toMatchObject({
      reason: 'missing',
    });
    const invalid = build(
      Role.USER,
      jest
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 401 })),
    );
    await expect(invalid.authorize('Bearer t')).rejects.toMatchObject({
      reason: 'invalid',
    });
    const offline = build(
      Role.USER,
      jest.fn<typeof fetch>().mockRejectedValue(new Error('offline')),
    );
    await expect(offline.authorize('Bearer t')).rejects.toMatchObject({
      reason: 'unavailable',
    });
  });
});
