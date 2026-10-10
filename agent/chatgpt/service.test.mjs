import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ChatGPTService } from './service.mjs';
import { AgentError, OpenAIProtocol, OAUTH } from './protocol.mjs';

const NOW = 1800000000000;
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const browser = 'synthetic-browser-session';
const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function account(id = 'oaiapp_first', expiresAt = NOW + 3600000) {
  return { id, issuer: 'https://auth.openai.com', subject: `user-${id}`, email: `${id}@example.test`, tokens: {
    accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', idToken: 'synthetic-id-token', nonce: 'synthetic-nonce',
    expiresAt, scopes: SCOPES.split(' '), pendingIdentity: false,
  } };
}

function tokenResponse(overrides = {}) {
  return { access_token: 'synthetic-access-new', refresh_token: 'synthetic-refresh-new', id_token: 'synthetic-id-new', token_type: 'Bearer', expires_in: 3600, scope: SCOPES, ...overrides };
}

function fixture({ accounts = [], activeAccountId = accounts[0]?.id ?? null, protocol: custom = {}, data: given } = {}) {
  const data = given ?? { version: 1, hostId: `urn:uuid:${randomUUID()}`, accounts, activeAccountId };
  const store = { saved: structuredClone(data), async save(next) { this.saved = structuredClone(next); } };
  const calls = { exchange: [], refresh: [], verify: [], revoke: [], models: [], generate: [] };
  const protocol = {
    async exchange(args) { calls.exchange.push(args); return tokenResponse(); },
    async verifyIdentity(args) { calls.verify.push(args); return { sub: args.subject ?? `user-${args.clientId}`, email: `${args.clientId}@example.test` }; },
    async refresh(args) { calls.refresh.push(args); return tokenResponse({ id_token: undefined }); },
    async revoke(args) { calls.revoke.push(args); return true; },
    async models(args) { calls.models.push(args); return [{ id: 'test-model', name: 'Test model' }]; },
    async generate(args) { calls.generate.push(args); return 'flowchart TD\nA --> B'; },
    ...custom,
  };
  const service = new ChatGPTService({ store, data, protocol, now: () => NOW, redirectUri: 'http://127.0.0.1:8788/auth/callback' });
  return { service, store, calls, protocol };
}

async function loginCallback(service, options = {}, clientId = 'oaiapp_new') {
  const { authUrl } = await service.login(options, browser);
  const url = new URL(authUrl);
  return new URLSearchParams({ state: url.searchParams.get('state'), code: 'synthetic-code', client_id: url.searchParams.get('client_id') === 'dynamic_agent_client' ? clientId : url.searchParams.get('client_id') });
}

test('a valid callback activates one verified account and never exposes tokens in status', async () => {
  const { service, store, calls } = fixture();
  const query = await loginCallback(service);
  await service.callback(query, browser);
  assert.equal(service.status().connected, true);
  assert.equal(service.status().usage.state, 'unverified');
  assert.equal(store.saved.activeAccountId, 'oaiapp_new');
  assert.equal(store.saved.accounts[0].tokens.refreshToken, 'synthetic-refresh-new');
  assert.doesNotMatch(JSON.stringify(service.status()), /synthetic-(access|refresh|id|nonce)/);
  await assert.rejects(service.callback(query, browser), { code: 'invalid_callback' });
  assert.equal(calls.exchange.length, 1);
});

test('callback from another browser cannot redeem the code or replace the active account', async () => {
  const { service, calls, store } = fixture({ accounts: [account()] });
  const before = structuredClone(store.saved);
  const query = await loginCallback(service, { newAccount: true });
  await assert.rejects(service.callback(query, 'another-browser'), { code: 'invalid_callback' });
  assert.deepEqual(store.saved, before);
  assert.equal(calls.exchange.length, 0);
  await service.callback(query, browser);
  assert.equal(service.status().activeAccountId, 'oaiapp_new');
});

test('denied or mismatched-state sign-in preserves a working account', async () => {
  for (const denied of [true, false]) {
    const { service, store, calls } = fixture({ accounts: [account()] });
    const before = structuredClone(store.saved);
    const query = await loginCallback(service, { newAccount: true });
    if (denied) { query.delete('code'); query.set('error', 'access_denied'); } else query.set('state', 'wrong-state');
    await assert.rejects(service.callback(query, browser));
    assert.deepEqual(store.saved, before);
    assert.equal(service.status().connected, true);
    assert.equal(calls.exchange.length, 0);
  }
});

test('an issued client survives an invalid code exchange and is reused on retry', async () => {
  const err = new AgentError('auth_required', 'Sign in again.', 401);
  err.upstreamCode = 'invalid_grant';
  const { service, store } = fixture({ protocol: { async exchange() { throw err; } } });
  await assert.rejects(service.callback(await loginCallback(service), browser));
  assert.equal(store.saved.accounts[0].id, 'oaiapp_new');
  assert.equal(store.saved.accounts[0].subject, null);
  assert.equal(service.status().activeAccountId, null);
  const next = new URL((await service.login({}, browser)).authUrl);
  assert.equal(next.searchParams.get('client_id'), 'oaiapp_new');
  assert.equal(next.searchParams.has('agent_name_hint'), false);
});

