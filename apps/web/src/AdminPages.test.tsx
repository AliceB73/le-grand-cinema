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

jest.mock('./admin-api', () => ({
  ...(jest.requireActual('./admin-api') as object),
  checkAdminAccess: jest.fn(),
  listShowtimes: jest.fn(),
  listMovies: jest.fn(),
  listRooms: jest.fn(),
  createShowtime: jest.fn(),
  cancelShowtime: jest.fn(),
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
        { name: 'Salle A', category: 'STANDARD', capacity: 180 },
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
