import { describe, expect, it, jest } from '@jest/globals';
import {
  createCustomerTicketService,
  prismaCustomerBookingRepository,
  TicketSecretNotConfiguredError,
  type CustomerBookingRecord,
  type CustomerBookingRepository,
} from './customer-ticket.service.js';
import { createTicketToken, hashTicketToken } from './ticket-token.js';
import { prisma } from '../data/prisma.js';

const secret = 's'.repeat(32);
const bookingId = '11111111-1111-4111-8111-111111111111';

function record(
  overrides: Partial<CustomerBookingRecord> = {},
): CustomerBookingRecord {
  return {
    id: bookingId,
    ticketTokenHash: hashTicketToken(createTicketToken(bookingId, secret)),
    checkedInAt: null,
    startTime: new Date('2026-10-20T18:00:00Z'),
    movieTitle: 'Film',
    roomName: 'Salle 1',
    seats: [{ rowNumber: 'A', seatNumber: 1 }],
    ...overrides,
  };
}

function repo(
  records: CustomerBookingRecord[],
): jest.Mocked<CustomerBookingRepository> {
  return {
    listConfirmedByEmail: jest
      .fn<CustomerBookingRepository['listConfirmedByEmail']>()
      .mockResolvedValue(records),
    findConfirmedByEmail: jest
      .fn<CustomerBookingRepository['findConfirmedByEmail']>()
      .mockResolvedValue(records[0] ?? null),
  };
}

describe('customer ticket service', () => {
  it('lists upcoming bookings first (ascending) then past ones (descending)', async () => {
    const service = createCustomerTicketService(
      repo([
        record({ id: 'past-old', startTime: new Date('2026-10-01T10:00:00Z') }),
        record({ id: 'later', startTime: new Date('2026-10-25T10:00:00Z') }),
        record({ id: 'past-new', startTime: new Date('2026-10-10T10:00:00Z') }),
        record({
          id: 'soon',
          startTime: new Date('2026-10-18T10:00:00Z'),
          checkedInAt: new Date(),
        }),
      ]),
      secret,
    );

    const bookings = await service.listBookings(
      'a@example.com',
      new Date('2026-10-17T10:00:00Z'),
    );

    expect(bookings.map(({ id }) => id)).toEqual([
      'soon',
      'later',
      'past-new',
      'past-old',
    ]);
    expect(bookings[0]).toMatchObject({ used: true, isUpcoming: true });
    expect(bookings[2].isUpcoming).toBe(false);
    expect(bookings[0]).toMatchObject({ seatCount: 1 });
  });

  it('renders the QR for the derived token of an owned booking', async () => {
    const qrEncoder = jest
      .fn<(token: string) => Promise<string>>()
      .mockResolvedValue('data:image/png;base64,AAA');
    const service = createCustomerTicketService(
      repo([record()]),
      secret,
      qrEncoder,
    );

    await expect(
      service.getTicketQr('a@example.com', bookingId),
    ).resolves.toEqual({
      qrCodeDataUrl: 'data:image/png;base64,AAA',
      used: false,
    });
    expect(qrEncoder).toHaveBeenCalledWith(
      createTicketToken(bookingId, secret),
    );
  });

  it('returns null for unknown bookings or a mismatching hash', async () => {
    expect(
      await createCustomerTicketService(repo([]), secret).getTicketQr(
        'a@example.com',
        bookingId,
      ),
    ).toBeNull();
    expect(
      await createCustomerTicketService(
        repo([record({ ticketTokenHash: 'other' })]),
        secret,
      ).getTicketQr('a@example.com', bookingId),
    ).toBeNull();
  });

  it('fails when the ticket secret is not configured', async () => {
    await expect(
      createCustomerTicketService(repo([record()]), 'short').getTicketQr(
        'a@example.com',
        bookingId,
      ),
    ).rejects.toBeInstanceOf(TicketSecretNotConfiguredError);
  });

  it('renders a real PNG data URL with the default encoder', async () => {
    const ticket = await createCustomerTicketService(
      repo([record()]),
      secret,
    ).getTicketQr('a@example.com', bookingId);

    expect(ticket?.qrCodeDataUrl.startsWith('data:image/png;base64,')).toBe(
      true,
    );
  });

  it('returns null when the booking has no ticket hash yet', async () => {
    await expect(
      createCustomerTicketService(
        repo([record({ ticketTokenHash: null })]),
        secret,
      ).getTicketQr('a@example.com', bookingId),
    ).resolves.toBeNull();
  });
});

describe('prisma customer booking repository', () => {
  const row = {
    id: bookingId,
    ticketTokenHash: 'hash',
    checkedInAt: null,
    showtime: {
      startTime: new Date('2026-10-20T18:00:00Z'),
      movie: { title: 'Film' },
      room: { name: 'Salle 1' },
    },
    seats: [{ rowNumber: 'A', seatNumber: 1 }],
  };

  it('queries confirmed bookings by case-insensitive e-mail', async () => {
    const findMany = jest
      .spyOn(prisma.booking, 'findMany')
      .mockResolvedValue([row] as never);

    const records =
      await prismaCustomerBookingRepository.listConfirmedByEmail('a@b.fr');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'CONFIRMED',
          guestEmail: { equals: 'a@b.fr', mode: 'insensitive' },
        },
      }),
    );
    expect(records).toEqual([
      {
        id: bookingId,
        ticketTokenHash: 'hash',
        checkedInAt: null,
        startTime: row.showtime.startTime,
        movieTitle: 'Film',
        roomName: 'Salle 1',
        seats: row.seats,
      },
    ]);
  });

  it('scopes a single booking lookup to the e-mail', async () => {
    const findFirst = jest
      .spyOn(prisma.booking, 'findFirst')
      .mockResolvedValueOnce(row as never)
      .mockResolvedValueOnce(null);

    await expect(
      prismaCustomerBookingRepository.findConfirmedByEmail('a@b.fr', bookingId),
    ).resolves.toMatchObject({ id: bookingId });
    await expect(
      prismaCustomerBookingRepository.findConfirmedByEmail('a@b.fr', bookingId),
    ).resolves.toBeNull();
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: bookingId,
          guestEmail: { equals: 'a@b.fr', mode: 'insensitive' },
        }),
      }),
    );
  });
});
