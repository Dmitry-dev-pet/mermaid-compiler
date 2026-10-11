import { describe, expect, it } from 'vitest';
import { readWorkspaceMode, saveWorkspaceMode } from './workspaceMode';

describe('workspace mode', () => {
  it('defaults to Simple on first load and ignores invalid stored values', () => {
    expect(readWorkspaceMode({ getItem: () => null })).toBe('simple');
    expect(readWorkspaceMode({ getItem: () => 'unsupported' })).toBe('simple');
  });

  it('restores Studio and the user choice across reloads', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    saveWorkspaceMode('studio', storage);
    expect(readWorkspaceMode(storage)).toBe('studio');
    saveWorkspaceMode('simple', storage);
    expect(readWorkspaceMode(storage)).toBe('simple');
  });

  it('safely defaults without browser storage and ignores write failures', () => {
    expect(readWorkspaceMode({ getItem: () => { throw Error('blocked'); } })).toBe('simple');
    expect(() => saveWorkspaceMode('studio', { setItem: () => { throw Error('blocked'); } })).not.toThrow();
  });
});
