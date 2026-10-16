import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { validateWithMermaid } from '../../diagram-compiler/mermaid-node-validate.mjs';
import { applySemanticPatch, sha256 } from './core.mjs';

const exampleSources = [
  'flowchart LR\nA[Old]\nB[Other]\nA --> B\n',
  'flowchart LR\nA["Old"]\nB["Other"]\nA --> B\n',
  'flowchart LR\nsubgraph Outer\n subgraph Inner\n A[Old]\n end\nend\nA --> B\n',
  'flowchart LR\nA[Old]\n%% keep comment\nB[Other]\nA --> B\n',
  'flowchart LR\r\nA[Old]\r\nB[Other]\r\nA --> B\r\n',
  'flowchart LR\nA[Старый]\nB[Коимбра]\nA --> B\n',
];

for (const source of exampleSources) {
  test(`Mermaid parser accepts before and after (${JSON.stringify(source.slice(0, 35))})`, async () => {
    assert.equal(await validateWithMermaid(source), true);
    const req = { schemaVersion: 1, expectedSourceSha256: sha256(source), operation: 'set_node_label', target: { nodeId: 'A' }, value: 'New label' };
    const result = await applySemanticPatch(source, req, { validate: validateWithMermaid });
    assert.equal(result.status, 'applied', JSON.stringify(result));
    assert.equal(await validateWithMermaid(result.changedSource), true);
  });
}

test('CLI uses real parser; dry-run and explicit write preserve source', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'mermaid-patch-'));
  const cli = fileURLToPath(new URL('./cli.mjs', import.meta.url));
  try {
    const path = join(folder, 'diagram.mmd');
    const patchPath = join(folder, 'patch.json');
    const source = 'flowchart LR\nA[Old]\nB[Keep]\nA --> B\n';
    const patch = { schemaVersion: 1, expectedSourceSha256: sha256(source), operation: 'set_node_label', target: { nodeId: 'A' }, value: 'Done' };
    await writeFile(path, source);
    await writeFile(patchPath, JSON.stringify(patch));
    const exec = (...flags) => {
      const proc = spawnSync(process.execPath, [cli, ...flags], { encoding: 'utf8', timeout: 30000 });
      assert.equal(proc.status, 0, proc.stderr || proc.stdout);
      return JSON.parse(proc.stdout);
    };
    assert.equal(exec('check', path, '--json').status, 'valid');
    assert.equal(exec('inspect', path, '--json').recognizedStandaloneNodes.length, 2);
    assert.equal(exec('apply', path, '--patch', patchPath, '--json').written, false);
    assert.equal(await readFile(path, 'utf8'), source);
    await writeFile(join(folder, 'original.mmd'), source);
    const written = exec('apply', path, '--patch', patchPath, '--write', '--json');
    assert.equal(written.status, 'applied');
    assert.equal(written.written, true);
    assert.equal(await readFile(path, 'utf8'), 'flowchart LR\nA[Done]\nB[Keep]\nA --> B\n');
    assert.equal(exec('diff', join(folder, 'original.mmd'), path, '--json').status, 'verified_label_change');
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
