import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';

export const OAUTH = Object.freeze({
  issuer: 'https://auth.openai.com',
  authorization: 'https://auth.openai.com/api/accounts/authorize',
  token: 'https://auth.openai.com/api/accounts/oauth/token',
  jwks: 'https://auth.openai.com/.well-known/jwks.json',
  discovery: 'https://auth.openai.com/.well-known/openid-configuration',
  resource: 'https://api.openai.com/v1',
  scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
});

const DYNAMIC_CLIENT = 'dynamic_agent_client';
const METADATA_TIMEOUT = 15_000;
const INFERENCE_TIMEOUT = 240_000;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_ERROR_BYTES = 16 * 1024;
const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_EVENT_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_STREAM_BYTES = 16 * 1024 * 1024;
const TERMINAL_REFRESH_CODES = new Set([
  'invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired',
  'refresh_token_invalidated', 'refresh_token_reused',
]);

export class AgentError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = 'AgentError';
    this.code = code;
    this.status = status;
    for (const key of ['upstreamCode', 'upstreamStatus', 'requestId', 'param', 'responseShape']) {
      if (details[key] !== undefined) this[key] = details[key];
    }
  }
}

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 512) => typeof value === 'string' && value.length > 0
  && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
const issuedClient = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/u.test(value)
  && value !== DYNAMIC_CLIENT;
const opaqueToken = (value) => typeof value === 'string' && /^[\x21-\x7e]{1,65536}$/u.test(value);
const modelId = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u.test(value);
const random = (bytes = 32) => randomBytes(bytes).toString('base64url');
const same = (a, b) => typeof a === 'string' && typeof b === 'string'
  && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function invalidRequest() {
  return new AgentError('invalid_request', 'The request contains invalid or unsupported values.', 400);
}

function invalidIdentity() {
  return new AgentError('invalid_identity', 'The ChatGPT identity could not be verified. Sign in again.', 401);
}

function validRedirect(value) {
  if (typeof value !== 'string' || !/^http:\/\/127\.0\.0\.1(?::[0-9]{1,5})?\/auth\/callback$/u.test(value)) return false;
  try {
    const url = new URL(value);
    return url.hostname === '127.0.0.1' && !url.username && !url.password
      && !url.search && !url.hash && url.pathname === '/auth/callback';
  } catch { return false; }
}

function validHost(value) {
  return typeof value === 'string' && (
    /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
    || /^urn:ietf:params:oauth:jwk-thumbprint:sha-256:[A-Za-z0-9_-]{43}$/u.test(value)
    || /^did:key:z[1-9A-HJ-NP-Za-km-z]{20,400}$/u.test(value)
  );
}

export function createAttempt({ hostId, redirectUri, registration = null, browserSessionId,
  forceConsent = false, now = Date.now() }) {
  if (!validHost(hostId) || !validRedirect(redirectUri) || !text(browserSessionId, 256)
    || !Number.isFinite(now) || typeof forceConsent !== 'boolean'
    || (registration !== null && (!object(registration) || !issuedClient(registration.id)
      || (registration.subject != null && !text(registration.subject))))) throw invalidRequest();
  return {
    id: random(18), state: random(), nonce: random(), verifier: random(64),
    hostId, redirectUri, browserSessionId, forceConsent,
    clientId: registration?.id ?? DYNAMIC_CLIENT,
    subject: registration?.subject ?? undefined,
    email: text(registration?.email, 320) ? registration.email : undefined,
    expiresAt: now + 10 * 60_000,
  };
}

export function authorizationUrl(attempt) {
  const url = new URL(OAUTH.authorization);
  const params = new URLSearchParams({
    client_id: attempt.clientId,
    ext_agent_host_id: attempt.hostId,
    response_type: 'code',
    redirect_uri: attempt.redirectUri,
    scope: OAUTH.scope,
    resource: OAUTH.resource,
    state: attempt.state,
    nonce: attempt.nonce,
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(attempt.verifier).digest('base64url'),
  });
  if (attempt.clientId === DYNAMIC_CLIENT) params.set('agent_name_hint', 'Mermaid Agent');
  else if (attempt.email) params.set('login_hint', attempt.email);
  if (attempt.forceConsent) params.set('prompt', 'consent');
  // This URL can reach browser JavaScript; do not include the optional ID-token hint.
  url.search = params.toString();
  return url.toString();
}

