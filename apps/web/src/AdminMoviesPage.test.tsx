import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import AdminMoviesPage from './AdminMoviesPage';
import * as api from './admin-api';

jest.mock('./admin-api', () => ({
  ...(jest.requireActual('./admin-api') as object),
  listMovies: jest.fn(),
  createMovie: jest.fn(),
  updateMovie: jest.fn(),
  deleteMovie: jest.fn(),
}));

const movie = {
  id: 'm1',
  title: 'Film A',
  genre: 'DRAME',
  description: 'Une description',
  duration: 108,
  posterUrl: null,
};

function fillForm(duration = '95') {
  fireEvent.change(screen.getByLabelText('Titre'), {
    target: { value: ' Film B ' },
  });
  fireEvent.change(screen.getByLabelText('Description'), {
    target: { value: 'Synopsis' },
  });
  fireEvent.change(screen.getByLabelText('Durée (minutes)'), {
    target: { value: duration },
  });
}

describe('AdminMoviesPage', () => {
  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  it('shows an error when the movies cannot be loaded', async () => {
    jest.mocked(api.listMovies).mockRejectedValue(new Error('boom'));
    render(<AdminMoviesPage />);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Impossible de charger les films.',
    );
  });

  it('shows an empty state', async () => {
    jest.mocked(api.listMovies).mockResolvedValue([]);
    render(<AdminMoviesPage />);
    expect(await screen.findByText('Aucun film.')).toBeTruthy();
  });

  it('rejects an invalid duration without calling the API', async () => {
    jest.mocked(api.listMovies).mockResolvedValue([]);
    render(<AdminMoviesPage />);
    await screen.findByText('Aucun film.');
    fillForm('0');
    fireEvent.click(screen.getByRole('button', { name: 'Créer le film' }));
    expect((await screen.findByRole('alert')).textContent).toContain('1 à 600');
    expect(api.createMovie).not.toHaveBeenCalled();
  });

  it('creates a movie', async () => {
    jest.mocked(api.listMovies).mockResolvedValue([]);
    jest.mocked(api.createMovie).mockResolvedValue(movie);
    render(<AdminMoviesPage />);
    await screen.findByText('Aucun film.');
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Créer le film' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('Film créé.'),
    );
    expect(api.createMovie).toHaveBeenCalledWith({
      title: 'Film B',
      genre: 'ACTION',
      description: 'Synopsis',
      duration: 95,
      posterUrl: null,
    });
  });

  it('edits then cancels the edition', async () => {
    jest.mocked(api.listMovies).mockResolvedValue([movie]);
    jest.mocked(api.updateMovie).mockResolvedValue(movie);
    render(<AdminMoviesPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Modifier/ }));
    expect((screen.getByLabelText('Titre') as HTMLInputElement).value).toBe(
      'Film A',
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Enregistrer le film' }),
    );
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('Film mis à jour.'),
    );
    expect(api.updateMovie).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ title: 'Film A', duration: 108 }),
    );

    fireEvent.click(screen.getByRole('button', { name: /Modifier/ }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Annuler la modification' }),
    );
    expect((screen.getByLabelText('Titre') as HTMLInputElement).value).toBe('');
  });

  it('shows the API error when creation fails', async () => {
    jest.mocked(api.listMovies).mockResolvedValue([]);
    jest
      .mocked(api.createMovie)
      .mockRejectedValue(new api.AdminApiError(400, 'Invalide.'));
    render(<AdminMoviesPage />);
    await screen.findByText('Aucun film.');
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Créer le film' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Invalide.');
  });

  it('deletes a movie after confirmation only', async () => {
    jest.mocked(api.listMovies).mockResolvedValue([movie]);
    jest.mocked(api.deleteMovie).mockResolvedValue(undefined);
    const confirm = jest.spyOn(window, 'confirm');
    render(<AdminMoviesPage />);
    const button = await screen.findByRole('button', { name: /Supprimer/ });

    confirm.mockReturnValue(false);
    fireEvent.click(button);
    expect(api.deleteMovie).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(button);
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('Film supprimé.'),
    );
    expect(api.deleteMovie).toHaveBeenCalledWith('m1');
  });

  it('reports a refused deletion', async () => {
    jest.mocked(api.listMovies).mockResolvedValue([movie]);
    jest
      .mocked(api.deleteMovie)
      .mockRejectedValue(new api.AdminApiError(409, 'Film programmé.'));
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    render(<AdminMoviesPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Supprimer/ }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Film programmé.',
    );
  });
});
