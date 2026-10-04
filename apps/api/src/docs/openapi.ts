import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

const registry = new OpenAPIRegistry();

registry.registerPath({
  method: 'get',
  path: '/api/health',
  summary: 'Vérifier la disponibilité de l’API',
  responses: {
    200: {
      description: 'API disponible',
      content: {
        'application/json': {
          schema: z.object({ status: z.literal('ok') }),
        },
      },
    },
  },
});

const generator = new OpenApiGeneratorV3(registry.definitions);

export const openApiDocument = generator.generateDocument({
  openapi: '3.0.0',
  info: {
    title: 'Le Grand Cinéma API',
    version: '1.0.0',
    description: 'API de réservation du cinéma.',
  },
  servers: [
    { url: 'http://localhost:3000', description: 'Développement local' },
  ],
});
