import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { AgentError, OAUTH, OpenAIProtocol, authorizationUrl, createAttempt, validateCallback } from './protocol.mjs';

const NOW = Date.UTC(2026, 9, 10, 12);
const CLIENT = 'oaiapp_test_registration';
const HOST = 'urn:uuid:bd38bc1f-4792-4e4f-8bb9-44c04bf8d65e';
const NONCE = 'synthetic-login-nonce';
const TOKEN = 'synthetic-access-token';
const REFRESH = 'synthetic-refresh-token';
const encoder = new TextEncoder();
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const secondPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const key = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'key-one', alg: 'RS256', use: 'sig' };
const secondKey = { ...secondPair.publicKey.export({ format: 'jwk' }), kid: 'key-two', alg: 'RS256', use: 'sig' };
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

function token(claims = {}, header = {}, privateKey = pair.privateKey) {
  const body = {
    iss: OAUTH.issuer, sub: 'subject-one', aud: CLIENT,
    iat: NOW / 1000 - 10, exp: NOW / 1000 + 3600, nonce: NONCE,
    email: 'same@example.test', ...claims,
  };
  const unsigned = encode({ alg: 'RS256', kid: 'key-one', ...header }) + '.' + encode(body);
  return unsigned + '.' + sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url');
}

function attempt(extra = {}) {
  return createAttempt({ hostId: HOST, redirectUri: 'http://127.0.0.1:8788/auth/callback',
    browserSessionId: 'synthetic-browser-session', now: NOW, ...extra });
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function harness(respond, options = {}) {
  const calls = [];
  const protocol = new OpenAIProtocol({ now: () => NOW, ...options, fetchImpl: async (url, init) => {
    calls.push({ url: String(url), init });
    return respond(String(url), init, calls.length);
  } });
  return { protocol, calls };
}

function errorCode(code) {
  return (error) => error instanceof AgentError && error.code === code;
}

function event(value, newline = '\n') {
  return 'data: ' + JSON.stringify(value) + newline + newline;
}

const delta = (value) => event({ type: 'response.output_text.delta', delta: value });
const completed = (output) => event({ type: 'response.completed', response: { status: 'completed', ...(output ? { output } : {}) } });
const messageOutput = (value) => [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: value }] }];
const request = (extra = {}) => ({ accessToken: TOKEN, model: 'gpt-test', messages: [{ role: 'user', content: 'Draw a diagram.' }], ...extra });

