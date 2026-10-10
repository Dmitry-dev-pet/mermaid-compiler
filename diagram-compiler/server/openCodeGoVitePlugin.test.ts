import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createOpenCodeGoMiddleware } from './openCodeGoVitePlugin';

const servers: Server[] = [];
async function listen(handler: (request: Request) => Promise<Response>): Promise<string> {
  const middleware = createOpenCodeGoMiddleware(handler);
  const server = createServer((req, res) => {
    middleware(req, res, () => { res.writeHead(404); res.end(); });
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  })));
});

describe('OpenCode Go local server adapter', () => {
  it('preserves body, credentials, origin and response status for the exact route', async () => {
    const base = await listen(async request => {
      expect(request.method).toBe('POST');
      expect(request.headers.get('authorization')).toBe('Bearer local-test-key');
      expect(request.headers.get('origin')).toBe(new URL(request.url).origin);
      expect(await request.json()).toEqual({ operation: 'models' });
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Cache-Control': 'no-store' } });
    });
    const result = await fetch(`${base}/api/opencode-go`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local-test-key', Origin: base },
      body: JSON.stringify({ operation: 'models' }),
    });
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(await result.json()).toEqual({ data: [] });
    expect((await fetch(`${base}/api/opencode-go/other`)).status).toBe(404);
  });

  it('propagates browser disconnect to the handler signal', async () => {
    let started: () => void = () => undefined;
    let cancelled: () => void = () => undefined;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const aborted = new Promise<void>(resolve => { cancelled = resolve; });
    const base = await listen(async request => {
      started();
      await new Promise<void>(resolve => request.signal.addEventListener('abort', () => {
        cancelled(); resolve();
      }, { once: true }));
      return new Response(null, { status: 499 });
    });
    const controller = new AbortController();
    const pending = fetch(`${base}/api/opencode-go`, { method: 'POST', body: '{}', signal: controller.signal });
    await ready;
    controller.abort();
    await expect(pending).rejects.toThrow();
    await aborted;
  });
});
