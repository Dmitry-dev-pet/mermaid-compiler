import { createContext, useContext } from 'react';
import type { Session, SupabaseClient, User } from '@supabase/supabase-js';

export type AuthStatus = 'disabled' | 'loading' | 'signed_out' | 'signed_in' | 'error';

export type AuthState = {
  status: AuthStatus;
  user: User | null;
  session: Session | null;
  error?: string;
};

export type AuthContextValue = AuthState & {
  supabase: SupabaseClient | null;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within <AuthProvider />');
  }
  return ctx;
};

