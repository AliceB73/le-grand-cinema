import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AUTH_SESSION_UNAVAILABLE_MESSAGE } from './auth-messages';
import { AuthSessionProvider, useAuthSession } from './AuthSessionProvider';
import SiteHeader from './SiteHeader';
import { supabase } from './supabase-client';

describe('AuthSessionProvider', () => {
  afterEach(() => {
    cleanup();
    jest.mocked(supabase!.auth.getSession).mockReset();
    jest.mocked(supabase!.auth.onAuthStateChange).mockReset();
    jest.mocked(supabase!.auth.getSession).mockResolvedValue({
      data: { session: null },
      error: null,
    } as never);
    jest.mocked(supabase!.auth.onAuthStateChange).mockReturnValue({
      data: { subscription: { unsubscribe: jest.fn() } },
    } as never);
  });

  it('shows an explicit unavailable state when session lookup fails', async () => {
    jest
      .mocked(supabase!.auth.getSession)
      .mockRejectedValue(new Error('offline'));

    render(
      <MemoryRouter>
        <AuthSessionProvider>
          <SiteHeader />
        </AuthSessionProvider>
      </MemoryRouter>,
    );

    expect((await screen.findByRole('alert')).textContent).toContain(
      AUTH_SESSION_UNAVAILABLE_MESSAGE,
    );
    expect(screen.queryByRole('link', { name: 'Connexion' })).toBeNull();
  });

  it('shows an unavailable state when Supabase returns a session error', async () => {
    jest.mocked(supabase!.auth.getSession).mockResolvedValue({
      data: { session: null },
      error: new Error('offline'),
    } as never);

    render(
      <MemoryRouter>
        <AuthSessionProvider>
          <SiteHeader />
        </AuthSessionProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Connexion' })).toBeNull();
  });

  it('requires the provider around consumers', () => {
    function Consumer() {
      useAuthSession();
      return null;
    }

    expect(() => render(<Consumer />)).toThrow(
      'useAuthSession must be used within AuthSessionProvider.',
    );
  });
});
