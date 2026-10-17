import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SIGN_OUT_ERROR_MESSAGE } from './auth-messages';
import { AuthSessionProvider } from './AuthSessionProvider';
import SiteHeader from './SiteHeader';
import { supabase } from './supabase-client';

function renderHeader() {
  return render(
    <MemoryRouter>
      <AuthSessionProvider>
        <SiteHeader />
      </AuthSessionProvider>
    </MemoryRouter>,
  );
}

describe('SiteHeader', () => {
  afterEach(() => {
    cleanup();
    jest.mocked(supabase!.auth.getSession).mockReset();
    jest.mocked(supabase!.auth.signOut).mockReset();
    jest.mocked(supabase!.auth.onAuthStateChange).mockReset();
    jest.mocked(supabase!.auth.getSession).mockResolvedValue({
      data: { session: null },
      error: null,
    } as never);
    jest.mocked(supabase!.auth.onAuthStateChange).mockReturnValue({
      data: { subscription: { unsubscribe: jest.fn() } },
    } as never);
  });

  it('shows sign-in links when no session is present', async () => {
    renderHeader();

    expect(await screen.findByRole('link', { name: 'Connexion' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Inscription' })).toBeTruthy();
  });

  it('shows the account email and signs out', async () => {
    jest.mocked(supabase!.auth.getSession).mockResolvedValue({
      data: {
        session: { user: { email: 'alice@example.com' } },
      },
      error: null,
    } as never);
    jest.mocked(supabase!.auth.signOut).mockResolvedValue({
      error: null,
    } as never);

    renderHeader();

    expect(await screen.findByText('alice@example.com')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Déconnexion' }));

    await waitFor(() => {
      expect(supabase!.auth.signOut).toHaveBeenCalled();
    });
    expect(await screen.findByRole('link', { name: 'Connexion' })).toBeTruthy();
  });

  it('links to the customer area when signed in', async () => {
    jest.mocked(supabase!.auth.getSession).mockResolvedValue({
      data: { session: { user: { email: 'alice@example.com' } } },
      error: null,
    } as never);

    renderHeader();

    const link = await screen.findByRole('link', { name: 'Mes billets' });
    expect(link.getAttribute('href')).toBe('/mon-espace');
  });

  it('preserves the session and reports a failed sign-out', async () => {
    jest.mocked(supabase!.auth.getSession).mockResolvedValue({
      data: {
        session: { user: { email: 'alice@example.com' } },
      },
      error: null,
    } as never);
    jest.mocked(supabase!.auth.signOut).mockResolvedValue({
      error: new Error('offline'),
    } as never);

    renderHeader();

    expect(await screen.findByText('alice@example.com')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Déconnexion' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      SIGN_OUT_ERROR_MESSAGE,
    );
    expect(screen.getByText('alice@example.com')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Déconnexion' })).toBeTruthy();
  });

  it('preserves the session when sign-out rejects', async () => {
    jest.mocked(supabase!.auth.getSession).mockResolvedValue({
      data: {
        session: { user: { email: 'alice@example.com' } },
      },
      error: null,
    } as never);
    jest.mocked(supabase!.auth.signOut).mockRejectedValue(new Error('offline'));

    renderHeader();

    expect(await screen.findByText('alice@example.com')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Déconnexion' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('alice@example.com')).toBeTruthy();
  });
});
