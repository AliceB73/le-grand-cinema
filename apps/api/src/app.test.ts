import { describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { createApp } from './app.js';

describe('API baseline', () => {
  const app = createApp();

  it('returns a healthy status', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('publishes the OpenAPI document', async () => {
    const response = await request(app).get('/api/openapi.json');

    expect(response.status).toBe(200);
    expect(response.body.openapi).toBe('3.0.0');
    expect(response.body.paths['/api/health']).toBeDefined();
  });
});
