import type { Model } from '../types';

export const CHATGPT_AGENT_ORIGIN = 'http://127.0.0.1:8788';
export const CHATGPT_STATUS_CHANGED_EVENT = 'mermaid:chatgpt-status-changed';

export type ChatGptStatus = {
  agent: 'mermaid-chatgpt';
  protocolVersion: 1;
  connected: boolean;
  activeAccountId: string | null;
  accounts: Array<{ id: string; email: string | null; connected: boolean }>;
  login: {
    id: string;
    state: 'pending' | 'complete' | 'failed' | 'cancelled';
    message?: string;
  } | null;
  usage: {
    state: 'unverified' | 'available' | 'limit_reached' | 'unavailable';
    message?: string;
    model?: string;
  };
};

type ChatGptMessage = { role: 'system' | 'user' | 'assistant'; content: string };
type ControlResult = { ok: true; message?: string };

export class ChatGptAgentError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 0) {
    super(message);
    this.name = 'ChatGptAgentError';
    this.code = code;
    this.status = status;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isNonemptyText = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim());
const optionalText = (value: unknown): string | undefined =>
  isNonemptyText(value) ? value.slice(0, 1000) : undefined;

export const isChatGptAgentOrigin = (origin?: string): boolean =>
  (origin ?? (typeof window !== 'undefined' ? window.location.origin : '')) === CHATGPT_AGENT_ORIGIN;

const unavailable = (status = 0) => new ChatGptAgentError(
  'agent_unavailable',
  'Open the local ChatGPT workspace with Mermaid Agent to connect your subscription.',
  status,
);

const defaultErrorMessage = (status: number): string => {
  if (status === 401) return 'Your ChatGPT session needs sign-in. Reconnect in AI settings.';
  if (status === 403) return 'ChatGPT subscription access is unavailable. Check the account and granted access.';
  if (status === 409) return 'The ChatGPT account changed or is busy. Reload its status before starting again.';
  if (status === 429) return 'The ChatGPT subscription limit was reached. Wait for it to reset before retrying.';
  if (status === 413) return 'This conversation is too large. Shorten it before retrying.';
  if (status === 400 || status === 422) return 'ChatGPT could not accept the request. Reload the model list and check the prompt.';
  if (status === 499) return 'ChatGPT generation was stopped.';
  if (status === 504) return 'ChatGPT generation timed out. It was stopped; start a new request when ready.';
  return 'The local ChatGPT Agent is unavailable. Check that it is running and reload its status.';
};

const requestJson = async (
  path: string,
  body?: Record<string, unknown>,
  signal?: AbortSignal | null,
): Promise<unknown> => {
  if (!isChatGptAgentOrigin()) throw unavailable();
  try {
    const response = await fetch(`/api/chatgpt/${path}`, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      signal,
    });
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      throw unavailable(response.status);
    }
    const result: unknown = await response.json();
    if (!response.ok) {
      const error = isRecord(result) && isRecord(result.error) ? result.error : null;
      const code = error && typeof error.code === 'string' && /^[a-z0-9_:-]{1,80}$/i.test(error.code)
        ? error.code : 'agent_error';
      // The local Agent returns a sanitized error envelope. Never print the raw body.
      throw new ChatGptAgentError(code, optionalText(error?.message) ?? defaultErrorMessage(response.status), response.status);
    }
    return result;
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
    if (error instanceof ChatGptAgentError) throw error;
    throw new ChatGptAgentError('agent_unavailable', defaultErrorMessage(0));
  }
};

export const getChatGptStatus = async (signal?: AbortSignal | null): Promise<ChatGptStatus> => {
  const result = await requestJson('status', undefined, signal);
  if (!isRecord(result) || result.agent !== 'mermaid-chatgpt' || result.protocolVersion !== 1
    || typeof result.connected !== 'boolean'
    || !(result.activeAccountId === null || isNonemptyText(result.activeAccountId))
    || !Array.isArray(result.accounts) || !isRecord(result.usage)) throw unavailable();

  const accounts = result.accounts.map((account) => {
    if (!isRecord(account) || !isNonemptyText(account.id) || typeof account.connected !== 'boolean'
      || !(account.email === null || typeof account.email === 'string')) throw unavailable();
    return { id: account.id, email: account.email as string | null, connected: account.connected };
  });
  if (result.connected && !accounts.some((account) => account.id === result.activeAccountId && account.connected)) {
    throw unavailable();
  }

  let login: ChatGptStatus['login'] = null;
  if (result.login !== null) {
    if (!isRecord(result.login) || !isNonemptyText(result.login.id)
      || typeof result.login.state !== 'string'
      || !['pending', 'complete', 'failed', 'cancelled'].includes(result.login.state)) throw unavailable();
    login = {
      id: result.login.id,
      state: result.login.state as NonNullable<ChatGptStatus['login']>['state'],
      ...(optionalText(result.login.message) ? { message: optionalText(result.login.message) } : {}),
    };
  }
  if (typeof result.usage.state !== 'string'
    || !['unverified', 'available', 'limit_reached', 'unavailable'].includes(result.usage.state)) throw unavailable();

  // Only display metadata crosses this boundary; unexpected credential fields are dropped.
  return {
    agent: 'mermaid-chatgpt',
    protocolVersion: 1,
    connected: result.connected,
    activeAccountId: result.activeAccountId as string | null,
    accounts,
    login,
    usage: {
      state: result.usage.state as ChatGptStatus['usage']['state'],
      ...(optionalText(result.usage.message) ? { message: optionalText(result.usage.message) } : {}),
      ...(optionalText(result.usage.model) ? { model: optionalText(result.usage.model) } : {}),
    },
  };
};

