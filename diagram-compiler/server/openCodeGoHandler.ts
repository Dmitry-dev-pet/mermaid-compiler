// OpenCode Go documents the endpoint families at https://opencode.ai/docs/go/.
// This adapter intentionally supports only the Chat Completions family.
const CHAT_MODELS = new Set([
  'glm-5.3-flash', 'glm-5.3', 'glm-5.2',
  'kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6',
  'longcat-2.0', 'longcat-2.5-preview-free', 'step-5-preview-free',
  'deepseek-v4.1-flash', 'deepseek-v4-pro', 'deepseek-v4-flash',
  'deepseek-v4-flash-vision-exp',
  'mimo-v2.6-flash', 'mimo-v2.6-pro', 'mimo-v2.5', 'mimo-v2.5-pro',
  'hy4-preview', 'hy3', 'space-bunny',
]);

const GO_BASE_URL = 'https://opencode.ai/zen/go/v1';
const USER_AGENT = 'Mermaid-Compiler/0.1.0-alpha';
export const GO_MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 240_000;

type Fetcher = typeof fetch;
type JsonObject = Record<string, unknown>;
type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

class RequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const json = (body: unknown, status = 200, headers?: HeadersInit): Response => {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
  responseHeaders.set('Cache-Control', 'no-store');
  responseHeaders.set('X-Content-Type-Options', 'nosniff');
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
};

const errorResponse = (status: number, code: string, message: string): Response =>
  json({ error: { code, message } }, status);

