import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AccountPage from './AccountPage';
import { AuthSessionProvider } from './AuthSessionProvider';
import * as api from './my-bookings-api';
import { supabase } from './supabase-client';

jest.mock('./my-bookings-api', () => ({
  ...(jest.requireActual('./my-bookings-api') as object),
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
          <Route path="/connexion" element={<p>Page de connexion</p>} />
        </Routes>
      </AuthSessionProvider>
    </MemoryRouter>,
  );
}

describe('AccountPage', () => {
  afterEach(() => {
    cleanup();
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
    jest
      .mocked(api.getMyBookings)
      .mockResolvedValue([
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
});
