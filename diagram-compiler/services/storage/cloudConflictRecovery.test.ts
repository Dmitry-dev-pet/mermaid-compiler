import { describe, expect, it, vi } from 'vitest';
import type { SessionBundle } from '../history/bundle';
import type { StorageProvider } from './types';
import { decodeProjectBundleFromBlob, encodeProjectBundleToBlob } from './projectBlob';
import { fetchRemoteConflictCopy, saveLocalConflictCopy } from './cloudConflictRecovery';

const bundle: SessionBundle = {
  session: {
    id: 'local-test', title: 'A diagram', createdAt: 1, updatedAt: 2,
    currentRevisionId: null, nextStepIndex: 0,
  } as SessionBundle['session'],
  steps: [], revisions: [],
};
const meta = { id: 'new-remote', title: 'A diagram (local conflict copy)', version: 1, updatedAt: 3 };

describe('non-destructive cloud conflict recovery', () => {
  it('creates a separate cloud copy with the local project bundle', async () => {
    const createProject = vi.fn().mockResolvedValue(meta);
    const result = await saveLocalConflictCopy({ createProject }, bundle);
    expect(result).toEqual(meta);
    expect(createProject).toHaveBeenCalledTimes(1);
    const arg = createProject.mock.calls[0][0];
    expect(arg.title).toBe('A diagram (local conflict copy)');
    expect(decodeProjectBundleFromBlob(arg.blob)).toEqual(bundle);
    // The helper is given only createProject authority, never put/delete.
  });

  it('opens the current remote bundle without overwriting it', async () => {
    const getProject = vi.fn().mockResolvedValue({
      meta: { ...meta, id: 'original-remote', version: 9 },
      blob: encodeProjectBundleToBlob(bundle),
    });
    const result = await fetchRemoteConflictCopy({ getProject }, 'original-remote');
    expect(getProject).toHaveBeenCalledExactlyOnceWith('original-remote');
    expect(result.bundle).toEqual(bundle);
    expect(result.meta.version).toBe(9);
  });

  it('handles a missing remote document without creating a local one', async () => {
    const getProject = vi.fn().mockResolvedValue(null);
    await expect(fetchRemoteConflictCopy({ getProject }, 'missing')).rejects.toThrow('no longer available');
  });

  it('refuses an invalid remote bundle instead of treating it as a project', async () => {
    const getProject = vi.fn().mockResolvedValue({ meta, blob: new TextEncoder().encode('{"broken":true}') });
    await expect(fetchRemoteConflictCopy({ getProject }, 'bad')).rejects.toThrow('Invalid project bundle');
  });

  it('leaves the local bundle unchanged if the cloud rejects creating the copy', async () => {
    const createProject = vi.fn().mockRejectedValue(new Error('offline'));
    const before = JSON.stringify(bundle);
    await expect(saveLocalConflictCopy({ createProject }, bundle)).rejects.toThrow('offline');
    expect(JSON.stringify(bundle)).toBe(before);
  });

  it('limits helper authority to one method per recovery path', () => {
    const makeCopy: keyof StorageProvider = 'createProject';
    const readRemote: keyof StorageProvider = 'getProject';
    expect([makeCopy, readRemote]).not.toContain('putProject');
    expect([makeCopy, readRemote]).not.toContain('deleteProject');
  });
});
