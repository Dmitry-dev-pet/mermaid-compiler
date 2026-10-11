import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySemanticPatch, diffSources, inspectSource, readFlowchart, sha256 } from './core.mjs';

// Unit contract tests use a deterministic stub, not a substitute for Mermaid parse.
// parser.test.mjs verifies the real Mermaid 11 parser in CI after npm ci.
const validate = async (source) => /\b(?:flowchart|graph)\s+(?:LR|TD|TB|BT|RL)/.test(source) && !source.includes('INVALID');
const request = (source, nodeId = 'A', value = 'Changed', overrides = {}) => ({
  schemaVersion: 1, expectedSourceSha256: sha256(source), operation: 'set_node_label', target: { nodeId }, value, ...overrides,
});
const edit = (source, nodeId, value, overrides) => applySemanticPatch(source, request(source, nodeId, value, overrides), { validate });

const positive = [
  ['standalone', 'flowchart LR\nA[Old]\nB[Other]\nA --> B\n'],
  ['quoted', 'flowchart LR\nA["Old"]\nB["Other"]\nA --> B\n'],
  ['same visible labels distinct IDs', 'flowchart LR\nA[Old]\nB[Old]\nA --> B\n'],
  ['reused ID references', 'flowchart LR\nA[Old]\nA --> B\nC --> A\nB --> C\n'],
  ['inside subgraph', 'flowchart LR\nsubgraph Cluster\n  A[Old]\nend\nA --> B\n'],
  ['nested subgraphs', 'flowchart LR\nsubgraph Outer\nsubgraph Inner\n A[Old]\nend\nend\n'],
  ['comments survive', '%% a header comment\nflowchart LR\n%% comment 1\nA[Old] %% comment 2\n%% comment 3\nB[Other]\n'],
  ['whitespace and indentation', 'flowchart LR\n\n  A[Old]\n\n\tB[Other]\n\n'],
  ['class definition preserved', 'flowchart LR\nA[Old]\nclassDef good fill:#fff\nclass A good\n'],
  ['inline style preserved', 'flowchart LR\nA[Old]\nstyle A fill:#eee\n'],
  ['click directive preserved', 'flowchart LR\nA[Old]\nclick A "https://example.com" "Open"\n'],
  ['edge labels preserved', 'flowchart LR\nA[Old]\nA -->|confirmed| B\n'],
  ['edge chain preserved', 'flowchart LR\nA[Old]\nA --> B --> C\n'],
  ['Unicode labels', 'flowchart LR\nA[Старый текст]\nB[Коимбра]\nA --> B\n'],
  ['CRLF bytes preserved', 'flowchart LR\r\nA[Old]\r\n\r\nA --> B\r\n'],
  ['node ID repeated inside its label', 'flowchart LR\nA[Old A]\nB[Other]\n'],
];

for (const [name, source] of positive) {
  test(`patch works: ${name}`, async () => {
    const oldNode = readFlowchart(source).nodes.find(({ id }) => id === 'A');
    const original = source;
    const result = await edit(source, 'A', 'Изменено');
    assert.equal(result.status, 'applied', JSON.stringify(result));
    assert.equal(source, original, 'input string is never mutated');
    assert.equal(result.semanticDiff[0].oldLabel, oldNode.label);
    assert.equal(result.semanticDiff[0].newLabel, 'Изменено');
    assert.equal(result.changedSource.slice(0, oldNode.start), source.slice(0, oldNode.start));
    assert.equal(result.changedSource.slice(oldNode.start + 'Изменено'.length), source.slice(oldNode.end));
    assert.equal(result.proof.astEquivalence, 'not_verified');
    assert.equal(readFlowchart(result.changedSource).nodes.find(({ id }) => id === 'A').label, 'Изменено');
    const comparison = await diffSources(source, result.changedSource, { validate });
    assert.equal(comparison.status, 'verified_label_change');
  });
}

