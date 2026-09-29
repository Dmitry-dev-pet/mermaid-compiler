import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Copy, Download } from 'lucide-react';
import type { SessionBundle } from '../services/history/bundle';
import { importSessionBundle } from '../services/history/bundle';
import { createSupabaseHostedProvider, decodeProjectBundleFromBlob } from '../services/storage';
import { detectMermaidDiagramType, initializeMermaid } from '../services/mermaidService';
import { augmentMermaidErrorForAutoFix } from '../utils/mermaidAutoFixHints';
import { useMermaidSvgRender } from '../hooks/preview/useMermaidSvgRender';
import { Button } from './ui/Button';

type ShareViewerProps = {
  token: string;
};

const buildMermaidCodeFromBundle = (bundle: SessionBundle): { title: string; code: string } => {
  const title = bundle.session.title ?? 'Shared project';
  const revId = bundle.session.currentRevisionId;
  const rev = revId ? bundle.revisions.find((r) => r.id === revId) : null;
  const code = rev?.mermaid ?? '';
  return { title, code };
};

const ShareViewer: React.FC<ShareViewerProps> = ({ token }) => {
  const [status, setStatus] = useState<{ kind: 'loading' | 'error' | 'ready'; message?: string }>({ kind: 'loading' });
  const [bundle, setBundle] = useState<SessionBundle | null>(null);
  const [title, setTitle] = useState('Shared project');
  const [code, setCode] = useState('');

  const bindFunctionsRef = useRef<((element: Element) => void) | null>(null);

  useEffect(() => {
    initializeMermaid('default');
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        setStatus({ kind: 'loading' });
        const provider = createSupabaseHostedProvider();
        const shared = await provider.fetchShared({ token });
        if (!shared) {
          if (!cancelled) setStatus({ kind: 'error', message: 'Share not found' });
          return;
        }
        const nextBundle = decodeProjectBundleFromBlob(shared.blob);
        const derived = buildMermaidCodeFromBundle(nextBundle);
        if (cancelled) return;
        setBundle(nextBundle);
        setTitle(derived.title);
        setCode(derived.code);
        setStatus({ kind: 'ready' });
      } catch (e: unknown) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : 'Failed to load share';
        setStatus({ kind: 'error', message });
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const { svgMarkup, renderError } = useMermaidSvgRender({
    code,
    enabled: status.kind === 'ready',
    isMarkdownMermaidInvalid: false,
    isMarkdownMermaidMode: false,
    isMermaidValid: true,
    debounceMs: 50,
    enrichError: (c, message) =>
      augmentMermaidErrorForAutoFix(detectMermaidDiagramType(c) ?? 'auto', message),
    bindFunctionsRef,
  });

  const svgContainerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = svgContainerRef.current;
    if (!el) return;
    if (!svgMarkup) return;
    bindFunctionsRef.current?.(el);
  }, [svgMarkup]);

  const tokenLabel = useMemo(() => {
    const t = token.trim();
    if (t.length <= 16) return t;
    return `${t.slice(0, 8)}…${t.slice(-6)}`;
  }, [token]);

  const handleCopy = async () => {
    if (!code.trim()) return;
    await navigator.clipboard.writeText(code);
  };

  const handleForkToLocal = async () => {
    if (!bundle) return;
    await importSessionBundle(bundle, { mode: 'new', setActive: true, keepTimestamps: false });
    window.location.assign('/');
  };

  const handleDownloadJson = () => {
    if (!bundle) return;
    const payload = {
      schema: 'mermaid-langgraph.project' as const,
      version: 1 as const,
      exportedAt: Date.now(),
      bundle,
    };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^a-zA-Z0-9._-]+/g, '-').toLowerCase() || 'shared'}.mlg.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-screen text-slate-800 dark:text-slate-100 font-sans" style={{ backgroundColor: 'var(--app-bg, #ffffff)' }}>
      <header className="px-4 py-2 border-b flex items-center justify-between gap-3" style={{ borderColor: 'var(--panel-border, #e5e7eb)', backgroundColor: 'var(--panel-alt-bg, #ffffff)' }}>
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <Button type="button" variant="ghost" className="gap-1" onClick={() => window.location.assign('/')}>
              <ArrowLeft size={12} />
              Back
            </Button>
            <div className="min-w-0">
              <div className="font-semibold text-sm truncate">{title}</div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono tabular-nums truncate">share/{tokenLabel}</div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button type="button" variant="ghost" onClick={handleCopy} disabled={status.kind !== 'ready' || !code.trim()} className="gap-1">
            <Copy size={12} /> Copy
          </Button>
          <Button type="button" variant="ghost" onClick={handleDownloadJson} disabled={status.kind !== 'ready' || !bundle} className="gap-1">
            <Download size={12} /> Download
          </Button>
          <Button type="button" variant="primary" onClick={handleForkToLocal} disabled={status.kind !== 'ready' || !bundle} className="gap-1">
            Fork
          </Button>
        </div>
      </header>

      <main className="flex-1 min-h-0 grid grid-cols-2 gap-0">
        <section className="min-h-0 border-r" style={{ borderColor: 'var(--panel-border, #e5e7eb)', backgroundColor: 'var(--panel-bg, #f3f4f6)' }}>
          <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500 border-b" style={{ borderColor: 'var(--panel-border, #e5e7eb)' }}>
            Mermaid
          </div>
          <div className="p-3 min-h-0 h-full overflow-auto">
            {status.kind === 'loading' ? (
              <div className="text-sm text-slate-500 dark:text-slate-400">Loading…</div>
            ) : status.kind === 'error' ? (
              <div className="text-sm text-rose-600 dark:text-rose-300">{status.message ?? 'Failed to load'}</div>
            ) : (
              <pre className="text-[12px] leading-relaxed whitespace-pre-wrap font-mono">{code}</pre>
            )}
          </div>
        </section>

        <section className="min-h-0" style={{ backgroundColor: 'var(--panel-bg, #f3f4f6)' }}>
          <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500 border-b" style={{ borderColor: 'var(--panel-border, #e5e7eb)' }}>
            Preview
          </div>
          <div className="p-3 min-h-0 h-full overflow-auto">
            {status.kind === 'loading' ? (
              <div className="text-sm text-slate-500 dark:text-slate-400">Loading…</div>
            ) : status.kind === 'error' ? (
              <div className="text-sm text-rose-600 dark:text-rose-300">{status.message ?? 'Failed to load'}</div>
            ) : renderError ? (
              <div className="text-sm text-rose-600 dark:text-rose-300 whitespace-pre-wrap">{renderError}</div>
            ) : (
              <div ref={svgContainerRef} className="rounded border bg-white dark:bg-slate-900/40 p-2" style={{ borderColor: 'var(--panel-border, #e5e7eb)' }} dangerouslySetInnerHTML={{ __html: svgMarkup }} />
            )}
          </div>
        </section>
      </main>
    </div>
  );
};

export default ShareViewer;

