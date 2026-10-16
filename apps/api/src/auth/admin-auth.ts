import { Role } from '@prisma/client';
import { prisma } from '../data/prisma.js';

export class AdminAuthenticationError extends Error {
  constructor(
    readonly reason: 'missing' | 'invalid' | 'forbidden' | 'unavailable',
  ) {
    super('The request is not authorized to validate tickets.');
    this.name = 'AdminAuthenticationError';
  }
}

interface AdminAuthenticatorOptions {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  fetcher?: typeof fetch;
  findRoleByEmail?: (email: string) => Promise<Role | null>;
}

export function createAdminAuthenticator({
  supabaseUrl = process.env.SUPABASE_URL,
  supabaseAnonKey = process.env.SUPABASE_ANON_KEY,
  fetcher = fetch,
  findRoleByEmail = async (email) => {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { role: true },
    });
    return user?.role ?? null;
  },
}: AdminAuthenticatorOptions = {}) {
  return {
    async authorize(authorization: string | undefined) {
      const match = authorization?.match(/^Bearer ([^\s]+)$/);
      if (!match) {
        throw new AdminAuthenticationError('missing');
      }
      if (!supabaseUrl || !supabaseAnonKey) {
        throw new AdminAuthenticationError('unavailable');
      }

      let response: Response;
      try {
        response = await fetcher(new URL('/auth/v1/user', supabaseUrl), {
          headers: {
            apikey: supabaseAnonKey,
            authorization: `Bearer ${match[1]}`,
          },
        });
      } catch {
        throw new AdminAuthenticationError('unavailable');
      }

      if (response.status === 401 || response.status === 403) {
        throw new AdminAuthenticationError('invalid');
      }
      if (!response.ok) {
        throw new AdminAuthenticationError('unavailable');
      }

      let profile: unknown;
      try {
        profile = await response.json();
      } catch {
        throw new AdminAuthenticationError('unavailable');
      }
      if (
        typeof profile !== 'object' ||
        profile === null ||
        !('email' in profile) ||
        typeof profile.email !== 'string' ||
        profile.email.length === 0
      ) {
        throw new AdminAuthenticationError('invalid');
      }

      let role: Role | null;
      try {
        role = await findRoleByEmail(profile.email.toLowerCase());
      } catch {
        throw new AdminAuthenticationError('unavailable');
      }
      if (role !== Role.ADMIN) {
        throw new AdminAuthenticationError('forbidden');
      }
    },
  };
}

export type AdminAuthenticator = ReturnType<typeof createAdminAuthenticator>;
