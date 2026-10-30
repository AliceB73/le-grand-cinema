import { useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet } from 'react-router-dom';
import { AdminApiError, checkAdminAccess } from './admin-api';
import { useAuthSession } from './AuthSessionProvider';

type AccessState = 'checking' | 'granted' | 'forbidden' | 'unavailable';

const linkClassName = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300 ${
    isActive
      ? 'bg-amber-300 text-slate-950'
      : 'text-slate-100 hover:bg-slate-800'
  }`;

export default function AdminLayout() {
  const { email, isReady } = useAuthSession();
  const [access, setAccess] = useState<AccessState>('checking');

  useEffect(() => {
    if (!email) {
      return;
    }
    let isMounted = true;
    setAccess('checking');
    checkAdminAccess()
      .then(() => isMounted && setAccess('granted'))
      .catch((error: unknown) => {
        if (!isMounted) {
          return;
        }
        setAccess(
          error instanceof AdminApiError &&
            (error.status === 403 || error.status === 401)
            ? 'forbidden'
            : 'unavailable',
        );
      });
    return () => {
      isMounted = false;
    };
  }, [email]);

  if (!isReady) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-12 sm:px-10">
        <p className="text-slate-300" role="status">
          Chargement…
        </p>
      </main>
    );
  }
  if (!email) {
    return <Navigate replace to="/connexion" />;
  }
  if (access === 'checking') {
    return (
      <main className="mx-auto max-w-5xl px-6 py-12 sm:px-10">
        <p className="text-slate-300" role="status">
          Vérification de vos droits…
        </p>
      </main>
    );
  }
  if (access !== 'granted') {
    return (
      <main className="mx-auto max-w-5xl px-6 py-12 sm:px-10">
        <p className="text-rose-200" role="alert">
          {access === 'forbidden'
            ? 'L’espace d’administration est réservé aux administrateurs.'
            : 'L’espace d’administration est momentanément indisponible.'}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-6 py-12 sm:px-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Administration</h1>
        <nav aria-label="Administration" className="flex flex-wrap gap-2">
          <NavLink className={linkClassName} to="/admin/seances">
            Séances
          </NavLink>
          <NavLink className={linkClassName} to="/admin/salles">
            Salles et tarifs
          </NavLink>
          <NavLink className={linkClassName} to="/admin/films">
            Films
          </NavLink>
          <NavLink className={linkClassName} to="/admin/ventes">
            Ventes
          </NavLink>
        </nav>
      </div>
      <Outlet />
    </main>
  );
}