test('missing plan permission never replaces a usable session', async () => {
  for (const newAccount of [true, false]) {
    const { service, store } = fixture({ accounts: [account()], protocol: { async exchange() { return tokenResponse({ scope: 'openid profile email' }); } } });
    const query = await loginCallback(service, { newAccount });
    await service.callback(query, browser);
    assert.equal(service.status().activeAccountId, 'oaiapp_first');
    assert.equal(service.status().connected, true);
    assert.equal(store.saved.accounts[0].tokens.accessToken, 'synthetic-access');
    assert.equal(service.status().login.state, 'failed');
  }
});

test('catalogue discovery does not claim verified generation; a completed request does', async () => {
  const { service, calls } = fixture({ accounts: [account()] });
  const catalogue = await service.models();
  assert.equal(catalogue.accountId, 'oaiapp_first');
  assert.equal(service.status().usage.state, 'unverified');
  assert.equal(calls.generate.length, 0);
  assert.deepEqual(await service.generate({ accountId: catalogue.accountId, model: 'test-model', messages: [{ role: 'user', content: 'A to B' }] }), { text: 'flowchart TD\nA --> B' });
  assert.equal(service.status().usage.state, 'available');
  assert.equal(calls.models.length, 1);
});

test('parallel calls refresh an expired account once and use the rotated access token', async () => {
  const { service, calls, store } = fixture({ accounts: [account('oaiapp_first', NOW - 1000)] });
  await Promise.all([service.models(), service.models()]);
  assert.equal(calls.refresh.length, 1);
  assert.equal(store.saved.accounts[0].tokens.refreshToken, 'synthetic-refresh-new');
  assert(calls.models.every(c => c.accessToken === 'synthetic-access-new'));
});

test('a temporary refresh error keeps credentials; a confirmed invalid refresh clears them', async () => {
  for (const terminal of [false, true]) {
    const error = new AgentError(terminal ? 'auth_required' : 'upstream_error', 'Safe session error.', terminal ? 401 : 503);
    if (terminal) error.upstreamCode = 'refresh_token_reused';
    const { service, store } = fixture({ accounts: [account('oaiapp_first', NOW - 1000)], protocol: { async refresh() { throw error; } } });
    await assert.rejects(service.models());
    assert.equal(store.saved.accounts[0].id, 'oaiapp_first');
    assert.equal(store.saved.accounts[0].tokens === null, terminal);
  }
});

test('rotated credentials survive a temporary JWKS failure and resume after restart without another refresh', async () => {
  const { service, store } = fixture({ accounts: [account('oaiapp_first', NOW - 1000)], protocol: {
    async refresh() { return tokenResponse(); },
    async verifyIdentity() { throw new AgentError('upstream_error', 'Identity keys are temporarily unavailable.', 503); },
  } });
  await assert.rejects(service.models(), { code: 'upstream_error' });
  assert.equal(store.saved.accounts[0].tokens.refreshToken, 'synthetic-refresh-new');
  assert.equal(store.saved.accounts[0].tokens.pendingIdentity, true);
  const resumed = fixture({ data: store.saved });
  await resumed.service.models();
  assert.equal(resumed.calls.refresh.length, 0);
  assert.equal(resumed.calls.verify.length, 1);
  assert.equal(resumed.store.saved.accounts[0].tokens.pendingIdentity, false);
});

test('logout while refresh completes revokes the replacement token and cannot resurrect a session', async () => {
  const entered = deferred(); const release = deferred(); const revoked = [];
  const { service, store } = fixture({ accounts: [account('oaiapp_first', NOW - 1000)], protocol: {
    async refresh() { entered.resolve(); return release.promise; },
    async revoke(args) { revoked.push(args.refreshToken); return true; },
  } });
  const request = service.models();
  const rejected = assert.rejects(request, { code: 'cancelled' });
  await entered.promise;
  const logout = service.logout();
  release.resolve(tokenResponse({ id_token: undefined }));
  await Promise.all([rejected, logout]);
  assert.deepEqual(revoked, ['synthetic-refresh-new']);
  assert.equal(store.saved.accounts[0].tokens, null);
  assert.equal(service.status().connected, false);
});

