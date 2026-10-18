import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AUTH_SESSION_UNAVAILABLE_MESSAGE,
  AUTH_UNAVAILABLE_MESSAGE,
  SIGN_OUT_ERROR_MESSAGE,
} from './auth-messages';
import { supabase } from './supabase-client';

interface AuthSessionValue {
  authErrorMessage: string | null;
  clearDeletedAccountSession: () => Promise<boolean>;
  email: string | null;
  isReady: boolean;
  signOut: () => Promise<void>;
}

const AuthSessionContext = createContext<AuthSessionValue | null>(null);

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const [authErrorMessage, setAuthErrorMessage] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(!supabase);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    let isMounted = true;

    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!isMounted) {
          return;
        }

        if (error) {
          setAuthErrorMessage(AUTH_SESSION_UNAVAILABLE_MESSAGE);
          setIsReady(true);
          return;
        }

        setEmail(data.session?.user.email ?? null);
        setAuthErrorMessage(null);
        setIsReady(true);
      })
      .catch(() => {
        if (!isMounted) {
          return;
        }
        setAuthErrorMessage(AUTH_SESSION_UNAVAILABLE_MESSAGE);
        setIsReady(true);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user.email ?? null);
      setAuthErrorMessage(null);
      setIsReady(true);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(
    () => ({
      authErrorMessage,
      clearDeletedAccountSession: async () => {
        if (!supabase) {
          setEmail(null);
          setAuthErrorMessage(AUTH_UNAVAILABLE_MESSAGE);
          return false;
        }

        try {
          const { error } = await supabase.auth.signOut({ scope: 'local' });
          setEmail(null);
          if (error) {
            setAuthErrorMessage(SIGN_OUT_ERROR_MESSAGE);
            return false;
          }

          setAuthErrorMessage(null);
          return true;
        } catch {
          setEmail(null);
          setAuthErrorMessage(SIGN_OUT_ERROR_MESSAGE);
          return false;
        }
      },
      email,
      isReady,
      signOut: async () => {
        setAuthErrorMessage(null);

        if (!supabase) {
          setAuthErrorMessage(AUTH_UNAVAILABLE_MESSAGE);
          return;
        }

        try {
          const { error } = await supabase.auth.signOut();

          if (error) {
            setAuthErrorMessage(SIGN_OUT_ERROR_MESSAGE);
            return;
          }

          setEmail(null);
        } catch {
          setAuthErrorMessage(SIGN_OUT_ERROR_MESSAGE);
        }
      },
    }),
    [authErrorMessage, email, isReady],
  );

  return (
    <AuthSessionContext.Provider value={value}>
      {children}
    </AuthSessionContext.Provider>
  );
}

export function useAuthSession() {
  const value = useContext(AuthSessionContext);

  if (!value) {
    throw new Error('useAuthSession must be used within AuthSessionProvider.');
  }

  return value;
}
