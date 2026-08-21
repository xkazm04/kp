#!/usr/bin/env node
// Fixtures for the doc-sync Stop hook. No deps — run with:
//   node scripts/docs/__tests__/check-doc-sync.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluate,
  compileGlob,
  isTurnBoundary,
  collectEditedFilesFromTranscript,
} from '../check-doc-sync.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');
const realMap = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'scripts/docs/feature-doc-map.json'), 'utf8'),
);

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const MAP = {
  entries: [
    { doc: 'docs/features/comms/README.md', sourceGlobs: ['app/_lib/comms/**', 'app/api/comms/**'] },
    { doc: 'docs/features/billing/README.md', sourceGlobs: ['app/api/billing/**', 'app/_lib/billing.ts'] },
  ],
};

// --- glob compilation -------------------------------------------------------
check('globstar matches nested paths', () => {
  const re = compileGlob('app/_lib/comms/**');
  assert.ok(re.test('app/_lib/comms/send.ts'));
  assert.ok(re.test('app/_lib/comms/providers/smtp.ts'));
  assert.ok(!re.test('app/_lib/commsx/send.ts'));
});

check('globstar matches the bare directory', () => {
  assert.ok(compileGlob('app/api/billing/**').test('app/api/billing'));
});

check('exact file glob matches only itself', () => {
  const re = compileGlob('app/_lib/billing.ts');
  assert.ok(re.test('app/_lib/billing.ts'));
  assert.ok(!re.test('app/_lib/billing.test.ts'));
});

check('single star does not cross a slash', () => {
  const re = compileGlob('app/api/*/route.ts');
  assert.ok(re.test('app/api/jobs/route.ts'));
  assert.ok(!re.test('app/api/jobs/nested/route.ts'));
});

// --- evaluate ---------------------------------------------------------------
check('mapped source edit with no doc edit => missing', () => {
  const { hits, missing } = evaluate(['app/_lib/comms/send.ts'], MAP);
  assert.equal(missing, true);
  assert.deepEqual([...hits.keys()], ['docs/features/comms/README.md']);
});

check('mapped source edit WITH a feature-doc edit => satisfied', () => {
  const { missing } = evaluate(
    ['app/_lib/comms/send.ts', 'docs/features/comms/README.md'],
    MAP,
  );
  assert.equal(missing, false);
});

check('an architecture-doc edit also satisfies', () => {
  const { missing } = evaluate(
    ['app/api/billing/route.ts', 'docs/architecture/llm-provider-layer.md'],
    MAP,
  );
  assert.equal(missing, false);
});

check('a design-doc edit also satisfies', () => {
  const { missing } = evaluate(['app/api/billing/route.ts', 'docs/design/README.md'], MAP);
  assert.equal(missing, false);
});

check('unmapped source edit => silent', () => {
  const { missing } = evaluate(['app/_lib/unmapped-thing.ts'], MAP);
  assert.equal(missing, false);
});

check('test files are skipped', () => {
  const { missing } = evaluate(['app/_lib/comms/send.test.ts'], MAP);
  assert.equal(missing, false);
});

check('doc-only turns are skipped', () => {
  const { missing } = evaluate(['docs/features/comms/README.md'], MAP);
  assert.equal(missing, false);
});

check('.claude/ edits are skipped', () => {
  const { missing } = evaluate(['.claude/skills/perfect/skill.md'], MAP);
  assert.equal(missing, false);
});

check('app/landing is exempt (fixed art direction)', () => {
  const { missing } = evaluate(
    ['app/landing/spark/SparkLanding.tsx'],
    { entries: [{ doc: 'docs/design/README.md', sourceGlobs: ['app/**'] }] },
  );
  assert.equal(missing, false);
});

check('multiple docs can be hit in one turn', () => {
  const { hits, missing } = evaluate(
    ['app/_lib/comms/send.ts', 'app/api/billing/route.ts'],
    MAP,
  );
  assert.equal(missing, true);
  assert.equal(hits.size, 2);
});

check('empty turn => silent', () => {
  assert.equal(evaluate([], MAP).missing, false);
});

