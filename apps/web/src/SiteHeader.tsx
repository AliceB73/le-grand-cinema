import { Link } from 'react-router-dom';
import { useAuthSession } from './AuthSessionProvider';

export default function SiteHeader() {
  const { authErrorMessage, email, isReady, signOut } = useAuthSession();

  return (
    <header className="border-b border-slate-800 bg-slate-950 px-6 py-4 sm:px-10">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
        <Link
          className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-400 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300"
          to="/"
        >
          Le Grand Cinéma
        </Link>
        <nav aria-label="Compte" className="flex flex-wrap items-center gap-3">
          {!isReady ? (
            <p className="text-sm text-slate-400" role="status">
              Chargement du compte…
            </p>
          ) : email ? (
            <>
              <Link
                className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300"
                to="/mon-espace"
              >
                Mes billets
              </Link>
              <p className="text-sm text-slate-300">{email}</p>
              <button
                className="rounded-lg border border-slate-500 px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300"
                onClick={() => void signOut()}
                type="button"
              >
                Déconnexion
              </button>
              {authErrorMessage && (
                <p className="text-sm text-rose-200" role="alert">
                  {authErrorMessage}
                </p>
              )}
            </>
          ) : authErrorMessage ? (
            <p className="text-sm text-rose-200" role="alert">
              {authErrorMessage}
            </p>
          ) : (
            <>
              <Link
                className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300"
                to="/connexion"
              >
                Connexion
              </Link>
              <Link
                className="rounded-lg bg-amber-300 px-3 py-2 text-sm font-bold text-slate-950 hover:bg-amber-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300"
                to="/inscription"
              >
                Inscription
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
