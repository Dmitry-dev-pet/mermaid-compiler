import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, realpath } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { randomBytes } from 'node:crypto';
import { resolve, extname, sep, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { CredentialStore } from './storage.mjs';
import { ChatGPTService } from './service.mjs';
import { AgentError } from './protocol.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const COOKIE = 'mermaid_chatgpt_local';
const SESSION_MS = 8 * 60 * 60 * 1000;
const BODY_LIMIT = 2 * 1024 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm',
};

function headers(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}

function json(res, status, value) {
  if (res.destroyed || res.writableEnded) return;
  headers(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

function safeError(error) {
  if (error instanceof AgentError) return { status: error.status >= 400 && error.status <= 599 ? error.status : 500, body: { error: { code: error.code, message: error.message } } };
  if (error?.name === 'AbortError') return { status: 409, body: { error: { code: 'cancelled', message: 'The request was cancelled.' } } };
  return { status: 500, body: { error: { code: 'local_agent_error', message: 'Mermaid Agent could not complete this request. Check its local session and try again.' } } };
}

const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function authPage(res, status, message) {
  headers(res);
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mermaid · ChatGPT</title><style>body{font:18px/1.6 system-ui,sans-serif;max-width:42rem;margin:12vh auto;padding:0 1.5rem;background:#111827;color:#e5e7eb}a{color:#93c5fd}h1{font-size:1.5rem}</style><h1>Mermaid · ChatGPT</h1><p>${escapeHtml(message)}</p><p><a href="/?ai=chatgpt">Return to Mermaid</a></p></html>`);
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let bytes = 0; let chunks = []; let finished = false;
    const clean = () => { req.off('data', data); req.off('end', end); req.off('error', fail); req.off('aborted', aborted); };
    const fail = error => {
      if (finished) return;
      finished = true; chunks = []; clean(); req.resume();
      reject(error instanceof AgentError ? error : new AgentError('invalid_request', 'Could not read the local request.', 400));
    };
    const data = chunk => {
      bytes += chunk.length;
      if (bytes > BODY_LIMIT) return fail(new AgentError('invalid_request', 'The request is too large. Shorten the conversation.', 413));
      chunks.push(chunk);
    };
    const end = () => { if (!finished) { finished = true; clean(); resolveBody(Buffer.concat(chunks)); } };
    const aborted = () => fail(new AgentError('cancelled', 'The request was cancelled.', 409));
    req.on('data', data); req.once('end', end); req.once('error', fail); req.once('aborted', aborted);
  });
}

async function readJson(req, allowedKeys) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
    req.resume();
    throw new AgentError('invalid_request', 'Send this request as JSON.', 415);
  }
  let value;
  try { value = JSON.parse((await readBody(req)).toString('utf8')); }
  catch (error) { if (error instanceof AgentError) throw error; throw new AgentError('invalid_request', 'The request must contain valid JSON.', 400); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowedKeys.includes(k))) {
    throw new AgentError('invalid_request', 'Unsupported request fields.', 400);
  }
  for (const name of ['accountId', 'sessionId']) if (value[name] !== undefined && (typeof value[name] !== 'string' || value[name].length === 0 || value[name].length > 256)) {
    throw new AgentError('invalid_request', 'Invalid connection or session identifier.', 400);
  }
  for (const name of ['newAccount', 'forceConsent']) if (value[name] !== undefined && typeof value[name] !== 'boolean') {
    throw new AgentError('invalid_request', 'Invalid sign-in option.', 400);
  }
  return value;
}

function cookieValue(req) {
  const pairs = String(req.headers.cookie ?? '').split(';').map(s => s.trim().split('='));
  const values = pairs.filter(p => p[0] === COOKIE);
  return values.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(values[0][1] ?? '') ? values[0][1] : null;
}

