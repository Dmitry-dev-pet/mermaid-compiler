// Credentials stay outside AIConfig and project/session exports.
const STORAGE_KEY = 'dc_opencode_go_api_key';

export const getOpenCodeGoApiKey = (): string => {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
};

export const setOpenCodeGoApiKey = (value: string): void => {
  const key = value.trim();
  try {
    if (!globalThis.localStorage) throw new Error('Storage unavailable');
    if (key) globalThis.localStorage.setItem(STORAGE_KEY, key);
    else globalThis.localStorage.removeItem(STORAGE_KEY);
  } catch {
    throw new Error('Browser storage is unavailable. Allow local storage to save your OpenCode Go key.');
  }
};

export const clearOpenCodeGoApiKey = (): void => setOpenCodeGoApiKey('');
