import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, render, screen } from '@testing-library/react';
import App from './App';
import { getProgramme } from './programme-api';

jest.mock('./programme-api', () => ({
  getProgramme: jest.fn(),
}));

describe('App', () => {
  afterEach(() => {
    cleanup();
    jest.mocked(getProgramme).mockReset();
  });

  it('shows future screening cards with film and session details', async () => {
    jest.mocked(getProgramme).mockResolvedValue([
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
    ]);

    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'Les Veilleurs du Phare' }),
    ).toBeTruthy();
    expect(screen.getByText(/Thriller/)).toBeTruthy();
    expect(screen.getByText(/108\s*min/)).toBeTruthy();
    expect(screen.getByText('Salle A')).toBeTruthy();
    expect(
      screen.getByAltText('Affiche du film Les Veilleurs du Phare'),
    ).toBeTruthy();
  });

  it('shows an explicit empty-programme state', async () => {
    jest.mocked(getProgramme).mockResolvedValue([]);

    render(<App />);

    expect(
      await screen.findByText(
        'Aucune séance n’est programmée pour les sept prochains jours.',
      ),
    ).toBeTruthy();
  });

  it('shows an explicit error state and offers a retry', async () => {
    jest.mocked(getProgramme).mockRejectedValue(new Error('API unavailable'));

    render(<App />);

    expect((await screen.findByRole('alert')).textContent).toContain(
      'La programmation est momentanément indisponible.',
    );
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy();
  });
});
