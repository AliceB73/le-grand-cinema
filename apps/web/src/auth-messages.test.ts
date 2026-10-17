import { describe, expect, it } from '@jest/globals';
import {
  AUTH_UNAVAILABLE_MESSAGE,
  getPasswordUpdateErrorMessage,
  getResetRequestErrorMessage,
  getSignInErrorMessage,
  getSignUpErrorMessage,
} from './auth-messages';
import { PASSWORD_RULES_TEXT } from './password-policy';

describe('auth messages', () => {
  it('maps duplicate sign-up and weak password errors', () => {
    expect(getSignUpErrorMessage('User already registered')).toContain(
      'existe déjà',
    );
    expect(
      getSignUpErrorMessage('Password should be at least 12 characters'),
    ).toBe(PASSWORD_RULES_TEXT);
    expect(getSignUpErrorMessage('Unable to validate email address: invalid')).toContain(
      'adresse e-mail valide',
    );
    expect(getSignUpErrorMessage('unexpected')).toContain('inscription a échoué');
  });

  it('maps invalid login credentials', () => {
    expect(getSignInErrorMessage('Invalid login credentials')).toContain(
      'incorrect',
    );
    expect(getSignInErrorMessage('timeout')).toContain('connexion a échoué');
  });

  it('maps password update and reset request errors', () => {
    expect(
      getPasswordUpdateErrorMessage(
        'Password should be at least 12 characters',
      ),
    ).toContain('12 caractères');
    expect(getPasswordUpdateErrorMessage('expired')).toContain(
      'nouveau lien',
    );
    expect(getResetRequestErrorMessage()).toBe(AUTH_UNAVAILABLE_MESSAGE);
  });
});