// The service atomically consumes the pending attempt and checks its browser session.
export function validateCallback(attempt, params, now = Date.now()) {
  const invalid = () => new AgentError('invalid_callback', 'The sign-in callback could not be verified.', 400);
  if (!object(attempt) || !(params instanceof URLSearchParams) || !Number.isFinite(now)
    || !Number.isFinite(attempt.expiresAt) || now >= attempt.expiresAt) throw invalid();
  for (const key of params.keys()) if (params.getAll(key).length !== 1) throw invalid();
  if (!same(params.get('state'), attempt.state)) throw invalid();
  if (params.has('error')) {
    if (params.get('error') === 'access_denied') {
      throw new AgentError('access_denied', 'ChatGPT sign-in was not approved. Your existing account is unchanged.', 403);
    }
    throw new AgentError('auth_required', 'ChatGPT sign-in did not complete. Start a new sign-in.', 401);
  }
  const code = params.get('code');
  const returnedClient = params.get('client_id');
  const clientId = returnedClient ?? attempt.clientId;
  if (!opaqueToken(code) || code.length > 4096 || !issuedClient(clientId)
    || (attempt.clientId !== DYNAMIC_CLIENT && clientId !== attempt.clientId)) throw invalid();
  return { code, clientId };
}

function stopped(signal) {
  if (!signal.aborted) return null;
  return signal.reason instanceof AgentError && signal.reason.code === 'timeout'
    ? signal.reason : new AgentError('cancelled', 'The request was cancelled.', 499);
}

async function abortable(operation, signal) {
  if (signal.aborted) throw stopped(signal);
  let listener;
  const interruption = new Promise((_, reject) => {
    listener = () => reject(stopped(signal));
    signal.addEventListener('abort', listener, { once: true });
  });
  try { return await Promise.race([Promise.resolve().then(operation), interruption]); }
  finally { signal.removeEventListener('abort', listener); }
}

async function withDeadline(external, milliseconds, operation) {
  const controller = new AbortController();
  const cancel = () => controller.abort(new AgentError('cancelled', 'The request was cancelled.', 499));
  if (external?.aborted) cancel();
  else external?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(
    new AgentError('timeout', 'The ChatGPT request timed out. No retry was started.', 504),
  ), milliseconds);
  timer.unref?.();
  try {
    if (controller.signal.aborted) throw stopped(controller.signal);
    const result = await operation(controller.signal);
    if (controller.signal.aborted) throw stopped(controller.signal);
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw stopped(controller.signal);
    if (error instanceof AgentError) throw error;
    throw new AgentError('usage_unavailable', 'OpenAI could not be reached. Try again later.', 503);
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', cancel);
  }
}

function closeReader(reader) {
  try { Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* Already closed. */ }
  try { reader.releaseLock(); } catch { /* A cancelled read may still be settling. */ }
}

async function readText(response, signal, limit) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const parts = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await abortable(() => reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new AgentError('invalid_response', 'OpenAI returned an oversized response.', 502);
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join('');
  } catch (error) {
    if (signal.aborted) throw stopped(signal);
    if (error instanceof AgentError) throw error;
    throw new AgentError('invalid_response', 'OpenAI returned an unreadable response.', 502);
  } finally { closeReader(reader); }
}

function diagnostic(value, pattern = /^[A-Za-z0-9_.:\[\]-]{1,128}$/u) {
  return typeof value === 'string' && pattern.test(value) ? value : undefined;
}

