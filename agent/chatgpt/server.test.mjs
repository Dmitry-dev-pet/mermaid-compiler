import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { startChatGPTAgent } from './server.mjs';
import { AgentError } from './protocol.mjs';

const deferred = () => { let resolve; const promise = new Promise(a => { resolve = a; }); return { promise, resolve }; };
const status = () => ({ agent: 'mermaid-chatgpt', protocolVersion: 1, connected: false, activeAccountId: null, accounts: [], login: null, usage: { state: 'unverified' } });

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'mermaid-server-test-'));
  const distDir = join(directory, 'dist');
  await mkdir(join(distDir, 'assets'), { recursive: true });
  await writeFile(join(distDir, 'index.html'), '<!doctype html><title>Mermaid test workspace</title>');
  await writeFile(join(distDir, 'assets', 'app.js'), 'export const editor = true;');
  const calls = [];
  const service = {
    status,
    async login(body, browser) { calls.push(['login', body, browser]); return { ok: true, authUrl: 'https://auth.openai.com/api/accounts/authorize?state=synthetic-state' }; },
    async callback(query, browser) { calls.push(['callback', Object.fromEntries(query), browser]); return { ok: true, connected: true }; },
    cancelLogin() { calls.push(['cancel']); return { ok: true }; },
    async logout(accountId) { calls.push(['logout', accountId]); return { ok: true }; },
    async selectAccount(accountId) { calls.push(['account', accountId]); return { ok: true }; },
    async models() { return { models: [{ id: 'synthetic-model', name: 'Synthetic model' }], accountId: 'synthetic-account' }; },
    async generate(body, signal) { calls.push(['generate', body, signal]); return { text: 'flowchart TD\nA --> B' }; },
    async close() {},
    ...options.service,
  };
  const store = { async initialize() { calls.push(['initialize']); return {}; } };
  const agent = await startChatGPTAgent({ port: 0, distDir, store, createService: () => service, ...options.agent });
  t.after(async () => { await agent.close(); await rm(directory, { recursive: true, force: true }); });
  const page = await fetch(agent.origin);
  assert.equal(page.status, 200);
  const setCookie = page.headers.get('set-cookie');
  const cookie = setCookie.split(';')[0];
  await page.text();
  const request = (path, { headers, ...init } = {}) => fetch(agent.origin + path, { ...init, headers: { cookie, ...headers } });
  const post = (path, body = {}, init = {}) => request(path, {
    method: 'POST', body: JSON.stringify(body), ...init,
    headers: { origin: agent.origin, 'content-type': 'application/json', ...init.headers },
  });
  return { agent, directory, distDir, calls, service, cookie, setCookie, request, post };
}

