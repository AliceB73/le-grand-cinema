import { MIN_PASSWORD_LENGTH, PASSWORD_RULES_TEXT } from './password-policy';

export const AUTH_UNAVAILABLE_MESSAGE =
  'Le service d’authentification est momentanément indisponible. Réessayez plus tard.';

export const AUTH_SESSION_UNAVAILABLE_MESSAGE =
  'Impossible de vérifier votre session pour le moment. Réessayez plus tard.';

export const SIGN_OUT_ERROR_MESSAGE =
  'La déconnexion n’a pas abouti. Vérifiez votre connexion puis réessayez.';

export const RESET_EMAIL_SENT_MESSAGE =
  'Si un compte existe pour cette adresse, un courriel avec un lien valable une heure vient d’être envoyé.';

export const INVALID_RESET_LINK_MESSAGE =
  'Ce lien de réinitialisation est invalide ou a expiré. Demandez un nouveau courriel.';

export function getSignUpErrorMessage(errorMessage: string) {
  const normalized = errorMessage.toLowerCase();

  if (
    normalized.includes('already registered') ||
    normalized.includes('already exists') ||
    normalized.includes('user already')
  ) {
    return 'Un compte existe déjà avec cette adresse e-mail.';
  }

  if (normalized.includes('password') && normalized.includes('character')) {
    return PASSWORD_RULES_TEXT;
  }

  if (normalized.includes('invalid') && normalized.includes('email')) {
    return 'Saisissez une adresse e-mail valide.';
  }

  return 'L’inscription a échoué. Vérifiez vos informations puis réessayez.';
}

export function getSignInErrorMessage(errorMessage: string) {
  const normalized = errorMessage.toLowerCase();

  if (
    normalized.includes('invalid login') ||
    normalized.includes('invalid credentials')
  ) {
    return 'L’adresse e-mail ou le mot de passe est incorrect.';
  }

  return 'La connexion a échoué. Vérifiez vos informations puis réessayez.';
}

export function getPasswordUpdateErrorMessage(errorMessage: string) {
  const normalized = errorMessage.toLowerCase();

  if (normalized.includes('password') && normalized.includes('character')) {
    return `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`;
  }

  return 'Le mot de passe n’a pas pu être mis à jour. Demandez un nouveau lien.';
}

export function getResetRequestErrorMessage() {
  return AUTH_UNAVAILABLE_MESSAGE;
}
