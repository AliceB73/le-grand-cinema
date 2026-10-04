import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
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

  it('shows a placeholder when a screening has no poster', async () => {
    jest.mocked(getProgramme).mockResolvedValue([
      {
        id: 'screening-no-poster',
        title: 'Film sans affiche',
        genre: 'DRAME',
        genreLabel: 'Drame',
        duration: 90,
        posterUrl: null,
        roomName: 'Salle B',
        startTime: '2026-10-04T15:00:00.000Z',
      },
    ]);

    render(<App />);

    expect(
      await screen.findByRole('img', {
        name: 'Affiche indisponible pour Film sans affiche',
      }),
    ).toBeTruthy();
  });

  it('ignores request failures caused by unmounting', async () => {
    let rejectRequest: (error: Error) => void = () => {};
    jest.mocked(getProgramme).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectRequest = reject;
        }),
    );

    const { unmount } = render(<App />);
    unmount();

    const abortError = new Error('Request aborted');
    abortError.name = 'AbortError';
    await act(async () => {
      rejectRequest(abortError);
    });

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows an explicit error state and offers a retry', async () => {
    jest
      .mocked(getProgramme)
      .mockRejectedValueOnce(new Error('API unavailable'))
      .mockResolvedValueOnce([]);

    render(<App />);

    expect((await screen.findByRole('alert')).textContent).toContain(
      'La programmation est momentanément indisponible.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

    await waitFor(() => {
      expect(
        screen.getByText(
          'Aucune séance n’est programmée pour les sept prochains jours.',
        ),
      ).toBeTruthy();
    });
    expect(getProgramme).toHaveBeenCalledTimes(2);
  });
});
