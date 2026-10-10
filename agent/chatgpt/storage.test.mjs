import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, chmod, symlink, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore } from './storage.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mermaid-chatgpt-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, store: new CredentialStore(directory) };
}

test('the installation ID survives restart and account logout', async t => {
  const { directory, store } = await fixture(t);
  const first = await store.initialize();
  assert.match(first.hostId, /^urn:uuid:/);
  assert.deepEqual(await new CredentialStore(directory).initialize(), first);
  await store.save({ ...first, accounts: [], activeAccountId: null });
  assert.equal((await store.initialize()).hostId, first.hostId);
});

test('session files are private and concurrent writes replace complete snapshots', async t => {
  const { directory, store } = await fixture(t);
  const initial = await store.initialize();
  const account = { id: 'oaiapp_test', issuer: 'https://auth.openai.com', subject: 'test-user', email: null, tokens: null };
  await Promise.all([
    store.save({ ...initial, accounts: [account], activeAccountId: account.id }),
    store.save(initial),
  ]);
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'session.json'), 'utf8')), initial);
  if (process.platform !== 'win32') {
    assert.equal((await stat(join(directory, 'session.json'))).mode & 0o777, 0o600);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
  }
  assert.deepEqual(await readdir(directory), ['session.json']);
});

test('unsafe existing file permissions are rejected without returning contents', async t => {
  if (process.platform === 'win32') return t.skip('POSIX permission check');
  const { directory, store } = await fixture(t);
  await store.initialize();
  await chmod(join(directory, 'session.json'), 0o644);
  await assert.rejects(store.initialize(), /Could not safely read/);
});

test('a credential-file symlink cannot read or overwrite another file', async t => {
  if (process.platform === 'win32') return t.skip('POSIX symlink check');
  const { directory, store } = await fixture(t);
  const initial = await store.initialize();
  const target = join(directory, 'target.json');
  const { writeFile } = await import('node:fs/promises');
  await writeFile(target, 'synthetic private material', { mode: 0o600 });
  await rm(join(directory, 'session.json'));
  await symlink(target, join(directory, 'session.json'));
  await assert.rejects(store.initialize(), /Could not safely read/);
  await assert.rejects(store.save(initial));
  assert.equal(await readFile(target, 'utf8'), 'synthetic private material');
});

test('invalid or partially written data is never accepted as an authenticated account', async t => {
  const { store } = await fixture(t);
  const initial = await store.initialize();
  assert.throws(() => store.save({ ...initial, activeAccountId: 'missing' }), /invalid/);
  assert.throws(() => store.save({ ...initial, accounts: [{ id: 'dynamic_agent_client' }] }), /invalid/);
  assert.deepEqual(await store.initialize(), initial);
});
