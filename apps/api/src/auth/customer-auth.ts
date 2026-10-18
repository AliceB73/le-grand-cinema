import { Role } from '@prisma/client';
import { prisma } from '../data/prisma.js';

export class CustomerAuthenticationError extends Error {
  constructor(
    readonly reason: 'missing' | 'invalid' | 'forbidden' | 'unavailable',
  ) {
    super('The request is not authorized to access the customer area.');
    this.name = 'CustomerAuthenticationError';
  }
}

export interface AuthenticatedCustomer {
  id: string;
  email: string;
}

interface CustomerAuthenticatorOptions {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  fetcher?: typeof fetch;
  findRoleById?: (id: string) => Promise<Role | null>;
}

export function createCustomerAuthenticator({
  supabaseUrl = process.env.SUPABASE_URL,
  supabaseAnonKey = process.env.SUPABASE_ANON_KEY,
  fetcher = fetch,
  findRoleById = async (id) => {
    const user = await prisma.user.findUnique({
      where: { id },
      select: { role: true },
    });
    return user?.role ?? null;
  },
}: CustomerAuthenticatorOptions = {}) {
  return {
    async authorize(
      authorization: string | undefined,
    ): Promise<AuthenticatedCustomer> {
      const match = authorization?.match(/^Bearer\s+(\S+)$/i);
      if (!match) {
        throw new CustomerAuthenticationError('missing');
      }
      if (!supabaseUrl || !supabaseAnonKey) {
        throw new CustomerAuthenticationError('unavailable');
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
        throw new CustomerAuthenticationError('unavailable');
      }

      if (response.status === 401 || response.status === 403) {
        throw new CustomerAuthenticationError('invalid');
      }
      if (!response.ok) {
        throw new CustomerAuthenticationError('unavailable');
      }

      let profile: unknown;
      try {
        profile = await response.json();
      } catch {
        throw new CustomerAuthenticationError('unavailable');
      }
      if (
        typeof profile !== 'object' ||
        profile === null ||
        !('id' in profile) ||
        typeof profile.id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          profile.id,
        ) ||
        !('email' in profile) ||
        typeof profile.email !== 'string' ||
        profile.email.length === 0
      ) {
        throw new CustomerAuthenticationError('invalid');
      }

      const email = profile.email.toLowerCase();
      let role: Role | null;
      try {
        role = await findRoleById(profile.id);
      } catch {
        throw new CustomerAuthenticationError('unavailable');
      }
      if (role !== Role.USER) {
        throw new CustomerAuthenticationError('forbidden');
      }
      return { id: profile.id, email };
    },
  };
}

export type CustomerAuthenticator = ReturnType<
  typeof createCustomerAuthenticator
>;
