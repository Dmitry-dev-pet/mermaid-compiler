import { constants } from 'node:fs';
import { mkdir, lstat, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

// The CLI acquires the fixed loopback port before opening this store. Only that
// process owns refreshes; all writes in the process also pass through one queue.
const MAX_BYTES = 2 * 1024 * 1024;
const CLIENT_ID = /^[A-Za-z0-9._:-]{1,256}$/;
const HOST_ID = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireValue(condition) {
  if (!condition) throw new Error('The local ChatGPT session file is invalid.');
}

const text = (value, max = 65536) => typeof value === 'string' && value.length > 0 && value.length <= max;

export function validateStore(value) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value));
  requireValue(value.version === 1 && HOST_ID.test(value.hostId));
  requireValue(Array.isArray(value.accounts) && value.accounts.length <= 32);
  const ids = new Set();
  for (const account of value.accounts) {
    requireValue(account && typeof account === 'object' && CLIENT_ID.test(account.id));
    requireValue(account.id !== 'dynamic_agent_client' && !ids.has(account.id));
    ids.add(account.id);
    requireValue(account.subject === null || text(account.subject, 1024));
    requireValue(account.email === null || text(account.email, 1024));
    requireValue(account.issuer === 'https://auth.openai.com');
    if (account.tokens !== null) {
      const t = account.tokens;
      requireValue(t && typeof t === 'object' && text(t.accessToken));
      requireValue(t.refreshToken === null || text(t.refreshToken));
      requireValue(text(t.idToken) && text(t.nonce, 256));
      requireValue(Number.isFinite(t.expiresAt) && t.expiresAt > 0);
      requireValue(Array.isArray(t.scopes) && t.scopes.length <= 32 && t.scopes.every(s => text(s, 128)));
      requireValue(typeof t.pendingIdentity === 'boolean');
      requireValue(account.subject !== null);
    }
  }
  requireValue(value.activeAccountId === null || ids.has(value.activeAccountId));
  if (value.activeAccountId !== null) {
    requireValue(value.accounts.find(a => a.id === value.activeAccountId).subject !== null);
  }
  return value;
}

function ensureOwned(stat, directory = false) {
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) {
    throw new Error('ChatGPT session storage must use a regular private file and directory.');
  }
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error('ChatGPT session storage belongs to another user.');
  }
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    throw new Error('ChatGPT session storage must be accessible only to its owner.');
  }
}

export class CredentialStore {
  #directory;
  #path;
  #queue = Promise.resolve();

  constructor(directory) {
    this.#directory = directory;
    this.#path = join(directory, 'session.json');
  }

  async initialize() {
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    ensureOwned(await lstat(this.#directory), true);
    let handle;
    try {
      handle = await open(this.#path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const stat = await handle.stat();
      ensureOwned(stat);
      if (stat.size > MAX_BYTES) throw new Error('The local ChatGPT session file is too large.');
      return validateStore(JSON.parse(await handle.readFile('utf8')));
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        // Do not include parser snippets: the file contains OAuth credentials.
        throw new Error('Could not safely read the local ChatGPT session. Check its owner and permissions.');
      }
    } finally {
      await handle?.close();
    }
    const initial = { version: 1, hostId: `urn:uuid:${randomUUID()}`, activeAccountId: null, accounts: [] };
    await this.save(initial);
    return initial;
  }

  save(value) {
    validateStore(value);
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized) > MAX_BYTES) throw new Error('The local ChatGPT session is too large.');
    const write = this.#queue.then(() => this.#write(serialized));
    this.#queue = write.catch(() => {});
    return write;
  }

  async #write(serialized) {
    ensureOwned(await lstat(this.#directory), true);
    try {
      ensureOwned(await lstat(this.#path));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const temporary = join(this.#directory, `.session-${randomBytes(12).toString('hex')}.tmp`);
    let handle;
    try {
      handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, this.#path);
      // Preserve the atomic replacement across a crash on POSIX hosts.
      if (process.platform !== 'win32') {
        const directory = await open(this.#directory, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
        try { await directory.sync(); } finally { await directory.close(); }
      }
    } catch {
      throw new Error('Could not safely save the ChatGPT session. Check free space and private storage permissions.');
    } finally {
      await handle?.close();
      await unlink(temporary).catch(() => {});
    }
  }
}
