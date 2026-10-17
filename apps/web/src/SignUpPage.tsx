import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AUTH_UNAVAILABLE_MESSAGE,
  getSignUpErrorMessage,
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

export default function SignUpPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });

    setIsSubmitting(false);

    if (error) {
      setErrorMessage(getSignUpErrorMessage(error.message));
      return;
    }

    void navigate('/');
  }

  return (
    <main className={authPageClassName}>
      <h1 className="text-3xl font-bold tracking-tight">Créer un compte</h1>
      <p className="text-slate-300">
        Inscrivez-vous pour vous reconnecter plus tard. La réservation sans
        compte reste possible.
      </p>
      <form
        className="space-y-5"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <div>
          <label className="font-semibold" htmlFor="signup-email">
            Adresse e-mail
          </label>
          <input
            autoComplete="email"
            className={authFieldClassName}
            id="signup-email"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </div>
        <div>
          <label className="font-semibold" htmlFor="signup-password">
            Mot de passe
          </label>
          <input
            autoComplete="new-password"
            className={authFieldClassName}
            id="signup-password"
            minLength={MIN_PASSWORD_LENGTH}
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
          <p className="mt-2 text-sm text-slate-300">{PASSWORD_RULES_TEXT}</p>
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
          S’inscrire
        </button>
      </form>
      <p className="text-sm text-slate-300">
        Déjà un compte ?{' '}
        <Link
          className="font-semibold text-amber-300 underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300"
          to="/connexion"
        >
          Se connecter
        </Link>
      </p>
    </main>
  );
}
