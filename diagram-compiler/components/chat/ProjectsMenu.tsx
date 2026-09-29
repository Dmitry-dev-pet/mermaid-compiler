import React, { useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  Chrome,
  Cloud,
  Download,
  LogOut,
  RefreshCw,
  Trash2,
  UploadCloud,
  User as UserIcon,
  X,
} from 'lucide-react';
import type { HistorySession } from '../../services/history/types';
import type { StorageMode } from '../../hooks/core/useStorageMode';
import type {
  CloudMigrationItem,
  CloudMigrationStatus,
  CloudProjectsStatus,
  CloudSyncStatus,
} from '../../hooks/studio/useCloudControlPlane';
import type { ProjectMeta } from '../../services/storage';
import { createCloudProjectsSource, createLocalProjectsSource } from '../../services/projects/projectsSource';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { InlineStatus } from '../ui/InlineStatus';
import { useAuth } from '../../contexts/auth';

const EXPERIMENTAL_CLOUD_ENABLED = import.meta.env.VITE_ENABLE_EXPERIMENTAL_CLOUD === 'true';

type SortKey = 'updated' | 'created' | 'name';

type ProjectsMenuProps = {
  menuRef?: React.Ref<HTMLDivElement>;
  projects: HistorySession[];
  activeProjectId: string | null;
  editingProjectId: string | null;
  editingProjectTitle: string;
  sortKey: SortKey;
  onSortChange: (value: SortKey) => void;
  onPreviewProjectSnapshot: (sessionId: string) => Promise<void>;
  onClearProjectPreview: () => void;
  onStartEditingProject: (project: HistorySession) => void;
  onEditingProjectTitleChange: (value: string) => void;
  onCommitProjectRename: (project: HistorySession) => void | Promise<void>;
  onCancelEditingProject: () => void;
  onOpenProject: (sessionId: string) => void | Promise<void>;
  onDeleteProject: (project: HistorySession) => void | Promise<void>;
  onExportProject: (sessionId: string) => Promise<void>;
  onImportProject: (file: File) => Promise<void>;
  byoConfig: { url: string; anonKey: string };
  onByoConfigChange: (updates: { url?: string; anonKey?: string }) => void;
  onTestByoConfig: () => Promise<{ ok: boolean; error?: string }>;
  storageMode?: StorageMode;
  onStorageModeChange?: (mode: StorageMode) => void;
  cloudSync?: { status: CloudSyncStatus; syncActive: () => Promise<void>; syncAll: () => Promise<void> };
  cloudProjects?: {
    status: CloudProjectsStatus;
    projects: ProjectMeta[];
    refresh: () => Promise<void>;
    importFromCloud: (projectId: string) => Promise<void>;
  };
  cloudMigration?: {
    status: CloudMigrationStatus;
    items: CloudMigrationItem[];
    unlinkedCount: number;
    migrateAll: () => Promise<void>;
    migrateActive: () => Promise<void>;
    cancel: () => void;
    reset: () => void;
  };
};

const SectionToggle: React.FC<{
  expanded: boolean;
  onToggle: () => void;
  title?: string;
}> = ({ expanded, onToggle, title }) => {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onToggle}
      className="h-6 w-6 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
      title={title ?? (expanded ? 'Collapse' : 'Expand')}
    >
      <ChevronDown size={14} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
    </Button>
  );
};

