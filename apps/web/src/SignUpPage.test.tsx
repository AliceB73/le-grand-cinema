import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PASSWORD_RULES_TEXT } from './password-policy';
import SignUpPage from './SignUpPage';
import { supabase } from './supabase-client';

describe('SignUpPage', () => {
  afterEach(() => {
    cleanup();
    jest.mocked(supabase!.auth.signUp).mockReset();
  });

  it('shows the password rule and refuses a weak password without calling Auth', () => {
    render(
      <MemoryRouter>
        <SignUpPage />
      </MemoryRouter>,
    );

    expect(screen.getByText(PASSWORD_RULES_TEXT)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), {
      target: { value: 'alice@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Mot de passe'), {
      target: { value: 'tropcourt' },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'S’inscrire' }));

    expect(screen.getByRole('alert').textContent).toBe(PASSWORD_RULES_TEXT);
    expect(supabase!.auth.signUp).not.toHaveBeenCalled();
  });

  it('creates an account then returns to the home page', async () => {
    jest.mocked(supabase!.auth.signUp).mockResolvedValue({
      data: { user: null, session: null },
      error: null,
    } as never);

    render(
      <MemoryRouter initialEntries={['/inscription']}>
        <Routes>
          <Route path="/" element={<p>Accueil</p>} />
          <Route path="/inscription" element={<SignUpPage />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('Adresse e-mail'), {
      target: { value: 'alice@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Mot de passe'), {
      target: { value: 'motdepasse12' },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'S’inscrire' }));

    await waitFor(() => {
      expect(screen.getByText('Accueil')).toBeTruthy();
    });
    expect(supabase!.auth.signUp).toHaveBeenCalledWith({
      email: 'alice@example.com',
      password: 'motdepasse12',
    });
  });

  it('shows a non-technical error when the address is already registered', async () => {
    jest.mocked(supabase!.auth.signUp).mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'User already registered' },
    } as never);

    render(
      <MemoryRouter>
        <SignUpPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('Adresse e-mail'), {
      target: { value: 'alice@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Mot de passe'), {
      target: { value: 'motdepasse12' },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'S’inscrire' }));

    expect(
      await screen.findByText('Un compte existe déjà avec cette adresse e-mail.'),
    ).toBeTruthy();
  });
});
