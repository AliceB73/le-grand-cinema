import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { getProgramme, type ProgrammeFetcher } from './programme-api';

jest.mock('./api-config', () => ({
  apiBaseUrl: 'http://localhost:3000',
}));

const validProgramme = [
  {
    id: 'screening-1',
    title: 'Les Veilleurs du Phare',
    genre: 'THRILLER',
    genreLabel: 'Thriller',
    duration: 108,
    posterUrl: '/posters/veilleurs-du-phare.svg',
    roomName: 'Salle A',
    startTime: '2026-10-04T15:00:00.000Z',
  },
];

describe('getProgramme', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('requests and validates the public programme', async () => {
    const fetchMock = jest.fn<ProgrammeFetcher>().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => validProgramme,
    });
    const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
    });
    const controller = new AbortController();

    try {
      await expect(getProgramme(controller.signal)).resolves.toEqual(
        validProgramme,
      );
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/api/programme',
        { signal: controller.signal },
      );
    } finally {
      if (originalFetch) {
        Object.defineProperty(globalThis, 'fetch', originalFetch);
      } else {
        Reflect.deleteProperty(globalThis, 'fetch');
      }
    }
  });

  it('throws an explicit error for an unsuccessful response', async () => {
    const fetchMock = jest.fn<ProgrammeFetcher>().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => null,
    });

    await expect(getProgramme(undefined, fetchMock)).rejects.toThrow(
      'Programme request failed with status 503.',
    );
  });

  it('rejects a response that does not match the API contract', async () => {
    const fetchMock = jest.fn<ProgrammeFetcher>().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ ...validProgramme[0], duration: 0 }],
    });

    await expect(getProgramme(undefined, fetchMock)).rejects.toThrow();
  });
});
