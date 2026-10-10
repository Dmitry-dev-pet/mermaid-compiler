import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ARTIFACTS = join(ROOT, 'artifacts');
const OUTPUT = join(ARTIFACTS, 'mermaid-chatgpt-local');
const GENERATED = join(ROOT, 'agent/chatgpt/generated/openCodeGoHandler.mjs');
const RUNTIME = ['cli.mjs', 'server.mjs', 'storage.mjs', 'service.mjs', 'protocol.mjs'];
const execFileAsync = promisify(execFile);

async function verifyPackage() {
  const { startChatGPTAgent } = await import(pathToFileURL(join(OUTPUT, 'agent/chatgpt/server.mjs')).href);
  const { handleOpenCodeGo } = await import(pathToFileURL(join(OUTPUT, 'agent/chatgpt/generated/openCodeGoHandler.mjs')).href);
  const temporary = await mkdtemp(join(tmpdir(), 'mermaid-package-check-'));
  let agent;
  try {
    agent = await startChatGPTAgent({
      port: 0, distDir: join(OUTPUT, 'diagram-compiler/dist'),
      storageDir: join(temporary, 'session'), goHandler: handleOpenCodeGo,
    });
    const page = await fetch(agent.origin);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<html/i);
    const cookie = page.headers.get('set-cookie')?.split(';')[0];
    assert(cookie);
    const status = await (await fetch(agent.origin + '/api/chatgpt/status', { headers: { cookie } })).json();
    assert.equal(status.agent, 'mermaid-chatgpt');
    assert.equal(status.connected, false);
    assert.deepEqual(status.accounts, []);
    const go = await fetch(agent.origin + '/api/opencode-go', {
      method: 'POST', headers: { cookie, origin: agent.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'models' }),
    });
    // No key is supplied, so the packaged Go adapter must reject locally.
    assert.equal(go.status, 401);
    assert.equal((await go.json()).error.code, 'key_required');
    assert.equal((await fetch(agent.origin + '/api/chatgpt/status')).status, 401);
  } finally {
    if (agent) await agent.close();
    await rm(temporary, { recursive: true, force: true });
  }
}

async function buildPackage() {
  const requireApp = createRequire(join(ROOT, 'diagram-compiler/package.json'));
  const ts = requireApp('typescript');
  const source = await readFile(join(ROOT, 'diagram-compiler/server/openCodeGoHandler.ts'), 'utf8');
  const compiled = ts.transpileModule(source, {
    fileName: 'openCodeGoHandler.ts', reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, removeComments: false },
  });
  if (compiled.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error)) throw new Error('The Go adapter did not compile.');
  await mkdir(dirname(GENERATED), { recursive: true });
  await writeFile(GENERATED, compiled.outputText);
  await rm(OUTPUT, { recursive: true, force: true });
  await mkdir(join(OUTPUT, 'agent/chatgpt/generated'), { recursive: true });
  await mkdir(join(OUTPUT, 'diagram-compiler'), { recursive: true });
  await cp(join(ROOT, 'diagram-compiler/dist'), join(OUTPUT, 'diagram-compiler/dist'), { recursive: true });
  for (const file of RUNTIME) await copyFile(join(ROOT, 'agent/chatgpt', file), join(OUTPUT, 'agent/chatgpt', file));
  await copyFile(GENERATED, join(OUTPUT, 'agent/chatgpt/generated/openCodeGoHandler.mjs'));
  await copyFile(join(ROOT, 'Start-Mermaid-ChatGPT.command'), join(OUTPUT, 'Start-Mermaid-ChatGPT.command'));
  await chmod(join(OUTPUT, 'Start-Mermaid-ChatGPT.command'), 0o755);
  await copyFile(join(ROOT, 'LICENSE'), join(OUTPUT, 'LICENSE'));

  let sourceCommit = null;
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: ROOT });
    if (/^[a-f0-9]{40}$/.test(stdout.trim())) sourceCommit = stdout.trim();
  } catch { /* A source archive can also be built without a Git checkout. */ }
  if (process.env.CI && !sourceCommit) throw new Error('CI packages require a source commit.');
  if (sourceCommit) {
    await execFileAsync('git', ['archive', '--format=tar.gz', `--output=${join(OUTPUT, 'source.tar.gz')}`, sourceCommit], { cwd: ROOT });
  }
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  await writeFile(join(OUTPUT, 'build-info.json'), JSON.stringify({
    name: 'Mermaid ChatGPT local workspace', version: pkg.version,
    node: '22 or later', sourceCommit,
    sourceUrl: sourceCommit ? `https://github.com/Dmitry-dev-pet/mermaid-compiler/tree/${sourceCommit}` : 'https://github.com/Dmitry-dev-pet/mermaid-compiler',
    license: pkg.license, workspace: 'http://127.0.0.1:8788/?ai=chatgpt',
    launch: 'Start-Mermaid-ChatGPT.command', command: 'node agent/chatgpt/cli.mjs',
  }, null, 2) + '\n');

  await verifyPackage();
  const archive = join(ARTIFACTS, 'mermaid-chatgpt-local.tar.gz');
  await execFileAsync('tar', ['-czf', archive, '-C', ARTIFACTS, 'mermaid-chatgpt-local']);
  const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
  await writeFile(archive + '.sha256', `${digest}  mermaid-chatgpt-local.tar.gz\n`);
  console.log('Mermaid ChatGPT package passed its local startup check. No OAuth or inference requests were made.');
  console.log('Package: artifacts/mermaid-chatgpt-local.tar.gz');
}

await buildPackage();
