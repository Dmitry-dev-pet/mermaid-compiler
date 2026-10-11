import { createHash } from 'node:crypto';

export const sha256 = (source) => createHash('sha256').update(source, 'utf8').digest('hex');

const NODE_ID = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const HEADER = /^(flowchart|graph)[ \t]+(TB|TD|BT|LR|RL)[ \t]*(?:%%.*)?$/i;
// Intentionally small safe grammar. Not a replacement for Mermaid's parser.
const STANDALONE = /^([ \t]*)([A-Za-z_][A-Za-z0-9_-]*)[ \t]*\[(?:"([^"\\\r\n]*)"|([^\[\]"\\\r\n`<>]*))\]([ \t]*(?:%%[^\r\n]*)?)$/;
const MAX_SOURCE = 1024 * 1024;
const MAX_LABEL = 1000;
const safeLabel = (label) => typeof label === 'string' && label.length > 0 && label.length <= MAX_LABEL &&
  !/[\x00-\x1f\x7f]/.test(label) && !['[', ']', '\\', '"', '`', '<', '>', '|', '{', '}'].some((ch) => label.includes(ch)) && !label.includes('%%');

const reject = (reason, extras = {}) => ({ status: 'rejected', reason, ...extras });
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function readFlowchart(source) {
  if (typeof source !== 'string' || source.length === 0 || Buffer.byteLength(source, 'utf8') > MAX_SOURCE || source.includes('\0')) {
    throw new Error('invalid_source_size');
  }
  let position = 0;
  let header = null;
  let lineNumber = 0;
  const nodes = [];
  const lines = source.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter(Boolean) ?? [];
  for (const rawLine of lines) {
    lineNumber += 1;
    const content = rawLine.replace(/\r\n$|[\r\n]$/, '');
    const trimmed = content.trim();
    if (header === null) {
      if (trimmed === '' || trimmed.startsWith('%%')) {
        position += rawLine.length;
        continue;
      }
      const foundHeader = HEADER.exec(trimmed);
      if (!foundHeader) throw new Error('unsupported_diagram');
      header = { type: 'flowchart', direction: foundHeader[2].toUpperCase() };
      position += rawLine.length;
      continue;
    }
    if (trimmed === '' || trimmed.startsWith('%%')) {
      position += rawLine.length;
      continue;
    }
    const match = STANDALONE.exec(content);
    if (match) {
      const id = match[2];
      const bracketIndex = content.indexOf('[', match[1].length + id.length);
      const quoted = match[3] !== undefined;
      const label = quoted ? match[3] : match[4];
      const start = position + bracketIndex + (quoted ? 2 : 1);
      nodes.push({ id, idStart: position + match[1].length, label, quoted, line: lineNumber, start, end: start + label.length });
    }
    position += rawLine.length;
  }
  if (!header) throw new Error('unsupported_diagram');
  return { ...header, nodes, lineCount: lineNumber };
}

export function validatePatchRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return 'invalid_patch';
  if (Object.keys(request).some((key) => !['schemaVersion', 'expectedSourceSha256', 'operation', 'target', 'value', 'dryRun'].includes(key))) return 'unknown_patch_field';
  if (request.schemaVersion !== 1 || request.operation !== 'set_node_label') return 'unsupported_patch_operation';
  if (typeof request.expectedSourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(request.expectedSourceSha256)) return 'invalid_source_sha256';
  if (!request.target || typeof request.target !== 'object' || Array.isArray(request.target) ||
    Object.keys(request.target).length !== 1 || !own(request.target, 'nodeId') ||
    typeof request.target.nodeId !== 'string' || !NODE_ID.test(request.target.nodeId)) return 'invalid_target';
  if (!safeLabel(request.value)) return 'unsafe_label';
  if (own(request, 'dryRun') && typeof request.dryRun !== 'boolean') return 'invalid_dry_run';
  return null;
}

function candidateFor(source, node, value) {
  return source.slice(0, node.start) + value + source.slice(node.end);
}

function ensureUniqueDeclaration(source, node, selected) {
  // No other shaped definition for this ID anywhere (including inline edges).
  // A false positive is a safe rejection, not a silent source rewrite.
  const pattern = new RegExp(`(^|[^A-Za-z0-9_-])${escapeRegex(node.id)}[ \\t]*(?=[\\[({])`, 'g');
  const lines = source.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter(Boolean) ?? [];
  let offset = 0;
  let count = 0;
  for (const line of lines) {
    if (line.trimStart().startsWith('%%')) { offset += line.length; continue; }
    for (const match of line.matchAll(pattern)) {
      const absolute = offset + match.index + match[1].length;
      if (absolute !== selected) return false;
      count += 1;
    }
    offset += line.length;
  }
  return count === 1;
}

async function parserAccepts(validate, source) {
  if (typeof validate !== 'function') return false;
  try {
    return (await validate(source)) === true;
  } catch {
    return false;
  }
}

function lineDiff(original, next, line) {
  const before = original.split(/\r\n|\n|\r/)[line - 1];
  const after = next.split(/\r\n|\n|\r/)[line - 1];
  return `--- before\n+++ after\n@@ -${line},1 +${line},1 @@\n-${before}\n+${after}\n`;
}

