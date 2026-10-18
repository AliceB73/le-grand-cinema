import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import AccountPage from './AccountPage';
import { AuthSessionProvider } from './AuthSessionProvider';
import * as api from './my-bookings-api';
import { supabase } from './supabase-client';

jest.mock('./my-bookings-api', () => ({
  ...(jest.requireActual('./my-bookings-api') as object),
  deleteMyAccount: jest.fn(),
  getMyBookings: jest.fn(),
  getMyTicket: jest.fn(),
}));

const booking = (overrides: Partial<api.CustomerBooking> = {}) => ({
  id: 'b1',
  movieTitle: 'Film A',
  roomName: 'Salle 1',
  startTime: '2026-10-20T18:00:00.000Z',
  seats: [{ rowNumber: 'A', seatNumber: 1 }],
  seatCount: 1,
  used: false,
  isUpcoming: true,
  ...overrides,
});

function signIn() {
  jest.mocked(supabase!.auth.getSession).mockResolvedValue({
    data: {
      session: { access_token: 'tok', user: { email: 'alice@example.com' } },
    },
    error: null,
  } as never);
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/mon-espace']}>
      <AuthSessionProvider>
        <Routes>
          <Route path="/mon-espace" element={<AccountPage />} />
          <Route
            path="/connexion"
            element={
              <>
                <p>Page de connexion</p>
                <ConnectionSearch />
              </>
            }
          />
        </Routes>
      </AuthSessionProvider>
    </MemoryRouter>,
  );
}

function ConnectionSearch() {
  const location = useLocation();
  return <p>{location.search}</p>;
}

