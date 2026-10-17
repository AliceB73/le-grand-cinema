import { describe, expect, it } from '@jest/globals';
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_RULES_TEXT,
  isPasswordStrongEnough,
} from './password-policy';

describe('password policy', () => {
  it('rejects passwords shorter than 12 characters', () => {
    expect(isPasswordStrongEnough('short-pass')).toBe(false);
    expect(isPasswordStrongEnough('a'.repeat(MIN_PASSWORD_LENGTH - 1))).toBe(
      false,
    );
  });

  it('accepts passwords with 12 or more characters without extra classes', () => {
    expect(isPasswordStrongEnough('a'.repeat(MIN_PASSWORD_LENGTH))).toBe(true);
    expect(isPasswordStrongEnough('motdepasse12')).toBe(true);
  });

  it('exposes the rule shown at sign-up', () => {
    expect(PASSWORD_RULES_TEXT).toContain('12 caractères');
  });
});
