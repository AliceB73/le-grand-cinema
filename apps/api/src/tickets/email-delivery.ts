import {
  Prisma,
  type EmailDeliveryKind,
  type EmailDeliveryStatus,
} from '@prisma/client';
import { Resend } from 'resend';
import QRCode from 'qrcode';
import { prisma } from '../data/prisma.js';
import { createTicketToken, hashTicketToken } from './ticket-token.js';

const maxAttempts = 5;
const leaseDurationMs = 60_000;

export interface TicketEmailData {
  deliveryId: string;
  bookingId: string;
  email: string;
  ticketTokenHash: string;
  movieTitle: string;
  startTime: Date;
  roomName: string;
  seats: Array<{ rowNumber: string; seatNumber: number }>;
}

export interface ClaimedDelivery {
  id: string;
  attempts: number;
  kind?: EmailDeliveryKind;
}

export interface CancellationEmailData {
  bookingId: string;
  email: string;
  movieTitle: string;
  startTime: Date;
  roomName: string;
}

export interface TicketEmailRepository {
  claimNext(now: Date): Promise<ClaimedDelivery | null>;
  getEmailData(deliveryId: string): Promise<TicketEmailData | null>;
  getCancellationData?(
    deliveryId: string,
  ): Promise<CancellationEmailData | null>;
  markSent(deliveryId: string, now: Date): Promise<void>;
  recordFailure(
    deliveryId: string,
    attempts: number,
    errorCode: string,
    now: Date,
    retryable: boolean,
  ): Promise<void>;
}

export interface TicketEmailSender {
  send(input: {
    to: string;
    from: string;
    subject: string;
    html: string;
    text: string;
    qrImage?: Buffer;
    idempotencyKey: string;
  }): Promise<void>;
}

