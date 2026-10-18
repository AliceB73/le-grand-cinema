import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AUTH_UNAVAILABLE_MESSAGE,
  getSignInErrorMessage,
} from './auth-messages';
import {
  authFieldClassName,
  authPageClassName,
  authPrimaryButtonClassName,
} from './auth-form-styles';
import { supabase } from './supabase-client';

export default function SignInPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase) {
      setErrorMessage(AUTH_UNAVAILABLE_MESSAGE);
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setIsSubmitting(false);

    if (error) {
      setErrorMessage(getSignInErrorMessage(error.message));
      return;
    }

    void navigate('/mon-espace');
  }

  return (
    <main className={authPageClassName}>
      <h1 className="text-3xl font-bold tracking-tight">Connexion</h1>
      {searchParams.get('accountDeleted') === '1' && (
        <p className="text-sm text-emerald-200" role="status">
          Votre compte a été supprimé et les réservations conservées ont été
          anonymisées.
        </p>
      )}
      {searchParams.get('sessionCleanupFailed') === '1' && (
        <p className="text-sm text-rose-200" role="alert">
          La session locale n’a pas pu être fermée. Supprimez-la depuis les
          paramètres de votre navigateur avant de vous reconnecter.
        </p>
      )}
      <p className="text-slate-300">
        Connectez-vous avec l’adresse e-mail de votre compte.
      </p>
      <form
        className="space-y-5"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <div>
          <label className="font-semibold" htmlFor="signin-email">
            Adresse e-mail
          </label>
          <input
            autoComplete="email"
            className={authFieldClassName}
            id="signin-email"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </div>
        <div>
          <label className="font-semibold" htmlFor="signin-password">
            Mot de passe
          </label>
          <input
            autoComplete="current-password"
            className={authFieldClassName}
            id="signin-password"
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </div>
        {errorMessage && (
          <p className="text-sm text-rose-200" role="alert">
            {errorMessage}
          </p>
        )}
        <button
          className={authPrimaryButtonClassName}
          disabled={isSubmitting}
          type="submit"
        >
          Se connecter
        </button>
      </form>
      <p className="text-sm text-slate-300">
        <Link
          className="font-semibold text-amber-300 underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300"
          to="/mot-de-passe-oublie"
        >
          Mot de passe oublié
        </Link>
      </p>
      <p className="text-sm text-slate-300">
        Pas encore de compte ?{' '}
        <Link
          className="font-semibold text-amber-300 underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300"
          to="/inscription"
        >
          Créer un compte
        </Link>
      </p>
    </main>
  );
}