// The production CLI always uses 8788 and binds before opening credentials. The
// port option exists for isolated tests, not an HTTP or environment override.
export async function startChatGPTAgent({
  port = 8788,
  distDir = resolve(ROOT, 'diagram-compiler/dist'),
  storageDir = join(homedir(), '.config', 'mermaid-agent', 'chatgpt'),
  store = new CredentialStore(storageDir), protocol, openBrowser,
  createService = options => new ChatGPTService(options),
  goHandler = null,
} = {}) {
  const frontendRoot = await realpath(distDir);
  const indexFile = await realpath(join(frontendRoot, 'index.html'));
  if (!indexFile.startsWith(frontendRoot + sep) || !(await stat(indexFile)).isFile()) throw new Error('Build the editor before starting Mermaid Agent.');
  let service = null;
  let origin = '';
  const sessions = new Map();
  const loginResults = new Map();
  const sessionFor = req => {
    const token = cookieValue(req);
    if (!token) return null;
    const expires = sessions.get(token);
    if (!expires || expires <= Date.now()) { sessions.delete(token); loginResults.delete(token); return null; }
    return token;
  };
  const issueSession = (req, res) => {
    const existing = sessionFor(req);
    if (existing) return existing;
    for (const [id, expires] of sessions) if (expires <= Date.now()) { sessions.delete(id); loginResults.delete(id); }
    if (sessions.size >= 64) { const oldest = sessions.keys().next().value; sessions.delete(oldest); loginResults.delete(oldest); }
    const token = randomBytes(32).toString('base64url');
    sessions.set(token, Date.now() + SESSION_MS);
    // HTTP loopback is required by SIWC; HTTPS Secure-cookie rules do not apply.
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}`);
    return token;
  };

  const handle = async (req, res) => {
    headers(res);
    const expectedHost = new URL(origin).host;
    if (req.headers.host !== expectedHost) throw new AgentError('forbidden_origin', 'Open Mermaid at its 127.0.0.1 address.', 403);
    if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//') || req.url.length > 8192) throw new AgentError('invalid_request', 'Invalid local URL.', 400);
    const rawPath = req.url.split('?')[0];
    let pathname;
    try { pathname = decodeURIComponent(rawPath); } catch { throw new AgentError('invalid_request', 'Invalid local URL.', 400); }
    if (/[\\\u0000-\u001f\u007f]/.test(pathname) || pathname.split('/').some(p => p.startsWith('.'))) {
      throw new AgentError('invalid_request', 'This path is not available.', 404);
    }
    const url = new URL(req.url, origin);
    const session = sessionFor(req);
    if (!service) throw new AgentError('agent_starting', 'Mermaid Agent is starting. Reload shortly.', 503);

    if (pathname === '/auth/callback') {
      if (req.method !== 'GET') throw new AgentError('invalid_request', 'Use the browser sign-in callback.', 405);
      if (!session) return authPage(res, 400, 'Return to the Mermaid tab where you started sign-in and open its sign-in link in that browser.');
      try {
        const result = await service.callback(url.searchParams, session);
        loginResults.set(session, { status: 200, message: result.connected ? 'ChatGPT is connected. Return to Mermaid, load models and send a request to verify generation.' : 'Sign-in completed, but use of the ChatGPT plan needs permission. Return to Mermaid to reconnect.' });
      } catch (error) {
        const safe = safeError(error);
        loginResults.set(session, { status: safe.status, message: safe.body.error.message });
      }
      // Remove the authorization code from the displayed URL before any content.
      res.writeHead(303, { Location: '/auth/complete' });
      return res.end();
    }
    if (pathname === '/auth/complete') {
      if (req.method !== 'GET') throw new AgentError('invalid_request', 'Unsupported method.', 405);
      const result = session ? loginResults.get(session) : null;
      return authPage(res, result?.status ?? 400, result?.message ?? 'Return to Mermaid to start sign-in.');
    }

    if (pathname.startsWith('/api/')) {
      const requestOrigin = req.headers.origin;
      const site = req.headers['sec-fetch-site'];
      if ((requestOrigin && requestOrigin !== origin) || (site && site !== 'same-origin' && site !== 'none')) throw new AgentError('forbidden_origin', 'Use the local Mermaid tab for this request.', 403);
      if (!session) throw new AgentError('local_session_required', 'Open the local Mermaid workspace first, then reconnect.', 401);
      if (req.method !== 'GET' && requestOrigin !== origin) throw new AgentError('forbidden_origin', 'Local actions require the Mermaid page origin.', 403);
      const controller = new AbortController();
      const disconnected = () => { if (!res.writableEnded) controller.abort(); };
      res.once('close', disconnected);
      try {
        if (pathname === '/api/opencode-go' && goHandler) {
          const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
          const requestHeaders = new Headers();
          for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') requestHeaders.set(key, value);
          const result = await goHandler(new Request(url, { method: req.method, headers: requestHeaders, body, signal: controller.signal }));
          if (res.destroyed) return;
          result.headers.forEach((value, key) => res.setHeader(key, value));
          res.writeHead(result.status);
          return res.end(Buffer.from(await result.arrayBuffer()));
        }
        let result;
        if (pathname === '/api/chatgpt/status' && req.method === 'GET') result = service.status();
        else if (pathname === '/api/chatgpt/models' && req.method === 'GET') result = await service.models(controller.signal);
        else if (pathname === '/api/chatgpt/login' && req.method === 'POST') result = await service.login(await readJson(req, ['accountId', 'newAccount', 'forceConsent']), session);
        else if (pathname === '/api/chatgpt/login/cancel' && req.method === 'POST') { await readJson(req, []); result = service.cancelLogin(); }
        else if (pathname === '/api/chatgpt/logout' && req.method === 'POST') { const body = await readJson(req, ['accountId']); result = await service.logout(body.accountId); }
        else if (pathname === '/api/chatgpt/account' && req.method === 'POST') { const body = await readJson(req, ['accountId']); if (!body.accountId) throw new AgentError('invalid_request', 'Choose a ChatGPT account.', 400); result = await service.selectAccount(body.accountId); }
        else if (pathname === '/api/chatgpt/generate' && req.method === 'POST') result = await service.generate(await readJson(req, ['model', 'messages', 'sessionId', 'accountId']), controller.signal);
        else throw new AgentError('invalid_request', 'This local API route or method is not available.', 404);
        return json(res, 200, result);
      } finally {
        res.off('close', disconnected);
      }
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') throw new AgentError('invalid_request', 'Unsupported method.', 405);
    const site = req.headers['sec-fetch-site'];
    if ((site === 'cross-site' || site === 'same-site') && !(req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document')) throw new AgentError('forbidden_origin', 'Open Mermaid in its own browser tab.', 403);
    let file = resolve(frontendRoot, `.${pathname === '/' ? '/index.html' : pathname}`);
    try {
      file = await realpath(file);
    } catch (error) {
      if (error?.code === 'ENOENT' && !extname(pathname)) file = indexFile;
      else throw new AgentError('invalid_request', 'File not found.', 404);
    }
    if (!file.startsWith(frontendRoot + sep) || !(await stat(file)).isFile()) throw new AgentError('invalid_request', 'File not found.', 404);
    const contentType = MIME[extname(file).toLowerCase()];
    if (!contentType) throw new AgentError('invalid_request', 'This file type is not served.', 404);
    if (extname(file) === '.html') issueSession(req, res);
    res.setHeader('Content-Type', contentType);
    if (req.method === 'HEAD') return res.end();
    await pipeline(createReadStream(file), res);
  };

  const server = createServer((req, res) => {
    handle(req, res).catch(error => { const safe = safeError(error); json(res, safe.status, safe.body); });
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.keepAliveTimeout = 5000;
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolveListen(); });
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  try {
    // Acquire the single production listening port BEFORE loading/refreshing a
    // session, so another process cannot rotate the same refresh token.
    const data = await store.initialize();
    service = createService({ store, data, protocol, openBrowser, redirectUri: `${origin}/auth/callback` });
  } catch (error) {
    await new Promise(resolveClose => server.close(resolveClose));
    throw error;
  }
  let closed = false;
  return {
    origin,
    async close() {
      if (closed) return;
      closed = true;
      await service.close();
      await new Promise(resolveClose => { server.close(resolveClose); server.closeAllConnections(); });
      sessions.clear(); loginResults.clear();
    },
  };
}
