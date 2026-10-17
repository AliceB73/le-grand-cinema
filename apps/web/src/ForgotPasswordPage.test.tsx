import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RESET_EMAIL_SENT_MESSAGE } from './auth-messages';
import ForgotPasswordPage from './ForgotPasswordPage';
import { supabase } from './supabase-client';

describe('ForgotPasswordPage', () => {
  afterEach(() => {
    cleanup();
    jest.mocked(supabase!.auth.resetPasswordForEmail).mockReset();
  });

  it('asks Auth to send a one-time reset link', async () => {
    jest.mocked(supabase!.auth.resetPasswordForEmail).mockResolvedValue({
      data: {},
      error: null,
    } as never);

    render(
      <MemoryRouter>
        <ForgotPasswordPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('Adresse e-mail'), {
      target: { value: 'alice@example.com' },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'Envoyer le lien' }));

    expect(await screen.findByText(RESET_EMAIL_SENT_MESSAGE)).toBeTruthy();
    expect(supabase!.auth.resetPasswordForEmail).toHaveBeenCalledWith(
      'alice@example.com',
      {
        redirectTo: 'http://localhost/reinitialiser-mot-de-passe',
      },
    );
  });
});