test('a real protocol refresh finishes rotation before logout or browser cancellation can stop inference', async t => {
  for (const stop of ['logout', 'disconnect']) await t.test(stop, async () => {
    const entered = deferred(); const release = deferred(); const revoked = [];
    let refreshSignal; let exchanges = 0;
    const real = new OpenAIProtocol({ fetchImpl: async (url, init) => {
      assert.equal(url, OAUTH.token);
      exchanges += 1;
      refreshSignal = init.signal;
      entered.resolve();
      await release.promise;
      return Response.json(tokenResponse({ id_token: undefined }));
    } });
    const { service, store, calls } = fixture({ accounts: [account('oaiapp_first', NOW - 1000)], protocol: {
      refresh: args => real.refresh(args),
      async revoke(args) { revoked.push(args.refreshToken); return true; },
    } });
    const controller = new AbortController();
    const request = service.models(controller.signal);
    const rejected = assert.rejects(request, { code: 'cancelled' });
    await entered.promise;
    const stopped = stop === 'logout' ? service.logout() : Promise.resolve(controller.abort());
    assert.equal(refreshSignal.aborted, false);
    release.resolve();
    await Promise.all([rejected, stopped]);
    assert.equal(exchanges, 1);
    assert.equal(calls.models.length, 0);
    if (stop === 'logout') {
      assert.deepEqual(revoked, ['synthetic-refresh-new']);
      assert.equal(store.saved.accounts[0].tokens, null);
    } else {
      assert.equal(store.saved.accounts[0].tokens.refreshToken, 'synthetic-refresh-new');
      await service.models();
      assert.equal(exchanges, 1);
    }
  });
});

test('a malformed successful refresh cannot leave the previous rotating token reusable', async t => {
  for (const overrides of [{ refresh_token: undefined }, { refresh_token: null }, { access_token: null }, { token_type: ['Bearer'] }, { scope: SCOPES.split(' ') }]) {
    await t.test(Object.keys(overrides)[0] + ':' + String(Object.values(overrides)[0]), async () => {
      let attempts = 0;
      const { service, store } = fixture({ accounts: [account('oaiapp_first', NOW - 1000)], protocol: {
        async refresh() { attempts += 1; return tokenResponse(overrides); },
      } });
      await assert.rejects(service.models(), { code: 'invalid_response' });
      assert.equal(store.saved.accounts[0].tokens, null);
      await assert.rejects(service.models(), { code: 'auth_required' });
      assert.equal(attempts, 1);
    });
  }
});

test('cancel/logout during activation disk I/O restores the previous account before sign-out', async () => {
  const { service, store } = fixture({ accounts: [account()] });
  const entered = deferred(); const release = deferred();
  const originalSave = store.save.bind(store);
  let paused = false;
  store.save = async next => {
    if (!paused && next.activeAccountId === 'oaiapp_new') { paused = true; entered.resolve(); await release.promise; }
    await originalSave(next);
  };
  const callback = service.callback(await loginCallback(service, { newAccount: true }), browser);
  const rejected = assert.rejects(callback, { code: 'cancelled' });
  await entered.promise;
  const logout = service.logout('oaiapp_first');
  release.resolve();
  await Promise.all([rejected, logout]);
  assert.equal(store.saved.activeAccountId, 'oaiapp_first');
  assert(store.saved.accounts.every(a => a.tokens === null));
  assert.equal(service.status().connected, false);
});

test('a generation keeps its account and aborts when the user switches', async () => {
  const entered = deferred();
  const { service, calls } = fixture({ accounts: [account(), account('oaiapp_second')], protocol: {
    async generate({ signal }) {
      entered.resolve();
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new AgentError('cancelled', 'Cancelled.', 409)), { once: true }));
    },
  } });
  const request = service.generate({ accountId: 'oaiapp_first', model: 'test-model', messages: [] });
  const rejected = assert.rejects(request, { code: 'cancelled' });
  await entered.promise;
  await service.selectAccount('oaiapp_second');
  await rejected;
  await assert.rejects(service.generate({ accountId: 'oaiapp_first', model: 'test-model', messages: [] }), { code: 'account_changed' });
  assert.equal(calls.models.length, 1);
  assert.equal(service.status().usage.state, 'unverified');
});

test('quota errors report limits without a second request or fallback', async () => {
  let count = 0;
  const { service } = fixture({ accounts: [account()], protocol: { async generate() { count += 1; throw new AgentError('quota_exceeded', 'Your ChatGPT plan limit was reached.', 429); } } });
  await assert.rejects(service.generate({ model: 'test-model', messages: [] }), { code: 'quota_exceeded' });
  assert.equal(count, 1);
  assert.equal(service.status().usage.state, 'limit_reached');
});

test('failed remote revocation still clears local tokens and is reported honestly', async () => {
  const { service, store } = fixture({ accounts: [account()], protocol: { async revoke() { return false; } } });
  const result = await service.logout();
  assert.equal(store.saved.accounts[0].tokens, null);
  assert.match(result.message, /could not be confirmed/);
  assert.match(service.status().login.message, /ChatGPT settings/);
});

test('storage failure after rotation blocks further refresh/inference rather than reusing the spent token', async () => {
  const { service, store, calls } = fixture({ accounts: [account('oaiapp_first', NOW - 1000)] });
  store.save = async () => { throw new Error('synthetic disk failure'); };
  await assert.rejects(service.models(), { code: 'local_storage_error' });
  await assert.rejects(service.models(), { code: 'local_storage_error' });
  assert.equal(calls.refresh.length, 1);
  assert.equal(calls.models.length, 0);
  assert.equal(service.status().connected, false);
});
