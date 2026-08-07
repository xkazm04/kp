#!/usr/bin/env node
// Stop hook: nudge Claude when feature source changed in this turn but the
// feature doc coupled to it was not updated.
//
// Registered from .claude/settings.json -> hooks.Stop. Reads the JSONL
// transcript at $payload.transcript_path, scans the most recent assistant turn
// for Edit/Write/MultiEdit/NotebookEdit calls, and matches the edited paths
// against scripts/docs/feature-doc-map.json.
//
// Exit 2 (with a message on stderr) when source matched an entry's
// `sourceGlobs` and no file under docs/features/ or docs/architecture/ was
// edited in the same turn. Honors `stop_hook_active` so it cannot loop.
//
// Dismiss path: if the change is internal-only (refactor, generated code, no
// behavior shift), reply with one short sentence — "internal-only, no doc
// update needed" — and stop. Do not ignore the reminder silently.

import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const MAP_PATH = path.join(REPO_ROOT, 'scripts/docs/feature-doc-map.json');

// Edits to these never count as "feature source changed".
const SKIP_PATTERNS = [
  /\.test\.[tj]sx?$/,
  /\.spec\.[tj]sx?$/,
  /_test\.py$/,
  /__tests__\//,
  /\/generated\//,
  /\.generated\.(ts|tsx|mjs|js|cjs)$/,
  /^app\/_dev-inspector\//,
  /^app\/landing\//,
  /^messages\//,
  /^docs\//,
  /^\.claude\//,
  /^uat\//,
  /^tiger\//,
  /^context-map\.json$/,
  /^next-env\.d\.ts$/,
];

// Editing any file under these satisfies the reminder.
const DOC_PREFIXES = ['docs/features/', 'docs/architecture/', 'docs/design/'];

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function normalize(p) {
  return path.relative(REPO_ROOT, p).split(path.sep).join('/');
}

export function compileGlob(pattern) {
  const re = pattern
    .split('/')
    .map((segment) => {
      if (segment === '**') return '__GLOBSTAR__';
      return segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
    })
    .join('/')
    .replace(/\/__GLOBSTAR__\//g, '(/.*)?/')
    .replace(/^__GLOBSTAR__\//, '(.*/)?')
    .replace(/\/__GLOBSTAR__$/, '(/.*)?')
    .replace(/__GLOBSTAR__/g, '.*');
  return new RegExp(`^${re}$`);
}

function collectEditedFilesFromTranscript(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return new Set();
  const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
  const edited = new Set();
  // Walk backwards to the most recent user message; assistant events between
  // that boundary and EOF are this turn's tool calls.
  for (let i = lines.length - 1; i >= 0; i--) {
    const evt = safeJson(lines[i]);
    if (!evt) continue;
    if (evt.type === 'user' && evt.message?.role === 'user') break;
    if (evt.type !== 'assistant') continue;
    const content = evt.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type !== 'tool_use') continue;
      if (!['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(block.name)) continue;
      const fp = block.input?.file_path;
      if (typeof fp === 'string' && fp.length) edited.add(normalize(fp));
    }
  }
  return edited;
}

// Pure core, exported for the test fixtures.
export function evaluate(editedArr, map) {
  const docsTouched = editedArr.some((f) => DOC_PREFIXES.some((p) => f.startsWith(p)));
  const meaningful = editedArr.filter((f) => !SKIP_PATTERNS.some((re) => re.test(f)));
  if (meaningful.length === 0) return { hits: new Map(), missing: false };

  const compiled = (map.entries || []).map((entry) => ({
    doc: entry.doc,
    matchers: (entry.sourceGlobs || []).map(compileGlob),
  }));

  const hits = new Map(); // doc -> [files]
  for (const f of meaningful) {
    for (const entry of compiled) {
      if (!entry.matchers.some((re) => re.test(f))) continue;
      if (!hits.has(entry.doc)) hits.set(entry.doc, []);
      hits.get(entry.doc).push(f);
    }
  }
  return { hits, missing: !docsTouched && hits.size > 0 };
}

function main() {
  const payload = safeJson(readStdin()) || {};
  if (payload.stop_hook_active) process.exit(0);

  const edited = collectEditedFilesFromTranscript(payload.transcript_path);
  if (edited.size === 0) process.exit(0);

  let map;
  try {
    map = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
  } catch {
    process.exit(0);
  }

  const { hits, missing } = evaluate([...edited], map);
  if (!missing) process.exit(0);

  const summary = [...hits.entries()]
    .map(([doc, files]) => {
      const head = files.slice(0, 4).join(', ');
      const tail = files.length > 4 ? ` (+${files.length - 4} more)` : '';
      return `  - ${doc} <- ${head}${tail}`;
    })
    .join('\n');

  process.stderr.write(
    `Doc-sync reminder: this turn edited feature source but no docs/features/*, ` +
      `docs/architecture/* or docs/design/* file was touched.\n\n` +
      `Doc(s) likely affected:\n${summary}\n\n` +
      `Update the named doc(s) now — entry points, flows, surface table, data model, ` +
      `known gaps — or dismiss with one short sentence ("internal-only, no doc update ` +
      `needed"). Do not ignore this silently. If you added a new feature area, add its ` +
      `entry to scripts/docs/feature-doc-map.json in the same change.\n`,
  );
  process.exit(2);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('check-doc-sync.mjs')) {
  main();
}
