import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AdminLayout from './AdminLayout';
import AdminShowtimesPage from './AdminShowtimesPage';
import { AuthSessionProvider } from './AuthSessionProvider';
import * as api from './admin-api';
import { supabase } from './supabase-client';

const roomFixture = {
  name: 'Salle A',
  category: 'STANDARD',
  capacity: 180,
  rows: 12,
  columns: 15,
  defaultPrice: 9.5,
};

jest.mock('./admin-api', () => ({
  ...(jest.requireActual('./admin-api') as object),
  checkAdminAccess: jest.fn(),
  listShowtimes: jest.fn(),
  listMovies: jest.fn(),
  listRooms: jest.fn(),
  createShowtime: jest.fn(),
  cancelShowtime: jest.fn(),
  updateShowtimePrice: jest.fn(),
}));

function signIn() {
  jest.mocked(supabase!.auth.getSession).mockResolvedValue({
    data: {
      session: { access_token: 'tok', user: { email: 'admin@example.com' } },
    },
    error: null,
  } as never);
}

function renderAdmin(path = '/admin/seances') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthSessionProvider>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route path="seances" element={<AdminShowtimesPage />} />
          </Route>
          <Route path="/connexion" element={<p>Page de connexion</p>} />
        </Routes>
      </AuthSessionProvider>
    </MemoryRouter>,
  );
}

const showtime = (overrides: Partial<api.AdminShowtime> = {}) => ({
  id: 's1',
  movieId: 'm1',
  movieTitle: 'Film A',
  roomName: 'Salle A',
  startTime: '2027-01-01T18:00:00.000Z',
  endTime: '2027-01-01T19:48:00.000Z',
  price: 9.5,
  status: 'SCHEDULED' as const,
  confirmedBookings: 2,
  ...overrides,
});

