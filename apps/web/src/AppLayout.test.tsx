import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AppLayout from './AppLayout';
import { AuthSessionProvider } from './AuthSessionProvider';
import { supabase } from './supabase-client';

describe('AppLayout', () => {
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

  it('renders the site header around nested pages', async () => {
    render(
      <MemoryRouter>
        <AuthSessionProvider>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/" element={<p>Page enfant</p>} />
            </Route>
          </Routes>
        </AuthSessionProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('link', { name: 'Connexion' })).toBeTruthy();
    expect(screen.getByText('Page enfant')).toBeTruthy();
  });
});