function sse(source, { chunkSize, remainOpen = false, onCancel } = {}) {
  const bytes = typeof source === 'string' ? encoder.encode(source) : source;
  const body = new ReadableStream({
    start(controller) {
      const size = chunkSize ?? Math.max(bytes.byteLength, 1);
      for (let offset = 0; offset < bytes.byteLength; offset += size) controller.enqueue(bytes.slice(offset, offset + size));
      if (!remainOpen) controller.close();
    },
    cancel() { onCancel?.(); },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('new authorization uses fresh PKCE/state/nonce, stable host, exact redirect and full scopes', () => {
  const first = attempt();
  const second = attempt();
  const url = new URL(authorizationUrl(first));
  assert.equal(url.origin + url.pathname, OAUTH.authorization);
  assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(url.searchParams.get('agent_name_hint'), 'Mermaid Agent');
  assert.equal(url.searchParams.get('ext_agent_host_id'), HOST);
  assert.equal(url.searchParams.get('redirect_uri'), first.redirectUri);
  assert.equal(url.searchParams.get('scope'), OAUTH.scope);
  assert.equal(url.searchParams.get('resource'), OAUTH.resource);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(first.verifier).digest('base64url'));
  assert.equal(first.expiresAt, NOW + 600_000);
  assert.equal(first.hostId, second.hostId);
  for (const property of ['id', 'state', 'nonce', 'verifier']) assert.notEqual(first[property], second[property]);
  assert.equal(url.searchParams.has('code_verifier'), false);
  assert.equal(url.searchParams.has('prompt'), false);
});

test('reauthorization keeps registration, excludes ID-token hint, and requests consent only explicitly', () => {
  const pending = attempt({ registration: { id: CLIENT, subject: 'subject-one', email: 'same@example.test',
    tokens: { idToken: 'never-return-this-identity-token' } }, forceConsent: true });
  const url = new URL(authorizationUrl(pending));
  assert.equal(url.searchParams.get('client_id'), CLIENT);
  assert.equal(url.searchParams.get('login_hint'), 'same@example.test');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.has('agent_name_hint'), false);
  assert.equal(url.searchParams.has('id_token_hint'), false);
  assert.equal(url.searchParams.has('force_reconsent'), false);
  assert.equal(JSON.stringify(pending).includes('never-return'), false);
  assert.equal(url.toString().includes('never-return'), false);
  assert.equal(pending.subject, 'subject-one');
});

test('authorization preparation rejects unsafe callbacks and malformed registration values', () => {
  for (const redirectUri of [
    'http://localhost:8788/auth/callback', 'https://127.0.0.1:8788/auth/callback',
    'http://127.1:8788/auth/callback', 'http://127.0.0.1:8788/callback',
    'http://127.0.0.1:8788/auth/callback?next=evil', 'http://127.0.0.1:8788/auth/callback#fragment',
    'http://127.0.0.1:70000/auth/callback', 'http://127.0.0.1@other.test/auth/callback',
  ]) assert.throws(() => attempt({ redirectUri }), errorCode('invalid_request'));
  assert.throws(() => attempt({ registration: { id: 'dynamic_agent_client' } }), errorCode('invalid_request'));
  assert.throws(() => attempt({ registration: { id: [CLIENT] } }), errorCode('invalid_request'));
  assert.throws(() => attempt({ hostId: 'email@example.test' }), errorCode('invalid_request'));
  assert.throws(() => attempt({ forceConsent: 'true' }), errorCode('invalid_request'));
  assert.equal(attempt({ redirectUri: 'http://127.0.0.1:54321/auth/callback' }).redirectUri, 'http://127.0.0.1:54321/auth/callback');
});

test('callbacks require the issued ID for registration and preserve the returning ID', () => {
  const pending = attempt();
  assert.deepEqual(validateCallback(pending, new URLSearchParams({ state: pending.state, code: 'synthetic-code', client_id: CLIENT }), NOW),
    { code: 'synthetic-code', clientId: CLIENT });
  const saved = attempt({ registration: { id: CLIENT, subject: 'subject-one' } });
  assert.deepEqual(validateCallback(saved, new URLSearchParams({ state: saved.state, code: 'synthetic-code' }), NOW),
    { code: 'synthetic-code', clientId: CLIENT });
  assert.throws(() => validateCallback(saved, new URLSearchParams({ state: saved.state, code: 'code', client_id: 'oaiapp_other' }), NOW), errorCode('invalid_callback'));
  for (const client_id of [undefined, 'dynamic_agent_client', '', 'https://other.test']) {
    const values = new URLSearchParams({ state: pending.state, code: 'code' });
    if (client_id !== undefined) values.set('client_id', client_id);
    assert.throws(() => validateCallback(pending, values, NOW), errorCode('invalid_callback'));
  }
});

test('callback validates state and expiration before errors, rejects duplicates and never trusts returned scopes', () => {
  const pending = attempt();
  const valid = new URLSearchParams({ state: pending.state, code: 'code', client_id: CLIENT, scope: 'arbitrary' });
  assert.deepEqual(validateCallback(pending, valid, NOW), { code: 'code', clientId: CLIENT });
  assert.throws(() => validateCallback(pending, valid, pending.expiresAt), errorCode('invalid_callback'));
  for (const field of ['state', 'code', 'client_id', 'scope']) {
    const duplicate = new URLSearchParams(valid);
    duplicate.append(field, duplicate.get(field));
    assert.throws(() => validateCallback(pending, duplicate, NOW), errorCode('invalid_callback'));
  }
  assert.throws(() => validateCallback(pending, new URLSearchParams({ state: 'wrong', error: 'access_denied' }), NOW), errorCode('invalid_callback'));
  assert.throws(() => validateCallback(pending, new URLSearchParams({ state: pending.state, error: 'access_denied', error_description: 'secret' }), NOW),
    (error) => error.code === 'access_denied' && !error.message.includes('secret'));
  assert.throws(() => validateCallback(pending, new URLSearchParams({ state: pending.state, client_id: CLIENT }), NOW), errorCode('invalid_callback'));
});

test('code exchange and refresh use fixed form grants and preserve raw rotating token responses', async () => {
  const raw = { access_token: TOKEN, refresh_token: REFRESH, scope: OAUTH.scope, token_type: 'Bearer', expires_in: 3600 };
  const { protocol, calls } = harness(() => json(raw));
  const pending = attempt();
  assert.deepEqual(await protocol.exchange({ attempt: pending, clientId: CLIENT, code: 'synthetic-code' }), raw);
  assert.deepEqual(await protocol.refresh({ clientId: CLIENT, refreshToken: REFRESH }), raw);
  const first = new URLSearchParams(calls[0].init.body);
  assert.equal(calls[0].url, OAUTH.token);
  assert.equal(first.get('client_id'), CLIENT);
  assert.equal(first.get('grant_type'), 'authorization_code');
  assert.equal(first.get('redirect_uri'), new URL(authorizationUrl(pending)).searchParams.get('redirect_uri'));
  assert.equal(first.get('code_verifier'), pending.verifier);
  assert.equal(first.get('resource'), OAUTH.resource);
  assert.equal(first.has('client_secret'), false);
  const refresh = new URLSearchParams(calls[1].init.body);
  assert.equal(refresh.get('grant_type'), 'refresh_token');
  assert.equal(refresh.get('client_id'), CLIENT);
  assert.equal(refresh.get('refresh_token'), REFRESH);
  assert.equal(refresh.get('resource'), OAUTH.resource);
  assert.equal(refresh.has('scope'), false);
  for (const call of calls) {
    assert.equal(call.init.redirect, 'error');
    assert.equal(call.init.credentials, 'omit');
    assert.equal(call.init.headers['content-type'], 'application/x-www-form-urlencoded');
    assert.equal(call.init.method, 'POST');
    assert.equal(call.url.includes(TOKEN), false);
    assert.equal(call.url.includes(REFRESH), false);
  }
  await assert.rejects(protocol.refresh({ clientId: 'dynamic_agent_client', refreshToken: REFRESH }), errorCode('invalid_request'));
  await assert.rejects(protocol.exchange({ attempt: attempt({ registration: { id: CLIENT } }), clientId: 'oaiapp_other', code: 'code' }), errorCode('invalid_request'));
  assert.equal(calls.length, 2);
});

test('identity verification uses published RSA keys and caches them without returning unneeded claims', async () => {
  const { protocol, calls } = harness((url) => { assert.equal(url, OAUTH.jwks); return json({ keys: [key] }); });
  const idToken = token({ private_metadata: 'do-not-return' });
  const first = await protocol.verifyIdentity({ idToken, clientId: CLIENT, nonce: NONCE });
  await protocol.verifyIdentity({ idToken, clientId: CLIENT, nonce: NONCE, subject: 'subject-one' });
  assert.equal(first.sub, 'subject-one');
  assert.equal(first.email, 'same@example.test');
  assert.equal(first.private_metadata, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.headers.authorization, undefined);
});

test('identity verification rejects tampered signatures, algorithms and claims', async (t) => {
  const invalidTokens = {
    'wrong signature': token({}, {}, secondPair.privateKey),
    'alg none': token({}, { alg: 'none' }),
    'alg confusion': token({}, { alg: 'HS256' }),
    'unknown kid': token({}, { kid: 'unknown' }),
    'missing kid': token({}, { kid: undefined }),
    'unsupported critical header': token({}, { crit: ['jku'] }),
    'unencoded payload': token({}, { b64: false }),
    'wrong issuer': token({ iss: 'https://other.test' }),
    'wrong audience': token({ aud: 'oaiapp_other' }),
    'array audience without azp': token({ aud: [CLIENT, 'oaiapp_other'] }),
    'wrong azp': token({ azp: 'oaiapp_other' }),
    'audience type': token({ aud: { value: CLIENT } }),
    'expired': token({ exp: NOW / 1000 - 20, iat: NOW / 1000 - 100 }),
    'numeric string expiry': token({ exp: String(NOW / 1000 + 3600) }),
    'missing expiry': token({ exp: undefined }),
    'missing issued-at': token({ iat: undefined }),
    'future issued-at': token({ iat: NOW / 1000 + 600 }),
    'future not-before': token({ nbf: NOW / 1000 + 600 }),
    'not-before type': token({ nbf: 'later' }),
    'missing subject': token({ sub: undefined }),
    'empty subject': token({ sub: '' }),
    'wrong nonce': token({ nonce: 'another-attempt' }),
    'missing nonce': token({ nonce: undefined }),
    'invalid JWT encoding': 'eyJhbGciOiJSUzI1NiJ9.%%%%.invalid',
    'extra segment': token() + '.unexpected',
  };
  for (const [name, idToken] of Object.entries(invalidTokens)) await t.test(name, async () => {
    const { protocol } = harness(() => json({ keys: [key] }));
    await assert.rejects(protocol.verifyIdentity({ idToken, clientId: CLIENT, nonce: NONCE }), errorCode('invalid_identity'));
  });
  const { protocol } = harness(() => json({ keys: [key] }));
  await assert.rejects(protocol.verifyIdentity({ idToken: token(), clientId: CLIENT, nonce: NONCE, subject: 'another-person' }), errorCode('invalid_identity'));
  assert.equal((await protocol.verifyIdentity({ idToken: token({ aud: [CLIENT, 'other'], azp: CLIENT }), clientId: CLIENT, nonce: NONCE })).sub, 'subject-one');
});

test('refresh identity permits missing nonce but binds any present nonce and the original subject', async () => {
  const { protocol } = harness(() => json({ keys: [key] }));
  const args = { clientId: CLIENT, nonce: NONCE, subject: 'subject-one', refresh: true };
  assert.equal((await protocol.verifyIdentity({ ...args, idToken: token({ nonce: undefined }) })).sub, 'subject-one');
  assert.equal((await protocol.verifyIdentity({ ...args, idToken: token() })).nonce, NONCE);
  await assert.rejects(protocol.verifyIdentity({ ...args, idToken: token({ nonce: 'wrong' }) }), errorCode('invalid_identity'));
  await assert.rejects(protocol.verifyIdentity({ ...args, idToken: token({ sub: 'switched-user' }) }), errorCode('invalid_identity'));
  await assert.rejects(protocol.verifyIdentity({ ...args, subject: undefined, idToken: token() }), errorCode('invalid_identity'));
  await assert.rejects(protocol.verifyIdentity({ ...args, nonce: undefined, idToken: token() }), errorCode('invalid_identity'));
});

test('unknown kid refreshes a cached JWKS once and accepts the new signing key', async () => {
  const { protocol, calls } = harness((_, __, count) => json({ keys: count === 1 ? [key] : [secondKey] }));
  await protocol.verifyIdentity({ idToken: token(), clientId: CLIENT, nonce: NONCE });
  const rotated = token({}, { kid: secondKey.kid }, secondPair.privateKey);
  assert.equal((await protocol.verifyIdentity({ idToken: rotated, clientId: CLIENT, nonce: NONCE })).sub, 'subject-one');
  assert.equal(calls.length, 2);
});

test('a JWKS outage remains retryable and unsuitable or duplicate signing keys fail closed', async () => {
  const { protocol } = harness(() => json({ error: { code: 'server_error', message: 'secret-debug-data' } }, 503));
  await assert.rejects(protocol.verifyIdentity({ idToken: token(), clientId: CLIENT, nonce: NONCE }),
    (error) => error.code === 'usage_unavailable' && !error.message.includes('secret'));
  for (const keys of [[key, key], [{ ...key, use: 'enc' }], [{ ...key, alg: 'HS256' }], [{ ...key, key_ops: ['sign'] }], [{ ...key, n: 'invalid' }]]) {
    const check = harness(() => json({ keys })).protocol;
    await assert.rejects(check.verifyIdentity({ idToken: token(), clientId: CLIENT, nonce: NONCE }), errorCode('invalid_identity'));
  }
});

test('refresh exposes machine-readable terminal codes while keeping descriptions and tokens private', async () => {
  for (const code of ['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused']) {
    const { protocol } = harness(() => json({ error: code, error_description: REFRESH + ' private description' }, 400, { 'x-request-id': 'req_synthetic' }));
    await assert.rejects(protocol.refresh({ clientId: CLIENT, refreshToken: REFRESH }), (error) => {
      assert.equal(error.code, 'auth_required');
      assert.equal(error.upstreamCode, code);
      assert.equal(error.status, 400);
      assert.equal(error.upstreamStatus, 400);
      assert.equal(error.requestId, 'req_synthetic');
      assert.equal(error.responseShape, 'oauth');
      assert.equal(error.message.includes(REFRESH), false);
      assert.equal(error.message.includes('private description'), false);
      return true;
    });
  }
  const check = harness(() => json({ error: 'invalid_client' }, 401)).protocol;
  await assert.rejects(check.refresh({ clientId: CLIENT, refreshToken: REFRESH }), errorCode('invalid_client'));
});

test('revocation discovers the endpoint, pins the issuer and host, and submits only the selected session', async () => {
  const endpoint = OAUTH.issuer + '/documented-revocation-route';
  const { protocol, calls } = harness((url) => url === OAUTH.discovery
    ? json({ issuer: OAUTH.issuer, revocation_endpoint: endpoint }) : new Response(null, { status: 200 }));
  assert.equal(await protocol.revoke({ clientId: CLIENT, refreshToken: REFRESH }), true);
  assert.deepEqual(calls.map((call) => call.url), [OAUTH.discovery, endpoint]);
  const body = new URLSearchParams(calls[1].init.body);
  assert.deepEqual(Object.fromEntries(body), { token: REFRESH, token_type_hint: 'refresh_token', client_id: CLIENT });
  assert.equal(calls[1].init.redirect, 'error');
  for (const revocation_endpoint of [
    'https://other.test/revoke', 'http://auth.openai.com/revoke',
    'https://auth.openai.com@other.test/revoke', 'https://name:password@auth.openai.com/revoke',
    'https://auth.openai.com/revoke?next=other', 'https://auth.openai.com/revoke#fragment', 'not a URL',
  ]) {
    const bad = harness(() => json({ issuer: OAUTH.issuer, revocation_endpoint }));
    assert.equal(await bad.protocol.revoke({ clientId: CLIENT, refreshToken: REFRESH }), false);
    assert.equal(bad.calls.length, 1);
  }
  const badIssuer = harness(() => json({ issuer: 'https://other.test', revocation_endpoint: endpoint }));
  assert.equal(await badIssuer.protocol.revoke({ clientId: CLIENT, refreshToken: REFRESH }), false);
  assert.equal(badIssuer.calls.length, 1);
});

test('unconfirmed revocation reports false without guessing a route or hiding caller cancellation', async () => {
  const unavailable = harness(() => json({ error: 'server_error' }, 503));
  assert.equal(await unavailable.protocol.revoke({ clientId: CLIENT, refreshToken: REFRESH }), false);
  assert.equal(unavailable.calls.length, 1);
  const notRevoked = harness((_, __, count) => count === 1
    ? json({ issuer: OAUTH.issuer, revocation_endpoint: OAUTH.issuer + '/revoke' }) : new Response(null, { status: 500 }));
  assert.equal(await notRevoked.protocol.revoke({ clientId: CLIENT, refreshToken: REFRESH }), false);
  const controller = new AbortController();
  controller.abort('private reason');
  await assert.rejects(unavailable.protocol.revoke({ clientId: CLIENT, refreshToken: REFRESH, signal: controller.signal }), errorCode('cancelled'));
  assert.equal(unavailable.calls.length, 1);
});

test('models use the OAuth catalogue shape, visibility and server ordering without inference', async () => {
  const { protocol, calls } = harness(() => json({ models: [
    { slug: 'gpt-second', display_name: 'Second', visibility: 'list' },
    { slug: 'hidden', display_name: 'Hidden', visibility: 'hide' },
    { slug: 'gpt-first', display_name: 'First', visibility: 'list' },
    { slug: 'gpt-second', display_name: 'Duplicate', visibility: 'list' },
    { slug: 'bad name', display_name: 'Malformed', visibility: 'list' },
  ] }));
  assert.deepEqual(await protocol.models({ accessToken: TOKEN }), [{ id: 'gpt-second', name: 'Second' }, { id: 'gpt-first', name: 'First' }]);
  assert.equal(calls[0].url, OAUTH.resource + '/models');
  assert.equal(calls[0].init.headers.authorization, 'Bearer ' + TOKEN);
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls.length, 1);
  const wrongShape = harness(() => json({ data: [] })).protocol;
  await assert.rejects(wrongShape.models({ accessToken: TOKEN }), errorCode('invalid_response'));
});