export async function applySemanticPatch(source, request, { validate } = {}) {
  const originalHash = typeof source === 'string' ? sha256(source) : null;
  const invalidRequest = validatePatchRequest(request);
  if (invalidRequest) return reject(invalidRequest, { sourceSha256: originalHash });
  if (originalHash !== request.expectedSourceSha256) return reject('source_hash_mismatch', { sourceSha256: originalHash });
  if (typeof validate !== 'function') return reject('validator_unavailable', { sourceSha256: originalHash });

  let parsed;
  try { parsed = readFlowchart(source); }
  catch (error) { return reject(error.message, { sourceSha256: originalHash }); }
  const targets = parsed.nodes.filter((node) => node.id === request.target.nodeId);
  if (targets.length === 0) return reject('target_missing_or_unsupported', { sourceSha256: originalHash });
  if (targets.length !== 1) return reject('ambiguous_node_declaration', { sourceSha256: originalHash });
  const target = targets[0];
  if (!safeLabel(target.label)) return reject('unsupported_existing_label', { sourceSha256: originalHash });
  if (!ensureUniqueDeclaration(source, target, target.idStart)) return reject('ambiguous_node_declaration', { sourceSha256: originalHash });
  if (!(await parserAccepts(validate, source))) return reject('invalid_original_mermaid', { sourceSha256: originalHash });
  if (target.label === request.value) {
    return {
      status: 'no_change', sourceSha256: originalHash, newSourceSha256: originalHash,
      semanticDiff: [], sourceDiff: '',
      proof: { onlyLabelSpanChanged: true, untouchedBytesPreserved: true, parserBeforeAndAfter: true, astEquivalence: 'not_verified' },
    };
  }

  const changedSource = candidateFor(source, target, request.value);
  // Verify only requested character span was touched, even across CRLF and Unicode.
  const prefix = source.slice(0, target.start);
  const suffix = source.slice(target.end);
  if (!changedSource.startsWith(prefix) || !changedSource.endsWith(suffix) ||
    changedSource !== prefix + request.value + suffix) return reject('span_proof_failed', { sourceSha256: originalHash });
  let changed;
  try { changed = readFlowchart(changedSource); }
  catch { return reject('candidate_unsupported', { sourceSha256: originalHash }); }
  const nextTarget = changed.nodes.filter((node) => node.id === target.id);
  if (nextTarget.length !== 1 || nextTarget[0].label !== request.value) return reject('candidate_structure_changed', { sourceSha256: originalHash });
  if (!(await parserAccepts(validate, changedSource))) return reject('invalid_candidate_mermaid', { sourceSha256: originalHash });
  return {
    status: 'applied', sourceSha256: originalHash, newSourceSha256: sha256(changedSource),
    changedSource,
    semanticDiff: [{ operation: 'set_node_label', nodeId: target.id, oldLabel: target.label, newLabel: request.value }],
    sourceDiff: lineDiff(source, changedSource, target.line),
    proof: { onlyLabelSpanChanged: true, untouchedBytesPreserved: true, parserBeforeAndAfter: true, astEquivalence: 'not_verified' },
  };
}

export async function inspectSource(source, { validate } = {}) {
  let parsed;
  try { parsed = readFlowchart(source); }
  catch (error) { return reject(error.message); }
  if (typeof validate !== 'function') return reject('validator_unavailable');
  if (!(await parserAccepts(validate, source))) return reject('invalid_original_mermaid');
  return { status: 'valid', sourceSha256: sha256(source), type: parsed.type,
    direction: parsed.direction, recognizedStandaloneNodes: parsed.nodes.map(({ id, label, line }) => ({ id, label, line })),
    coverage: 'standalone_square_bracket_nodes_only' };
}

export async function diffSources(before, after, { validate } = {}) {
  const orig = await inspectSource(before, { validate });
  if (orig.status !== 'valid') return reject('invalid_or_unsupported_before', { detail: orig.reason });
  const next = await inspectSource(after, { validate });
  if (next.status !== 'valid') return reject('invalid_or_unsupported_after', { detail: next.reason });
  if (before === after) return { status: 'no_change', semanticDiff: [], sourceSha256: sha256(before), newSourceSha256: sha256(after) };
  const a = readFlowchart(before);
  const b = readFlowchart(after);
  const changes = [];
  for (const node of a.nodes) {
    const other = b.nodes.filter((candidate) => candidate.id === node.id);
    if (other.length !== 1) continue;
    if (other[0].label === node.label || !safeLabel(node.label) || !safeLabel(other[0].label)) continue;
    // Source outside the changed label must be byte-exact in both files.
    if (before.slice(0, node.start) + before.slice(node.end) ===
      after.slice(0, other[0].start) + after.slice(other[0].end) &&
      ensureUniqueDeclaration(before, node, node.idStart) &&
      ensureUniqueDeclaration(after, other[0], other[0].idStart)) {
      changes.push({ operation: 'set_node_label', nodeId: node.id, oldLabel: node.label, newLabel: other[0].label });
    }
  }
  if (changes.length !== 1) return reject('not_one_supported_label_change', { sourceSha256: sha256(before), newSourceSha256: sha256(after) });
  return { status: 'verified_label_change', sourceSha256: sha256(before), newSourceSha256: sha256(after), semanticDiff: changes,
    proof: { untouchedBytesPreserved: true, parserBeforeAndAfter: true, astEquivalence: 'not_verified' } };
}
