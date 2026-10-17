import QRCode from 'qrcode';
import { BookingStatus } from '@prisma/client';
import { prisma } from '../data/prisma.js';
import { createTicketToken, hashTicketToken } from './ticket-token.js';

export interface CustomerBooking {
  id: string;
  movieTitle: string;
  roomName: string;
  startTime: string;
  seats: Array<{ rowNumber: string; seatNumber: number }>;
  seatCount: number;
  used: boolean;
  isUpcoming: boolean;
}

export interface CustomerBookingRecord {
  id: string;
  ticketTokenHash: string | null;
  checkedInAt: Date | null;
  startTime: Date;
  movieTitle: string;
  roomName: string;
  seats: Array<{ rowNumber: string; seatNumber: number }>;
}

export interface CustomerBookingRepository {
  listConfirmedByEmail(email: string): Promise<CustomerBookingRecord[]>;
  findConfirmedByEmail(
    email: string,
    bookingId: string,
  ): Promise<CustomerBookingRecord | null>;
}

export class TicketSecretNotConfiguredError extends Error {
  constructor() {
    super('TICKET_TOKEN_SECRET_NOT_CONFIGURED');
    this.name = 'TicketSecretNotConfiguredError';
  }
}

const bookingSelect = {
  id: true,
  ticketTokenHash: true,
  checkedInAt: true,
  showtime: {
    select: {
      startTime: true,
      movie: { select: { title: true } },
      room: { select: { name: true } },
    },
  },
  seats: {
    select: { rowNumber: true, seatNumber: true },
    orderBy: [{ rowNumber: 'asc' as const }, { seatNumber: 'asc' as const }],
  },
};

type BookingRow = {
  id: string;
  ticketTokenHash: string | null;
  checkedInAt: Date | null;
  showtime: {
    startTime: Date;
    movie: { title: string };
    room: { name: string };
  };
  seats: Array<{ rowNumber: string; seatNumber: number }>;
};

function toRecord(row: BookingRow): CustomerBookingRecord {
  return {
    id: row.id,
    ticketTokenHash: row.ticketTokenHash,
    checkedInAt: row.checkedInAt,
    startTime: row.showtime.startTime,
    movieTitle: row.showtime.movie.title,
    roomName: row.showtime.room.name,
    seats: row.seats,
  };
}

export const prismaCustomerBookingRepository: CustomerBookingRepository = {
  listConfirmedByEmail: async (email) => {
    const rows = await prisma.booking.findMany({
      where: {
        status: BookingStatus.CONFIRMED,
        guestEmail: { equals: email, mode: 'insensitive' },
      },
      select: bookingSelect,
      take: 200,
    });
    return rows.map(toRecord);
  },
  findConfirmedByEmail: async (email, bookingId) => {
    const row = await prisma.booking.findFirst({
      where: {
        id: bookingId,
        status: BookingStatus.CONFIRMED,
        guestEmail: { equals: email, mode: 'insensitive' },
      },
      select: bookingSelect,
    });
    return row ? toRecord(row) : null;
  },
};

export function createCustomerTicketService(
  repository: CustomerBookingRepository = prismaCustomerBookingRepository,
  tokenSecret = process.env.TICKET_TOKEN_SECRET,
  qrEncoder: (token: string) => Promise<string> = (token) =>
    QRCode.toDataURL(token, { errorCorrectionLevel: 'M', margin: 2 }),
) {
  return {
    async listBookings(
      email: string,
      now = new Date(),
    ): Promise<CustomerBooking[]> {
      const records = await repository.listConfirmedByEmail(email);
      const bookings = records.map((record) => ({
        id: record.id,
        movieTitle: record.movieTitle,
        roomName: record.roomName,
        startTime: record.startTime.toISOString(),
        seats: record.seats,
        seatCount: record.seats.length,
        used: record.checkedInAt !== null,
        isUpcoming: record.startTime.getTime() >= now.getTime(),
      }));
      const upcoming = bookings
        .filter(({ isUpcoming }) => isUpcoming)
        .sort((a, b) => a.startTime.localeCompare(b.startTime));
      const past = bookings
        .filter(({ isUpcoming }) => !isUpcoming)
        .sort((a, b) => b.startTime.localeCompare(a.startTime));
      return [...upcoming, ...past];
    },
    async getTicketQr(email: string, bookingId: string) {
      const record = await repository.findConfirmedByEmail(email, bookingId);
      if (!record || !record.ticketTokenHash) {
        return null;
      }
      if (!tokenSecret || tokenSecret.length < 32) {
        throw new TicketSecretNotConfiguredError();
      }
      const token = createTicketToken(record.id, tokenSecret);
      if (hashTicketToken(token) !== record.ticketTokenHash) {
        return null;
      }
      return {
        qrCodeDataUrl: await qrEncoder(token),
        used: !!record.checkedInAt,
      };
    },
  };
}

export type CustomerTicketService = ReturnType<
  typeof createCustomerTicketService
>;
