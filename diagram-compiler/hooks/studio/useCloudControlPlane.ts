import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HistorySession } from '../../services/history/types';
import type { ImportSessionBundleOptions, SessionBundle } from '../../services/history/bundle';
import { fetchRemoteConflictCopy, saveLocalConflictCopy } from '../../services/storage/cloudConflictRecovery';
import {
  createSupabaseByoProvider,
  createSupabaseHostedProvider,
  decodeProjectBundleFromBlob,
  encodeProjectBundleToBlob,
  getCloudLink,
  setCloudLink,
  StorageConflictError,
  type ProjectMeta,
  type StorageProvider,
  type StorageProviderKind,
} from '../../services/storage';

export type CloudMode = 'cloud_hosted' | 'cloud_byo';

export type CloudSyncStatus =
  | { kind: 'idle' }
  | { kind: 'syncing'; message: string }
  | { kind: 'success'; message: string; syncedAt: number }
  | { kind: 'error'; message: string };

export type CloudSyncConflict = {
  sessionId: string;
  remoteProjectId: string;
  providerKind: StorageProviderKind;
  title: string;
};

export type CloudSyncControls = {
  status: CloudSyncStatus;
  conflict: CloudSyncConflict | null;
  syncActive: () => Promise<void>;
  syncAll: () => Promise<void>;
  saveLocalCopy: () => Promise<void>;
  openRemoteCopy: () => Promise<void>;
};

export type CloudProjectsStatus =
  | { kind: 'idle' }
  | { kind: 'loading'; message: string }
  | { kind: 'success'; message: string; fetchedAt: number }
  | { kind: 'error'; message: string };

export type CloudMigrationItemStatus = 'pending' | 'syncing' | 'success' | 'skipped' | 'error';

export type CloudMigrationItem = {
  sessionId: string;
  title: string;
  status: CloudMigrationItemStatus;
  message?: string;
};

export type CloudMigrationStatus =
  | { kind: 'idle' }
  | { kind: 'syncing'; message: string; done: number; total: number }
  | { kind: 'success'; message: string; syncedAt: number }
  | { kind: 'cancelled'; message: string }
  | { kind: 'error'; message: string };

const resolveProviderKind = (mode: CloudMode): StorageProviderKind => {
  return mode === 'cloud_byo' ? 'supabase_byo' : 'supabase_hosted';
};

const resolveProvider = (mode: CloudMode, byoConfig: { url: string; anonKey: string }): StorageProvider => {
  return mode === 'cloud_byo' ? createSupabaseByoProvider(byoConfig) : createSupabaseHostedProvider();
};

const ensureProviderReady = async (provider: StorageProvider): Promise<{ ok: true } | { ok: false; error: string }> => {
  const init = await provider.init();
  if (!init.ok) return { ok: false, error: init.error ?? 'Cloud provider not ready' };
  return { ok: true };
};

