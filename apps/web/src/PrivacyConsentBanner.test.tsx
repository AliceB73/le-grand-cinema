import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import PrivacyConsentBanner from './PrivacyConsentBanner';

const storageKey = 'le-grand-cinema-privacy-consent';

describe('PrivacyConsentBanner', () => {
  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
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

  it('shows the banner and an error when stored preferences cannot be read', async () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    render(<PrivacyConsentBanner />);

    expect(
      await screen.findByRole('heading', {
        name: 'Vos choix de confidentialité',
      }),
    ).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(
      'ne peut pas être lue',
    );
  });

  it('keeps the banner open when a choice cannot be stored', async () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    render(<PrivacyConsentBanner />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Tout refuser' }),
    );

    expect(screen.getByRole('alert').textContent).toContain(
      'n’a pas pu être enregistré',
    );
    expect(
      screen.getByRole('heading', { name: 'Vos choix de confidentialité' }),
    ).toBeTruthy();
  });
});