export const prismaTicketEmailRepository: TicketEmailRepository = {
  claimNext: async (now) =>
    prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<ClaimedDelivery[]>(Prisma.sql`
        SELECT "id", "attempts", "kind"
        FROM "EmailDelivery"
        WHERE (
          "status" = 'PENDING' AND "nextAttemptAt" <= ${now}
        ) OR (
          "status" = 'SENDING' AND "lockedUntil" <= ${now}
        )
        ORDER BY "nextAttemptAt" ASC, "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `);
      const delivery = rows[0];
      if (!delivery) {
        return null;
      }

      if (delivery.attempts >= maxAttempts) {
        await transaction.emailDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'FAILED',
            lockedUntil: null,
            lastError: 'MAX_ATTEMPTS_EXCEEDED',
          },
        });
        return null;
      }

      const updated = await transaction.emailDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'SENDING',
          attempts: { increment: 1 },
          lockedUntil: new Date(now.getTime() + leaseDurationMs),
        },
        select: { id: true, attempts: true, kind: true },
      });
      return updated;
    }),
  getCancellationData: async (deliveryId) => {
    const delivery = await prisma.emailDelivery.findUnique({
      where: { id: deliveryId },
      select: {
        booking: {
          select: {
            id: true,
            guestEmail: true,
            user: { select: { email: true } },
            showtime: {
              select: {
                status: true,
                startTime: true,
                movie: { select: { title: true } },
                room: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    const booking = delivery?.booking;
    const email = booking?.guestEmail ?? booking?.user?.email;
    if (!booking || !email || booking.showtime.status !== 'CANCELLED') {
      return null;
    }
    return {
      bookingId: booking.id,
      email,
      movieTitle: booking.showtime.movie.title,
      startTime: booking.showtime.startTime,
      roomName: booking.showtime.room.name,
    };
  },
  getEmailData: async (deliveryId) => {
    const delivery = await prisma.emailDelivery.findUnique({
      where: { id: deliveryId },
      select: {
        id: true,
        booking: {
          select: {
            id: true,
            guestEmail: true,
            ticketTokenHash: true,
            status: true,
            showtime: {
              select: {
                startTime: true,
                movie: { select: { title: true } },
                room: { select: { name: true } },
              },
            },
            seats: {
              select: { rowNumber: true, seatNumber: true },
              orderBy: [{ rowNumber: 'asc' }, { seatNumber: 'asc' }],
            },
          },
        },
      },
    });
    if (
      !delivery ||
      delivery.booking.status !== 'CONFIRMED' ||
      !delivery.booking.guestEmail ||
      !delivery.booking.ticketTokenHash
    ) {
      return null;
    }

    return {
      deliveryId: delivery.id,
      bookingId: delivery.booking.id,
      email: delivery.booking.guestEmail,
      ticketTokenHash: delivery.booking.ticketTokenHash,
      movieTitle: delivery.booking.showtime.movie.title,
      startTime: delivery.booking.showtime.startTime,
      roomName: delivery.booking.showtime.room.name,
      seats: delivery.booking.seats,
    };
  },
  markSent: async (deliveryId, now) => {
    await prisma.emailDelivery.update({
      where: { id: deliveryId, status: 'SENDING' },
      data: {
        status: 'SENT',
        sentAt: now,
        lockedUntil: null,
        lastError: null,
      },
    });
  },
  recordFailure: async (deliveryId, attempts, errorCode, now, retryable) => {
    const terminal = !retryable || attempts >= maxAttempts;
    const delayMs = Math.min(1000 * 2 ** Math.max(0, attempts - 1), 60_000);
    await prisma.emailDelivery.update({
      where: { id: deliveryId, status: 'SENDING' },
      data: {
        status: terminal ? 'FAILED' : 'PENDING',
        lockedUntil: null,
        nextAttemptAt: terminal ? now : new Date(now.getTime() + delayMs),
        lastError: errorCode,
      },
    });
  },
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character]!;
  });
}

function formatShowtime(date: Date) {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Europe/Paris',
  }).format(date);
}

function ticketEmailContent(data: TicketEmailData) {
  const seats = data.seats
    .map(({ rowNumber, seatNumber }) => `${rowNumber}-${seatNumber}`)
    .join(', ');
  const date = formatShowtime(data.startTime);
  const title = escapeHtml(data.movieTitle);
  const room = escapeHtml(data.roomName);
  const escapedSeats = escapeHtml(seats);
  const reference = escapeHtml(data.bookingId);
  return {
    subject: `Votre billet pour ${data.movieTitle}`,
    text: [
      'Votre réservation est confirmée.',
      `Référence : ${data.bookingId}`,
      `Film : ${data.movieTitle}`,
      `Séance : ${date}`,
      `Salle : ${data.roomName}`,
      `Sièges : ${seats}`,
      `Nombre de places : ${data.seats.length}`,
    ].join('\n'),
    html: `<main style="font-family:Arial,sans-serif;color:#202124;max-width:600px;margin:auto">
      <h1>Votre réservation est confirmée</h1>
      <p>Présentez ce billet à l’entrée. Le QR code est valable pour l’ensemble du groupe et ne peut être utilisé qu’une seule fois.</p>
      <img src="cid:reservation-qr" alt="QR code du billet" width="240" height="240" />
      <dl>
        <dt>Référence</dt><dd>${reference}</dd>
        <dt>Film</dt><dd>${title}</dd>
        <dt>Séance</dt><dd>${escapeHtml(date)}</dd>
        <dt>Salle</dt><dd>${room}</dd>
        <dt>Sièges</dt><dd>${escapedSeats}</dd>
        <dt>Nombre de places</dt><dd>${data.seats.length}</dd>
      </dl>
    </main>`,
  };
}

function cancellationEmailContent(data: CancellationEmailData) {
  const date = formatShowtime(data.startTime);
  return {
    subject: `Séance annulée : ${data.movieTitle}`,
    text: [
      'Nous sommes désolés : votre séance a été annulée.',
      `Référence : ${data.bookingId}`,
      `Film : ${data.movieTitle}`,
      `Séance : ${date}`,
      `Salle : ${data.roomName}`,
      'Votre billet n’est plus valable. Le remboursement sera traité par notre équipe.',
    ].join('\n'),
    html: `<main style="font-family:Arial,sans-serif;color:#202124;max-width:600px;margin:auto">
      <h1>Votre séance a été annulée</h1>
      <p>Votre billet n’est plus valable. Le remboursement sera traité par notre équipe.</p>
      <dl>
        <dt>Référence</dt><dd>${escapeHtml(data.bookingId)}</dd>
        <dt>Film</dt><dd>${escapeHtml(data.movieTitle)}</dd>
        <dt>Séance</dt><dd>${escapeHtml(date)}</dd>
        <dt>Salle</dt><dd>${escapeHtml(data.roomName)}</dd>
      </dl>
    </main>`,
  };
}

function createResendSender(): TicketEmailSender {
  return {
    async send(input) {
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey?.startsWith('re_')) {
        throw new Error('RESEND_NOT_CONFIGURED');
      }
      if (!input.from) {
        throw new Error('EMAIL_FROM_NOT_CONFIGURED');
      }

      const resend = new Resend(apiKey);
      const { error } = await resend.emails.send(
        {
          from: input.from,
          to: input.to,
          subject: input.subject,
          html: input.html,
          text: input.text,
          attachments: input.qrImage
            ? [
                {
                  filename: 'billet-qr.png',
                  content: input.qrImage,
                  contentType: 'image/png',
                  contentId: 'reservation-qr',
                },
              ]
            : undefined,
        },
        { idempotencyKey: input.idempotencyKey },
      );
      if (error) {
        throw new Error('RESEND_REQUEST_FAILED');
      }
    },
  };
}

