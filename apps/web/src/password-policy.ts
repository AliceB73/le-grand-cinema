export const MIN_PASSWORD_LENGTH = 12;

export const PASSWORD_RULES_TEXT =
  'Le mot de passe doit contenir au moins 12 caractères.';

export function isPasswordStrongEnough(password: string) {
  return password.length >= MIN_PASSWORD_LENGTH;
}
