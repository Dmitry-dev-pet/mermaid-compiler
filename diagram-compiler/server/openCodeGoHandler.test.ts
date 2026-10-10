import { describe, expect, it, vi } from 'vitest';
import { createOpenCodeGoHandler, GO_MAX_BODY_BYTES } from './openCodeGoHandler';
import { GET, OPTIONS } from '../../api/opencode-go';

const TEST_KEY = 'personal-go-test-key';
const SESSION = 'mermaid:project-123:chat.main';
const chat = { model: 'glm-5.3-flash', messages: [{ role: 'user', content: 'Build a Mermaid flowchart.' }] };
const answer = { choices: [{ message: { role: 'assistant', content: 'flowchart TD\n A --> B' } }] };

function request(payload: unknown = { operation: 'chat', request: chat }, headers: Record<string, string> = {}, signal?: AbortSignal): Request {
  return new Request('https://mermaid.example/api/opencode-go', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TEST_KEY}`,
      'x-opencode-session': SESSION,
      Origin: 'https://mermaid.example',
      ...headers,
    },
    body: JSON.stringify(payload), signal,
  });
}

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('OpenCode Go handler', () => {
  it('forwards one chat request to Go with application identity and a stable session', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(answer));
    const result = await createOpenCodeGoHandler({ fetcher })(request({ operation: 'chat', request: { ...chat, temperature: 0.2, stream: false } }, {
      Cookie: 'not-forwarded', 'x-custom-route': 'https://example.invalid',
    }));
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(await result.json()).toEqual({ choices: [{ index: 0, message: answer.choices[0].message }] });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://opencode.ai/zen/go/v1/chat/completions');
    expect(init?.redirect).toBe('error');
    expect(init?.method).toBe('POST');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${TEST_KEY}`);
    expect(headers.get('user-agent')).toBe('Mermaid-Compiler/0.1.0-alpha');
    expect(headers.get('x-opencode-session')).toBe(SESSION);
    expect(headers.has('cookie')).toBe(false);
    expect(headers.has('x-custom-route')).toBe(false);
    expect(JSON.parse(String(init?.body))).toEqual({ ...chat, temperature: 0.2, stream: false });
  });

  it('loads only compatible models without sending the personal key or making an inference', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ data: [
      { id: 'glm-5.3-flash' }, { id: 'kimi-k3' }, { id: 'minimax-m3' },
      { id: 'qwen3.7-plus' }, { id: 'gpt-5.4' }, { id: 'unknown-model' },
      { id: 'glm-5.3-flash' }, { id: 123 },
    ] }));
    const result = await createOpenCodeGoHandler({ fetcher })(request({ operation: 'models' }));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ object: 'list', data: [
      { id: 'glm-5.3-flash', object: 'model', owned_by: 'opencode' },
      { id: 'kimi-k3', object: 'model', owned_by: 'opencode' },
    ] });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://opencode.ai/zen/go/v1/models');
    expect(init?.method).toBe('GET');
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
  });

  it.each([
    ['minimax-m3'], ['qwen3.7-plus'], ['gpt-5.4'], ['https://other.example/model'],
  ])('rejects unsupported model %s before any upstream request', async model => {
    const fetcher = vi.fn<typeof fetch>();
    const result = await createOpenCodeGoHandler({ fetcher })(request({ operation: 'chat', request: { ...chat, model } }));
    expect(result.status).toBe(400);
    expect((await result.json()).error.code).toBe('unsupported_model');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { operation: ['models'] },
    { operation: 'proxy', url: 'https://other.example' },
    { operation: 'models', request: chat },
    { operation: 'chat', request: chat, url: 'https://other.example' },
    { operation: 'chat', request: { ...chat, stream: true } },
    { operation: 'chat', request: { ...chat, tools: [] } },
    { operation: 'chat', request: { ...chat, temperature: '0.2' } },
    { operation: 'chat', request: { ...chat, max_tokens: -1 } },
    { operation: 'chat', request: { ...chat, messages: [{ role: 'tool', content: 'x' }] } },
    { operation: 'chat', request: { ...chat, messages: [{ role: ['user'], content: 'x' }] } },
    { operation: 'chat', request: { ...chat, messages: [{ role: 'user', content: ['image'] }] } },
  ])('rejects invalid operations and request fields', async payload => {
    const fetcher = vi.fn<typeof fetch>();
    const result = await createOpenCodeGoHandler({ fetcher })(request(payload));
    expect(result.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [{ Authorization: '' }, 401],
    [{ 'x-opencode-session': '' }, 400],
    [{ 'x-opencode-session': 'contains spaces' }, 400],
    [{ 'x-opencode-session': 'a'.repeat(161) }, 400],
    [{ Origin: 'https://other.example' }, 403],
    [{ 'sec-fetch-site': 'cross-site' }, 403],
    [{ 'Content-Type': 'text/plain' }, 415],
    [{ 'Content-Length': String(GO_MAX_BODY_BYTES + 1) }, 413],
  ] as [Record<string, string>, number][])('rejects invalid request headers', async (headers, status) => {
    const fetcher = vi.fn<typeof fetch>();
    const result = await createOpenCodeGoHandler({ fetcher })(request(undefined, headers));
    expect(result.status).toBe(status);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('bounds the actual body even without a Content-Length header', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const result = await createOpenCodeGoHandler({ fetcher })(request({
      operation: 'chat', request: { ...chat, messages: [{ role: 'user', content: 'a'.repeat(GO_MAX_BODY_BYTES) }] },
    }));
    expect(result.status).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([400, 401, 402, 403, 404, 422, 429, 500, 503])('sanitizes upstream %s errors and never retries or falls back', async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ error: { message: `echoed ${TEST_KEY} PRIVATE_PROMPT` } }, status));
    const result = await createOpenCodeGoHandler({ fetcher })(request());
    expect(result.status).toBe(status >= 500 ? 502 : status);
    const body = await result.text();
    expect(body).not.toContain(TEST_KEY);
    expect(body).not.toContain('PRIVATE_PROMPT');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([{}, { choices: [] }, { choices: [{ message: { content: '' } }] }, { choices: [{ message: { content: null } }] }])('rejects malformed and empty completions', async body => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(body));
    expect((await createOpenCodeGoHandler({ fetcher })(request())).status).toBe(502);
  });

  it('sanitizes network failures', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error(`echo ${TEST_KEY}`));
    const result = await createOpenCodeGoHandler({ fetcher })(request());
    expect(result.status).toBe(502);
    expect(await result.text()).not.toContain(TEST_KEY);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('cancels upstream work when the client aborts', async () => {
    let started: () => void = () => undefined;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      started();
    }));
    const controller = new AbortController();
    const pending = createOpenCodeGoHandler({ fetcher })(request(undefined, {}, controller.signal));
    await ready;
    controller.abort();
    expect((await pending).status).toBe(499);
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not call upstream for an already cancelled request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const controller = new AbortController();
    controller.abort();
    const result = await createOpenCodeGoHandler({ fetcher })(request(undefined, {}, controller.signal));
    expect(result.status).toBe(499);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('bounds slow upstream work with an actionable timeout', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    const result = await createOpenCodeGoHandler({ fetcher, timeoutMs: 5 })(request());
    expect(result.status).toBe(504);
    expect((await result.json()).error.code).toBe('timeout');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('exposes the real Vercel route and gives navigation/preflight a non-CORS 405', async () => {
    for (const method of ['GET', 'OPTIONS']) {
      const result = await (method === 'GET' ? GET : OPTIONS)(new Request('https://mermaid.example/api/opencode-go', { method }));
      expect(result.status).toBe(405);
      expect(result.headers.get('allow')).toBe('POST');
      expect(result.headers.has('access-control-allow-origin')).toBe(false);
    }
  });
});
