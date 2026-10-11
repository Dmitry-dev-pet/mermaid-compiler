export type WorkspaceMode = 'simple' | 'studio';

const STORAGE_KEY = 'dc_workspace_mode';

export const readWorkspaceMode = (storage?: Pick<Storage, 'getItem'>): WorkspaceMode => {
  try {
    const value = (storage ?? globalThis.localStorage)?.getItem(STORAGE_KEY);
    return value === 'studio' ? 'studio' : 'simple';
  } catch {
    return 'simple';
  }
};

export const saveWorkspaceMode = (mode: WorkspaceMode, storage?: Pick<Storage, 'setItem'>): void => {
  try {
    (storage ?? globalThis.localStorage)?.setItem(STORAGE_KEY, mode);
  } catch {
    // The editor remains usable if browser storage is unavailable.
  }
};