test('generation sends only supported Responses fields and maps system prompts to developer messages', async () => {
  const { protocol, calls } = harness(() => sse(delta('graph TD\nA-->B') + completed()));
  const messages = [
    { role: 'system', content: 'Use Mermaid.', tool_calls: ['never-forward'] },
    { role: 'assistant', content: 'Previous answer' },
    { role: 'user', content: 'Now connect them.' },
  ];
  assert.equal(await protocol.generate(request({ messages, temperature: 1, max_output_tokens: 10 })), 'graph TD\nA-->B');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, OAUTH.resource + '/responses');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.headers.authorization, 'Bearer ' + TOKEN);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    model: 'gpt-test', input: [
      { role: 'developer', content: 'Use Mermaid.' }, { role: 'assistant', content: 'Previous answer' },
      { role: 'user', content: 'Now connect them.' },
    ], store: false, stream: true,
  });
});

test('SSE handles split UTF-8, CRLF, comments and multiline data at single-byte boundaries', async () => {
  const stream = ': comment\r\nid: 1\r\nretry: 500\r\n'
    + 'event: response.output_text.delta\r\ndata: {"type":"response.output_text.delta",\r\ndata: "delta":"Привет 🐙"}\r\n\r\n'
    + 'event: response.completed\r\ndata: {"type":"response.completed","response":{"status":"completed"}}\r\n\r\n';
  const { protocol } = harness(() => sse(stream, { chunkSize: 1 }));
  assert.equal(await protocol.generate(request()), 'Привет 🐙');
});

