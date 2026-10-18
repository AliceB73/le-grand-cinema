import type { Prisma } from '@prisma/client';
import { prisma } from '../data/prisma.js';

export class AccountDeletionError extends Error {
  constructor(readonly reason: 'unavailable' | 'database') {
    super('The account could not be deleted.');
    this.name = 'AccountDeletionError';
  }
}

export interface AccountDeletionService {
  deleteAccount(userId: string, email: string): Promise<void>;
}

interface AccountDeletionOptions {
  supabaseUrl?: string;
  serviceRoleKey?: string;
  fetcher?: typeof fetch;
  runTransaction?: (
    operation: (transaction: AccountDeletionTransaction) => Promise<void>,
  ) => Promise<void>;
}

type AccountDeletionTransaction = Pick<
  Prisma.TransactionClient,
  'booking' | 'emailDelivery' | 'user'
>;

async function anonymizeCustomerData(
  transaction: AccountDeletionTransaction,
  userId: string,
  email: string,
) {
  const bookings = await transaction.booking.findMany({
    where: {
      OR: [{ userId }, { guestEmail: { equals: email, mode: 'insensitive' } }],
    },
    select: { id: true },
  });
  const bookingIds = bookings.map(({ id }) => id);

  if (bookingIds.length > 0) {
    await transaction.emailDelivery.updateMany({
      where: { bookingId: { in: bookingIds } },
      data: { lastError: null },
    });
    await transaction.booking.updateMany({
      where: { id: { in: bookingIds } },
      data: {
        guestEmail: null,
        userId: null,
        stripeCheckoutSessionId: null,
      },
    });
  }

  await transaction.user.update({
    where: { id: userId },
    data: { email: `erased-${userId}@example.invalid` },
  });
}

export function createAccountDeletionService({
  supabaseUrl = process.env.SUPABASE_URL,
  serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
  fetcher = fetch,
  runTransaction = (operation) => prisma.$transaction(operation),
}: AccountDeletionOptions = {}): AccountDeletionService {
  return {
    async deleteAccount(userId, email) {
      if (!supabaseUrl || !serviceRoleKey) {
        throw new AccountDeletionError('unavailable');
      }

      try {
        await runTransaction((transaction) =>
          anonymizeCustomerData(transaction, userId, email),
        );
      } catch {
        throw new AccountDeletionError('database');
      }

      let response: Response;
      try {
        response = await fetcher(
          new URL(
            `/auth/v1/admin/users/${encodeURIComponent(userId)}`,
            supabaseUrl,
          ),
          {
            method: 'DELETE',
            headers: {
              apikey: serviceRoleKey,
              authorization: `Bearer ${serviceRoleKey}`,
            },
          },
        );
      } catch {
        throw new AccountDeletionError('unavailable');
      }

      if (!response.ok && response.status !== 404) {
        throw new AccountDeletionError('unavailable');
      }
    },
  };
}