const formatProjectTimestamp = (ts?: number) => {
  if (!ts) return '';
  return new Date(ts).toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const CloudSection: React.FC<{
  storageMode?: StorageMode;
  onStorageModeChange?: (mode: StorageMode) => void;
  cloudSync?: ProjectsMenuProps['cloudSync'];
  cloudProjects?: ProjectsMenuProps['cloudProjects'];
  cloudMigration?: ProjectsMenuProps['cloudMigration'];
}> = ({ storageMode, onStorageModeChange, cloudSync, cloudProjects, cloudMigration }) => {
  const auth = useAuth();
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudAuthError, setCloudAuthError] = useState<string | null>(null);
  const [showAllCloudProjects, setShowAllCloudProjects] = useState(false);
  const [showMigrationItems, setShowMigrationItems] = useState(false);

  const cloudSource = useMemo(() => {
    return createCloudProjectsSource(cloudProjects?.projects ?? []);
  }, [cloudProjects?.projects]);

  const cloudLabel = useMemo(() => {
    if (auth.status === 'disabled') return 'disabled';
    if (auth.status === 'loading') return 'loading…';
    if (auth.status === 'error') return auth.error ?? 'error';
    if (auth.status === 'signed_in') {
      const email = auth.user?.email;
      const login = typeof auth.user?.user_metadata?.login === 'string' ? auth.user.user_metadata.login : null;
      return email || login || 'signed in';
    }
    return 'signed out';
  }, [auth.error, auth.status, auth.user]);

  const canSync =
    !!cloudSync &&
    (storageMode === 'cloud_hosted' || storageMode === 'cloud_byo') &&
    auth.status === 'signed_in' &&
    cloudSync.status.kind !== 'syncing';

  const canBrowseCloudProjects =
    !!cloudProjects &&
    (storageMode === 'cloud_hosted' || storageMode === 'cloud_byo') &&
    auth.status === 'signed_in' &&
    cloudProjects.status.kind !== 'loading';

  const canMigrate =
    !!cloudMigration &&
    (storageMode === 'cloud_hosted' || storageMode === 'cloud_byo') &&
    auth.status === 'signed_in' &&
    cloudMigration.status.kind !== 'syncing' &&
    cloudMigration.unlinkedCount > 0;

  const handleCloudLoginGoogle = async () => {
    if (cloudBusy) return;
    setCloudBusy(true);
    try {
      setCloudAuthError(null);
      await auth.loginWithGoogle();
    } catch (e: unknown) {
      setCloudAuthError(e instanceof Error ? e.message : 'Login failed');
    } finally {
      setCloudBusy(false);
    }
  };

  const handleCloudLogout = async () => {
    if (cloudBusy) return;
    setCloudBusy(true);
    try {
      setCloudAuthError(null);
      await auth.logout();
    } catch (e: unknown) {
      setCloudAuthError(e instanceof Error ? e.message : 'Logout failed');
    } finally {
      setCloudBusy(false);
    }
  };

  const showCloud =
    !!storageMode || !!onStorageModeChange || !!cloudSync || !!cloudProjects || !!cloudMigration || auth.status !== 'disabled';

  if (!showCloud) return null;

  const syncMessage =
    cloudSync?.status.kind === 'idle'
      ? null
      : cloudSync?.status.kind === 'syncing'
        ? { status: 'syncing' as const, message: cloudSync.status.message }
        : cloudSync?.status.kind === 'error'
          ? { status: 'error' as const, message: cloudSync.status.message }
          : { status: 'success' as const, message: cloudSync?.status.message };

  const migrationMessage =
    cloudMigration?.status.kind === 'idle'
      ? null
      : cloudMigration?.status.kind === 'syncing'
        ? { status: 'syncing' as const, message: cloudMigration.status.message }
        : cloudMigration?.status.kind === 'error'
          ? { status: 'error' as const, message: cloudMigration.status.message }
          : cloudMigration?.status.kind === 'cancelled'
            ? { status: 'cancelled' as const, message: cloudMigration.status.message }
            : { status: 'success' as const, message: cloudMigration?.status.message };

  const projectsMessage =
    cloudProjects?.status.kind === 'idle'
      ? null
      : cloudProjects?.status.kind === 'loading'
        ? { status: 'loading' as const, message: cloudProjects.status.message }
        : cloudProjects?.status.kind === 'error'
          ? { status: 'error' as const, message: cloudProjects.status.message }
          : { status: 'success' as const, message: cloudProjects?.status.message };

  return (
    <div className="px-3 py-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-slate-400 dark:text-slate-500 inline-flex items-center gap-1">
          <Cloud size={12} className="opacity-80" /> Cloud
        </span>
        {auth.status === 'signed_in' ? (
          <Button
            type="button"
            variant="ghost"
            onClick={handleCloudLogout}
            disabled={cloudBusy}
            className="text-[10px] px-2 py-1 rounded-full text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 gap-1"
            title={cloudLabel}
          >
            <UserIcon size={12} className="opacity-80" />
            <LogOut size={12} className="opacity-80" />
            Logout
          </Button>
        ) : (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              onClick={handleCloudLoginGoogle}
              disabled={cloudBusy || auth.status === 'disabled' || auth.status === 'loading'}
              className="text-[10px] px-2 py-1 rounded-full text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 gap-1"
              title="Login with Google"
            >
              <Chrome size={12} className="opacity-80" />
              Google
            </Button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-slate-400 dark:text-slate-500">Status</span>
        <span className="text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate max-w-[240px]">
          {cloudLabel}
        </span>
      </div>

      {cloudAuthError && <div className="text-[10px] text-rose-600 dark:text-rose-300">{cloudAuthError}</div>}

      {storageMode && onStorageModeChange && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-slate-400 dark:text-slate-500">Mode</span>
          <Select
            value={storageMode}
            onChange={(event) => onStorageModeChange(event.target.value as StorageMode)}
            size="xs"
            className="w-[200px]"
          >
            <option value="local">Local</option>
            <option value="cloud_hosted">Cloud (hosted)</option>
            <option value="cloud_byo">Cloud (BYO)</option>
          </Select>
        </div>
      )}

      {cloudSync && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-slate-400 dark:text-slate-500">Sync</span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => void cloudSync.syncActive()}
              disabled={!canSync}
              className="text-[10px] px-2 py-1 rounded-full text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700"
            >
              Active
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => void cloudSync.syncAll()}
              disabled={!canSync}
              className="text-[10px] px-2 py-1 rounded-full text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700"
            >
              All
            </Button>
          </div>
        </div>
      )}

      {syncMessage && <InlineStatus kind={syncMessage.status} message={syncMessage.message} />}

      {(cloudMigration || cloudProjects) && (
        <div className="border-t border-[var(--panel-border)] pt-2 space-y-3">
          {cloudMigration && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">Migration</span>
                  <span className="text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    {cloudMigration.unlinkedCount} unlinked
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setShowMigrationItems((v) => !v)}
                    className="text-[10px] px-2 py-1 rounded-full text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700"
                    title={showMigrationItems ? 'Hide details' : 'Show details'}
                  >
                    {showMigrationItems ? 'Hide' : 'Show'}
                  </Button>
                  {cloudMigration.status.kind === 'syncing' ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={cloudMigration.cancel}
                      className="text-[10px] px-2 py-1 rounded-full text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700"
                    >
                      Cancel
                    </Button>
                  ) : (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => void cloudMigration.migrateActive()}
                        disabled={!canMigrate}
                        className="text-[10px] px-2 py-1 rounded-full text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 gap-1"
                        title={auth.status === 'signed_in' ? 'Upload active local project' : 'Login required'}
                      >
                        <UploadCloud size={12} className="opacity-80" />
                        Active
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => void cloudMigration.migrateAll()}
                        disabled={!canMigrate}
                        className="text-[10px] px-2 py-1 rounded-full text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 gap-1"
                        title={auth.status === 'signed_in' ? 'Upload all local projects' : 'Login required'}
                      >
                        <UploadCloud size={12} className="opacity-80" />
                        All
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {migrationMessage && <InlineStatus kind={migrationMessage.status} message={migrationMessage.message} />}

              {showMigrationItems && cloudMigration.items.length > 0 && (
                <div className="pl-2 space-y-1">
                  {cloudMigration.items.map((it) => (
                    <div
                      key={it.sessionId}
                      className="px-2 py-1.5 rounded-md border border-[var(--panel-border)] bg-[var(--control-bg)]"
                    >
                      <div className="min-w-0">
                        <div className="text-[11px] text-slate-700 dark:text-slate-200 truncate">{it.title}</div>
                        <div className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
                          {it.status}
                          {it.message ? ` · ${it.message}` : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {cloudProjects && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">Cloud projects</span>
                  <span className="text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    {cloudSource.items.length}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {cloudSource.items.length > 3 && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setShowAllCloudProjects((v) => !v)}
                      className="text-[10px] px-2 py-1 rounded-full text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700"
                      title={showAllCloudProjects ? 'Show fewer' : 'Show all'}
                    >
                      {showAllCloudProjects ? 'Less' : 'All'}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => void cloudProjects.refresh()}
                    disabled={!canBrowseCloudProjects}
                    className="text-[10px] px-2 py-1 rounded-full text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 gap-1"
                    title={auth.status === 'signed_in' ? 'Refresh' : 'Login required'}
                  >
                    <RefreshCw size={12} className="opacity-80" />
                    Refresh
                  </Button>
                </div>
              </div>

              {projectsMessage && <InlineStatus kind={projectsMessage.status} message={projectsMessage.message} />}

              <div className="pl-2 space-y-1">
                {(showAllCloudProjects ? cloudSource.items : cloudSource.items.slice(0, 3)).map((item) => {
                  const project = item.data;
                  return (
                    <div
                      key={project.id}
                      className="px-2 py-1.5 rounded-md border border-[var(--panel-border)] bg-[var(--control-bg)]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[11px] text-slate-700 dark:text-slate-200 truncate">
                            {project.title ?? project.id}
                          </div>
                          <div className="text-[10px] text-slate-400 dark:text-slate-500">
                            Updated: {formatProjectTimestamp(project.updatedAt)}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => void cloudProjects.importFromCloud(project.id)}
                          disabled={!canBrowseCloudProjects}
                          className="text-[10px] px-2 py-1 rounded-full text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 gap-1"
                        >
                          <Download size={12} className="opacity-80" />
                          Import
                        </Button>
                      </div>
                    </div>
                  );
                })}

                {cloudSource.items.length === 0 && (
                  <div className="px-2 py-1 text-[10px] text-slate-400 dark:text-slate-500">No cloud projects yet.</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const ByoSupabaseSection: React.FC<{
  byoConfig: { url: string; anonKey: string };
  onByoConfigChange: (updates: { url?: string; anonKey?: string }) => void;
  onTestByoConfig: () => Promise<{ ok: boolean; error?: string }>;
}> = ({ byoConfig, onByoConfigChange, onTestByoConfig }) => {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<{ kind: 'idle' | 'error' | 'success'; message?: string }>({ kind: 'idle' });

  const handleTestByo = async () => {
    const result = await onTestByoConfig();
    if (result.ok) {
      setStatus({ kind: 'success', message: 'Schema OK' });
    } else {
      setStatus({ kind: 'error', message: result.error ?? 'Schema error' });
    }
  };

  return (
    <div className="px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-slate-400 dark:text-slate-500">BYO Supabase</span>
        <div className="flex items-center gap-1">
          <SectionToggle expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
          <Button
            type="button"
            variant="ghost"
            onClick={() => void handleTestByo()}
            className="text-[10px] px-2 py-1 rounded-full text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700"
          >
            Test
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="mt-2 space-y-2">
          <Input
            value={byoConfig.url}
            onChange={(e) => onByoConfigChange({ url: e.target.value })}
            placeholder="Supabase URL"
            size="sm"
          />
          <Input
            type="password"
            value={byoConfig.anonKey}
            onChange={(e) => onByoConfigChange({ anonKey: e.target.value })}
            placeholder="Anon key"
            size="sm"
          />
        </div>
      )}

      {status.kind !== 'idle' && (
        <div className="mt-2 text-[10px] text-slate-400 dark:text-slate-500">
          <span
            className={
              status.kind === 'error' ? 'text-rose-600 dark:text-rose-300' : 'text-emerald-600 dark:text-emerald-300'
            }
          >
            {status.message}
          </span>
        </div>
      )}
    </div>
  );
};

const LocalProjectsSection: React.FC<
  Pick<
    ProjectsMenuProps,
    | 'projects'
    | 'activeProjectId'
    | 'editingProjectId'
    | 'editingProjectTitle'
    | 'sortKey'
    | 'onSortChange'
    | 'onPreviewProjectSnapshot'
    | 'onClearProjectPreview'
    | 'onStartEditingProject'
    | 'onEditingProjectTitleChange'
    | 'onCommitProjectRename'
    | 'onCancelEditingProject'
    | 'onOpenProject'
    | 'onDeleteProject'
  >
> = ({
  projects,
  activeProjectId,
  editingProjectId,
  editingProjectTitle,
  sortKey,
  onSortChange,
  onPreviewProjectSnapshot,
  onClearProjectPreview,
  onStartEditingProject,
  onEditingProjectTitleChange,
  onCommitProjectRename,
  onCancelEditingProject,
  onOpenProject,
  onDeleteProject,
}) => {
  const source = useMemo(() => createLocalProjectsSource(projects), [projects]);

  const sortedItems = useMemo(() => {
    const next = [...source.items];
    if (sortKey === 'name') {
      next.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
      return next;
    }
    if (sortKey === 'created') {
      next.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      return next;
    }
    next.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    return next;
  }, [sortKey, source.items]);

  return (
    <div className="py-2">
      <div className="px-3 flex items-center justify-between gap-3">
        <label className="text-[10px] text-slate-400 dark:text-slate-500">Projects</label>
        <Select value={sortKey} onChange={(event) => onSortChange(event.target.value as SortKey)} size="xs" className="w-[200px]">
          <option value="updated">Updated (newest)</option>
          <option value="created">Created (newest)</option>
          <option value="name">Name (A-Z)</option>
        </Select>
      </div>

      <div className="px-2 pb-2 pt-2 max-h-[45vh] overflow-y-auto">
        {sortedItems.length === 0 ? (
          <div className="px-2 py-2 text-[11px] text-slate-400 dark:text-slate-500">No projects yet.</div>
        ) : (
          <div className="space-y-1">
            {sortedItems.map((item) => {
              const project = item.data;
              const isActive = project.id === activeProjectId;
              const isEditing = project.id === editingProjectId;
              return (
                <div
                  key={project.id}
                  className="px-2 py-1.5 rounded-md border border-[var(--panel-border)] bg-[var(--control-bg)] hover:bg-[var(--control-bg-hover)] transition-colors"
                  onMouseEnter={() => {
                    void onPreviewProjectSnapshot(project.id);
                  }}
                  onMouseLeave={() => {
                    onClearProjectPreview();
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <Input
                          value={editingProjectTitle}
                          onChange={(e) => onEditingProjectTitleChange(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void onCommitProjectRename(project);
                            }
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              onCancelEditingProject();
                            }
                          }}
                          onBlur={() => void onCommitProjectRename(project)}
                          size="sm"
                          autoFocus
                        />
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => onStartEditingProject(project)}
                          className="h-auto px-0 py-0 text-xs font-medium text-slate-700 dark:text-slate-200 truncate hover:text-blue-600 dark:hover:text-blue-400"
                          title={project.title}
                        >
                          {project.title}
                        </Button>
                      )}
                      <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                        Updated: {formatProjectTimestamp(project.updatedAt ?? project.createdAt)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {isEditing ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onMouseDown={(e) => {
                            e.preventDefault();
                          }}
                          onClick={onCancelEditingProject}
                          className="h-6 w-6 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                          title="Cancel"
                        >
                          <X size={12} />
                        </Button>
                      ) : (
                        <>
                          {isActive ? (
                            <span className="text-[10px] px-2 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                              Active
                            </span>
                          ) : (
                            <Button
                              type="button"
                              onClick={() => void onOpenProject(project.id)}
                              className="text-[10px] px-2 py-1 rounded-full text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700"
                            >
                              Continue
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => void onDeleteProject(project)}
                            className="h-6 w-6 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30"
                            title="Delete"
                          >
                            <Trash2 size={12} />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

const BackupSection: React.FC<{ activeProjectId: string | null; onExportProject: (sessionId: string) => Promise<void>; onImportProject: (file: File) => Promise<void> }> = ({
  activeProjectId,
  onExportProject,
  onImportProject,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [backupStatus, setBackupStatus] = useState<{ kind: 'idle' | 'error' | 'success'; message?: string }>({ kind: 'idle' });

  const handleExport = async () => {
    if (!activeProjectId) return;
    try {
      await onExportProject(activeProjectId);
      setBackupStatus({ kind: 'success', message: 'Exported' });
    } catch {
      setBackupStatus({ kind: 'error', message: 'Export failed' });
    }
  };

  const handleImport = async (file: File) => {
    try {
      await onImportProject(file);
      setBackupStatus({ kind: 'success', message: 'Imported' });
    } catch {
      setBackupStatus({ kind: 'error', message: 'Import failed' });
    }
  };

  return (
    <div className="py-2">
      <div className="px-3 flex items-center justify-between gap-2">
        <span className="text-[10px] text-slate-400 dark:text-slate-500">Backup</span>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void handleImport(file);
              event.currentTarget.value = '';
            }}
          />
          <Button
            type="button"
            variant="ghost"
            onClick={() => void handleExport()}
            disabled={!activeProjectId}
            className="text-[10px] px-2 py-1 rounded-full text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700"
          >
            Export
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => fileInputRef.current?.click()}
            className="text-[10px] px-2 py-1 rounded-full text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700"
          >
            Import
          </Button>
        </div>
      </div>

      {backupStatus.kind !== 'idle' && (
        <div className="px-3 pt-2 text-[10px] text-slate-400 dark:text-slate-500">
          <span
            className={
              backupStatus.kind === 'error' ? 'text-rose-600 dark:text-rose-300' : 'text-emerald-600 dark:text-emerald-300'
            }
          >
            {backupStatus.message}
          </span>
        </div>
      )}
    </div>
  );
};

const ProjectsMenu: React.FC<ProjectsMenuProps> = ({
  menuRef,
  projects,
  activeProjectId,
  editingProjectId,
  editingProjectTitle,
  sortKey,
  onSortChange,
  onPreviewProjectSnapshot,
  onClearProjectPreview,
  onStartEditingProject,
  onEditingProjectTitleChange,
  onCommitProjectRename,
  onCancelEditingProject,
  onOpenProject,
  onDeleteProject,
  onExportProject,
  onImportProject,
  byoConfig,
  onByoConfigChange,
  onTestByoConfig,
  storageMode,
  onStorageModeChange,
  cloudSync,
  cloudProjects,
  cloudMigration,
}) => {
  return (
    <div
      ref={menuRef}
      className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border shadow-lg bg-transparent"
      style={{ borderColor: 'var(--panel-border, #e5e7eb)', backgroundColor: 'var(--menu-bg, var(--panel-bg, #f3f4f6))' }}
    >
      <div className="divide-y divide-[var(--panel-border)]">
        {EXPERIMENTAL_CLOUD_ENABLED && (
          <>
            <CloudSection
              storageMode={storageMode}
              onStorageModeChange={onStorageModeChange}
              cloudSync={cloudSync}
              cloudProjects={cloudProjects}
              cloudMigration={cloudMigration}
            />
            <ByoSupabaseSection
              byoConfig={byoConfig}
              onByoConfigChange={onByoConfigChange}
              onTestByoConfig={onTestByoConfig}
            />
          </>
        )}
        <LocalProjectsSection
          projects={projects}
          activeProjectId={activeProjectId}
          editingProjectId={editingProjectId}
          editingProjectTitle={editingProjectTitle}
          sortKey={sortKey}
          onSortChange={onSortChange}
          onPreviewProjectSnapshot={onPreviewProjectSnapshot}
          onClearProjectPreview={onClearProjectPreview}
          onStartEditingProject={onStartEditingProject}
          onEditingProjectTitleChange={onEditingProjectTitleChange}
          onCommitProjectRename={onCommitProjectRename}
          onCancelEditingProject={onCancelEditingProject}
          onOpenProject={onOpenProject}
          onDeleteProject={onDeleteProject}
        />
        <BackupSection activeProjectId={activeProjectId} onExportProject={onExportProject} onImportProject={onImportProject} />
      </div>
    </div>
  );
};

export default ProjectsMenu;
