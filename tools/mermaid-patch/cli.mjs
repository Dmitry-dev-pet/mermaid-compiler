#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { applySemanticPatch, diffSources, inspectSource, sha256 } from './core.mjs';

const help = `Usage:
  node tools/mermaid-patch/cli.mjs inspect <file> --json
  node tools/mermaid-patch/cli.mjs check <file> --json
  node tools/mermaid-patch/cli.mjs diff <before> <after> --json
  node tools/mermaid-patch/cli.mjs apply <file> --patch <patch.json> [--dry-run | --write] --json

Apply defaults to dry-run. --write is explicit and never overrides patch.dryRun=true.
Install app dependencies (npm --prefix diagram-compiler ci) for the real Mermaid parser.
`;

function output(data) {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  if (data.status === 'rejected') process.exitCode = 2;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command === '--help' || command === '-h' || !command) return { command: 'help' };
  if (!['inspect', 'check', 'diff', 'apply'].includes(command)) throw new Error('unknown_command');
  const positional = [];
  let patchPath;
  let write = false;
  let dryRun = false;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--json') continue;
    if (arg === '--write') { write = true; continue; }
    if (arg === '--dry-run') { dryRun = true; continue; }
    if (arg === '--patch') {
      if (patchPath !== undefined || !rest[index + 1] || rest[index + 1].startsWith('--')) throw new Error('invalid_patch_path');
      patchPath = rest[++index];
      continue;
    }
    if (arg.startsWith('-')) throw new Error('unknown_option');
    positional.push(arg);
  }
  const expected = command === 'diff' ? 2 : 1;
  if (positional.length !== expected || (command === 'apply' && !patchPath) ||
    (command !== 'apply' && (patchPath || write || dryRun)) || (write && dryRun)) throw new Error('invalid_arguments');
  return { command, positional, patchPath, write };
}

async function readUtf8(filename) {
  const bytes = await fs.readFile(filename);
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}

async function loadValidator() {
  try {
    const bridge = await import('../../diagram-compiler/mermaid-node-validate.mjs');
    return bridge.validateWithMermaid;
  } catch {
    return null;
  }
}

async function safeWrite(filename, expectedSha, result) {
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) return 'unsupported_file_type';
  const current = await readUtf8(filename);
  if (sha256(current) !== expectedSha) return 'source_changed_on_disk';
  const temp = join(dirname(filename), `.${basename(filename)}.mermaid-patch-${process.pid}-${randomBytes(6).toString('hex')}.tmp`);
  let created = false;
  try {
    const fh = await fs.open(temp, 'wx', stat.mode & 0o777);
    created = true;
    try {
      await fh.writeFile(result.changedSource, { encoding: 'utf8' });
      await fh.chmod(stat.mode & 0o777);
      await fh.sync();
    } finally {
      await fh.close();
    }
    const recheck = await fs.lstat(filename);
    if (!recheck.isFile() || recheck.isSymbolicLink() || recheck.ino !== stat.ino || recheck.dev !== stat.dev ||
      sha256(await readUtf8(filename)) !== expectedSha) return 'source_changed_on_disk';
    await fs.rename(temp, filename); // Atomic same-directory replace, not cross-process CAS.
    created = false;
    return null;
  } finally {
    if (created) await fs.rm(temp, { force: true });
  }
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (error) { output({ status: 'rejected', reason: error.message, usage: help }); return; }
  if (args.command === 'help') { process.stdout.write(help); return; }

  const validate = await loadValidator();
  if (!validate) { output({ status: 'rejected', reason: 'validator_unavailable', hint: 'Run npm --prefix diagram-compiler ci to install the official Mermaid dependency.' }); return; }
  try {
    if (args.command === 'inspect' || args.command === 'check') {
      const result = await inspectSource(await readUtf8(args.positional[0]), { validate });
      output(args.command === 'check' && result.status === 'valid' ? {
        status: 'valid', sourceSha256: result.sourceSha256, type: result.type, direction: result.direction,
      } : result);
      return;
    }
    if (args.command === 'diff') {
      output(await diffSources(await readUtf8(args.positional[0]), await readUtf8(args.positional[1]), { validate }));
      return;
    }
    const filename = args.positional[0];
    const source = await readUtf8(filename);
    const patch = JSON.parse(await readUtf8(args.patchPath));
    const result = await applySemanticPatch(source, patch, { validate });
    if (result.status === 'applied' && args.write && patch.dryRun !== true) {
      const error = await safeWrite(filename, patch.expectedSourceSha256, result);
      if (error) { output({ status: 'rejected', reason: error, sourceSha256: sha256(source) }); return; }
      output({ ...result, written: true });
      return;
    }
    output({ ...result, written: false });
  } catch (error) {
    output({ status: 'rejected', reason: 'io_or_json_error', code: error.code ?? 'INVALID' });
  }
}

await main();
