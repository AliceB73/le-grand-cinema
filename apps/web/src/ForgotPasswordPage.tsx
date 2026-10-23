import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  AUTH_UNAVAILABLE_MESSAGE,
  RESET_EMAIL_SENT_MESSAGE,
  getResetRequestErrorMessage,
} from './auth-messages';
import {
  authFieldClassName,
  authPageClassName,
  authPrimaryButtonClassName,
} from './auth-form-styles';
import { supabase } from './supabase-client';
import { appBasePath } from './app-base';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);

    if (!supabase) {
      setErrorMessage(AUTH_UNAVAILABLE_MESSAGE);
      return;
    }

    setIsSubmitting(true);

    const redirectTo = new URL(
      `${appBasePath}reinitialiser-mot-de-passe`,
      window.location.origin,
    ).toString();
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo,
    });

    setIsSubmitting(false);

    if (error) {
      setErrorMessage(getResetRequestErrorMessage());
      return;
    }

    setStatusMessage(RESET_EMAIL_SENT_MESSAGE);
  }

  return (
    <main className={authPageClassName}>
      <h1 className="text-3xl font-bold tracking-tight">Mot de passe oublié</h1>
      <p className="text-slate-300">
        Saisissez votre adresse e-mail. Un lien à usage unique, valable une
        heure, vous sera envoyé si un compte existe.
      </p>
      <form
        className="space-y-5"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <div>
          <label className="font-semibold" htmlFor="reset-email">
            Adresse e-mail
          </label>
          <input
            autoComplete="email"
            className={authFieldClassName}
            id="reset-email"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </div>
        {errorMessage && (
          <p className="text-sm text-rose-200" role="alert">
            {errorMessage}
          </p>
        )}
        {statusMessage && (
          <p className="text-sm text-emerald-200" role="status">
            {statusMessage}
          </p>
        )}
        <button
          className={authPrimaryButtonClassName}
          disabled={isSubmitting}
          type="submit"
        >
          Envoyer le lien
        </button>
      </form>
      <p className="text-sm text-slate-300">
        <Link
          className="font-semibold text-amber-300 underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300"
          to="/connexion"
        >
          Retour à la connexion
        </Link>
      </p>
    </main>
  );
}
