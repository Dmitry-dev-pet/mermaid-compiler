import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AuthContext, type AuthContextValue, type AuthState } from './auth';
import { getHostedSupabaseClient } from '../services/supabaseClient';

const AUTH_RETURN_PATH_KEY = 'mermaid_auth_return_path';

const restoreAuthReturnPath = () => {
  const returnPath = sessionStorage.getItem(AUTH_RETURN_PATH_KEY);
  if (!returnPath) return;
  sessionStorage.removeItem(AUTH_RETURN_PATH_KEY);
  if (!returnPath.startsWith('/')) return;
  window.history.replaceState({}, document.title, returnPath);
};

const cleanupAuthRedirectUrl = () => {
  const urlObj = new URL(window.location.href);
  let changed = false;

  for (const key of ['code', 'state', 'error', 'error_code', 'error_description']) {
    if (urlObj.searchParams.has(key)) {
      urlObj.searchParams.delete(key);
      changed = true;
    }
  }

  if (urlObj.hash && /(access_token|refresh_token|provider_token|token_type|expires_in)=/i.test(urlObj.hash)) {
    urlObj.hash = '';
    changed = true;
  }

  if (!changed) return;
  window.history.replaceState({}, document.title, urlObj.pathname + urlObj.search + urlObj.hash);
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const supabase = useMemo(() => getHostedSupabaseClient(), []);

  const [state, setState] = useState<AuthState>(() => ({
    status: supabase ? 'loading' : 'disabled',
    user: null,
    session: null,
  }));

  useEffect(() => {
    if (!supabase) return;

    let cancelled = false;

    const init = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (cancelled) return;
        if (error) {
          setState({ status: 'error', user: null, session: null, error: error.message });
          return;
        }
        const session = data.session ?? null;
        if (session) {
          cleanupAuthRedirectUrl();
          restoreAuthReturnPath();
        }
        setState({
          status: session ? 'signed_in' : 'signed_out',
          user: session?.user ?? null,
          session,
        });
      } catch (e: unknown) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : 'Auth init failed';
        setState({ status: 'error', user: null, session: null, error: message });
      }
    };

    void init();

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === 'SIGNED_IN') {
        cleanupAuthRedirectUrl();
        restoreAuthReturnPath();
      }
      setState({
        status: session ? 'signed_in' : 'signed_out',
        user: session?.user ?? null,
        session,
      });
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  const loginWithGoogle = useCallback(async () => {
    if (!supabase) throw new Error('Supabase is not configured');
    sessionStorage.setItem(
      AUTH_RETURN_PATH_KEY,
      window.location.pathname + window.location.search + window.location.hash,
    );
    const redirectTo = `${window.location.origin}/`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    if (error) throw error;
  }, [supabase]);

  const loginWithGitHub = useCallback(async () => {
    if (!supabase) throw new Error('Supabase is not configured');
    const redirectTo = `${window.location.origin}/`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo },
    });
    if (error) throw error;
  }, [supabase]);

  const logout = useCallback(async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, [supabase]);

  const value = useMemo<AuthContextValue>(() => {
    return {
      ...state,
      supabase,
      loginWithGoogle,
      loginWithGitHub,
      logout,
    };
  }, [loginWithGoogle, loginWithGitHub, logout, state, supabase]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