async function readJson(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<unknown> {
  if (!body) throw new RequestError(400, 'invalid_request', 'A JSON request body is required.');
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new RequestError(413, 'body_too_large', 'The request or response is too large. Shorten the conversation and retry.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new RequestError(400, 'invalid_json', 'The request body must be valid JSON.');
  }
}

function validateOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if ((origin && origin !== new URL(request.url).origin)
      || (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none')) {
    throw new RequestError(403, 'cross_origin', 'OpenCode Go requests must originate from this Mermaid application.');
  }
}

const NUMBER_PARAMS: Record<string, { min: number; max: number; integer?: boolean }> = {
  temperature: { min: 0, max: 2 },
  top_p: { min: 0, max: 1 },
  top_k: { min: 0, max: 1000, integer: true },
  max_tokens: { min: 1, max: 131072, integer: true },
  max_completion_tokens: { min: 1, max: 131072, integer: true },
  frequency_penalty: { min: -2, max: 2 },
  presence_penalty: { min: -2, max: 2 },
  seed: { min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER, integer: true },
};

function validateChat(value: unknown): JsonObject {
  if (!isObject(value)) throw new RequestError(400, 'invalid_request', 'A chat request is required.');
  if (typeof value.model !== 'string' || !CHAT_MODELS.has(value.model)) {
    throw new RequestError(400, 'unsupported_model', 'Select a supported OpenCode Go Chat Completions model from the model list.');
  }
  if (!Array.isArray(value.messages) || value.messages.length === 0 || value.messages.length > 256) {
    throw new RequestError(400, 'invalid_messages', 'Provide between 1 and 256 text messages.');
  }
  const messages: ChatMessage[] = value.messages.map((message: unknown) => {
    if (!isObject(message)
        || typeof message.role !== 'string'
        || !['system', 'user', 'assistant'].includes(message.role)
        || typeof message.content !== 'string'
        || Object.keys(message).some(key => key !== 'role' && key !== 'content')) {
      throw new RequestError(400, 'invalid_messages', 'Only system, user and assistant text messages are supported.');
    }
    return { role: message.role as ChatMessage['role'], content: message.content };
  });
  const chat: JsonObject = { model: value.model, messages, stream: false };
  for (const [key, parameter] of Object.entries(value)) {
    if (key === 'model' || key === 'messages') continue;
    if (key === 'stream' && parameter === false) continue;
    if (key === 'reasoning_effort' && typeof parameter === 'string'
        && ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(parameter)) {
      chat[key] = parameter;
      continue;
    }
    const range = Object.hasOwn(NUMBER_PARAMS, key) ? NUMBER_PARAMS[key] : undefined;
    if (!range || typeof parameter !== 'number' || !Number.isFinite(parameter)
        || parameter < range.min || parameter > range.max
        || (range.integer && !Number.isSafeInteger(parameter))) {
      throw new RequestError(400, 'unsupported_parameter', 'Use supported scalar Chat Completions parameters; streaming, tools and custom routing are not supported.');
    }
    chat[key] = parameter;
  }
  return chat;
}

function upstreamError(status: number): Response {
  // Upstream error text can echo credentials or prompts. Never relay or log it.
  if (status === 401) return errorResponse(401, 'invalid_key', 'OpenCode Go rejected the key. Check your personal API key in OpenCode Console.');
  if (status === 402) return errorResponse(402, 'subscription_required', 'OpenCode Go requires an active subscription with available quota. Check OpenCode Console.');
  if (status === 403) return errorResponse(403, 'access_denied', 'This key or subscription cannot access the selected Go model. Check model access in OpenCode Console.');
  if (status === 429) return errorResponse(429, 'quota_exceeded', 'OpenCode Go reached a rate or subscription limit. Check quota in OpenCode Console and retry when it resets.');
  if (status === 400 || status === 404 || status === 422) {
    return errorResponse(status, 'request_rejected', 'OpenCode Go rejected this model or request. Refresh the model list and check the selected model parameters.');
  }
  return errorResponse(502, 'upstream_unavailable', 'OpenCode Go is temporarily unavailable. Retry later.');
}

function modelList(value: unknown): JsonObject {
  if (!isObject(value) || !Array.isArray(value.data)) throw new Error('Invalid model catalogue');
  const seen = new Set<string>();
  const data = value.data.flatMap((item: unknown) => {
    if (!isObject(item) || typeof item.id !== 'string' || !CHAT_MODELS.has(item.id) || seen.has(item.id)) return [];
    seen.add(item.id);
    return [{ id: item.id, object: 'model', owned_by: 'opencode' }];
  });
  return { object: 'list', data };
}

function completion(value: unknown): JsonObject {
  if (!isObject(value) || !Array.isArray(value.choices)) throw new Error('Invalid completion');
  const first: unknown = value.choices[0];
  if (!isObject(first) || !isObject(first.message)
      || typeof first.message.content !== 'string' || !first.message.content.trim()) {
    throw new Error('Empty completion');
  }
  // Only expose the assistant text the client consumes, not upstream metadata.
  return { choices: [{ index: 0, message: { role: 'assistant', content: first.message.content } }] };
}

export function createOpenCodeGoHandler(options: { fetcher?: Fetcher; timeoutMs?: number } = {}) {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') {
      return json({ error: { code: 'method_not_allowed', message: 'Use POST for OpenCode Go requests.' } }, 405, { Allow: 'POST' });
    }
    try {
      validateOrigin(request);
      if (request.signal.aborted) return errorResponse(499, 'cancelled', 'The request was cancelled.');
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
        throw new RequestError(415, 'unsupported_media_type', 'Send a JSON request body.');
      }
      const declaredLength = Number(request.headers.get('content-length') ?? 0);
      if (declaredLength > GO_MAX_BODY_BYTES) throw new RequestError(413, 'body_too_large', 'Shorten the conversation before retrying.');
      const payload = await readJson(request.body, GO_MAX_BODY_BYTES);
      if (!isObject(payload) || typeof payload.operation !== 'string'
          || !['models', 'chat'].includes(payload.operation)
          || Object.keys(payload).some(key => key !== 'operation' && key !== 'request')) {
        throw new RequestError(400, 'invalid_operation', 'Only model discovery and chat generation are supported.');
      }
      const isChat = payload.operation === 'chat';
      const headers = new Headers({ Accept: 'application/json', 'User-Agent': USER_AGENT });
      let body: string | undefined;
      if (isChat) {
        const authorization = request.headers.get('authorization') ?? '';
        if (!/^Bearer [^\s]{1,4096}$/.test(authorization)) {
          throw new RequestError(401, 'key_required', 'Enter your personal OpenCode Go API key in AI settings.');
        }
        const session = request.headers.get('x-opencode-session') ?? '';
        if (!/^[a-zA-Z0-9_./:-]{1,160}$/.test(session)) {
          throw new RequestError(400, 'session_required', 'A stable conversation identifier is required. Reopen the conversation and retry.');
        }
        headers.set('Authorization', authorization);
        headers.set('x-opencode-session', session);
        headers.set('Content-Type', 'application/json');
        body = JSON.stringify(validateChat(payload.request));
      } else {
        if (payload.request !== undefined) throw new RequestError(400, 'invalid_request', 'Model discovery does not accept a chat request.');
        // The catalogue is public. It does not verify the user's key or plan.
        headers.set('x-opencode-session', 'mermaid:model-catalog');
      }
      const timeoutController = new AbortController();
      const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
      const signal = AbortSignal.any([request.signal, timeoutController.signal]);
      try {
        const upstream = await fetcher(`${GO_BASE_URL}/${isChat ? 'chat/completions' : 'models'}`, {
          method: isChat ? 'POST' : 'GET', headers, body, signal,
          redirect: 'error', cache: 'no-store',
        });
        if (!upstream.ok) {
          await upstream.body?.cancel();
          return upstreamError(upstream.status);
        }
        const data = await readJson(upstream.body, MAX_RESPONSE_BYTES);
        return json(isChat ? completion(data) : modelList(data));
      } catch {
        if (request.signal.aborted) return errorResponse(499, 'cancelled', 'The request was cancelled.');
        if (timeoutController.signal.aborted) return errorResponse(504, 'timeout', 'OpenCode Go took too long to respond. Retry with a shorter request.');
        return errorResponse(502, 'invalid_upstream_response', 'OpenCode Go returned an unavailable or invalid response. Retry later.');
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      if (request.signal.aborted) return errorResponse(499, 'cancelled', 'The request was cancelled.');
      if (error instanceof RequestError) return errorResponse(error.status, error.code, error.message);
      return errorResponse(400, 'invalid_request', 'The OpenCode Go request could not be read.');
    }
  };
}

export const handleOpenCodeGo = createOpenCodeGoHandler();
