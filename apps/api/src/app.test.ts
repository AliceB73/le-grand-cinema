import { describe, expect, it, jest } from '@jest/globals';
import { Genre } from '@prisma/client';
import request from 'supertest';
import { createApp } from './app.js';
import * as programmeService from './programme/programme.service.js';

describe('API baseline', () => {
  it('returns a healthy status', async () => {
    const response = await request(createApp()).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('publishes the OpenAPI document', async () => {
    const response = await request(createApp()).get('/api/openapi.json');

    expect(response.status).toBe(200);
    expect(response.body.openapi).toBe('3.0.0');
    expect(response.body.paths['/api/health']).toBeDefined();
    expect(response.body.paths['/api/programme']).toBeDefined();
  });

  it('returns the validated public programme', async () => {
    const app = createApp(async () => [
      {
        id: 'screening-1',
        title: 'Les Veilleurs du Phare',
        genre: Genre.THRILLER,
        genreLabel: 'Thriller',
        duration: 108,
        posterUrl: '/posters/veilleurs-du-phare.svg',
        roomName: 'Salle A',
        startTime: '2026-10-04T15:00:00.000Z',
      },
    ]);

    const response = await request(app).get('/api/programme');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      title: 'Les Veilleurs du Phare',
      genre: 'THRILLER',
      genreLabel: 'Thriller',
      roomName: 'Salle A',
    });
  });

  it('uses the default programme provider', async () => {
    const getUpcomingProgramme = jest
      .spyOn(programmeService, 'getUpcomingProgramme')
      .mockResolvedValue([]);

    const response = await request(createApp()).get('/api/programme');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(getUpcomingProgramme).toHaveBeenCalled();
    getUpcomingProgramme.mockRestore();
  });

  it('returns an explicit error and logs when programme retrieval fails', async () => {
    const logError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const app = createApp(async () => {
      throw new Error('database unavailable');
    });

    const response = await request(app).get('/api/programme');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'PROGRAMME_UNAVAILABLE',
      message: 'La programmation est momentanément indisponible.',
    });
    expect(logError).toHaveBeenCalled();
    logError.mockRestore();
  });
});