describe('admin area', () => {
  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
    jest.mocked(supabase!.auth.getSession).mockResolvedValue({
      data: { session: null },
      error: null,
    } as never);
  });

  it('redirects visitors to the sign-in page', async () => {
    renderAdmin();
    expect(await screen.findByText('Page de connexion')).toBeTruthy();
    expect(api.checkAdminAccess).not.toHaveBeenCalled();
  });

  it('refuses non-admin accounts', async () => {
    signIn();
    jest
      .mocked(api.checkAdminAccess)
      .mockRejectedValue(new api.AdminApiError(403, null));
    renderAdmin();
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'L’espace d’administration est réservé aux administrateurs.',
    );
    expect(api.listShowtimes).not.toHaveBeenCalled();
  });

  it('lists showtimes and shows the overlap message from the API', async () => {
    signIn();
    jest.mocked(api.checkAdminAccess).mockResolvedValue(undefined);
    jest.mocked(api.listShowtimes).mockResolvedValue([showtime()]);
    jest.mocked(api.listMovies).mockResolvedValue([
      {
        id: 'm1',
        title: 'Film A',
        genre: 'DRAME',
        description: 'd',
        duration: 108,
        posterUrl: null,
      },
    ]);
    jest
      .mocked(api.listRooms)
      .mockResolvedValue([
        { ...roomFixture },
      ]);
    jest
      .mocked(api.createShowtime)
      .mockRejectedValue(
        new api.AdminApiError(409, 'Cette salle est déjà occupée par « X ».'),
      );
    renderAdmin();

    expect(await screen.findByRole('cell', { name: 'Film A' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Film'), {
      target: { value: 'm1' },
    });
    fireEvent.change(screen.getByLabelText('Salle'), {
      target: { value: 'Salle A' },
    });
    fireEvent.change(screen.getByLabelText('Date et horaire'), {
      target: { value: '2027-02-01T18:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Créer la séance' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'Cette salle est déjà occupée par « X ».',
      ),
    );
  });

  function arrange(showtimes: api.AdminShowtime[]) {
    signIn();
    jest.mocked(api.checkAdminAccess).mockResolvedValue(undefined);
    jest.mocked(api.listShowtimes).mockResolvedValue(showtimes);
    jest.mocked(api.listMovies).mockResolvedValue([
      {
        id: 'm1',
        title: 'Film A',
        genre: 'DRAME',
        description: 'd',
        duration: 108,
        posterUrl: null,
      },
    ]);
    jest
      .mocked(api.listRooms)
      .mockResolvedValue([
        { ...roomFixture },
      ]);
  }

  it('shows an error when showtimes cannot be loaded', async () => {
    arrange([]);
    jest.mocked(api.listShowtimes).mockRejectedValue(new Error('boom'));
    renderAdmin();
    expect(
      await screen.findByText('Impossible de charger les séances.'),
    ).toBeTruthy();
  });

  it('validates the creation form before calling the API', async () => {
    arrange([]);
    renderAdmin();
    await screen.findByRole('button', { name: 'Créer la séance' });
    fireEvent.click(screen.getByRole('button', { name: 'Créer la séance' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Renseignez le film',
    );
    expect(api.createShowtime).not.toHaveBeenCalled();
  });

  it('creates a showtime', async () => {
    arrange([]);
    jest.mocked(api.createShowtime).mockResolvedValue(showtime());
    renderAdmin();
    await screen.findByText('Aucune séance programmée.');
    fireEvent.change(screen.getByLabelText('Film'), {
      target: { value: 'm1' },
    });
    fireEvent.change(screen.getByLabelText('Salle'), {
      target: { value: 'Salle A' },
    });
    fireEvent.change(screen.getByLabelText('Date et horaire'), {
      target: { value: '2027-02-01T18:00' },
    });
    fireEvent.change(screen.getByLabelText(/^Prix \(€\), vide/), {
      target: { value: '10' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Créer la séance' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('Séance créée.'),
    );
    expect(api.createShowtime).toHaveBeenCalledWith(
      expect.objectContaining({ movieId: 'm1', roomId: 'Salle A', price: 10 }),
    );
  });

  it('updates the price of a showtime', async () => {
    arrange([showtime()]);
    jest.mocked(api.updateShowtimePrice).mockResolvedValue(showtime());
    renderAdmin();
    const input = await screen.findByLabelText(/Prix en euros pour Film A/);
    fireEvent.change(input, { target: { value: '12,5' } });
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer/ }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('Prix mis à jour.'),
    );
    expect(api.updateShowtimePrice).toHaveBeenCalledWith('s1', 12.5);
  });

  it('rejects an invalid price and reports API failures', async () => {
    arrange([showtime()]);
    jest
      .mocked(api.updateShowtimePrice)
      .mockRejectedValue(new api.AdminApiError(409, 'Séance annulée.'));
    renderAdmin();
    const input = await screen.findByLabelText(/Prix en euros pour Film A/);
    fireEvent.change(input, { target: { value: '-3' } });
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer/ }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Le prix doit être un nombre positif.',
    );
    expect(api.updateShowtimePrice).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '11' } });
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer/ }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Séance annulée.'),
    );
  });

  it('does not cancel when the confirmation is declined', async () => {
    arrange([showtime()]);
    jest.spyOn(window, 'confirm').mockReturnValue(false);
    renderAdmin();
    fireEvent.click(
      await screen.findByRole('button', { name: /Annuler la séance Film A/ }),
    );
    expect(api.cancelShowtime).not.toHaveBeenCalled();
  });

  it('reports a failed cancellation', async () => {
    arrange([showtime({ confirmedBookings: 0 })]);
    jest
      .mocked(api.cancelShowtime)
      .mockRejectedValue(new api.AdminApiError(500, null));
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    renderAdmin();
    fireEvent.click(
      await screen.findByRole('button', { name: /Annuler la séance Film A/ }),
    );
    expect((await screen.findByRole('alert')).textContent).toContain('échoué');
  });

  it('marks cancelled showtimes as read-only', async () => {
    arrange([showtime({ status: 'CANCELLED' })]);
    renderAdmin();
    expect(await screen.findByText('Annulée')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Enregistrer/ })).toBeNull();
  });

  it('cancels a showtime after confirmation', async () => {
    signIn();
    jest.mocked(api.checkAdminAccess).mockResolvedValue(undefined);
    jest.mocked(api.listShowtimes).mockResolvedValue([showtime()]);
    jest.mocked(api.listMovies).mockResolvedValue([]);
    jest.mocked(api.listRooms).mockResolvedValue([]);
    jest.mocked(api.cancelShowtime).mockResolvedValue({
      showtime: showtime({ status: 'CANCELLED' }),
      notifiedBookings: 2,
    });
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    renderAdmin();

    fireEvent.click(
      await screen.findByRole('button', { name: /Annuler la séance Film A/ }),
    );

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain(
        '2 spectateur(s) notifié(s)',
      ),
    );
    expect(api.cancelShowtime).toHaveBeenCalledWith('s1');
  });
});
