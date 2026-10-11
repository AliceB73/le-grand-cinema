import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import { Genre } from '@prisma/client';
import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from './docs/openapi.js';
import { getUpcomingProgramme } from './programme/programme.service.js';
import {
  createTemporarySeatHold,
  getSeatMap,
  SeatUnavailableError,
  type SeatHoldResult,
  type SeatMap,
} from './seats/seat.service.js';

const programmeItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  genre: z.nativeEnum(Genre),
  genreLabel: z.string(),
  duration: z.number().int().positive(),
  posterUrl: z.string().nullable(),
  roomName: z.string(),
  occupancyStatus: z.enum(['AVAILABLE', 'LAST_SEATS', 'FULL']),
  startTime: z.string().datetime(),
});

const programmeProviderSchema = z.array(programmeItemSchema);
const seatSessionTokenSchema = z.string().uuid();
const showtimeIdSchema = z.string().min(1).max(120);
const holdRequestSchema = z.object({
  seatIds: z
    .array(z.string().min(1).max(120))
    .min(1)
    .max(300)
    .refine((seatIds) => new Set(seatIds).size === seatIds.length),
});

type ProgrammeProvider = () => ReturnType<typeof getUpcomingProgramme>;
export interface SeatService {
  getSeatMap(showtimeId: string, sessionToken: string): Promise<SeatMap | null>;
  createTemporarySeatHold(
    showtimeId: string,
    seatIds: string[],
    sessionToken: string,
  ): Promise<SeatHoldResult | null>;
}

const defaultSeatService: SeatService = {
  getSeatMap,
  createTemporarySeatHold,
};

export function createApp(
  programmeProvider: ProgrammeProvider = () => getUpcomingProgramme(),
  seatService: SeatService = defaultSeatService,
) {
  const app = express();

  app.use(express.json());
  app.use(
    cors({
      origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    }),
  );
  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' });
  });
  app.get('/api/programme', async (_request, response, next) => {
    try {
      const programme = await programmeProvider();
      response.json(programmeProviderSchema.parse(programme));
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/showtimes/:showtimeId/seats', async (request, response) => {
    const showtimeId = showtimeIdSchema.safeParse(request.params.showtimeId);
    const sessionToken = seatSessionTokenSchema.safeParse(
      request.get('x-seat-session-token'),
    );

    if (!showtimeId.success || !sessionToken.success) {
      response.status(400).json({
        error: 'INVALID_SEAT_MAP_REQUEST',
        message: 'La demande de plan de salle est invalide.',
      });
      return;
    }

    try {
      const seatMap = await seatService.getSeatMap(
        showtimeId.data,
        sessionToken.data,
      );

      if (!seatMap) {
        response.status(404).json({
          error: 'SHOWTIME_NOT_FOUND',
          message: 'Cette séance n’existe pas.',
        });
        return;
      }

      response.json(seatMap);
    } catch (error) {
      console.error('Failed to serve the seat map.', error);
      response.status(500).json({
        error: 'SEAT_MAP_UNAVAILABLE',
        message: 'Le plan de salle est momentanément indisponible.',
      });
    }
  });
  app.post(
    '/api/showtimes/:showtimeId/seats/holds',
    async (request, response) => {
      const showtimeId = showtimeIdSchema.safeParse(request.params.showtimeId);
      const sessionToken = seatSessionTokenSchema.safeParse(
        request.get('x-seat-session-token'),
      );
      const body = holdRequestSchema.safeParse(request.body);

      if (!showtimeId.success || !sessionToken.success || !body.success) {
        response.status(400).json({
          error: 'INVALID_SEAT_HOLD_REQUEST',
          message: 'La demande de réservation temporaire est invalide.',
        });
        return;
      }

      try {
        const hold = await seatService.createTemporarySeatHold(
          showtimeId.data,
          body.data.seatIds,
          sessionToken.data,
        );

        if (!hold) {
          response.status(404).json({
            error: 'SHOWTIME_NOT_FOUND',
            message: 'Cette séance n’existe pas.',
          });
          return;
        }

        response.status(201).json(hold);
      } catch (error) {
        if (error instanceof SeatUnavailableError) {
          response.status(409).json({
            error: 'SEATS_UNAVAILABLE',
            message:
              'Un ou plusieurs sièges ne sont plus disponibles. Actualisez le plan et choisissez à nouveau.',
          });
          return;
        }

        console.error('Failed to create a temporary seat hold.', error);
        response.status(500).json({
          error: 'SEAT_HOLD_UNAVAILABLE',
          message: 'La réservation temporaire est momentanément indisponible.',
        });
      }
    },
  );
  app.get('/api/openapi.json', (_request, response) => {
    response.json(openApiDocument);
  });
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));
  app.use(
    (
      error: Error,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      void _next;
      console.error('Failed to serve the public programme.', error);
      response.status(500).json({
        error: 'PROGRAMME_UNAVAILABLE',
        message: 'La programmation est momentanément indisponible.',
      });
    },
  );

  return app;
}