function rawRequest(origin, path, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const url = new URL(origin);
    const req = httpRequest({ hostname: url.hostname, port: url.port, path, method, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('only the local workspace can bootstrap a browser session and access the API', async t => {
  const f = await fixture(t);
  assert.match(f.setCookie, /^mermaid_chatgpt_local=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Lax; Path=\/; Max-Age=28800$/);
  const anonymous = await fetch(f.agent.origin + '/api/chatgpt/status');
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.headers.get('set-cookie'), null);
  assert.equal((await anonymous.json()).error.code, 'local_session_required');
  const own = await f.request('/api/chatgpt/status');
  assert.deepEqual(await own.json(), status());
  assert.equal(own.headers.get('access-control-allow-origin'), null);
  assert.equal(own.headers.get('cache-control'), 'no-store');
  const foreignOrigin = await f.request('/api/chatgpt/status', { headers: { origin: 'https://unrelated.example' } });
  assert.equal(foreignOrigin.status, 403);
  const foreignSite = await f.request('/api/chatgpt/status', { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(foreignSite.status, 403);
  const duplicate = await f.request('/api/chatgpt/status', { headers: { cookie: `${f.cookie}; ${f.cookie}` } });
  assert.equal(duplicate.status, 401);
  const rebound = await rawRequest(f.agent.origin, '/api/chatgpt/status', { host: 'attacker.example', cookie: f.cookie });
  assert.equal(rebound.status, 403);
  const preflight = await f.request('/api/chatgpt/login', { method: 'OPTIONS', headers: { origin: 'https://unrelated.example' } });
  assert.equal(preflight.status, 403);
  assert.equal(preflight.headers.get('access-control-allow-origin'), null);
});

test('mutations require a same-origin JSON request with bounded, supported fields', async t => {
  const f = await fixture(t);
  const before = f.calls.length;
  assert.equal((await f.request('/api/chatgpt/login', { method: 'POST', body: '{}' })).status, 403);
  assert.equal((await f.post('/api/chatgpt/login', {}, { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await f.post('/api/chatgpt/login', { apiKey: 'synthetic-only' })).status, 400);
  assert.equal((await f.post('/api/chatgpt/login', { newAccount: 'yes' })).status, 400);
  assert.equal((await f.post('/api/chatgpt/account', {})).status, 400);
  assert.equal((await f.post('/api/chatgpt/generate', { model: 'synthetic', temperature: 1 })).status, 400);
  assert.equal((await f.post('/api/chatgpt/generate', { model: 'synthetic', messages: [{ role: 'user', content: 'x'.repeat(2 * 1024 * 1024) }] })).status, 413);
  assert.equal(f.calls.length, before);
  const login = await f.post('/api/chatgpt/login', { newAccount: true });
  assert.equal(login.status, 200);
  assert.deepEqual(f.calls.at(-1), ['login', { newAccount: true }, f.cookie.split('=')[1]]);
  assert.equal((await f.post('/api/chatgpt/login/cancel')).status, 200);
  assert.equal((await f.post('/api/chatgpt/logout', { accountId: 'synthetic-account' })).status, 200);
  assert.equal((await f.post('/api/chatgpt/account', { accountId: 'synthetic-account' })).status, 200);
});

test('the callback requires its browser cookie and redirects away from the code URL', async t => {
  const f = await fixture(t);
  const path = '/auth/callback?state=synthetic-state&code=synthetic-code&client_id=synthetic-account';
  const anonymous = await fetch(f.agent.origin + path, { redirect: 'manual' });
  assert.equal(anonymous.status, 400);
  assert.equal(f.calls.some(c => c[0] === 'callback'), false);
  const callback = await f.request(path, { redirect: 'manual' });
  assert.equal(callback.status, 303);
  assert.equal(callback.headers.get('location'), '/auth/complete');
  assert.equal(callback.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(await callback.text(), '');
  assert.deepEqual(f.calls.at(-1), ['callback', { state: 'synthetic-state', code: 'synthetic-code', client_id: 'synthetic-account' }, f.cookie.split('=')[1]]);
  const complete = await f.request('/auth/complete');
  assert.match(complete.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal(complete.headers.get('x-frame-options'), 'DENY');
  assert.doesNotMatch(await complete.text(), /synthetic-code|synthetic-state/);
});

test('callback errors are escaped and unexpected failures never expose details', async t => {
  const f = await fixture(t, { service: { async callback() { throw new AgentError('invalid_callback', '<script>alert("synthetic")</script>', 400); }, async generate() { throw new Error('synthetic-secret-token'); } } });
  await f.request('/auth/callback?code=synthetic', { redirect: 'manual' });
  const complete = await f.request('/auth/complete');
  const html = await complete.text();
  assert.equal(complete.status, 400);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  const error = await f.post('/api/chatgpt/generate', { model: 'synthetic', messages: [] });
  assert.equal(error.status, 500);
  assert.doesNotMatch(await error.text(), /synthetic-secret-token/);
});

test('the static server serves built editor files, with no traversal, embedding, or external symlinks', async t => {
  const f = await fixture(t);
  await writeFile(join(f.directory, 'private.txt'), 'outside-dist-synthetic');
  await writeFile(join(f.distDir, '.session.json'), '{"synthetic":"private"}');
  await writeFile(join(f.distDir, 'source.ts'), 'const synthetic = true;');
  await symlink(join(f.directory, 'private.txt'), join(f.distDir, 'escape.txt'));
  for (const path of ['/../private.txt', '/%2e%2e/private.txt', '/%2e%2es/private.txt', '/%5c..%5cprivate.txt', '/.session.json', '/escape.txt', '/source.ts', '/assets/app.js.map']) {
    const result = await rawRequest(f.agent.origin, path);
    assert.equal(result.status, 404, path);
    assert.doesNotMatch(result.body, /outside-dist-synthetic|"synthetic":"private"/);
  }
  const asset = await f.request('/assets/app.js');
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type'), /javascript/);
  assert.match(await asset.text(), /editor = true/);
  const route = await f.request('/workspace/synthetic');
  assert.equal(route.status, 200);
  assert.match(await route.text(), /Mermaid test workspace/);
  const embedded = await f.request('/assets/app.js', { headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'script' } });
  assert.equal(embedded.status, 403);
  const navigation = await rawRequest(f.agent.origin, '/', { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' });
  assert.equal(navigation.status, 200);
});

test('closing a generation connection cancels its upstream request', async t => {
  const entered = deferred(); const aborted = deferred();
  const f = await fixture(t, { service: {
    async generate(_body, signal) {
      entered.resolve();
      await new Promise((resolve, reject) => signal.addEventListener('abort', () => { aborted.resolve(); reject(new DOMException('Cancelled', 'AbortError')); }, { once: true }));
      return { text: 'never returned' };
    },
  } });
  const controller = new AbortController();
  const response = f.post('/api/chatgpt/generate', { model: 'synthetic', messages: [{ role: 'user', content: 'Synthetic diagram' }] }, { signal: controller.signal });
  const rejected = assert.rejects(response, { name: 'AbortError' });
  await entered.promise;
  controller.abort();
  await Promise.all([rejected, aborted.promise]);
});

test('a second Agent cannot open the credential store while the local port is owned', async t => {
  const f = await fixture(t);
  let initialized = false;
  await assert.rejects(startChatGPTAgent({
    port: Number(new URL(f.agent.origin).port), distDir: f.distDir,
    store: { async initialize() { initialized = true; return {}; } },
    createService: () => f.service,
  }), { code: 'EADDRINUSE' });
  assert.equal(initialized, false);
});

test('the existing Go route is available inside the same protected local workspace', async t => {
  let incoming;
  const f = await fixture(t, { agent: { async goHandler(request) {
    incoming = { method: request.method, path: new URL(request.url).pathname, body: await request.json(), signal: request.signal };
    return Response.json({ text: 'synthetic-Go-result' });
  } } });
  const response = await f.post('/api/opencode-go', { apiKey: 'synthetic-Go-key', action: 'generate' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { text: 'synthetic-Go-result' });
  assert.equal(incoming.path, '/api/opencode-go');
  assert.equal(incoming.method, 'POST');
  assert.equal(incoming.body.apiKey, 'synthetic-Go-key');
  assert.equal(incoming.signal.aborted, false);
  assert.equal((await fetch(f.agent.origin + '/api/opencode-go', { method: 'POST', body: '{}' })).status, 401);
});

test('browser sign-in, saved session, catalogue, and generation work together without live OAuth', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mermaid-flow-test-'));
  const distDir = join(directory, 'dist');
  await mkdir(distDir);
  await writeFile(join(distDir, 'index.html'), '<!doctype html><title>Synthetic flow</title>');
  let identityNonce; const requests = [];
  const protocol = {
    async exchange({ attempt, clientId }) {
      identityNonce = attempt.nonce;
      requests.push(['exchange', clientId]);
      return { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', id_token: 'synthetic-id', token_type: 'Bearer', expires_in: 3600, scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct' };
    },
    async verifyIdentity({ nonce }) { assert.equal(nonce, identityNonce); return { sub: 'synthetic-subject', email: 'synthetic@example.test' }; },
    async models({ accessToken }) { assert.equal(accessToken, 'synthetic-access'); return [{ id: 'synthetic-model', name: 'Synthetic model' }]; },
    async generate(args) { requests.push(['generate', args]); return 'flowchart TD\nA --> B'; },
    async revoke() { return true; },
  };
  const agent = await startChatGPTAgent({ port: 0, distDir, storageDir: join(directory, 'credentials'), protocol });
  t.after(async () => { await agent.close(); await rm(directory, { recursive: true, force: true }); });
  const root = await fetch(agent.origin);
  const cookie = root.headers.get('set-cookie').split(';')[0];
  await root.text();
  const post = (path, body = {}) => fetch(agent.origin + path, { method: 'POST', headers: { cookie, origin: agent.origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const login = await (await post('/api/chatgpt/login')).json();
  const authUrl = new URL(login.authUrl);
  assert.equal(authUrl.searchParams.get('redirect_uri'), `${agent.origin}/auth/callback`);
  assert.equal(authUrl.searchParams.get('client_id'), 'dynamic_agent_client');
  const query = new URLSearchParams({ state: authUrl.searchParams.get('state'), code: 'synthetic-code', client_id: 'oaiapp_synthetic' });
  const callback = await fetch(`${agent.origin}/auth/callback?${query}`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(callback.status, 303);
  const catalogue = await (await fetch(agent.origin + '/api/chatgpt/models', { headers: { cookie } })).json();
  assert.equal(catalogue.accountId, 'oaiapp_synthetic');
  const before = await (await fetch(agent.origin + '/api/chatgpt/status', { headers: { cookie } })).json();
  assert.equal(before.usage.state, 'unverified');
  const result = await post('/api/chatgpt/generate', { model: catalogue.models[0].id, accountId: catalogue.accountId, messages: [{ role: 'user', content: 'Synthetic diagram' }] });
  assert.deepEqual(await result.json(), { text: 'flowchart TD\nA --> B' });
  const after = await (await fetch(agent.origin + '/api/chatgpt/status', { headers: { cookie } })).json();
  assert.equal(after.usage.state, 'available');
  assert.doesNotMatch(JSON.stringify(after), /synthetic-access|synthetic-refresh|synthetic-id/);
  assert.equal(requests.filter(r => r[0] === 'exchange').length, 1);
  assert.equal(requests.filter(r => r[0] === 'generate').length, 1);
});
