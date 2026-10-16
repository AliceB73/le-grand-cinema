import { describe, expect, it, jest } from '@jest/globals';
import { BookingStatus } from '@prisma/client';
import { prisma } from '../data/prisma.js';
import {
  createTicketService,
  prismaTicketRepository,
  type TicketRepository,
} from './ticket.service.js';
import { hashTicketToken } from './ticket-token.js';

describe('ticket service', () => {
  it('hashes the presented QR before atomic repository check-in', async () => {
    const checkIn = jest
      .fn<TicketRepository['checkIn']>()
      .mockResolvedValue('accepted');
    const service = createTicketService({ checkIn });
    const now = new Date('2026-10-16T12:00:00.000Z');

    await expect(service.checkIn('lgc1_test-token', now)).resolves.toBe(
      'accepted',
    );
    expect(checkIn).toHaveBeenCalledWith(
      hashTicketToken('lgc1_test-token'),
      now,
    );
  });

  it('consumes a confirmed ticket atomically and reports a repeated scan', async () => {
    const tokenHash = hashTicketToken('lgc1_test-token');
    const findUnique = jest
      .spyOn(prisma.booking, 'findUnique')
      .mockResolvedValue({
        id: 'booking-1',
        status: BookingStatus.CONFIRMED,
        checkedInAt: null,
      } as Awaited<ReturnType<typeof prisma.booking.findUnique>>);
    const updateMany = jest
      .spyOn(prisma.booking, 'updateMany')
      .mockResolvedValue({ count: 1 });
    const now = new Date('2026-10-16T12:00:00.000Z');

    await expect(prismaTicketRepository.checkIn(tokenHash, now)).resolves.toBe(
      'accepted',
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'booking-1',
        status: BookingStatus.CONFIRMED,
        checkedInAt: null,
      },
      data: { checkedInAt: now },
    });

    findUnique.mockResolvedValue({
      id: 'booking-1',
      status: BookingStatus.CONFIRMED,
      checkedInAt: now,
    } as Awaited<ReturnType<typeof prisma.booking.findUnique>>);
    await expect(prismaTicketRepository.checkIn(tokenHash, now)).resolves.toBe(
      'already_used',
    );
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown and unconfirmed tickets', async () => {
    const findUnique = jest
      .spyOn(prisma.booking, 'findUnique')
      .mockResolvedValue(null);

    await expect(
      prismaTicketRepository.checkIn(
        hashTicketToken('lgc1_unknown'),
        new Date(),
      ),
    ).resolves.toBe('invalid');
    findUnique.mockResolvedValue({
      id: 'booking-1',
      status: BookingStatus.PENDING,
      checkedInAt: null,
    } as Awaited<ReturnType<typeof prisma.booking.findUnique>>);
    await expect(
      prismaTicketRepository.checkIn(
        hashTicketToken('lgc1_pending'),
        new Date(),
      ),
    ).resolves.toBe('invalid');
  });

  it('rejects a concurrent check-in after the atomic update loses the race', async () => {
    jest.spyOn(prisma.booking, 'findUnique').mockResolvedValue({
      id: 'booking-1',
      status: BookingStatus.CONFIRMED,
      checkedInAt: null,
    } as Awaited<ReturnType<typeof prisma.booking.findUnique>>);
    jest.spyOn(prisma.booking, 'updateMany').mockResolvedValue({ count: 0 });

    await expect(
      prismaTicketRepository.checkIn(
        hashTicketToken('lgc1_concurrent'),
        new Date(),
      ),
    ).resolves.toBe('already_used');
  });
});