test('completed output is authoritative and completion cancels the remaining stream', async () => {
  let cancelled = false;
  const { protocol } = harness(() => sse(delta('partial') + completed(messageOutput('Complete answer')), {
    remainOpen: true, onCancel: () => { cancelled = true; },
  }));
  assert.equal(await protocol.generate(request()), 'Complete answer');
  assert.equal(cancelled, true);
  const finalOnly = harness(() => sse(completed(messageOutput('Final only')))).protocol;
  assert.equal(await finalOnly.generate(request()), 'Final only');
});

test('partial, incomplete, malformed and empty streams never become successful text', async (t) => {
  const cases = [
    ['EOF', delta('partial'), 'incomplete_response'],
    ['DONE without completion', delta('partial') + 'data: [DONE]\n\n', 'incomplete_response'],
    ['incomplete', delta('partial') + event({ type: 'response.incomplete' }), 'incomplete_response'],
    ['cancelled', delta('partial') + event({ type: 'response.cancelled' }), 'incomplete_response'],
    ['unterminated completion', delta('partial') + completed().trimEnd(), 'incomplete_response'],
    ['invalid JSON', delta('partial') + 'data: {"secret":\n\n', 'invalid_response'],
    ['wrong completion status', delta('partial') + event({ type: 'response.completed', response: { status: 'incomplete' } }), 'invalid_response'],
    ['empty completion', completed(), 'invalid_response'],
    ['authoritative empty output', delta('partial') + completed([]), 'invalid_response'],
    ['event type mismatch', 'event: response.completed\n' + delta('text'), 'invalid_response'],
  ];
  for (const [name, stream, code] of cases) await t.test(name, async () => {
    const { protocol, calls } = harness(() => sse(stream));
    await assert.rejects(protocol.generate(request()), errorCode(code));
    assert.equal(calls.length, 1);
  });
});