test('large flowchart 120 nodes / 170 edges preserves all other bytes', async () => {
  const nodes = Array.from({ length: 120 }, (_, i) => `N${i}[Node ${i}]`);
  const edges = Array.from({ length: 170 }, (_, i) => `N${i % 120} --> N${(i + 1) % 120}`);
  const source = `flowchart LR\n${nodes.join('\n')}\n${edges.join('\n')}\n`;
  const result = await edit(source, 'N44', 'Target changed');
  assert.equal(result.status, 'applied');
  assert.equal(readFlowchart(result.changedSource).nodes.length, 120);
  assert.equal(result.changedSource.split('\n').filter((line) => line.includes('-->')).length, 170);
});

const negative = [
  ['unknown ID', 'flowchart LR\nA[Old]\n', { nodeId: 'Missing' }, 'target_missing_or_unsupported'],
  ['duplicate declarations', 'flowchart LR\nA[Old]\nA[Another]\n', {}, 'ambiguous_node_declaration'],
  ['inline second definition', 'flowchart LR\nA[Old]\nA[Later] --> C\n', {}, 'ambiguous_node_declaration'],
  ['inline declaration only', 'flowchart LR\nA[Old] --> B\n', {}, 'target_missing_or_unsupported'],
  ['markdown content original', 'flowchart LR\nA["`Markdown`"]\n', {}, 'unsupported_existing_label'],
  ['class diagram unsupported', 'classDiagram\nclass A\n', {}, 'unsupported_diagram'],
  ['unsupported shape', 'flowchart LR\nA{Old}\n', {}, 'target_missing_or_unsupported'],
  ['mermaid parser rejects original', 'flowchart LR\nA[INVALID]\n', {}, 'invalid_original_mermaid'],
];
for (const [name, source, extras, reason] of negative) {
  test(`fails closed: ${name}`, async () => {
    const result = await applySemanticPatch(source, request(source, extras.nodeId || 'A', 'New'), { validate });
    assert.equal(result.status, 'rejected');
    assert.equal(result.reason, reason);
    assert.equal(result.changedSource, undefined);
  });
}

test('rejects stale SHA, malformed schema, unknown fields, missing validator and unsafe labels', async () => {
  const source = 'flowchart LR\nA[Old]\n';
  const cases = [
    [request(source, 'A', 'New', { expectedSourceSha256: '0'.repeat(64) }), 'source_hash_mismatch'],
    [request(source, 'A', 'New', { schemaVersion: 2 }), 'unsupported_patch_operation'],
    [request(source, 'A', 'New', { dangerous: 'hi' }), 'unknown_patch_field'],
    [request(source, 'A', 'bad]\nX --> Y'), 'unsafe_label'],
    [request(source, 'A', '<img>'), 'unsafe_label'],
    [request(source, 'A', 'A %% hidden'), 'unsafe_label'],
    [request(source, 'A', 'New', { dryRun: 'true' }), 'invalid_dry_run'],
  ];
  for (const [patch, reason] of cases) {
    const result = await applySemanticPatch(source, patch, { validate });
    assert.equal(result.reason, reason);
  }
  assert.equal((await applySemanticPatch(source, request(source, 'A', 'New'))).reason, 'validator_unavailable');
});

test('no_change is idempotent, with real parser check callback', async () => {
  const source = 'flowchart LR\nA[Old]\n';
  const result = await edit(source, 'A', 'Old');
  assert.equal(result.status, 'no_change');
  assert.equal(result.changedSource, undefined);
});

test('inspect and diff reject unverifiable structural edits', async () => {
  const before = 'flowchart LR\nA[Old]\nB[Keep]\nA --> B\n';
  const after = 'flowchart LR\nA[New]\nB[Keep]\nA --> C\n';
  assert.equal((await inspectSource(before, { validate })).status, 'valid');
  assert.equal((await diffSources(before, after, { validate })).reason, 'not_one_supported_label_change');
  assert.equal((await diffSources(before, before, { validate })).status, 'no_change');
});