const connectedAccount = (status: ChatGptStatus): string => {
  if (!status.connected || !status.activeAccountId) {
    throw new ChatGptAgentError('login_required', 'Continue with ChatGPT in AI settings before loading models or generating.', 401);
  }
  return status.activeAccountId;
};

const checkControlResult = (result: unknown): ControlResult => {
  if (!isRecord(result) || result.ok !== true) throw unavailable();
  return { ok: true, ...(optionalText(result.message) ? { message: optionalText(result.message) } : {}) };
};

export const startChatGptLogin = async (
  options: { accountId?: string; newAccount?: boolean } = {},
  signal?: AbortSignal | null,
): Promise<{ ok: true; authUrl: string }> => {
  await getChatGptStatus(signal);
  const result = await requestJson('login', {
    ...(options.accountId ? { accountId: options.accountId } : {}),
    ...(options.newAccount === true ? { newAccount: true } : {}),
  }, signal);
  checkControlResult(result);
  if (!isRecord(result) || typeof result.authUrl !== 'string') throw unavailable();
  let authUrl: URL;
  try { authUrl = new URL(result.authUrl); } catch { throw unavailable(); }
  if (authUrl.protocol !== 'https:' || authUrl.hostname !== 'auth.openai.com' || authUrl.port
    || authUrl.username || authUrl.password
    || ['id_token_hint', 'access_token', 'refresh_token', 'client_secret'].some((key) => authUrl.searchParams.has(key))) {
    throw new ChatGptAgentError('invalid_login_url', 'The Agent returned an invalid sign-in link. Restart it before trying again.');
  }
  return { ok: true, authUrl: authUrl.href };
};

export const cancelChatGptLogin = async (signal?: AbortSignal | null): Promise<ControlResult> => {
  await getChatGptStatus(signal);
  return checkControlResult(await requestJson('login/cancel', {}, signal));
};

export const logoutChatGptAccount = async (accountId?: string, signal?: AbortSignal | null): Promise<ControlResult> => {
  await getChatGptStatus(signal);
  return checkControlResult(await requestJson('logout', accountId ? { accountId } : {}, signal));
};

export const selectChatGptAccount = async (accountId: string, signal?: AbortSignal | null): Promise<ControlResult> => {
  await getChatGptStatus(signal);
  return checkControlResult(await requestJson('account', { accountId }, signal));
};

export const getChatGptModelCatalog = async (signal?: AbortSignal | null): Promise<{ models: Model[]; accountId: string }> => {
  const status = await getChatGptStatus(signal);
  const accountId = status.activeAccountId;
  if (!accountId || !status.accounts.some((account) => account.id === accountId)) {
    throw new ChatGptAgentError('login_required', 'Continue with ChatGPT in AI settings before loading models.', 401);
  }
  // A saved account can be temporarily disconnected while the Agent rechecks a
  // rotated ID token. Explicit model discovery may finish that verification.
  const result = await requestJson('models', undefined, signal);
  if (!isRecord(result) || !Array.isArray(result.models) || !isNonemptyText(result.accountId)) throw unavailable();
  const models = result.models.map((model) => {
    if (!isRecord(model) || !isNonemptyText(model.id) || !isNonemptyText(model.name)) throw unavailable();
    return { id: model.id, name: model.name, vendor: 'openai', ownedBy: 'chatgpt', isFree: false };
  });
  if (result.accountId !== accountId) {
    throw new ChatGptAgentError('account_changed', 'The ChatGPT account changed while models were loading. Reload them.', 409);
  }
  return { models, accountId: result.accountId };
};

export const generateChatGpt = async (
  request: { model: string; messages: ChatGptMessage[]; sessionId?: string; accountId: string },
  signal?: AbortSignal | null,
): Promise<string> => {
  try {
    const accountId = connectedAccount(await getChatGptStatus(signal));
    if (accountId !== request.accountId) {
      throw new ChatGptAgentError('account_changed', 'The ChatGPT account changed. Reload its models and start a new operation.', 409);
    }
    const result = await requestJson('generate', {
      model: request.model,
      messages: request.messages.map(({ role, content }) => ({ role, content })),
      ...(request.sessionId ? { sessionId: request.sessionId } : {}),
      accountId: request.accountId,
    }, signal);
    if (!isRecord(result) || !isNonemptyText(result.text)) {
      throw new ChatGptAgentError('incomplete_response', 'ChatGPT did not return a completed text response. Start a new request when ready.', 502);
    }
    return result.text;
  } finally {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHATGPT_STATUS_CHANGED_EVENT));
  }
};

export const shouldStopChatGptOperation = (error: unknown): boolean =>
  error instanceof ChatGptAgentError
  || (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'));