test('midstream quota and explicit errors discard partial text and cancel upstream without retries', async () => {
  for (const failure of [
    { type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded', message: TOKEN } } },
    { type: 'error', code: 'subscription_sharing_usage_limit_exceeded', message: TOKEN },
  ]) {
    let cancelled = false;
    const { protocol, calls } = harness(() => sse(delta('private partial text') + event(failure), {
      remainOpen: true, onCancel: () => { cancelled = true; },
    }));
    await assert.rejects(protocol.generate(request()), (error) => {
      assert.equal(error.code, 'quota_exceeded');
      assert.equal(error.status, 429);
      assert.equal(error.upstreamStatus, 200);
      assert.equal(error.upstreamCode, 'subscription_sharing_usage_limit_exceeded');
      assert.equal(error.message.includes(TOKEN), false);
      assert.equal(error.message.includes('private partial text'), false);
      return true;
    });
    assert.equal(calls.length, 1);
    assert.equal(cancelled, true);
  }
});

test('admission detail and structured errors retain diagnostics without echoing response bodies', async () => {
  const cases = [
    [401, { detail: TOKEN + ' private admission details' }, 'auth_required'],
    [403, { detail: TOKEN }, 'permission_required'],
    [503, { detail: TOKEN }, 'usage_unavailable'],
    [400, { error: { code: 'subscription_sharing_unsupported_capability', param: 'temperature', message: TOKEN } }, 'invalid_request'],
    [403, { error: { code: 'subscription_sharing_user_not_eligible', message: TOKEN } }, 'permission_required'],
    [503, { error: { code: 'subscription_sharing_usage_unavailable', message: TOKEN } }, 'usage_unavailable'],
  ];
  for (const [status, body, code] of cases) {
    const { protocol, calls } = harness(() => json(body, status, { 'openai-request-id': 'req_example' }));
    await assert.rejects(protocol.generate(request()), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.status, status);
      assert.equal(error.requestId, 'req_example');
      assert.equal(error.message.includes(TOKEN), false);
      return true;
    });
    assert.equal(calls.length, 1);
  }
});