export function createTicketEmailWorker(
  repository: TicketEmailRepository = prismaTicketEmailRepository,
  sender: TicketEmailSender = createResendSender(),
  tokenSecret = process.env.TICKET_TOKEN_SECRET,
  qrEncoder: (token: string) => Promise<Buffer> = (token) =>
    QRCode.toBuffer(token, { type: 'png', errorCorrectionLevel: 'M' }),
) {
  return {
    async processNext(now = new Date()) {
      const delivery = await repository.claimNext(now);
      if (!delivery) {
        return false;
      }

      try {
        if (delivery.kind === 'SHOWTIME_CANCELLED') {
          const notice = await repository.getCancellationData?.(delivery.id);
          if (!notice) {
            await repository.recordFailure(
              delivery.id,
              delivery.attempts,
              'NOTICE_DATA_UNAVAILABLE',
              now,
              false,
            );
            return true;
          }
          await sender.send({
            to: notice.email,
            from: process.env.EMAIL_FROM ?? '',
            ...cancellationEmailContent(notice),
            idempotencyKey: delivery.id,
          });
          await repository.markSent(delivery.id, now);
          return true;
        }
        if (!tokenSecret || tokenSecret.length < 32) {
          throw new Error('TICKET_TOKEN_SECRET_NOT_CONFIGURED');
        }
        const data = await repository.getEmailData(delivery.id);
        if (!data) {
          await repository.recordFailure(
            delivery.id,
            delivery.attempts,
            'TICKET_DATA_UNAVAILABLE',
            now,
            false,
          );
          return true;
        }

        const token = createTicketToken(data.bookingId, tokenSecret);
        if (hashTicketToken(token) !== data.ticketTokenHash) {
          await repository.recordFailure(
            delivery.id,
            delivery.attempts,
            'TICKET_TOKEN_MISMATCH',
            now,
            false,
          );
          return true;
        }
        const qrImage = await qrEncoder(token);
        const content = ticketEmailContent(data);
        await sender.send({
          to: data.email,
          from: process.env.EMAIL_FROM ?? '',
          ...content,
          qrImage,
          idempotencyKey: delivery.id,
        });
        await repository.markSent(delivery.id, now);
      } catch (error) {
        const errorCode =
          error instanceof Error &&
          error.message === 'TICKET_TOKEN_SECRET_NOT_CONFIGURED'
            ? 'TICKET_TOKEN_SECRET_NOT_CONFIGURED'
            : error instanceof Error &&
                error.message === 'RESEND_NOT_CONFIGURED'
              ? 'RESEND_NOT_CONFIGURED'
              : error instanceof Error &&
                  error.message === 'EMAIL_FROM_NOT_CONFIGURED'
                ? 'EMAIL_FROM_NOT_CONFIGURED'
                : 'EMAIL_DELIVERY_FAILED';
        const retryable =
          errorCode === 'EMAIL_DELIVERY_FAILED' ||
          errorCode === 'RESEND_NOT_CONFIGURED' ||
          errorCode === 'EMAIL_FROM_NOT_CONFIGURED' ||
          errorCode === 'TICKET_TOKEN_SECRET_NOT_CONFIGURED';
        await repository.recordFailure(
          delivery.id,
          delivery.attempts,
          errorCode,
          now,
          retryable,
        );
        console.error('Ticket email delivery failed.', {
          deliveryId: delivery.id,
          attempt: delivery.attempts,
          errorCode,
        });
      }
      return true;
    },
  };
}

export function startTicketEmailWorker(
  worker = createTicketEmailWorker(),
  pollIntervalMs = 1000,
) {
  let stopped = false;
  let processing: Promise<void> | null = null;

  const poll = () => {
    if (stopped || processing) {
      return;
    }
    processing = (async () => {
      while (!stopped && (await worker.processNext())) {
        continue;
      }
    })()
      .catch((error: unknown) => {
        console.error('Ticket email queue processing failed.', error);
      })
      .finally(() => {
        processing = null;
      });
  };

  const timer = setInterval(poll, pollIntervalMs);
  poll();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await processing;
  };
}

export type TicketEmailDeliveryStatus = EmailDeliveryStatus;
