import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearOpenCodeGoApiKey, getOpenCodeGoApiKey, setOpenCodeGoApiKey } from './openCodeGoCredentials';
import { buildSessionSettings } from '../utils/sessionSettings';
import { DEFAULT_AI_CONFIG, DEFAULT_APP_STATE } from '../constants';

describe('personal OpenCode Go credential storage', () => {
  let values: Map<string, string>;

  beforeEach(() => {
    values = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (name: string) => values.get(name) ?? null,
      setItem: (name: string, value: string) => values.set(name, value),
      removeItem: (name: string) => values.delete(name),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('stores and clears the key independently from project settings', () => {
    setOpenCodeGoApiKey('  personal-go-test-key  ');
    expect(getOpenCodeGoApiKey()).toBe('personal-go-test-key');
    expect([...values.keys()]).toEqual(['dc_opencode_go_api_key']);
    const settings = buildSessionSettings(DEFAULT_APP_STATE, { ...DEFAULT_AI_CONFIG, provider: 'opencode-go' });
    expect(JSON.stringify(settings)).not.toContain('personal-go-test-key');
    clearOpenCodeGoApiKey();
    expect(getOpenCodeGoApiKey()).toBe('');
    expect(values.size).toBe(0);
  });

  it('does not expose storage exceptions or the key in error messages', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('private-value'); },
      setItem: () => { throw new Error('private-value'); },
    });
    expect(getOpenCodeGoApiKey()).toBe('');
    expect(() => setOpenCodeGoApiKey('private-value')).toThrow('Browser storage is unavailable');
    try {
      setOpenCodeGoApiKey('private-value');
    } catch (error: unknown) {
      expect(String(error)).not.toContain('private-value');
    }
  });
});
