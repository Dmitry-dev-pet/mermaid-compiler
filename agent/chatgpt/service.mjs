import { AgentError, OAUTH, createAttempt, authorizationUrl, validateCallback, OpenAIProtocol } from './protocol.mjs';

const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const TERMINAL_REFRESH = new Set(['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused']);
const tokenString = value => typeof value === 'string' && /^[\x21-\x7e]{1,65536}$/.test(value);
const copy = value => structuredClone(value);
const planAllowed = account => Boolean(account?.subject && account.tokens && !account.tokens.pendingIdentity && account.tokens.scopes.includes(PLAN_SCOPE));

export function normalizeTokens(raw, { previous = null, nonce, now = Date.now() }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !tokenString(raw.access_token) ||
      typeof raw.token_type !== 'string' || raw.token_type.toLowerCase() !== 'bearer' ||
      !Number.isFinite(raw.expires_in) || raw.expires_in <= 0 || raw.expires_in > 7 * 24 * 3600) {
    throw new AgentError('invalid_response', 'OpenAI returned an incomplete session. Sign in again.', 502);
  }
  if (raw.scope !== undefined && typeof raw.scope !== 'string') {
    throw new AgentError('invalid_response', 'OpenAI returned invalid session permissions.', 502);
  }
  const scopes = raw.scope === undefined ? previous?.scopes ?? [] : raw.scope.split(/\s+/).filter(Boolean);
  if (scopes.length > 32 || scopes.some(s => typeof s !== 'string' || s.length > 128)) {
    throw new AgentError('invalid_response', 'OpenAI returned invalid session permissions.', 502);
  }
  if (previous && !tokenString(raw.refresh_token)) {
    throw new AgentError('invalid_response', 'OpenAI did not return a replacement session. Sign in again.', 502);
  }
  const refreshToken = raw.refresh_token === undefined ? null : raw.refresh_token;
  const idToken = raw.id_token === undefined ? previous?.idToken : raw.id_token;
  if ((refreshToken !== null && !tokenString(refreshToken)) || !tokenString(idToken)) {
    throw new AgentError('invalid_response', 'OpenAI returned incomplete session credentials. Sign in again.', 502);
  }
  return {
    accessToken: raw.access_token, refreshToken, idToken, nonce: nonce ?? previous?.nonce,
    expiresAt: now + raw.expires_in * 1000, scopes: [...new Set(scopes)],
    pendingIdentity: false,
  };
}

export class ChatGPTService {
  #store;
  #data;
  #protocol;
  #now;
  #openBrowser;
  #redirectUri;
  #queue = Promise.resolve();
  #epoch = 0;
  #pending = null;
  #login = null;
  #usage = { state: 'unverified' };
  #models = new Map();
  #controllers = new Set();
  #storageFailed = false;
  #closed = false;

  constructor({ store, data, redirectUri, protocol = new OpenAIProtocol(), now = Date.now, openBrowser = async () => false }) {
    this.#store = store;
    this.#data = copy(data);
    this.#protocol = protocol;
    this.#now = now;
    this.#openBrowser = openBrowser;
    this.#redirectUri = redirectUri;
  }

