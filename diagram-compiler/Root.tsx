import React, { useState } from 'react';
import { Chrome, Loader2 } from 'lucide-react';
import App from './App';
import ShareViewer from './components/ShareViewer';
import { Button } from './components/ui/Button';
import { useAuth } from './contexts/auth';

const parseShareToken = (): string | null => {
  const path = window.location.pathname || '/';
  const match = path.match(/^\/share\/([^/]+)\/?$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
};

const AuthGate: React.FC = () => {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const handleGoogleLogin = async () => {
    if (busy) return;
    setBusy(true);
    setLoginError(null);
    try {
      await auth.loginWithGoogle();
    } catch (error: unknown) {
      setLoginError(error instanceof Error ? error.message : 'Google sign-in failed');
      setBusy(false);
    }
  };

  if (auth.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 size={16} className="animate-spin" />
          Checking session…
        </div>
      </div>
    );
  }

  if (auth.status === 'signed_in') return null;

  const authError =
    loginError ??
    (auth.status === 'error' ? auth.error ?? 'Authentication failed' : null) ??
    (auth.status === 'disabled' ? 'Authentication is not configured.' : null);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100">
      <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl">
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-blue-400">
          Mermaid Compiler
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to continue</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Access to this preview is limited to authenticated Google accounts.
        </p>

        <Button
          type="button"
          onClick={() => void handleGoogleLogin()}
          disabled={busy || auth.status === 'disabled'}
          className="mt-6 w-full justify-center gap-2"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Chrome size={16} />}
          Continue with Google
        </Button>

        {authError && (
          <div className="mt-4 rounded-lg border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-300">
            {authError}
          </div>
        )}
      </div>
    </div>
  );
};

const Root: React.FC = () => {
  const auth = useAuth();

  if (auth.status !== 'signed_in') {
    return <AuthGate />;
  }

  const shareToken = parseShareToken();
  if (shareToken) {
    return <ShareViewer token={shareToken} />;
  }
  return <App />;
};

export default Root;