export const useCloudControlPlane = (args: {
  enabled: boolean;
  mode: CloudMode;
  byoConfig: { url: string; anonKey: string };
  localProjects: HistorySession[];
  activeProjectId: string | null;
  exportProjectBundle: (sessionId: string) => Promise<SessionBundle | null>;
  importProjectBundle: (bundle: SessionBundle, options?: ImportSessionBundleOptions) => Promise<{ id: string } | null>;
  openProject: (sessionId: string) => Promise<void> | void;
}): {
  providerKind: StorageProviderKind;
  sync: CloudSyncControls;
  projects: { status: CloudProjectsStatus; projects: ProjectMeta[]; refresh: () => Promise<void>; importFromCloud: (projectId: string) => Promise<void> };
  migration: {
    status: CloudMigrationStatus;
    items: CloudMigrationItem[];
    unlinkedCount: number;
    migrateAll: () => Promise<void>;
    migrateActive: () => Promise<void>;
    cancel: () => void;
    reset: () => void;
  };
} => {
  const { enabled, mode, byoConfig, localProjects, activeProjectId, exportProjectBundle, importProjectBundle, openProject } =
    args;

  const providerKind = useMemo(() => resolveProviderKind(mode), [mode]);
  const provider = useMemo(() => resolveProvider(mode, byoConfig), [byoConfig, mode]);

  const [syncStatus, setSyncStatus] = useState<CloudSyncStatus>({ kind: 'idle' });
  const [syncConflict, setSyncConflict] = useState<CloudSyncConflict | null>(null);

  useEffect(() => {
    // A conflict belongs to one provider/connection. Never resolve it using
    // a different hosted/BYO session after the user switches configuration.
    setSyncConflict(null);
  }, [enabled, providerKind, byoConfig.url, byoConfig.anonKey]);
  const [projectsStatus, setProjectsStatus] = useState<CloudProjectsStatus>({ kind: 'idle' });
  const [cloudProjects, setCloudProjects] = useState<ProjectMeta[]>([]);

  const [migrationStatus, setMigrationStatus] = useState<CloudMigrationStatus>({ kind: 'idle' });
  const [migrationItems, setMigrationItems] = useState<CloudMigrationItem[]>([]);
  const cancelMigrationRef = useRef(false);

  const unlinkedCount = useMemo(() => {
    if (!enabled) return 0;
    let count = 0;
    for (const project of localProjects) {
      const existing = getCloudLink(project.id);
      if (!existing || existing.providerKind !== providerKind) {
        count += 1;
      }
    }
    return count;
  }, [enabled, localProjects, providerKind]);

  const syncSession = useCallback(
    async (sessionId: string) => {
      if (!enabled) return false;
      setSyncConflict(null);
      setSyncStatus({ kind: 'syncing', message: 'Exporting project…' });

      const bundle = await exportProjectBundle(sessionId);
      if (!bundle) {
        setSyncStatus({ kind: 'error', message: 'Project not found' });
        return false;
      }

      const ready = await ensureProviderReady(provider);
      if (ready.ok === false) {
        setSyncStatus({ kind: 'error', message: ready.error });
        return false;
      }

      const blob = encodeProjectBundleToBlob(bundle);
      const title = bundle.session.title;

      const existing = getCloudLink(sessionId);
      const canReuse = existing && existing.providerKind === providerKind && typeof existing.remoteProjectId === 'string';

      try {
        if (!canReuse) {
          setSyncStatus({ kind: 'syncing', message: 'Creating cloud project…' });
          const meta = await provider.createProject({ title: title ?? undefined, blob });
          setCloudLink(sessionId, {
            providerKind,
            remoteProjectId: meta.id,
            remoteVersion: meta.version,
          });
          setSyncStatus({ kind: 'success', message: 'Uploaded', syncedAt: Date.now() });
          return true;
        }

        setSyncStatus({ kind: 'syncing', message: 'Uploading changes…' });
        const meta = await provider.putProject({
          id: existing.remoteProjectId,
          blob,
          baseVersion: existing.remoteVersion,
          title: title ?? undefined,
        });
        setCloudLink(sessionId, {
          providerKind,
          remoteProjectId: meta.id,
          remoteVersion: meta.version,
        });
        setSyncStatus({ kind: 'success', message: 'Synced', syncedAt: Date.now() });
        return true;
      } catch (e: unknown) {
        if (e instanceof StorageConflictError && canReuse && existing) {
          setSyncConflict({
            sessionId,
            remoteProjectId: existing.remoteProjectId,
            providerKind,
            title: title || 'Project',
          });
          setSyncStatus({ kind: 'error', message: 'Conflict: the cloud project changed. Choose a non-destructive copy below.' });
          return false;
        }
        const message = e instanceof Error ? e.message : 'Cloud sync failed';
        setSyncStatus({ kind: 'error', message });
        return false;
      }
    },
    [enabled, exportProjectBundle, provider, providerKind]
  );

  const syncActive = useCallback(async () => {
    if (!activeProjectId) {
      setSyncStatus({ kind: 'error', message: 'No active project' });
      return;
    }
    await syncSession(activeProjectId);
  }, [activeProjectId, syncSession]);

  const syncAll = useCallback(async () => {
    if (!enabled) return;
    if (localProjects.length === 0) {
      setSyncStatus({ kind: 'error', message: 'No projects to sync' });
      return;
    }
    for (let i = 0; i < localProjects.length; i += 1) {
      const p = localProjects[i];
      setSyncStatus({ kind: 'syncing', message: `Syncing ${i + 1}/${localProjects.length}…` });
      if (!(await syncSession(p.id))) return;
    }
  }, [enabled, localProjects, syncSession]);

  const saveLocalCopy = useCallback(async () => {
    const conflict = syncConflict;
    if (!enabled || !conflict || conflict.providerKind !== providerKind) return;
    setSyncStatus({ kind: 'syncing', message: 'Saving a separate cloud copy…' });
    try {
      const ready = await ensureProviderReady(provider);
      if (ready.ok === false) throw new Error(ready.error);
      const bundle = await exportProjectBundle(conflict.sessionId);
      if (!bundle) throw new Error('The original local project is no longer available.');
      const meta = await saveLocalConflictCopy(provider, bundle);
      setCloudLink(conflict.sessionId, {
        providerKind, remoteProjectId: meta.id, remoteVersion: meta.version,
      });
      setSyncConflict(null);
      setSyncStatus({ kind: 'success', message: 'Local project saved as a new cloud copy. Original remote kept.', syncedAt: Date.now() });
    } catch (error: unknown) {
      setSyncStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Failed to save a cloud copy' });
    }
  }, [enabled, syncConflict, providerKind, provider, exportProjectBundle]);

  const openRemoteCopy = useCallback(async () => {
    const conflict = syncConflict;
    if (!enabled || !conflict || conflict.providerKind !== providerKind) return;
    setSyncStatus({ kind: 'syncing', message: 'Opening the cloud version as a local copy…' });
    try {
      const ready = await ensureProviderReady(provider);
      if (ready.ok === false) throw new Error(ready.error);
      const { meta, bundle } = await fetchRemoteConflictCopy(provider, conflict.remoteProjectId);
      const imported = await importProjectBundle(bundle, { mode: 'new', setActive: true });
      if (!imported?.id) throw new Error('Could not create a local project copy.');
      setCloudLink(imported.id, {
        providerKind, remoteProjectId: meta.id, remoteVersion: meta.version,
      });
      await openProject(imported.id);
      setSyncConflict(null);
      setSyncStatus({ kind: 'success', message: 'Cloud version opened as a new local project; the original local project is unchanged.', syncedAt: Date.now() });
    } catch (error: unknown) {
      setSyncStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Failed to open a cloud copy' });
    }
  }, [enabled, syncConflict, providerKind, provider, importProjectBundle, openProject]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setProjectsStatus({ kind: 'loading', message: 'Loading cloud projects…' });
    const ready = await ensureProviderReady(provider);
    if (ready.ok === false) {
      setProjectsStatus({ kind: 'error', message: ready.error });
      return;
    }
    try {
      const items = await provider.listProjects();
      setCloudProjects(items);
      setProjectsStatus({ kind: 'success', message: `${items.length} projects`, fetchedAt: Date.now() });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to load cloud projects';
      setProjectsStatus({ kind: 'error', message });
    }
  }, [enabled, provider]);

  const importFromCloud = useCallback(
    async (projectId: string) => {
      if (!enabled) return;
      setProjectsStatus({ kind: 'loading', message: 'Downloading project…' });
      const ready = await ensureProviderReady(provider);
      if (ready.ok === false) {
        setProjectsStatus({ kind: 'error', message: ready.error });
        return;
      }
      try {
        const remote = await provider.getProject(projectId);
        if (!remote) {
          setProjectsStatus({ kind: 'error', message: 'Project not found' });
          return;
        }
        const bundle = decodeProjectBundleFromBlob(remote.blob);
        const imported = await importProjectBundle(bundle, { mode: 'new', setActive: true });
        if (!imported?.id) {
          setProjectsStatus({ kind: 'error', message: 'Import failed' });
          return;
        }
        setCloudLink(imported.id, {
          providerKind,
          remoteProjectId: remote.meta.id,
          remoteVersion: remote.meta.version,
        });
        await openProject(imported.id);
        setProjectsStatus({ kind: 'success', message: 'Imported', fetchedAt: Date.now() });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Import from cloud failed';
        setProjectsStatus({ kind: 'error', message });
      }
    },
    [enabled, importProjectBundle, openProject, provider, providerKind]
  );

  const cancelMigration = useCallback(() => {
    cancelMigrationRef.current = true;
    setMigrationStatus({ kind: 'cancelled', message: 'Cancelled' });
  }, []);

  const resetMigration = useCallback(() => {
    cancelMigrationRef.current = false;
    setMigrationStatus({ kind: 'idle' });
    setMigrationItems([]);
  }, []);

  const migrate = useCallback(
    async (sessionIds: string[]) => {
      if (!enabled) return;
      cancelMigrationRef.current = false;
      setMigrationStatus({ kind: 'syncing', message: 'Starting…', done: 0, total: Math.max(1, sessionIds.length) });

      const ready = await ensureProviderReady(provider);
      if (ready.ok === false) {
        setMigrationStatus({ kind: 'error', message: ready.error });
        return;
      }

      const sessions = sessionIds
        .map((id) => localProjects.find((p) => p.id === id) ?? null)
        .filter((p): p is HistorySession => !!p);

      const initialItems: CloudMigrationItem[] = sessions.map((p) => ({
        sessionId: p.id,
        title: p.title ?? 'Project',
        status: 'pending',
      }));
      setMigrationItems(initialItems);

      const total = initialItems.length;
      let done = 0;
      let failed = 0;

      for (const project of sessions) {
        if (cancelMigrationRef.current) return;

        const existing = getCloudLink(project.id);
        const alreadyLinked = !!existing && existing.providerKind === providerKind;
        if (alreadyLinked) {
          done += 1;
          setMigrationItems((prev) =>
            prev.map((it) => (it.sessionId === project.id ? { ...it, status: 'skipped', message: 'Already linked' } : it))
          );
          setMigrationStatus({ kind: 'syncing', message: `Migrating ${done}/${total}…`, done, total });
          continue;
        }

        setMigrationItems((prev) =>
          prev.map((it) => (it.sessionId === project.id ? { ...it, status: 'syncing', message: 'Uploading…' } : it))
        );
        setMigrationStatus({ kind: 'syncing', message: `Migrating ${done + 1}/${total}…`, done, total });

        const bundle = await exportProjectBundle(project.id);
        if (!bundle) {
          done += 1;
          failed += 1;
          setMigrationItems((prev) =>
            prev.map((it) => (it.sessionId === project.id ? { ...it, status: 'error', message: 'Project not found' } : it))
          );
          setMigrationStatus({ kind: 'syncing', message: `Migrating ${done}/${total}…`, done, total });
          continue;
        }

        try {
          const blob = encodeProjectBundleToBlob(bundle);
          const meta = await provider.createProject({ title: bundle.session.title ?? undefined, blob });
          setCloudLink(project.id, {
            providerKind,
            remoteProjectId: meta.id,
            remoteVersion: meta.version,
          });
          done += 1;
          setMigrationItems((prev) =>
            prev.map((it) => (it.sessionId === project.id ? { ...it, status: 'success', message: 'Uploaded' } : it))
          );
          setMigrationStatus({ kind: 'syncing', message: `Migrating ${done}/${total}…`, done, total });
        } catch (e: unknown) {
          done += 1;
          failed += 1;
          const message = e instanceof Error ? e.message : 'Upload failed';
          setMigrationItems((prev) =>
            prev.map((it) => (it.sessionId === project.id ? { ...it, status: 'error', message } : it))
          );
          setMigrationStatus({ kind: 'syncing', message: `Migrating ${done}/${total}…`, done, total });
        }
      }

      setMigrationStatus({
        kind: 'success',
        message: failed > 0 ? `Migrated with errors (${failed})` : 'Migrated',
        syncedAt: Date.now(),
      });

      void refresh();
    },
    [enabled, exportProjectBundle, localProjects, provider, providerKind, refresh]
  );

  const migrateAll = useCallback(async () => {
    await migrate(localProjects.map((p) => p.id));
  }, [localProjects, migrate]);

  const migrateActive = useCallback(async () => {
    if (!activeProjectId) return;
    await migrate([activeProjectId]);
  }, [activeProjectId, migrate]);

  return {
    providerKind,
    sync: { status: syncStatus, conflict: syncConflict, syncActive, syncAll, saveLocalCopy, openRemoteCopy },
    projects: { status: projectsStatus, projects: cloudProjects, refresh, importFromCloud },
    migration: {
      status: migrationStatus,
      items: migrationItems,
      unlinkedCount,
      migrateAll,
      migrateActive,
      cancel: cancelMigration,
      reset: resetMigration,
    },
  };
};

