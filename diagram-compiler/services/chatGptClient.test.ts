import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHATGPT_AGENT_ORIGIN,
  CHATGPT_STATUS_CHANGED_EVENT,
  ChatGptAgentError,
  cancelChatGptLogin,
  generateChatGpt,
  getChatGptModelCatalog,
  getChatGptStatus,
  isChatGptAgentOrigin,
  logoutChatGptAccount,
  selectChatGptAccount,
  shouldStopChatGptOperation,
  startChatGptLogin,
  type ChatGptStatus,
} from './chatGptClient';
import { runLLMRequest } from './llmRequestRunner';
import { TimeoutError } from './llmTimeout';

const status = (overrides: Partial<ChatGptStatus> = {}): ChatGptStatus => ({
  agent: 'mermaid-chatgpt',
  protocolVersion: 1,
  connected: true,
  activeAccountId: 'account-a',
  accounts: [{ id: 'account-a', email: 'a@example.test', connected: true }],
  login: null,
  usage: { state: 'unverified' },
  ...overrides,
});
const generation = {
  model: 'subscription-model',
  messages: [{ role: 'user' as const, content: 'Draw A to B' }],
  sessionId: 'mermaid:project-a:main',
  accountId: 'account-a',
};

describe('ChatGPT local Agent transport', () => {
  const fetchMock = vi.fn();
  const dispatchEvent = vi.fn();
  const readStorage = vi.fn();
  const writeStorage = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    dispatchEvent.mockClear();
    readStorage.mockReset().mockReturnValue('synthetic-credential-not-for-transport');
    writeStorage.mockClear();
    vi.stubGlobal('window', { location: { origin: CHATGPT_AGENT_ORIGIN }, dispatchEvent });
    vi.stubGlobal('localStorage', { getItem: readStorage, setItem: writeStorage });
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/chatgpt/status') return Response.json(status());
      throw new Error(`Unexpected mock route: ${url}`);
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each(['https://mermaid-compiler.vercel.app', 'http://localhost:8788', 'http://127.0.0.1:3000', 'https://127.0.0.1:8788'])('does not contact an Agent from %s', async (origin) => {
    vi.stubGlobal('window', { location: { origin }, dispatchEvent });
    expect(isChatGptAgentOrigin()).toBe(false);
    await expect(getChatGptStatus()).rejects.toMatchObject({ code: 'agent_unavailable' });
    await expect(startChatGptLogin()).rejects.toMatchObject({ code: 'agent_unavailable' });
    await expect(generateChatGpt(generation)).rejects.toMatchObject({ code: 'agent_unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { ...status(), agent: 'other-local-app' },
    { ...status(), protocolVersion: 2 },
    { ...status(), accounts: [] },
    { ...status(), usage: { state: 'guessed' } },
    { ...status(), usage: { state: ['available'] } },
  ])('requires the exact Agent protocol and a valid status before a control action', async (invalidStatus) => {
    fetchMock.mockResolvedValue(Response.json(invalidStatus));
    await expect(startChatGptLogin()).rejects.toMatchObject({ code: 'agent_unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/chatgpt/status');
  });

  it('rejects a static HTML fallback without treating it as an authenticated Agent', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Editor fallback</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    await expect(getChatGptStatus()).rejects.toMatchObject({ code: 'agent_unavailable' });
  });

  it('drops credential fields from status at every displayed level', async () => {
    const secret = 'synthetic-oauth-secret';
    fetchMock.mockResolvedValue(Response.json({
      ...status(),
      accessToken: secret,
      refreshToken: secret,
      accounts: [{ ...status().accounts[0], idToken: secret }],
      login: { id: 'login-a', state: 'complete', clientSecret: secret },
      usage: { state: 'unverified', authorization: secret },
    }));
    const result = await getChatGptStatus();
    expect(result.usage.state).toBe('unverified');
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(readStorage).not.toHaveBeenCalled();
    expect(writeStorage).not.toHaveBeenCalled();
  });

  it('loads an account-bound model list without inference or verification', async () => {
    fetchMock.mockImplementation(async (url: string) => url === '/api/chatgpt/status'
      ? Response.json(status())
      : Response.json({ accountId: 'account-a', models: [{ id: 'subscription-model', name: 'Subscription model', accessToken: 'synthetic-hidden' }] }));
    const result = await getChatGptModelCatalog();
    expect(result.accountId).toBe('account-a');
    expect(result.models).toEqual([{ id: 'subscription-model', name: 'Subscription model', vendor: 'openai', ownedBy: 'chatgpt', isFree: false }]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/chatgpt/status', '/api/chatgpt/models']);
    expect(fetchMock.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it('rejects a catalogue whose account changed during discovery', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(status()))
      .mockResolvedValueOnce(Response.json({ accountId: 'account-b', models: [{ id: 'other-model', name: 'Other model' }] }));
    await expect(getChatGptModelCatalog()).rejects.toMatchObject({ code: 'account_changed', status: 409 });
  });

  it('lets the Agent recover a saved account through model discovery without a new login or inference', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(status({
      connected: false,
      accounts: [{ id: 'account-a', email: 'a@example.test', connected: false }],
    }))).mockResolvedValueOnce(Response.json({
      accountId: 'account-a', models: [{ id: 'subscription-model', name: 'Subscription model' }],
    }));
    await expect(getChatGptModelCatalog()).resolves.toMatchObject({ accountId: 'account-a' });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/chatgpt/status', '/api/chatgpt/models']);
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it('requires sign-in before model discovery or inference', async () => {
    fetchMock.mockImplementation(async () => Response.json(status({ connected: false, activeAccountId: null, accounts: [] })));
    await expect(getChatGptModelCatalog()).rejects.toMatchObject({ code: 'login_required' });
    await expect(generateChatGpt(generation)).rejects.toMatchObject({ code: 'login_required' });
    expect(fetchMock.mock.calls.every(([url]) => url === '/api/chatgpt/status')).toBe(true);
  });

  it('sends only prompt/model/session/account metadata over the protected same-origin route', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(status()))
      .mockResolvedValueOnce(Response.json({ text: 'flowchart TD\nA-->B' }));
    const request = { ...generation, temperature: 0.3, max_tokens: 1000, accessToken: 'synthetic-token', endpoint: 'https://example.test' };
    await expect(generateChatGpt(request)).resolves.toBe('flowchart TD\nA-->B');
    for (const [url, init] of fetchMock.mock.calls as Array<[string, RequestInit]>) {
      expect(url).toMatch(/^\/api\/chatgpt\//);
      expect(init.credentials).toBe('same-origin');
      expect(init.cache).toBe('no-store');
      expect(init.redirect).toBe('error');
      expect(new Headers(init.headers).has('Authorization')).toBe(false);
    }
    const init = fetchMock.mock.calls[1][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual(generation);
    expect(readStorage).not.toHaveBeenCalled();
    expect(writeStorage).not.toHaveBeenCalled();
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: CHATGPT_STATUS_CHANGED_EVENT }));
  });

  it('stops a pipeline pinned to another account before sending a new prompt', async () => {
    await expect(generateChatGpt({ ...generation, accountId: 'old-account' })).rejects.toMatchObject({ code: 'account_changed' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('only offers a credential-free official browser login URL and whitelists login options', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(status()))
      .mockResolvedValueOnce(Response.json({ ok: true, authUrl: 'https://auth.openai.com/oauth/authorize?client_id=synthetic-client&state=synthetic-state', accessToken: 'synthetic-hidden' }));
    const result = await startChatGptLogin({ newAccount: true, ...{ refreshToken: 'synthetic-hidden' } });
    expect(new URL(result.authUrl).hostname).toBe('auth.openai.com');
    expect(JSON.stringify(result)).not.toContain('synthetic-hidden');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ newAccount: true });
  });

  it.each([
    'https://auth.openai.com.evil.test/login',
    'http://auth.openai.com/login',
    'https://name:password@auth.openai.com/login',
    'https://auth.openai.com:444/login',
    'https://auth.openai.com/login?id_token_hint=synthetic-token',
    'javascript:alert(1)',
  ])('rejects an unsafe login fallback: %s', async (authUrl) => {
    fetchMock.mockResolvedValueOnce(Response.json(status())).mockResolvedValueOnce(Response.json({ ok: true, authUrl }));
    await expect(startChatGptLogin()).rejects.toBeInstanceOf(ChatGptAgentError);
  });

  it('uses only documented control paths and preserves the local sign-out notice', async () => {
    fetchMock.mockImplementation(async (url: string) => url === '/api/chatgpt/status'
      ? Response.json(status()) : Response.json({ ok: true, message: 'Local session removed. Manage account-wide access in ChatGPT settings.' }));
    await selectChatGptAccount('account-a');
    await cancelChatGptLogin();
    const signedOut = await logoutChatGptAccount('account-a');
    const mutations = fetchMock.mock.calls.filter(([, init]) => init.method === 'POST');
    expect(mutations.map(([url, init]) => [url, JSON.parse(init.body)])).toEqual([
      ['/api/chatgpt/account', { accountId: 'account-a' }],
      ['/api/chatgpt/login/cancel', {}],
      ['/api/chatgpt/logout', { accountId: 'account-a' }],
    ]);
    expect(signedOut.message).toContain('Local session removed');
  });

  it.each([400, 401, 403, 409, 413, 422, 429, 499, 500, 502, 504])('stops HTTP %i without retries or raw upstream diagnostics', async (httpStatus) => {
    fetchMock.mockResolvedValueOnce(Response.json(status()))
      .mockResolvedValueOnce(Response.json({ error: 'synthetic-hidden-upstream-body' }, { status: httpStatus }));
    const error = await generateChatGpt(generation).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ChatGptAgentError);
    expect(shouldStopChatGptOperation(error)).toBe(true);
    expect(String(error)).not.toContain('synthetic-hidden-upstream-body');
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/chatgpt/generate')).toHaveLength(1);
  });

  it('rejects missing completed text without inventing a successful generation', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(status())).mockResolvedValueOnce(Response.json({ text: '   ' }));
    await expect(generateChatGpt(generation)).rejects.toMatchObject({ code: 'incomplete_response' });
  });

  it('aborts an actual slow generation on timeout and never starts a duplicate request', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url === '/api/chatgpt/status') return Response.json(status());
      if (!init.signal) throw new Error('Expected generation signal');
      signals.push(init.signal);
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    });
    const parent = new AbortController();
    const request = runLLMRequest({
      task: 'ChatGPT build', retries: 1, timeoutMs: 100, abortOnTimeout: true, signal: parent.signal,
      run: (signal) => generateChatGpt(generation, signal),
    });
    const rejection = expect(request).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(true);
    expect(parent.signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves user cancellation through the transport', async () => {
    const controller = new AbortController();
    const aborted = new DOMException('Aborted', 'AbortError');
    fetchMock.mockRejectedValue(aborted);
    const request = generateChatGpt(generation, controller.signal);
    controller.abort();
    await expect(request).rejects.toBe(aborted);
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
    expect(shouldStopChatGptOperation(aborted)).toBe(true);
  });
});