function upstreamError(status, body, headers) {
  const source = object(body?.error) ? body.error : body;
  const upstreamCode = diagnostic(typeof body?.error === 'string' ? body.error : source?.code,
    /^[a-z][a-z0-9_]{0,95}$/u);
  const details = {
    upstreamCode, upstreamStatus: status,
    requestId: diagnostic(headers?.get('x-request-id') ?? headers?.get('openai-request-id')),
    param: diagnostic(source?.param),
    responseShape: object(body?.error) ? 'error' : typeof body?.error === 'string' ? 'oauth'
      : typeof body?.detail === 'string' ? 'detail' : 'other',
  };
  let code = 'upstream_error';
  let message = 'OpenAI could not complete this request.';
  let fallbackStatus = 502;
  if (upstreamCode === 'invalid_client') {
    code = 'invalid_client'; message = 'The saved ChatGPT client configuration was not accepted.'; fallbackStatus = 400;
  } else if (TERMINAL_REFRESH_CODES.has(upstreamCode) || upstreamCode === 'subscription_sharing_invalid_user' || status === 401) {
    code = 'auth_required'; message = 'ChatGPT access was not accepted. Check the selected account or sign in again.'; fallbackStatus = 401;
  } else if (upstreamCode === 'subscription_sharing_usage_limit_exceeded' || status === 429) {
    code = 'quota_exceeded'; message = 'The ChatGPT plan or this app has reached a usage limit. Manage usage in ChatGPT settings.'; fallbackStatus = 429;
  } else if (upstreamCode === 'subscription_sharing_unsupported_capability' || upstreamCode === 'subscription_sharing_route_not_supported') {
    code = 'invalid_request'; message = 'This request uses a capability or route unavailable with the ChatGPT plan.'; fallbackStatus = 400;
  } else if (upstreamCode === 'subscription_sharing_user_not_eligible'
    || upstreamCode === 'chatpass_v2_scope_not_authorized' || upstreamCode === 'chatpass_v2_invalid_authorization_context'
    || status === 403) {
    code = 'permission_required'; message = 'ChatGPT plan usage is not permitted for this account, workspace, or request.'; fallbackStatus = 403;
  } else if (upstreamCode === 'subscription_sharing_usage_unavailable'
    || upstreamCode === 'subscription_sharing_user_unavailable' || status >= 500) {
    code = 'usage_unavailable'; message = 'ChatGPT plan usage is temporarily unavailable. Try again later.'; fallbackStatus = 503;
  } else if (status >= 400 && status < 500) {
    code = 'invalid_request'; message = 'OpenAI rejected this request. Check the selected model and inputs.'; fallbackStatus = 400;
  }
  // Streaming failures arrive on HTTP 200; keep that fact separately from the local error status.
  return new AgentError(code, message, status >= 400 && status <= 599 ? status : fallbackStatus, details);
}

async function requireSuccess(response, signal) {
  if (response.ok) return;
  let body;
  try { body = JSON.parse(await readText(response, signal, MAX_ERROR_BYTES)); }
  catch (error) {
    if (signal.aborted || error?.code === 'cancelled' || error?.code === 'timeout') throw error;
  }
  throw upstreamError(response.status, body, response.headers);
}

async function jsonBody(response, signal) {
  await requireSuccess(response, signal);
  let body;
  try { body = JSON.parse(await readText(response, signal, MAX_JSON_BYTES)); }
  catch (error) {
    if (error instanceof AgentError) throw error;
    throw new AgentError('invalid_response', 'OpenAI returned invalid JSON.', 502);
  }
  if (!object(body)) throw new AgentError('invalid_response', 'OpenAI returned an unexpected response.', 502);
  return body;
}

function decodeSegment(segment) {
  if (!/^[A-Za-z0-9_-]+$/u.test(segment)) throw invalidIdentity();
  const buffer = Buffer.from(segment, 'base64url');
  if (buffer.toString('base64url') !== segment) throw invalidIdentity();
  return buffer;
}

function decodeObject(segment) {
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decodeSegment(segment)));
    if (!object(value)) throw invalidIdentity();
    return value;
  } catch { throw invalidIdentity(); }
}

function validTimestamp(value) { return Number.isSafeInteger(value) && value >= 0; }

function completedText(response, deltas) {
  if (!object(response) || response.status !== 'completed') {
    throw new AgentError('invalid_response', 'OpenAI returned an invalid completion event.', 502);
  }
  let result = '';
  if (response.output !== undefined && !Array.isArray(response.output)) {
    throw new AgentError('invalid_response', 'OpenAI returned invalid completion output.', 502);
  }
  if (Array.isArray(response.output)) {
    for (const item of response.output) {
      if (!Array.isArray(item?.content)) continue;
      for (const part of item.content) if (part?.type === 'output_text' && typeof part.text === 'string') result += part.text;
    }
  } else result = deltas.join('');
  if (!result.trim() || Buffer.byteLength(result) > MAX_OUTPUT_BYTES) {
    throw new AgentError('invalid_response', 'OpenAI completed without usable text output.', 502);
  }
  return result;
}