describe('AccountPage', () => {
  afterEach(() => {
    cleanup();
    jest.mocked(api.deleteMyAccount).mockReset();
    jest.mocked(supabase!.auth.signOut).mockReset();
    jest.mocked(supabase!.auth.getSession).mockResolvedValue({
      data: { session: null },
      error: null,
    } as never);
  });

  it('redirects visitors to the sign-in page', async () => {
    renderPage();
    expect(await screen.findByText('Page de connexion')).toBeTruthy();
  });

  it('lists upcoming and past bookings with the used badge', async () => {
    signIn();
    jest.mocked(api.getMyBookings).mockResolvedValue([
      booking(),
      booking({
        id: 'b2',
        movieTitle: 'Film B',
        isUpcoming: false,
        used: true,
      }),
    ]);

    renderPage();

    expect(await screen.findByText('Film A')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'À venir' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Passées' })).toBeTruthy();
    expect(screen.getByText('Utilisé')).toBeTruthy();
    expect(api.getMyBookings).toHaveBeenCalledWith('tok');
  });

  it('shows the QR code on demand', async () => {
    signIn();
    jest.mocked(api.getMyBookings).mockResolvedValue([booking()]);
    jest.mocked(api.getMyTicket).mockResolvedValue({
      qrCodeDataUrl: 'data:image/png;base64,AAA',
      used: false,
    });

    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: /Afficher le billet/ }),
    );

    const image = await screen.findByAltText(/QR code du billet/);
    expect(image.getAttribute('src')).toBe('data:image/png;base64,AAA');
    expect(api.getMyTicket).toHaveBeenCalledWith('b1', 'tok');
  });

  it('hides the QR code again and reports ticket errors', async () => {
    signIn();
    jest.mocked(api.getMyBookings).mockResolvedValue([booking()]);
    jest
      .mocked(api.getMyTicket)
      .mockRejectedValueOnce(new api.CustomerApiError(500))
      .mockResolvedValueOnce({
        qrCodeDataUrl: 'data:image/png;base64,AAA',
        used: false,
      });

    renderPage();
    const button = await screen.findByRole('button', {
      name: /Afficher le billet/,
    });
    fireEvent.click(button);
    expect((await screen.findByRole('alert')).textContent).toContain(
      'billet est momentanément indisponible',
    );

    fireEvent.click(button);
    await screen.findByAltText(/QR code du billet/);
    fireEvent.click(screen.getByRole('button', { name: /Masquer le billet/ }));
    expect(screen.queryByAltText(/QR code du billet/)).toBeNull();
  });

  it('pluralises seats and reports a generic load error', async () => {
    signIn();
    jest.mocked(api.getMyBookings).mockResolvedValueOnce([
      booking({
        seatCount: 2,
        seats: [
          { rowNumber: 'A', seatNumber: 1 },
          { rowNumber: 'A', seatNumber: 2 },
        ],
      }),
    ]);
    renderPage();
    expect(await screen.findByText(/2 places : A1, A2/)).toBeTruthy();
    cleanup();

    jest.mocked(api.getMyBookings).mockRejectedValueOnce(new Error('offline'));
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toContain(
      'momentanément indisponibles',
    );
  });

  it('shows an empty state and explicit errors', async () => {
    signIn();
    jest.mocked(api.getMyBookings).mockResolvedValueOnce([]);
    renderPage();
    expect(
      await screen.findByText(/pas encore de réservation confirmée/),
    ).toBeTruthy();
    cleanup();

    jest
      .mocked(api.getMyBookings)
      .mockRejectedValueOnce(new api.CustomerApiError(403));
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toContain(
      'réservé aux comptes spectateurs',
    );
  });

  it('confirms deletion, clears the local session and returns to sign in', async () => {
    signIn();
    jest.mocked(api.getMyBookings).mockResolvedValue([]);
    jest.mocked(api.deleteMyAccount).mockResolvedValue();
    jest.mocked(supabase!.auth.signOut).mockResolvedValue({
      error: null,
    } as never);

    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Supprimer mon compte' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirmer la suppression' }),
    );

    expect(await screen.findByText('Page de connexion')).toBeTruthy();
    expect(api.deleteMyAccount).toHaveBeenCalledWith('tok');
    expect(supabase!.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('allows the user to cancel account deletion', async () => {
    signIn();
    jest.mocked(api.getMyBookings).mockResolvedValue([]);

    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Supprimer mon compte' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));

    expect(
      screen.queryByRole('button', { name: 'Confirmer la suppression' }),
    ).toBeNull();
    expect(api.deleteMyAccount).not.toHaveBeenCalled();
  });

  it('keeps the confirmation open and reports a deletion failure', async () => {
    signIn();
    jest.mocked(api.getMyBookings).mockResolvedValue([]);
    jest
      .mocked(api.deleteMyAccount)
      .mockRejectedValue(new api.CustomerApiError(503));

    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Supprimer mon compte' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirmer la suppression' }),
    );

    expect(
      await screen.findByText(/suppression du compte n’a pas pu aboutir/),
    ).toBeTruthy();
    expect(supabase!.auth.signOut).not.toHaveBeenCalled();
  });

  it('navigates to sign in with an explicit message if session cleanup fails', async () => {
    signIn();
    jest.mocked(api.getMyBookings).mockResolvedValue([]);
    jest.mocked(api.deleteMyAccount).mockResolvedValue();
    jest.mocked(supabase!.auth.signOut).mockResolvedValue({
      error: new Error('offline'),
    } as never);

    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Supprimer mon compte' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirmer la suppression' }),
    );

    expect(await screen.findByText('Page de connexion')).toBeTruthy();
    expect(
      screen.getByText('?accountDeleted=1&sessionCleanupFailed=1'),
    ).toBeTruthy();
  });

  it('asks the user to reconnect when deletion reports an expired session', async () => {
    signIn();
    jest.mocked(api.getMyBookings).mockResolvedValue([]);
    jest
      .mocked(api.deleteMyAccount)
      .mockRejectedValue(new api.CustomerApiError(401));

    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Supprimer mon compte' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirmer la suppression' }),
    );

    expect(await screen.findByText(/session a expiré/)).toBeTruthy();
  });
});
