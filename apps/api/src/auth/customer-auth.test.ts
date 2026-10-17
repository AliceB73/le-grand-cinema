import { Role } from '@prisma/client';
import { describe, expect, it, jest } from '@jest/globals';
import { createCustomerAuthenticator } from './customer-auth.js';
import { prisma } from '../data/prisma.js';

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

  it('rejects malformed profiles and role lookup failures', async () => {
    for (const [body, reason] of [
      ['not-json', 'unavailable'],
      [JSON.stringify({ email: '' }), 'invalid'],
      [JSON.stringify(null), 'invalid'],
    ] as const) {
      const authenticator = build(
        Role.USER,
        jest.fn<typeof fetch>().mockResolvedValue(new Response(body)),
      );
      await expect(authenticator.authorize('Bearer t')).rejects.toMatchObject({
        reason,
      });
    }
    const failingLookup = createCustomerAuthenticator({
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon-key',
      fetcher: jest
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ email: 'a@example.com' })),
        ),
      findRoleByEmail: jest
        .fn<(email: string) => Promise<Role | null>>()
        .mockRejectedValue(new Error('db down')),
    });
    await expect(failingLookup.authorize('Bearer t')).rejects.toMatchObject({
      reason: 'unavailable',
    });
  });

  it('reports missing configuration and upstream errors as unavailable', async () => {
    const unconfigured = createCustomerAuthenticator({
      supabaseUrl: '',
      supabaseAnonKey: '',
    });
    await expect(unconfigured.authorize('Bearer t')).rejects.toMatchObject({
      reason: 'unavailable',
    });
    const upstream = build(
      Role.USER,
      jest
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 503 })),
    );
    await expect(upstream.authorize('Bearer t')).rejects.toMatchObject({
      reason: 'unavailable',
    });
  });

  it('looks the role up in the database by default', async () => {
    const findUnique = jest
      .spyOn(prisma.user, 'findUnique')
      .mockResolvedValueOnce({ role: Role.USER } as never)
      .mockResolvedValueOnce(null);
    const authenticator = createCustomerAuthenticator({
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon-key',
      fetcher: jest
        .fn<typeof fetch>()
        .mockImplementation(
          async () => new Response(JSON.stringify({ email: 'A@example.com' })),
        ),
    });

    await expect(authenticator.authorize('Bearer t')).resolves.toEqual({
      email: 'a@example.com',
    });
    await expect(authenticator.authorize('Bearer t')).rejects.toMatchObject({
      reason: 'forbidden',
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { email: 'a@example.com' },
      select: { role: true },
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
