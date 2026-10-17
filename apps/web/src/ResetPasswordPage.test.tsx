import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { INVALID_RESET_LINK_MESSAGE } from './auth-messages';
import { PASSWORD_RULES_TEXT } from './password-policy';
import ResetPasswordPage from './ResetPasswordPage';
import { supabase } from './supabase-client';

describe('ResetPasswordPage', () => {
  afterEach(() => {
    cleanup();
    jest.mocked(supabase!.auth.getSession).mockReset();
    jest.mocked(supabase!.auth.updateUser).mockReset();
    jest.mocked(supabase!.auth.onAuthStateChange).mockReset();
    jest.mocked(supabase!.auth.getSession).mockResolvedValue({
      data: { session: null },
      error: null,
    } as never);
    jest.mocked(supabase!.auth.onAuthStateChange).mockReturnValue({
      data: { subscription: { unsubscribe: jest.fn() } },
    } as never);
  });

  it('warns when the recovery link has expired', async () => {
    render(
      <MemoryRouter>
        <ResetPasswordPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText(INVALID_RESET_LINK_MESSAGE)).toBeTruthy();
  });

  it('updates the password when a recovery session is present', async () => {
    jest.mocked(supabase!.auth.getSession).mockResolvedValue({
      data: {
        session: { user: { email: 'alice@example.com' } },
      },
      error: null,
    } as never);
    jest.mocked(supabase!.auth.updateUser).mockResolvedValue({
      data: { user: null },
      error: null,
    } as never);

    render(
      <MemoryRouter initialEntries={['/reinitialiser-mot-de-passe']}>
        <Routes>
          <Route path="/connexion" element={<p>Connexion</p>} />
          <Route
            path="/reinitialiser-mot-de-passe"
            element={<ResetPasswordPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(await screen.findByLabelText('Nouveau mot de passe'), {
      target: { value: 'nouveaumotde' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: 'Enregistrer le mot de passe' }),
    );

    await waitFor(() => {
      expect(screen.getByText('Connexion')).toBeTruthy();
    });
    expect(supabase!.auth.updateUser).toHaveBeenCalledWith({
      password: 'nouveaumotde',
    });
  });

  it('refuses a weak replacement password', async () => {
    jest.mocked(supabase!.auth.getSession).mockResolvedValue({
      data: {
        session: { user: { email: 'alice@example.com' } },
      },
      error: null,
    } as never);

    render(
      <MemoryRouter>
        <ResetPasswordPage />
      </MemoryRouter>,
    );

    fireEvent.change(await screen.findByLabelText('Nouveau mot de passe'), {
      target: { value: 'court' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: 'Enregistrer le mot de passe' }),
    );

    expect(screen.getByRole('alert').textContent).toBe(PASSWORD_RULES_TEXT);
    expect(supabase!.auth.updateUser).not.toHaveBeenCalled();
  });
});
