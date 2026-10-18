import { afterEach, describe, expect, it } from '@jest/globals';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import PrivacyConsentBanner from './PrivacyConsentBanner';

const storageKey = 'le-grand-cinema-privacy-consent';

describe('PrivacyConsentBanner', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('shows choices on first visit and remembers the explicit refusal', async () => {
    render(<PrivacyConsentBanner />);

    expect(
      await screen.findByRole('heading', {
        name: 'Vos choix de confidentialité',
      }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tout refuser' }));

    expect(window.localStorage.getItem(storageKey)).toBe('rejected');
    expect(
      screen.getByRole('button', {
        name: 'Gérer les préférences de confidentialité',
      }),
    ).toBeTruthy();
  });

  it('remembers acceptance and allows preferences to be reopened', async () => {
    render(<PrivacyConsentBanner />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Tout accepter' }),
    );

    expect(window.localStorage.getItem(storageKey)).toBe('accepted');
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Gérer les préférences de confidentialité',
      }),
    );
    expect(
      screen.getByRole('heading', { name: 'Vos choix de confidentialité' }),
    ).toBeTruthy();
  });

  it('does not display the first-visit banner when a choice is stored', async () => {
    window.localStorage.setItem(storageKey, 'rejected');
    render(<PrivacyConsentBanner />);

    await screen.findByRole('button', {
      name: 'Gérer les préférences de confidentialité',
    });
    expect(
      screen.queryByRole('heading', { name: 'Vos choix de confidentialité' }),
    ).toBeNull();
  });
});
