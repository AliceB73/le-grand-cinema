import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import { Genre } from '@prisma/client';
import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from './docs/openapi.js';
import { getUpcomingProgramme } from './programme/programme.service.js';

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

type ProgrammeProvider = () => ReturnType<typeof getUpcomingProgramme>;

export function createApp(
  programmeProvider: ProgrammeProvider = () => getUpcomingProgramme(),
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