test('caller cancellation aborts the actual upstream signal and releases an in-flight body reader', async () => {
  let cancelled = false;
  const controller = new AbortController();
  const { protocol, calls } = harness(() => sse(delta('partial'), { remainOpen: true, onCancel: () => { cancelled = true; } }));
  const pending = protocol.generate(request({ signal: controller.signal }));
  await settle();
  controller.abort('never expose this cancellation reason');
  await assert.rejects(pending, (error) => error.code === 'cancelled' && !error.message.includes('never expose'));
  assert.equal(calls[0].init.signal.aborted, true);
  assert.equal(cancelled, true);
  assert.equal(calls.length, 1);
});

test('an already aborted request performs no fetch, including token exchange and identity metadata', async () => {
  const controller = new AbortController();
  controller.abort();
  const { protocol, calls } = harness(() => { throw new Error('must not fetch'); });
  await assert.rejects(protocol.generate(request({ signal: controller.signal })), errorCode('cancelled'));
  await assert.rejects(protocol.refresh({ clientId: CLIENT, refreshToken: REFRESH, signal: controller.signal }), errorCode('cancelled'));
  await assert.rejects(protocol.verifyIdentity({ idToken: token(), clientId: CLIENT, nonce: NONCE, signal: controller.signal }), errorCode('cancelled'));
  assert.equal(calls.length, 0);
});

