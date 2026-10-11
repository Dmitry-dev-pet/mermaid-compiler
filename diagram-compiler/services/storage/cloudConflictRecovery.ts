import type { SessionBundle } from '../history/bundle';
import { decodeProjectBundleFromBlob, encodeProjectBundleToBlob } from './projectBlob';
import type { ProjectMeta, StorageProvider } from './types';

// A conflict never authorizes overwrite or delete. Always create/import separate copies.
export const saveLocalConflictCopy = async (
  provider: Pick<StorageProvider, 'createProject'>,
  bundle: SessionBundle,
): Promise<ProjectMeta> => {
  const title = bundle.session.title?.trim() || 'Project';
  return provider.createProject({
    title: `${title} (local conflict copy)`,
    blob: encodeProjectBundleToBlob(bundle),
  });
};

export const fetchRemoteConflictCopy = async (
  provider: Pick<StorageProvider, 'getProject'>,
  remoteProjectId: string,
): Promise<{ meta: ProjectMeta; bundle: SessionBundle }> => {
  const remote = await provider.getProject(remoteProjectId);
  if (!remote) throw new Error('The remote project is no longer available.');
  return { meta: remote.meta, bundle: decodeProjectBundleFromBlob(remote.blob) };
};
