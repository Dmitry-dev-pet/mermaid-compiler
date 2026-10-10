// @vitest-environment node
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('loads the emitted Vercel entrypoint in native Node and rejects anonymous requests', () => {
  const repository = fileURLToPath(new URL('../../', import.meta.url));
  const output = mkdtempSync(join(tmpdir(), 'mermaid-go-runtime-'));
  try {
    // Match Vercel's NodeNext compilation and preserve the real package boundaries.
    // A Vitest import alone hides CommonJS-to-ESM loading failures in production.
    const program = ts.createProgram([join(repository, 'api/opencode-go.ts')], {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
      types: [],
      rootDir: repository,
      outDir: output,
      skipLibCheck: true,
      noEmitOnError: true,
    });
    const emitted = program.emit();
    const errors = [...ts.getPreEmitDiagnostics(program), ...emitted.diagnostics]
      .filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
      .map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    expect(errors).toEqual([]);
    expect(emitted.emitSkipped).toBe(false);

    for (const path of ['package.json', 'api/package.json', 'diagram-compiler/package.json']) {
      if (!existsSync(join(repository, path))) continue;
      mkdirSync(dirname(join(output, path)), { recursive: true });
      copyFileSync(join(repository, path), join(output, path));
    }

    const result = spawnSync(process.execPath, [
      '--no-experimental-require-module', '--input-type=module', '-e', `
        import assert from 'node:assert/strict';
        globalThis.fetch = () => { throw new Error('Unexpected upstream request'); };
        const { GET, POST, OPTIONS } = await import(process.argv[1]);
        for (const [method, handler, status, code] of [
          ['GET', GET, 405, 'method_not_allowed'],
          ['POST', POST, 401, 'key_required'],
          ['OPTIONS', OPTIONS, 405, 'method_not_allowed'],
        ]) {
          const response = await handler(new Request('https://mermaid.example/api/opencode-go', {
            method,
            ...(method === 'POST' ? {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ operation: 'chat' }),
            } : {}),
          }));
          assert.equal(response.status, status);
          assert.equal((await response.json()).error.code, code);
          assert.equal(response.headers.get('cache-control'), 'no-store');
        }
      `,
      pathToFileURL(join(output, 'api/opencode-go.js')).href,
    ], { encoding: 'utf8', timeout: 10_000 });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr || result.stdout).toBe(0);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}, 15_000);
