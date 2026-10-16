import { BookingStatus } from '@prisma/client';
import { prisma } from '../data/prisma.js';
import { hashTicketToken } from './ticket-token.js';

export type TicketCheckInResult = 'accepted' | 'already_used' | 'invalid';

export interface TicketRepository {
  checkIn(ticketTokenHash: string, now: Date): Promise<TicketCheckInResult>;
}

export const prismaTicketRepository: TicketRepository = {
  checkIn: async (ticketTokenHash, now) => {
    const booking = await prisma.booking.findUnique({
      where: { ticketTokenHash },
      select: { id: true, status: true, checkedInAt: true },
    });
    if (!booking || booking.status !== BookingStatus.CONFIRMED) {
      return 'invalid';
    }
    if (booking.checkedInAt) {
      return 'already_used';
    }

    const updated = await prisma.booking.updateMany({
      where: {
        id: booking.id,
        status: BookingStatus.CONFIRMED,
        checkedInAt: null,
      },
      data: { checkedInAt: now },
    });
    return updated.count === 1 ? 'accepted' : 'already_used';
  },
};

export function createTicketService(
  repository: TicketRepository = prismaTicketRepository,
) {
  return {
    checkIn(ticketToken: string, now = new Date()) {
      return repository.checkIn(hashTicketToken(ticketToken), now);
    },
  };
}

export type TicketService = ReturnType<typeof createTicketService>;