  #exclusive(operation) {
    const task = this.#queue.then(operation);
    this.#queue = task.catch(() => {});
    return task;
  }

  #assertReady() {
    if (this.#closed) throw new AgentError('cancelled', 'Mermaid Agent is shutting down.', 503);
    if (this.#storageFailed) throw new AgentError('local_storage_error', 'The session could not be saved. Check local storage and restart Mermaid Agent before reconnecting.', 503);
  }

  async #persist(next) {
    try {
      await this.#store.save(next);
      this.#data = next;
    } catch {
      // A failed fsync can follow a successful rename. Keep the newest rotation
      // in memory, but block inference/another refresh until storage is repaired.
      this.#data = next;
      this.#storageFailed = true;
      this.#abortRequests();
      throw new AgentError('local_storage_error', 'Could not safely save the session. Check local storage and restart Mermaid Agent.', 503);
    }
  }

  #abortRequests() {
    for (const controller of this.#controllers) controller.abort();
    this.#controllers.clear();
  }

  #cancelLogin(message = 'Sign-in cancelled.') {
    if (this.#pending) {
      this.#pending.controller.abort();
      this.#pending = null;
      this.#login = { ...this.#login, state: 'cancelled', message };
    }
  }

  #expireLogin() {
    if (this.#pending && this.#pending.attempt.expiresAt <= this.#now()) {
      this.#cancelLogin('Sign-in expired. Continue with ChatGPT to try again.');
      this.#login.state = 'failed';
    }
  }

  status() {
    this.#expireLogin();
    const active = this.#data.accounts.find(a => a.id === this.#data.activeAccountId);
    return {
      agent: 'mermaid-chatgpt', protocolVersion: 1,
      connected: !this.#storageFailed && planAllowed(active),
      activeAccountId: this.#data.activeAccountId,
      accounts: this.#data.accounts.map(a => ({ id: a.id, email: a.email, connected: planAllowed(a) })),
      login: this.#login ? { ...this.#login } : null,
      usage: this.#storageFailed ? { state: 'unavailable', message: 'Local session storage needs attention. Restart the Agent after checking its permissions and free space.' } : { ...this.#usage },
    };
  }

  async login({ accountId, newAccount = false, forceConsent = false } = {}, browserSessionId) {
    this.#assertReady();
    this.#cancelLogin();
    const registration = newAccount ? null : this.#data.accounts.find(a => a.id === (accountId ?? this.#data.activeAccountId)) ??
      (!accountId ? this.#data.accounts.findLast(a => a.subject === null) : undefined) ?? null;
    if (accountId && !registration && !newAccount) throw new AgentError('invalid_request', 'Choose an existing ChatGPT connection.', 400);
    if (newAccount && this.#data.accounts.length >= 32) throw new AgentError('invalid_request', 'Too many saved connections. Use an existing ChatGPT connection.', 400);
    const attempt = createAttempt({ hostId: this.#data.hostId, redirectUri: this.#redirectUri, registration, browserSessionId, now: this.#now(), forceConsent: forceConsent || Boolean(registration?.tokens && !registration.tokens.scopes.includes(PLAN_SCOPE)) });
    this.#pending = { attempt, controller: new AbortController(), consumed: false };
    this.#login = { id: attempt.id, state: 'pending', message: 'Complete sign-in in your browser.' };
    const authUrl = authorizationUrl(attempt);
    try { await this.#openBrowser(authUrl); } catch { /* The UI also has an explicit fallback link. */ }
    return { ok: true, authUrl };
  }

  cancelLogin() {
    this.#cancelLogin();
    return { ok: true };
  }

  callback(searchParams, browserSessionId) {
    return this.#exclusive(async () => {
      this.#assertReady();
      this.#expireLogin();
      const pending = this.#pending;
      if (!pending || pending.consumed || pending.attempt.browserSessionId !== browserSessionId) {
        throw new AgentError('invalid_callback', 'This sign-in belongs to another browser or has expired. Return to Mermaid and open its sign-in link.', 400);
      }
      const stillPending = () => this.#pending === pending && !pending.controller.signal.aborted && !this.#closed;
      try {
        const { code, clientId } = validateCallback(pending.attempt, searchParams, this.#now());
        pending.consumed = true;
        // Keep an issued registration even when a one-time code exchange fails.
        // It is never an authenticated/active account until identity is verified.
        if (!this.#data.accounts.some(a => a.id === clientId)) {
          const next = copy(this.#data);
          next.accounts.push({ id: clientId, issuer: OAUTH.issuer, subject: null, email: null, tokens: null });
          await this.#persist(next);
        }
        if (!stillPending()) throw new AgentError('cancelled', 'Sign-in cancelled.', 409);
        const raw = await this.#protocol.exchange({ attempt: pending.attempt, code, clientId, signal: pending.controller.signal });
        if (!stillPending()) throw new AgentError('cancelled', 'Sign-in cancelled.', 409);
        const identity = await this.#protocol.verifyIdentity({ idToken: raw.id_token, clientId, nonce: pending.attempt.nonce, subject: pending.attempt.subject, signal: pending.controller.signal });
        if (!stillPending()) throw new AgentError('cancelled', 'Sign-in cancelled.', 409);
        let tokens = null;
        if (raw.access_token !== undefined) tokens = normalizeTokens(raw, { nonce: pending.attempt.nonce, now: this.#now() });
        const beforeActivation = copy(this.#data);
        const next = copy(this.#data);
        const account = next.accounts.find(a => a.id === clientId);
        account.subject = identity.sub;
        account.email = typeof identity.email === 'string' ? identity.email : null;
        account.tokens = tokens;
        const allowed = planAllowed(account);
        const previousAccount = beforeActivation.accounts.find(a => a.id === clientId);
        if (!allowed && planAllowed(previousAccount)) account.tokens = copy(previousAccount.tokens);
        // A newly denied plan connection cannot replace an already usable one.
        if (allowed || next.activeAccountId === null) next.activeAccountId = clientId;
        await this.#persist(next);
        if (!stillPending()) {
          // Cancellation can arrive while the atomic file replacement awaits I/O.
          // Restore the prior authenticated state before a queued logout runs.
          await this.#persist(beforeActivation);
          throw new AgentError('cancelled', 'Sign-in cancelled.', 409);
        }
        this.#epoch += 1;
        this.#abortRequests();
        this.#models.clear();
        this.#usage = { state: 'unverified' };
        this.#pending = null;
        this.#login = { id: pending.attempt.id, state: allowed ? 'complete' : 'failed', message: allowed ? 'Connected. Load models, then send a request to verify generation.' : 'Signed in, but ChatGPT plan use was not enabled. Reconnect and grant permission to use your plan.' };
        return { ok: true, connected: allowed };
      } catch (error) {
        if (this.#pending === pending) {
          this.#pending = null;
          this.#login = { id: pending.attempt.id, state: 'failed', message: error instanceof AgentError ? error.message : 'Sign-in could not be completed. Try again.' };
        }
        throw error;
      }
    });
  }

  async selectAccount(accountId) {
    this.#assertReady();
    const account = this.#data.accounts.find(a => a.id === accountId);
    if (!account?.subject) throw new AgentError('auth_required', 'Complete sign-in for this connection first.', 401);
    this.#epoch += 1;
    this.#cancelLogin();
    this.#abortRequests();
    return this.#exclusive(async () => {
      const next = copy(this.#data);
      next.activeAccountId = accountId;
      await this.#persist(next);
      this.#models.clear();
      this.#usage = { state: 'unverified' };
      return { ok: true };
    });
  }

  async logout(accountId = this.#data.activeAccountId) {
    this.#epoch += 1;
    this.#cancelLogin();
    this.#abortRequests();
    return this.#exclusive(async () => {
      const account = this.#data.accounts.find(a => a.id === accountId);
      let confirmed = !account?.tokens?.refreshToken;
      if (account?.tokens?.refreshToken) {
        try { confirmed = await this.#protocol.revoke({ clientId: account.id, refreshToken: account.tokens.refreshToken }); } catch { confirmed = false; }
      }
      if (account) {
        const next = copy(this.#data);
        next.accounts.find(a => a.id === account.id).tokens = null;
        await this.#persist(next);
      }
      this.#models.clear();
      this.#usage = { state: 'unverified' };
      const message = confirmed ? 'Signed out. Saved connection details remain for your next sign-in.' : 'Signed out locally. Remote revocation could not be confirmed; manage this app’s access in ChatGPT settings.';
      this.#login = { id: 'logout', state: 'cancelled', message };
      return { ok: true, message };
    });
  }

  async #invalidate(accountId) {
    const next = copy(this.#data);
    const account = next.accounts.find(a => a.id === accountId);
    if (account) account.tokens = null;
    await this.#persist(next);
    this.#models.delete(accountId);
  }

  async #verifyRotation(account, epoch, signal) {
    const tokens = account.tokens;
    try {
      await this.#protocol.verifyIdentity({ idToken: tokens.idToken, clientId: account.id, nonce: tokens.nonce, subject: account.subject, refresh: true, signal });
    } catch (error) {
      if (epoch !== this.#epoch || signal.aborted) throw new AgentError('cancelled', 'The account changed. Start a new request.', 409);
      if (error instanceof AgentError && error.code === 'invalid_identity') await this.#invalidate(account.id);
      // Transient JWKS errors keep the rotated pending record for retry/restart.
      throw error;
    }
    if (epoch !== this.#epoch || signal.aborted) throw new AgentError('cancelled', 'The account changed. Start a new request.', 409);
    const next = copy(this.#data);
    next.accounts.find(a => a.id === account.id).tokens.pendingIdentity = false;
    await this.#persist(next);
  }

  #access(accountId, epoch, signal) {
    return this.#exclusive(async () => {
      this.#assertReady();
      const unchanged = () => epoch === this.#epoch && !signal.aborted && this.#data.activeAccountId === accountId;
      if (!unchanged()) throw new AgentError('cancelled', 'The account changed. Start a new request.', 409);
      let account = this.#data.accounts.find(a => a.id === accountId);
      if (!account?.subject || !account.tokens) throw new AgentError('auth_required', 'Continue with ChatGPT to connect your subscription.', 401);
      if (account.tokens.pendingIdentity) {
        await this.#verifyRotation(account, epoch, signal);
        account = this.#data.accounts.find(a => a.id === accountId);
      }
      if (!account.tokens.scopes.includes(PLAN_SCOPE)) throw new AgentError('permission_required', 'Reconnect and allow Mermaid Agent to use your ChatGPT plan.', 403);
      if (account.tokens.expiresAt <= this.#now() + 45000) {
        if (!account.tokens.refreshToken) throw new AgentError('auth_required', 'The session expired. Continue with ChatGPT to reconnect.', 401);
        let raw;
        try {
          // Once sent, refresh may consume a rotating token. Let its own bounded
          // deadline finish even if the browser disconnects or the account changes.
          // The queue persists the replacement before logout or another refresh.
          raw = await this.#protocol.refresh({ clientId: account.id, refreshToken: account.tokens.refreshToken });
        } catch (error) {
          if (unchanged() && TERMINAL_REFRESH.has(error?.upstreamCode ?? error?.code)) await this.#invalidate(account.id);
          throw error;
        }
        let rotated;
        try { rotated = normalizeTokens(raw, { previous: account.tokens, now: this.#now() }); }
        catch (error) {
          // A successful refresh may already have spent the previous token.
          // An unusable replacement must require sign-in, never reuse that token.
          await this.#invalidate(account.id);
          throw error;
        }
        rotated.pendingIdentity = raw.id_token !== undefined;
        const next = copy(this.#data);
        next.accounts.find(a => a.id === accountId).tokens = rotated;
        // Persist the replacement refresh token BEFORE any fallible JWKS read.
        // Even a queued logout must see this rotation so it revokes the new token.
        await this.#persist(next);
        if (!unchanged()) throw new AgentError('cancelled', 'The account changed. Start a new request.', 409);
        account = this.#data.accounts.find(a => a.id === accountId);
        if (rotated.pendingIdentity) await this.#verifyRotation(account, epoch, signal);
        account = this.#data.accounts.find(a => a.id === accountId);
      }
      if (!unchanged()) throw new AgentError('cancelled', 'The account changed. Start a new request.', 409);
      if (!planAllowed(account)) throw new AgentError('permission_required', 'Reconnect and allow Mermaid Agent to use your ChatGPT plan.', 403);
      return account.tokens.accessToken;
    });
  }

  async #request(expectedAccountId, externalSignal, operation) {
    this.#assertReady();
    const accountId = this.#data.activeAccountId;
    if (!accountId) throw new AgentError('auth_required', 'Continue with ChatGPT to connect your subscription.', 401);
    if (expectedAccountId && expectedAccountId !== accountId) throw new AgentError('account_changed', 'The active ChatGPT account changed. Reload its models before starting another operation.', 409);
    const epoch = this.#epoch;
    const controller = new AbortController();
    const signal = externalSignal ? AbortSignal.any([controller.signal, externalSignal]) : controller.signal;
    this.#controllers.add(controller);
    try {
      const accessToken = await this.#access(accountId, epoch, signal);
      if (signal.aborted || epoch !== this.#epoch) throw new AgentError('cancelled', 'Request cancelled.', 409);
      const value = await operation({ accessToken, accountId, signal, epoch });
      if (signal.aborted || epoch !== this.#epoch) throw new AgentError('cancelled', 'The account changed or the request was cancelled.', 409);
      return value;
    } catch (error) {
      if (epoch === this.#epoch && error instanceof AgentError) {
        if (error.code === 'quota_exceeded') this.#usage = { state: 'limit_reached', message: error.message };
        if (error.code === 'usage_unavailable') this.#usage = { state: 'unavailable', message: error.message };
      }
      throw error;
    } finally {
      this.#controllers.delete(controller);
    }
  }

  models(signal) {
    return this.#request(null, signal, async ({ accessToken, accountId, signal: requestSignal, epoch }) => {
      const models = await this.#protocol.models({ accessToken, signal: requestSignal });
      if (!requestSignal.aborted && epoch === this.#epoch) this.#models.set(accountId, { models, expiresAt: this.#now() + 5 * 60 * 1000 });
      return { models, accountId };
    });
  }

  async generate({ model, messages, accountId }, signal) {
    return this.#request(accountId, signal, async ({ accessToken, accountId: selectedId, signal: requestSignal, epoch }) => {
      let catalogue = this.#models.get(selectedId);
      if (!catalogue || catalogue.expiresAt <= this.#now()) {
        const models = await this.#protocol.models({ accessToken, signal: requestSignal });
        catalogue = { models, expiresAt: this.#now() + 5 * 60 * 1000 };
        if (!requestSignal.aborted && epoch === this.#epoch) this.#models.set(selectedId, catalogue);
      }
      if (!catalogue.models.some(m => m.id === model)) throw new AgentError('invalid_request', 'This model is not in the active account’s catalogue. Reload models and select an available model.', 400);
      const text = await this.#protocol.generate({ accessToken, model, messages, signal: requestSignal });
      if (!requestSignal.aborted && epoch === this.#epoch) this.#usage = { state: 'available', model, message: 'Generation completed with your ChatGPT plan.' };
      return { text };
    });
  }

  async close() {
    this.#closed = true;
    this.#epoch += 1;
    this.#cancelLogin();
    this.#abortRequests();
    await this.#queue;
  }
}