test('metadata and inference deadlines abort requests without starting a second attempt', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { protocol, calls } = harness(() => new Promise(() => {}));
  const metadata = protocol.models({ accessToken: TOKEN });
  const metadataCheck = assert.rejects(metadata, (error) => error.code === 'timeout' && error.status === 504);
  await settle();
  t.mock.timers.tick(15_000);
  await metadataCheck;
  assert.equal(calls[0].init.signal.aborted, true);
  const generation = protocol.generate(request());
  const generationCheck = assert.rejects(generation, (error) => error.code === 'timeout' && error.status === 504);
  await settle();
  t.mock.timers.tick(240_000);
  await generationCheck;
  assert.equal(calls[1].init.signal.aborted, true);
  assert.equal(calls.length, 2);
});

test('body reads remain bounded, including error bodies and SSE lines', async () => {
  const huge = 'x'.repeat(1024 * 1024 + 1);
  const metadata = harness(() => new Response(huge, { headers: { 'content-type': 'application/json' } })).protocol;
  await assert.rejects(metadata.models({ accessToken: TOKEN }), errorCode('invalid_response'));
  const badResponse = harness(() => new Response(huge, { status: 401 })).protocol;
  await assert.rejects(badResponse.generate(request()), errorCode('auth_required'));
  let cancelled = false;
  const stream = harness(() => sse('data: ' + huge + huge, { remainOpen: true, onCancel: () => { cancelled = true; } })).protocol;
  await assert.rejects(stream.generate(request()), errorCode('invalid_response'));
  assert.equal(cancelled, true);
});

