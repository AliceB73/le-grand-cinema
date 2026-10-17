import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AUTH_UNAVAILABLE_MESSAGE,
  INVALID_RESET_LINK_MESSAGE,
  getPasswordUpdateErrorMessage,
} from './auth-messages';
import {
  authFieldClassName,
  authPageClassName,
  authPrimaryButtonClassName,
} from './auth-form-styles';
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_RULES_TEXT,
  isPasswordStrongEnough,
} from './password-policy';
import { supabase } from './supabase-client';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setIsCheckingSession(false);
      return;
    }

    let isMounted = true;

    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!isMounted) {
          return;
        }
        setHasRecoverySession(Boolean(data.session));
        setIsCheckingSession(false);
      })
      .catch(() => {
        if (!isMounted) {
          return;
        }
        setHasRecoverySession(false);
        setIsCheckingSession(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) {
        setHasRecoverySession(true);
        setIsCheckingSession(false);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isPasswordStrongEnough(password)) {
      setErrorMessage(PASSWORD_RULES_TEXT);
      return;
    }

    if (!supabase) {
      setErrorMessage(AUTH_UNAVAILABLE_MESSAGE);
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const { error } = await supabase.auth.updateUser({ password });
    setIsSubmitting(false);

    if (error) {
      setErrorMessage(getPasswordUpdateErrorMessage(error.message));
      return;
    }

    void navigate('/connexion');
  }

  return (
    <main className={authPageClassName}>
      <h1 className="text-3xl font-bold tracking-tight">
        Choisir un nouveau mot de passe
      </h1>
      {isCheckingSession ? (
        <p role="status">Vérification du lien…</p>
      ) : !supabase || !hasRecoverySession ? (
        <p role="alert">{INVALID_RESET_LINK_MESSAGE}</p>
      ) : (
        <form
          className="space-y-5"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <p className="text-slate-300">{PASSWORD_RULES_TEXT}</p>
          <div>
            <label className="font-semibold" htmlFor="new-password">
              Nouveau mot de passe
            </label>
            <input
              autoComplete="new-password"
              className={authFieldClassName}
              id="new-password"
              minLength={MIN_PASSWORD_LENGTH}
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
            Enregistrer le mot de passe
          </button>
        </form>
      )}
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
