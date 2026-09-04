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

// A transcript line with `type:'user'` is EITHER a real human turn boundary OR
// the tool_result carrier the CLI writes after every tool call — both have
// `message.role === 'user'`. Breaking on the type alone therefore stopped the
// backward walk at the LAST tool result, and since an Edit/Write is always
// followed by its own result, the walk never reached a single tool_use: the hook
// collected zero files and exited 0 on every real turn. Only a message that
// carries no tool_result block is a turn boundary.
export function isTurnBoundary(evt) {
  if (evt.type !== 'user' || evt.message?.role !== 'user') return false;
  const content = evt.message?.content;
  if (!Array.isArray(content)) return true; // plain string prompt
  return !content.some((block) => block?.type === 'tool_result');
}

export function collectEditedFilesFromTranscript(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return new Set();
  const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
  const edited = new Set();
  // Walk backwards to the most recent user message; assistant events between
  // that boundary and EOF are this turn's tool calls.
  for (let i = lines.length - 1; i >= 0; i--) {
    const evt = safeJson(lines[i]);
    if (!evt) continue;
    if (isTurnBoundary(evt)) break;
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

// 3 — could NOT check. Any non-zero other than 2 is surfaced to the human as a
// non-blocking error, which is the right audience: an operator has to fix the
// instrument, and the model cannot. Never blocks; it only separates a green
// that means something from a green that means nobody looked.
export const EXIT_CANNOT_CHECK = 3;

function cannotCheck(reason) {
  process.stderr.write(
    `doc-sync: CANNOT CHECK — ${reason}.\n` +
      `This is not a pass: no doc-drift check ran for this turn. Fix the instrument ` +
      `(scripts/docs/feature-doc-map.json, and the Stop hook wiring in .claude/settings.json).\n`,
  );
  process.exit(EXIT_CANNOT_CHECK);
}

function main() {
  const payload = safeJson(readStdin()) || {};
  if (payload.stop_hook_active) process.exit(0);

  // A missing target is a broken trigger, not a clean turn.
  if (!payload.transcript_path) cannotCheck('no transcript_path in the hook payload');
  if (!fs.existsSync(payload.transcript_path)) {
    cannotCheck(`the transcript does not exist: ${payload.transcript_path}`);
  }

  const edited = collectEditedFilesFromTranscript(payload.transcript_path);
  if (edited.size === 0) process.exit(0);

  // A rule map that will not load, or loads empty, would pass every turn forever.
  let map;
  try {
    map = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
  } catch (e) {
    cannotCheck(`the rule map could not be read or parsed (${e.message})`);
  }
  if (!Array.isArray(map?.entries) || map.entries.length === 0) {
    cannotCheck('the rule map loaded with zero entries, so nothing could be matched');
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
