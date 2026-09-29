import React, { useRef, useEffect, useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Github, LogOut, User as UserIcon } from 'lucide-react';
import { AIConfig, ConnectionState, ModelParams, ThemePresetId } from '../types';
import PanelHeader from './ui/PanelHeader';
import { Button } from './ui/Button';
import AiControlPlaneMenu from './header/AiControlPlaneMenu';
import ThemeMenu from './header/ThemeMenu';
import { useAuth } from '../contexts/auth';

interface HeaderProps {
  aiConfig: AIConfig;
  modelParams: ModelParams | null;
  onModelParamsChange: React.Dispatch<React.SetStateAction<ModelParams | null>>;
  connectionState: ConnectionState;
  onConfigChange: React.Dispatch<React.SetStateAction<AIConfig>>;
  onConnect: () => Promise<void>;
  onDisconnect: () => void;
  chatColumnWidthPercent: number;
  theme: ThemePresetId;
  onThemeChange: (theme: ThemePresetId) => void;
  llmTimeoutMs: number;
  onLLMTimeoutMsChange: (timeoutMs: number) => void;
  notebookTabs?: React.ReactNode;
  projectsHeader?: React.ReactNode;
}

const DEFAULT_DOCS_URL = 'https://github.com/Dmitry-dev-pet/mermaid-compiler/tree/main/docs';
const DEFAULT_GITHUB_URL = 'https://github.com/Dmitry-dev-pet/mermaid-compiler';

const HeaderNotebookSlot: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  if (!children) return null;
  return <div className="flex-1 min-w-0">{children}</div>;
};

const Header: React.FC<HeaderProps> = ({ 
  aiConfig, 
  modelParams,
  onModelParamsChange,
  connectionState, 
  onConfigChange, 
  onConnect, 
  onDisconnect,
  chatColumnWidthPercent,
  theme,
  onThemeChange,
  llmTimeoutMs,
  onLLMTimeoutMsChange,
  notebookTabs,
  projectsHeader,
}) => {
  const headerRef = useRef<HTMLElement>(null);
  const auth = useAuth();
  const [authBusy, setAuthBusy] = useState(false);

  useEffect(() => {
    const headerEl = headerRef.current;
    if (!headerEl) return;
    const updateHeaderHeight = () => {
      const height = Math.ceil(headerEl.getBoundingClientRect().height);
      document.documentElement.style.setProperty('--app-header-height', `${height}px`);
    };
    updateHeaderHeight();
    const observer = new ResizeObserver(updateHeaderHeight);
    observer.observe(headerEl);
    window.addEventListener('resize', updateHeaderHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateHeaderHeight);
    };
  }, []);

  const docsUrl = (import.meta.env.VITE_DOCS_URL ?? DEFAULT_DOCS_URL).trim();
  const githubUrl = (import.meta.env.VITE_GITHUB_URL ?? DEFAULT_GITHUB_URL).trim();
  const openExternal = (url: string) => {
    if (!url) return;
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) window.location.assign(url);
  };
  const openDocs = () => {
    if (!docsUrl) return;
    const opened = window.open(docsUrl, '_blank', 'noopener,noreferrer');
    if (!opened) {
      window.location.assign(docsUrl);
    }
  };

  const authLabel = useMemo(() => {
    const email = auth.user?.email;
    return email || 'Signed in';
  }, [auth.user]);

  const handleLogout = async () => {
    if (authBusy) return;
    setAuthBusy(true);
    try {
      await auth.logout();
    } catch (e) {
      console.error('Logout failed', e);
    } finally {
      setAuthBusy(false);
    }
  };

  return (
    <PanelHeader
      as="header"
      ref={headerRef}
      className="fixed top-0 left-0 right-0 grid items-center gap-0 h-12 shrink-0 z-50 transition-colors"
      style={{
        gridTemplateColumns: `minmax(260px, ${chatColumnWidthPercent}%) 0.25rem minmax(0, 1fr) auto`,
      }}
    >
      <div className="flex items-center gap-4 min-w-0 pr-2">
        <div className="flex items-center gap-2 shrink-0">
          <h1 className="font-bold text-lg tracking-tight text-slate-800 dark:text-slate-100">Mermaid Compiler</h1>
          <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-blue-700 dark:border-blue-900/70 dark:bg-blue-950/50 dark:text-blue-300">
            Public alpha
          </span>
        </div>
        {projectsHeader && <div className="flex-1 min-w-0">{projectsHeader}</div>}
      </div>

      <div className="h-full w-1 bg-transparent" aria-hidden="true" />

      <div className="min-w-0">
        <HeaderNotebookSlot>{notebookTabs}</HeaderNotebookSlot>
      </div>

      <div className="flex items-center gap-4 text-[10px] text-slate-500 dark:text-slate-400 font-medium pl-3">
        <AiControlPlaneMenu
          aiConfig={aiConfig}
          modelParams={modelParams}
          onModelParamsChange={onModelParamsChange}
          connectionState={connectionState}
          onConfigChange={onConfigChange}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          llmTimeoutMs={llmTimeoutMs}
          onLLMTimeoutMsChange={onLLMTimeoutMsChange}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1 max-w-[180px]"
          title={authLabel}
          disabled={authBusy}
          onClick={handleLogout}
        >
          <UserIcon size={12} className="opacity-80" />
          <span className="truncate">{authLabel}</span>
          <LogOut size={12} className="opacity-80" />
        </Button>
        <ThemeMenu theme={theme} onThemeChange={onThemeChange} />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={openDocs}
          className="gap-1"
          title={docsUrl}
        >
          <ExternalLink size={12} className="opacity-80" />
          Docs
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => openExternal(githubUrl)}
          className="gap-1"
          title={githubUrl}
        >
          <Github size={12} className="opacity-80" />
          GitHub
        </Button>
      </div>
    </PanelHeader>
  );
};

export default Header;