test('inference timeout also cancels a stalled stream after receiving text', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let cancelled = false;
  const { protocol, calls } = harness(() => sse(delta('partial'), { remainOpen: true, onCancel: () => { cancelled = true; } }));
  const pending = protocol.generate(request());
  const check = assert.rejects(pending, errorCode('timeout'));
  await settle();
  t.mock.timers.tick(240_000);
  await check;
  assert.equal(cancelled, true);
  assert.equal(calls[0].init.signal.aborted, true);
  assert.equal(calls.length, 1);
});

test('a successful HTTP response with the wrong content type is cancelled without consuming it', async () => {
  let cancelled = false;
  const { protocol } = harness(() => new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
    headers: { 'content-type': 'application/json' },
  }));
  await assert.rejects(protocol.generate(request()), errorCode('invalid_response'));
  assert.equal(cancelled, true);
});

test('text request validation rejects coercions, tools, empty and oversized inputs before fetching', async () => {
  const { protocol, calls } = harness(() => { throw new Error('must not fetch'); });
  const cases = [
    { model: ['gpt-test'] }, { model: 'bad model' }, { accessToken: 'token\r\nheader: injected' },
    { messages: 'text' }, { messages: [] }, { messages: [{ role: ['user'], content: 'text' }] },
    { messages: [{ role: 'tool', content: 'text' }] }, { messages: [{ role: 'user', content: { text: 'text' } }] },
    { messages: [{ role: 'user', content: '   ' }] },
    { messages: [{ role: 'user', content: 'x'.repeat(2 * 1024 * 1024 + 1) }] },
  ];
  for (const extra of cases) await assert.rejects(protocol.generate(request(extra)), errorCode('invalid_request'));
  assert.equal(calls.length, 0);
});

test('network exceptions and interrupted readers are sanitized rather than exposing library error text', async () => {
  const transport = harness(() => { throw new Error('library diagnostic ' + TOKEN); }).protocol;
  await assert.rejects(transport.generate(request()), (error) => error.code === 'usage_unavailable' && !error.message.includes(TOKEN));
  const reader = harness(() => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(encoder.encode(delta('partial')));
    controller.error(new Error('private transport error ' + TOKEN));
  } }), { headers: { 'content-type': 'text/event-stream' } })).protocol;
  await assert.rejects(reader.generate(request()), (error) => error.code === 'incomplete_response' && !error.message.includes(TOKEN));
});
