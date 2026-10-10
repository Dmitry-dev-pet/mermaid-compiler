import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getOpenCodeGoSessionId, OpenCodeGoError, requestOpenCodeGo, shouldStopOpenCodeGoOperation } from './openCodeGoClient';

describe('OpenCode Go same-origin transport', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => 'private-go-test-key' });
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('discovers models without a completion or credential in the request body', async () => {
    fetchMock.mockResolvedValue(Response.json({ data: [{ id: 'glm-5.3' }] }));
    await requestOpenCodeGo({ operation: 'models' }, 'mermaid:model-catalog');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/opencode-go');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer private-go-test-key');
    expect(new Headers(init.headers).get('x-opencode-session')).toBe('mermaid:model-catalog');
    expect(JSON.parse(String(init.body))).toEqual({ operation: 'models' });
    expect(String(init.body)).not.toContain('private-go-test-key');
  });

  it('keeps conversation identity stable across operations and distinct across projects', () => {
    const first = getOpenCodeGoSessionId('project-123', 'main');
    expect(getOpenCodeGoSessionId('project-123', 'main')).toBe(first);
    expect(getOpenCodeGoSessionId('project-456', 'main')).not.toBe(first);
    expect(getOpenCodeGoSessionId('project-123', 'block:1')).not.toBe(first);
    expect(first).toMatch(/^[A-Za-z0-9._:-]+$/);
    expect(getOpenCodeGoSessionId(null)).toBeUndefined();
  });

  it.each([400, 401, 402, 403, 404, 413, 422, 429, 499])('stops on HTTP %i without exposing an upstream body', async (status) => {
    fetchMock.mockResolvedValue(Response.json({ error: 'private-go-test-key request-body-content' }, { status }));
    const error = await requestOpenCodeGo({ operation: 'models' }, 'mermaid:model-catalog').catch((value: unknown) => value);
    expect(error).toBeInstanceOf(OpenCodeGoError);
    expect(shouldStopOpenCodeGoOperation(error)).toBe(true);
    expect(String(error)).toContain(`API Error (${status})`);
    expect(String(error)).not.toContain('private-go-test-key');
    expect(String(error)).not.toContain('request-body-content');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('passes cancellation through to fetch and preserves the abort error', async () => {
    const controller = new AbortController();
    const error = new DOMException('Aborted', 'AbortError');
    fetchMock.mockRejectedValue(error);
    const promise = requestOpenCodeGo({ operation: 'models' }, 'mermaid:model-catalog', controller.signal);
    controller.abort();
    await expect(promise).rejects.toBe(error);
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
    expect(shouldStopOpenCodeGoOperation(error)).toBe(true);
  });

  it('rejects a static HTML fallback instead of calling it a connected API', async () => {
    fetchMock.mockResolvedValue(new Response('<html>old app</html>', { status: 200 }));
    await expect(requestOpenCodeGo({ operation: 'models' }, 'mermaid:model-catalog')).rejects.toThrow('invalid response');
  });

  it('does not send requests when no personal key is configured', async () => {
    vi.stubGlobal('localStorage', { getItem: () => '' });
    await expect(requestOpenCodeGo({ operation: 'models' }, 'mermaid:model-catalog')).rejects.toThrow('Enter your personal OpenCode Go key');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