async function readResponseStream(response, signal) {
  if (!response.body || !/^text\/event-stream(?:\s*;|\s*$)/iu.test(response.headers.get('content-type') ?? '')) {
    if (response.body) { try { Promise.resolve(response.body.cancel()).catch(() => {}); } catch { /* Closed. */ } }
    throw new AgentError('invalid_response', 'OpenAI did not return a Responses event stream.', 502);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  let skipLF = false;
  let eventName = '';
  let eventData = [];
  let eventBytes = 0;
  let streamBytes = 0;
  let outputBytes = 0;
  let result;
  const deltas = [];
  const incomplete = () => new AgentError('incomplete_response', 'The ChatGPT response did not complete. No retry was started.', 502);

  function dispatch() {
    if (!eventData.length) { eventName = ''; return; }
    const data = eventData.join('\n');
    eventData = []; eventBytes = 0;
    if (data === '[DONE]') throw incomplete();
    let event;
    try { event = JSON.parse(data); } catch { throw new AgentError('invalid_response', 'OpenAI returned an invalid stream event.', 502); }
    if (!object(event)) throw new AgentError('invalid_response', 'OpenAI returned an invalid stream event.', 502);
    const type = typeof event.type === 'string' ? event.type : eventName;
    if (eventName && eventName !== 'message' && event.type && eventName !== event.type) {
      throw new AgentError('invalid_response', 'OpenAI returned conflicting stream event types.', 502);
    }
    eventName = '';
    if (type === 'response.output_text.delta') {
      if (typeof event.delta !== 'string') throw new AgentError('invalid_response', 'OpenAI returned an invalid text event.', 502);
      outputBytes += Buffer.byteLength(event.delta);
      if (outputBytes > MAX_OUTPUT_BYTES) throw new AgentError('invalid_response', 'OpenAI returned oversized text output.', 502);
      deltas.push(event.delta);
    } else if (type === 'response.completed') result = completedText(event.response, deltas);
    else if (type === 'response.failed') throw upstreamError(200, { error: event.response?.error }, response.headers);
    else if (type === 'error') throw upstreamError(200, { error: event.error ?? event }, response.headers);
    else if (type === 'response.incomplete' || type === 'response.cancelled') throw incomplete();
  }

  function line(value) {
    if (value === '') { dispatch(); return; }
    if (value.startsWith(':')) return;
    const colon = value.indexOf(':');
    const field = colon < 0 ? value : value.slice(0, colon);
    let content = colon < 0 ? '' : value.slice(colon + 1);
    if (content.startsWith(' ')) content = content.slice(1);
    if (field === 'data') {
      eventBytes += Buffer.byteLength(content) + 1;
      if (eventBytes > MAX_EVENT_BYTES) throw new AgentError('invalid_response', 'OpenAI returned an oversized stream event.', 502);
      eventData.push(content);
    } else if (field === 'event') eventName = content;
  }

  function consume(chunk) {
    if (skipLF && chunk.length) { if (chunk.startsWith('\n')) chunk = chunk.slice(1); skipLF = false; }
    buffer += chunk;
    const endings = /[\r\n]/gu;
    let start = 0;
    let match;
    while ((match = endings.exec(buffer))) {
      const index = match.index;
      let next = index + 1;
      if (buffer[index] === '\r') {
        if (next === buffer.length) skipLF = true;
        else if (buffer[next] === '\n') next += 1;
      }
      line(buffer.slice(start, index));
      start = next;
      endings.lastIndex = next;
      if (result !== undefined) break;
    }
    buffer = buffer.slice(start);
    if (Buffer.byteLength(buffer) + eventBytes > MAX_EVENT_BYTES) {
      throw new AgentError('invalid_response', 'OpenAI returned an oversized stream event.', 502);
    }
  }

  try {
    while (result === undefined) {
      const { done, value } = await abortable(() => reader.read(), signal);
      if (done) { consume(decoder.decode()); break; }
      streamBytes += value.byteLength;
      if (streamBytes > MAX_STREAM_BYTES) throw new AgentError('invalid_response', 'OpenAI returned an oversized event stream.', 502);
      consume(decoder.decode(value, { stream: true }));
    }
    if (result === undefined) throw incomplete();
    return result;
  } catch (error) {
    if (signal.aborted) throw stopped(signal);
    if (error instanceof AgentError) throw error;
    throw incomplete();
  } finally { closeReader(reader); }
}

export class OpenAIProtocol {
  #fetch;
  #now;
  #jwks;

  constructor({ fetchImpl = fetch, now = Date.now } = {}) {
    this.#fetch = fetchImpl;
    this.#now = now;
  }

  async #request(url, init, signal) {
    return abortable(() => this.#fetch(url, {
      ...init, signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
    }), signal);
  }

  async #postToken(form, signal) {
    return jsonBody(await this.#request(OAUTH.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: form.toString(),
    }, signal), signal);
  }

  async exchange({ attempt, code, clientId, signal }) {
    if (!object(attempt) || !validRedirect(attempt.redirectUri) || !opaqueToken(code)
      || !issuedClient(clientId) || !/^[A-Za-z0-9._~-]{43,128}$/u.test(attempt.verifier ?? '')
      || (attempt.clientId !== DYNAMIC_CLIENT && attempt.clientId !== clientId)) throw invalidRequest();
    return withDeadline(signal, METADATA_TIMEOUT, (active) => this.#postToken(new URLSearchParams({
      grant_type: 'authorization_code', code, client_id: clientId,
      code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri, resource: OAUTH.resource,
    }), active));
  }

  async refresh({ clientId, refreshToken, signal }) {
    if (!issuedClient(clientId) || !opaqueToken(refreshToken)) throw invalidRequest();
    return withDeadline(signal, METADATA_TIMEOUT, (active) => this.#postToken(new URLSearchParams({
      grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken, resource: OAUTH.resource,
    }), active));
  }

  async #loadJwks(signal, force = false) {
    if (!force && this.#jwks && this.#jwks.expiresAt > this.#now()) return this.#jwks.keys;
    const body = await jsonBody(await this.#request(OAUTH.jwks, { headers: { accept: 'application/json' } }, signal), signal);
    if (!Array.isArray(body.keys) || !body.keys.length || body.keys.length > 64 || !body.keys.every(object)) {
      throw new AgentError('invalid_response', 'OpenAI signing keys could not be read.', 502);
    }
    this.#jwks = { keys: body.keys, expiresAt: this.#now() + 5 * 60_000 };
    return body.keys;
  }

  async verifyIdentity({ idToken, clientId, nonce, subject, refresh = false, signal }) {
    if (typeof idToken !== 'string' || idToken.length > 65536 || !issuedClient(clientId)
      || (!refresh && !text(nonce)) || (subject !== undefined && !text(subject))
      || (refresh && !text(subject))) throw invalidIdentity();
    const segments = idToken.split('.');
    if (segments.length !== 3) throw invalidIdentity();
    const header = decodeObject(segments[0]);
    const claims = decodeObject(segments[1]);
    const signature = decodeSegment(segments[2]);
    if (header.alg !== 'RS256' || !text(header.kid, 256)
      || (header.crit !== undefined && (!Array.isArray(header.crit) || header.crit.length))
      || header.b64 === false) throw invalidIdentity();
    return withDeadline(signal, METADATA_TIMEOUT, async (active) => {
      const hadCache = this.#jwks && this.#jwks.expiresAt > this.#now();
      let keys = await this.#loadJwks(active);
      let matches = keys.filter((key) => key.kid === header.kid);
      if (!matches.length && hadCache) {
        keys = await this.#loadJwks(active, true);
        matches = keys.filter((key) => key.kid === header.kid);
      }
      if (matches.length !== 1) throw invalidIdentity();
      const jwk = matches[0];
      if (jwk.kty !== 'RSA' || (jwk.alg !== undefined && jwk.alg !== 'RS256')
        || (jwk.use !== undefined && jwk.use !== 'sig')
        || (jwk.key_ops !== undefined && (!Array.isArray(jwk.key_ops) || !jwk.key_ops.includes('verify')))
        || typeof jwk.n !== 'string' || typeof jwk.e !== 'string' || jwk.d !== undefined) throw invalidIdentity();
      try {
        const key = createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' });
        if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048
          || !verify('RSA-SHA256', Buffer.from(segments[0] + '.' + segments[1]), key, signature)) throw invalidIdentity();
      } catch { throw invalidIdentity(); }
      const now = this.#now() / 1000;
      const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (claims.iss !== OAUTH.issuer || !text(claims.sub) || !audiences.length
        || !audiences.every((aud) => typeof aud === 'string') || !audiences.includes(clientId)
        || (claims.azp !== undefined && claims.azp !== clientId)
        || (audiences.length > 1 && claims.azp !== clientId)
        || !validTimestamp(claims.exp) || !validTimestamp(claims.iat) || now >= claims.exp + 5
        || claims.iat > now + 5 || claims.exp <= claims.iat
        || (claims.nbf !== undefined && (!validTimestamp(claims.nbf) || claims.nbf > now + 5))
        || ((!refresh || claims.nonce !== undefined) && !same(claims.nonce, nonce))
        || (subject !== undefined && claims.sub !== subject)) throw invalidIdentity();
      const identity = { iss: claims.iss, sub: claims.sub, aud: claims.aud, exp: claims.exp, iat: claims.iat };
      if (claims.nonce !== undefined) identity.nonce = claims.nonce;
      if (text(claims.email, 320)) identity.email = claims.email;
      if (typeof claims.email_verified === 'boolean') identity.email_verified = claims.email_verified;
      if (text(claims.name, 256)) identity.name = claims.name;
      return identity;
    });
  }

  async revoke({ clientId, refreshToken, signal }) {
    if (!issuedClient(clientId) || !opaqueToken(refreshToken)) throw invalidRequest();
    try {
      return await withDeadline(signal, METADATA_TIMEOUT, async (active) => {
        const discovery = await jsonBody(await this.#request(OAUTH.discovery, { headers: { accept: 'application/json' } }, active), active);
        if (discovery.issuer !== OAUTH.issuer || typeof discovery.revocation_endpoint !== 'string') return false;
        let endpoint;
        try { endpoint = new URL(discovery.revocation_endpoint); } catch { return false; }
        if (endpoint.origin !== OAUTH.issuer || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return false;
        const response = await this.#request(endpoint.toString(), {
          method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
          body: new URLSearchParams({ token: refreshToken, token_type_hint: 'refresh_token', client_id: clientId }).toString(),
        }, active);
        if (response.body) { try { Promise.resolve(response.body.cancel()).catch(() => {}); } catch { /* Closed. */ } }
        return response.status === 200;
      });
    } catch (error) {
      if (signal?.aborted) throw new AgentError('cancelled', 'The request was cancelled.', 499);
      if (error?.code === 'invalid_request') throw error;
      return false;
    }
  }

  async models({ accessToken, signal }) {
    if (!opaqueToken(accessToken)) throw invalidRequest();
    return withDeadline(signal, METADATA_TIMEOUT, async (active) => {
      const body = await jsonBody(await this.#request(OAUTH.resource + '/models', {
        headers: { authorization: 'Bearer ' + accessToken, accept: 'application/json' },
      }, active), active);
      if (!Array.isArray(body.models) || body.models.length > 1000) {
        throw new AgentError('invalid_response', 'OpenAI returned an unexpected model catalogue.', 502);
      }
      const seen = new Set();
      const models = [];
      for (const model of body.models) {
        if (model?.visibility !== 'list' || !modelId(model.slug) || !text(model.display_name, 256) || seen.has(model.slug)) continue;
        seen.add(model.slug);
        models.push({ id: model.slug, name: model.display_name });
      }
      return models;
    });
  }

  async generate({ accessToken, model, messages, signal }) {
    if (!opaqueToken(accessToken) || !modelId(model) || !Array.isArray(messages)
      || !messages.length || messages.length > 200) throw invalidRequest();
    let bytes = 0;
    let hasContent = false;
    const input = messages.map((message) => {
      if (!object(message) || !['system', 'developer', 'user', 'assistant'].includes(message.role)
        || typeof message.content !== 'string') throw invalidRequest();
      bytes += Buffer.byteLength(message.content);
      if (bytes > MAX_INPUT_BYTES) throw invalidRequest();
      hasContent ||= Boolean(message.content.trim());
      return { role: message.role === 'system' ? 'developer' : message.role, content: message.content };
    });
    if (!hasContent) throw invalidRequest();
    return withDeadline(signal, INFERENCE_TIMEOUT, async (active) => {
      const response = await this.#request(OAUTH.resource + '/responses', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + accessToken, 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({ model, input, store: false, stream: true }),
      }, active);
      await requireSuccess(response, active);
      return readResponseStream(response, active);
    });
  }
}
