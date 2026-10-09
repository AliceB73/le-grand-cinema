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
    expect(screen.getAllByText(/Thriller/)).toHaveLength(2);
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

  it('searches titles only after three characters and combines title, date, and genre filters', async () => {
    jest.mocked(getProgramme).mockResolvedValue([
      {
        id: 'jardin-1',
        title: 'Le Jardin des étoiles',
        genre: 'FANTASTIQUE',
        genreLabel: 'Fantastique',
        duration: 96,
        posterUrl: null,
        roomName: 'Salle A',
        startTime: '2026-10-04T15:00:00.000Z',
      },
      {
        id: 'jardin-2',
        title: 'Le Jardin des étoiles',
        genre: 'FANTASTIQUE',
        genreLabel: 'Fantastique',
        duration: 96,
        posterUrl: null,
        roomName: 'Salle A',
        startTime: '2026-10-05T15:00:00.000Z',
      },
      {
        id: 'veilleurs-1',
        title: 'Les Veilleurs du Phare',
        genre: 'THRILLER',
        genreLabel: 'Thriller',
        duration: 108,
        posterUrl: null,
        roomName: 'Salle B',
        startTime: '2026-10-04T17:00:00.000Z',
      },
    ]);

    render(<App />);
    expect(
      await screen.findAllByRole('heading', { name: 'Le Jardin des étoiles' }),
    ).toHaveLength(2);

    const titleSearch = screen.getByLabelText('Rechercher par titre');
    fireEvent.change(titleSearch, { target: { value: 'ja' } });
    expect(
      screen.getAllByRole('heading', { name: 'Le Jardin des étoiles' }),
    ).toHaveLength(2);
    expect(
      screen.getByRole('heading', { name: 'Les Veilleurs du Phare' }),
    ).toBeTruthy();

    fireEvent.change(titleSearch, { target: { value: 'jArD' } });
    fireEvent.change(screen.getByLabelText('Filtrer par date'), {
      target: { value: '2026-10-04' },
    });
    fireEvent.change(screen.getByLabelText('Filtrer par genre'), {
      target: { value: 'FANTASTIQUE' },
    });

    expect(
      screen.getAllByRole('heading', { name: 'Le Jardin des étoiles' }),
    ).toHaveLength(1);
    expect(
      screen.queryByRole('heading', { name: 'Les Veilleurs du Phare' }),
    ).toBeNull();
  });

  it('shows a no-results message and resets all filters', async () => {
    jest.mocked(getProgramme).mockResolvedValue([
      {
        id: 'jardin-1',
        title: 'Le Jardin des étoiles',
        genre: 'FANTASTIQUE',
        genreLabel: 'Fantastique',
        duration: 96,
        posterUrl: null,
        roomName: 'Salle A',
        startTime: '2026-10-04T15:00:00.000Z',
      },
      {
        id: 'veilleurs-1',
        title: 'Les Veilleurs du Phare',
        genre: 'THRILLER',
        genreLabel: 'Thriller',
        duration: 108,
        posterUrl: null,
        roomName: 'Salle B',
        startTime: '2026-10-04T17:00:00.000Z',
      },
    ]);

    render(<App />);
    await screen.findByRole('heading', { name: 'Le Jardin des étoiles' });
    fireEvent.change(screen.getByLabelText('Rechercher par titre'), {
      target: { value: 'Film introuvable' },
    });

    expect(
      screen.getByText('Aucune séance ne correspond à vos critères.'),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Réinitialiser les filtres' }),
    );

    expect(
      screen.getAllByRole('heading', { name: 'Le Jardin des étoiles' }),
    ).toHaveLength(1);
    expect(
      screen.getByRole('heading', { name: 'Les Veilleurs du Phare' }),
    ).toBeTruthy();
    expect(screen.getByLabelText('Rechercher par titre')).toHaveProperty(
      'value',
      '',
    );
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