// --- transcript walk --------------------------------------------------------
// Regression fixtures for the bug that made this hook a no-op: a tool RESULT is
// written as `{type:'user', message:{role:'user', content:[{type:'tool_result'}]}}`,
// so treating every `type:'user'` line as the turn boundary stopped the backward
// walk at the last tool result — before any Edit could be seen.
const userPrompt = (text) => ({ type: 'user', message: { role: 'user', content: text }, uuid: 't' });
const toolResult = (id) => ({
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] },
  toolUseResult: {},
});
const editCall = (id, file) => ({
  type: 'assistant',
  message: {
    role: 'assistant',
    content: [{ type: 'tool_use', name: 'Edit', id, input: { file_path: path.join(REPO_ROOT, file) } }],
  },
});
const assistantText = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });

function writeTranscript(events) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-docsync-'));
  const file = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(file, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return file;
}

check('a tool_result line is NOT a turn boundary', () => {
  assert.equal(isTurnBoundary(toolResult('t1')), false);
});

check('a human prompt IS a turn boundary (string and text-block forms)', () => {
  assert.equal(isTurnBoundary(userPrompt('do the thing')), true);
  assert.equal(
    isTurnBoundary({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } }),
    true,
  );
});

check('an assistant line is never a turn boundary', () => {
  assert.equal(isTurnBoundary(assistantText('done')), false);
});

check('an Edit followed by its tool_result is still collected', () => {
  const file = writeTranscript([
    userPrompt('Fix the comms dispatch bug.'),
    editCall('t1', 'app/_lib/comms-dispatch.ts'),
    toolResult('t1'),
    assistantText('Done.'),
  ]);
  const edited = [...collectEditedFilesFromTranscript(file)];
  assert.deepEqual(edited, ['app/_lib/comms-dispatch.ts']);
  assert.equal(evaluate(edited, realMap).missing, true);
});

check('the walk stops at the previous HUMAN turn', () => {
  const file = writeTranscript([
    userPrompt('turn one'),
    editCall('t1', 'app/_lib/billing.ts'),
    toolResult('t1'),
    assistantText('done one'),
    userPrompt('turn two'),
    editCall('t2', 'app/_lib/comms-dispatch.ts'),
    toolResult('t2'),
    assistantText('done two'),
  ]);
  assert.deepEqual([...collectEditedFilesFromTranscript(file)], ['app/_lib/comms-dispatch.ts']);
});

check('a turn that also edits the mapped doc is satisfied', () => {
  const file = writeTranscript([
    userPrompt('Fix the comms dispatch bug.'),
    editCall('t1', 'app/_lib/comms-dispatch.ts'),
    toolResult('t1'),
    editCall('t2', 'docs/features/comms/README.md'),
    toolResult('t2'),
    assistantText('Done.'),
  ]);
  assert.equal(evaluate([...collectEditedFilesFromTranscript(file)], realMap).missing, false);
});

// --- the real map is well-formed and resolves -------------------------------
check('real map: every entry has a doc and at least one glob', () => {
  assert.ok(Array.isArray(realMap.entries) && realMap.entries.length > 0);
  for (const e of realMap.entries) {
    assert.ok(typeof e.doc === 'string' && e.doc.startsWith('docs/'), `bad doc: ${e.doc}`);
    assert.ok(Array.isArray(e.sourceGlobs) && e.sourceGlobs.length > 0, `no globs: ${e.doc}`);
  }
});

check('real map: every mapped doc exists on disk', () => {
  for (const e of realMap.entries) {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, e.doc)), `missing doc: ${e.doc}`);
  }
});

check('real map: every glob root exists on disk', () => {
  for (const e of realMap.entries) {
    for (const g of e.sourceGlobs) {
      const root = g.split('/').filter((s) => !s.includes('*')).join('/');
      assert.ok(
        fs.existsSync(path.join(REPO_ROOT, root)),
        `glob root missing: ${g} (in ${e.doc})`,
      );
    }
  }
});

check('real map: no duplicate doc entries', () => {
  const docs = realMap.entries.map((e) => e.doc);
  assert.equal(new Set(docs).size, docs.length);
});

console.log(`\n${passed} checks passed.`);
