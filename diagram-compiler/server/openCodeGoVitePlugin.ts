import { Buffer } from 'node:buffer';
import type { Connect, Plugin } from 'vite';
import { GO_MAX_BODY_BYTES, handleOpenCodeGo } from './openCodeGoHandler';

type Handler = (request: Request) => Promise<Response>;

export function createOpenCodeGoMiddleware(handler: Handler = handleOpenCodeGo): Connect.NextHandleFunction {
  return async (req, res, next) => {
    if (req.url?.split('?')[0] !== '/api/opencode-go') return next();
    const controller = new AbortController();
    const abort = () => controller.abort();
    const close = () => { if (!res.writableEnded) abort(); };
    req.once('aborted', abort);
    res.once('close', close);
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) value.forEach(item => headers.append(name, item));
        else if (value !== undefined) headers.set(name, value);
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        const bytes: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size <= GO_MAX_BODY_BYTES) chunks.push(bytes);
      }
      if (size > GO_MAX_BODY_BYTES) {
        res.writeHead(413, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: { code: 'body_too_large', message: 'Shorten the conversation before retrying.' } }));
        return;
      }
      const method = req.method ?? 'GET';
      const request = new Request(new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost:3000'}`), {
        method, headers, signal: controller.signal,
        body: method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks).toString('utf8'),
      });
      const response = await handler(request);
      if (res.destroyed) return;
      res.statusCode = response.status;
      response.headers.forEach((value, name) => res.setHeader(name, value));
      res.end(await response.text());
    } catch {
      if (!res.destroyed && !res.headersSent) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: { code: 'invalid_request', message: 'The OpenCode Go request could not be read.' } }));
      }
    } finally {
      req.removeListener('aborted', abort);
      res.removeListener('close', close);
    }
  };
}

export function openCodeGoPlugin(): Plugin {
  return {
    name: 'mermaid-opencode-go',
    configureServer(server) { server.middlewares.use(createOpenCodeGoMiddleware()); },
    configurePreviewServer(server) { server.middlewares.use(createOpenCodeGoMiddleware()); },
  };
}
