import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SignInPage from './SignInPage';
import { supabase } from './supabase-client';

describe('SignInPage', () => {
  afterEach(() => {
    cleanup();
    jest.mocked(supabase!.auth.signInWithPassword).mockReset();
  });

  it('signs in then returns home', async () => {
    jest.mocked(supabase!.auth.signInWithPassword).mockResolvedValue({
      data: { user: null, session: null },
      error: null,
    } as never);

    render(
      <MemoryRouter initialEntries={['/connexion']}>
        <Routes>
          <Route path="/mon-espace" element={<p>Accueil</p>} />
          <Route path="/connexion" element={<SignInPage />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('Adresse e-mail'), {
      target: { value: 'alice@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Mot de passe'), {
      target: { value: 'motdepasse12' },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'Se connecter' }));

    await waitFor(() => {
      expect(screen.getByText('Accueil')).toBeTruthy();
    });
  });

  it('shows an explicit error for invalid credentials', async () => {
    jest.mocked(supabase!.auth.signInWithPassword).mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Invalid login credentials' },
    } as never);

    render(
      <MemoryRouter>
        <SignInPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('Adresse e-mail'), {
      target: { value: 'alice@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Mot de passe'), {
      target: { value: 'motdepasse12' },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'Se connecter' }));

    expect(
      await screen.findByText(
        'L’adresse e-mail ou le mot de passe est incorrect.',
      ),
    ).toBeTruthy();
  });

  it('explains that the account was deleted and reservations anonymized', () => {
    render(
      <MemoryRouter
        initialEntries={['/connexion?accountDeleted=1&sessionCleanupFailed=1']}
      >
        <SignInPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('status').textContent).toContain(
      'compte a été supprimé',
    );
    expect(screen.getByRole('alert').textContent).toContain(
      'session locale n’a pas pu être fermée',
    );
  });
});
