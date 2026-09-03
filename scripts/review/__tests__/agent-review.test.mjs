#!/usr/bin/env node
// Fixtures for the judgement lens's PURE half. No deps, no network, no model —
// run with:
//   node scripts/review/__tests__/agent-review.test.mjs
//
// The lens itself is a model call and cannot be pinned deterministically. What
// CAN be pinned is everything around it, and that is where its silent failures
// live: the diff is trimmed to a byte budget before it is sent, the reply is
// JSON dug out of whatever the model wrapped it in, and the exit code is derived
// from the findings. Each of those three can fail in the direction that reports
// GREEN — a budget that drops the file the change is actually in, an extraction
// that returns null and is read as "no findings", a verdict that never reaches 1
// — and none of them had a fixture. A review lens that silently reviews nothing
// is worse than no lens, because the required check goes green.
//
// The rubric half is here too, for the same reason: `section()` returning '' on a
// renamed heading would strip this project's constitution out of the prompt and
// leave a generic "good code" reviewer behind a name that promises otherwise.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { budgetDiff, extractJson, parseArgs, renderMarkdown, verdictFor } from '../agent-review.mjs';
import { adrSummaries, readIfPresent, section } from '../rubric.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

// --- what actually reaches the model ------------------------------------------

const fileDiff = (name, body) => `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n${body}\n`;

check('a diff inside the budget is passed through untouched', () => {
  const d = fileDiff('a.ts', '+one');
  assert.deepEqual(budgetDiff(d, 10_000), { text: d, truncated: false, droppedChars: 0 });
});

check('an over-budget diff is cut at a file boundary, and says how much it dropped', () => {
  const d = fileDiff('a.ts', `+${'a'.repeat(400)}`) + fileDiff('b.ts', `+${'b'.repeat(400)}`);
  const r = budgetDiff(d, 600);
  assert.equal(r.truncated, true);
  assert.ok(r.text.includes('a/a.ts'), 'the first file survives whole');
  assert.equal(r.text.includes('a/b.ts'), false, 'the second is dropped whole, not mid-hunk');
  assert.equal(r.text.length + r.droppedChars, d.length, 'droppedChars is honest about the remainder');
  assert.ok(d.slice(r.text.length).startsWith('\ndiff --git '), 'the cut lands exactly on the file boundary');
});

check('a single file bigger than the whole budget is cut hard rather than emptied', () => {
  // The boundary is only worth honouring if it is not in the first half of the
  // budget — otherwise "cut at a file boundary" means "send almost nothing".
  const d = fileDiff('huge.ts', `+${'x'.repeat(5_000)}`);
  const r = budgetDiff(d, 1_000);
  assert.equal(r.truncated, true);
  assert.equal(r.text.length, 1_000);
  assert.ok(r.text.includes('a/huge.ts'), 'the file that changed is still named in what is sent');
});

// --- what comes back ----------------------------------------------------------

check('a bare JSON reply is parsed', () => {
  assert.deepEqual(extractJson('{"summary":"ok","findings":[]}'), { summary: 'ok', findings: [] });
});

check('a fenced reply is parsed, with or without the language tag', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('```\n{"a":2}\n```'), { a: 2 });
});

check('prose wrapped around the object does not lose the object', () => {
  // The failure this prevents: a chatty reply extracts as null, null is read as
  // "no findings", and a review that found something reports clean.
  const r = extractJson('Sure! Here is the review:\n{"findings":[{"severity":"blocking"}]}\nHope that helps.');
  assert.deepEqual(r, { findings: [{ severity: 'blocking' }] });
});

check('an unparseable reply is null — never a silently empty result object', () => {
  assert.equal(extractJson(''), null);
  assert.equal(extractJson(null), null);
  assert.equal(extractJson('no object here at all'), null);
  assert.equal(extractJson('{ not: json, at: all '), null, 'an unclosed object is not half-accepted');
});

// --- the exit code ------------------------------------------------------------

check('one blocking finding is exit 1; notes and an empty list are exit 0', () => {
  assert.equal(verdictFor([]), 0);
  assert.equal(verdictFor([{ severity: 'note' }, { severity: 'note' }]), 0);
  assert.equal(verdictFor([{ severity: 'note' }, { severity: 'blocking' }]), 1);
  assert.equal(verdictFor([null, undefined, { severity: 'blocking' }]), 1, 'a malformed entry must not throw');
});

check('the rendered comment says clean only when the finding list is empty', () => {
  const clean = renderMarkdown({ backend: 'cli', model: null, summary: '', findings: [], truncated: false });
  assert.match(clean, /No finding\./);
  const found = renderMarkdown({
    backend: 'api',
    model: 'm',
    summary: 'One problem.',
    findings: [{ severity: 'blocking', file: 'a.ts', line: 3, finding: 'boom', category: 'correctness' }],
    truncated: true,
  });
  assert.equal(/No finding\./.test(found), false);
  assert.match(found, /1 blocking · 0 to note/);
  assert.match(found, /`a\.ts:3`/);
  assert.match(found, /partial diff/, 'a truncated diff is disclosed in the comment, not hidden');
});

check('the CLI flags are read, and the defaults are the safe ones', () => {
  const a = parseArgs(['--base', 'main', '--head', 'HEAD~1', '--out', 'r.md', '--json']);
  assert.equal(a.base, 'main');
  assert.equal(a.head, 'HEAD~1');
  assert.equal(a.out, 'r.md');
  assert.equal(a.json, true);
  assert.equal(parseArgs([]).head, 'HEAD');
  assert.equal(parseArgs([]).base, null);
});

// --- the rubric the reviewer is judged against --------------------------------

check('a `## Heading` section is pulled out whole and stops at the next one', () => {
  const md = '# Doc\n\n## First\nalpha\nbeta\n\n## Second\ngamma\n';
  assert.equal(section(md, 'First'), '## First\nalpha\nbeta');
  assert.equal(section(md, 'Second'), '## Second\ngamma');
});

check('the heading match is case-insensitive and prefix-based, and misses return empty', () => {
  const md = '## Design system — dual theme (read the doc)\nbody\n';
  assert.match(section(md, 'design system'), /body/);
  assert.equal(section(md, 'Nothing Like This'), '');
  assert.equal(section('', 'First'), '');
});

check('a deeper heading does not end a section', () => {
  const md = '## Outer\na\n### Inner\nb\n## Next\nc\n';
  assert.equal(section(md, 'Outer'), '## Outer\na\n### Inner\nb');
});

check('the real constitution still yields the sections the rubric is built from', () => {
  // The drift this catches: the rubric names three headings of `.claude/CLAUDE.md`.
  // Rename one and the reviewer quietly stops being told this project's rules —
  // no error, no red build, just a generic reviewer behind a specific name.
  const claude = readIfPresent('.claude/CLAUDE.md');
  assert.ok(claude, '.claude/CLAUDE.md is readable from the repo root');
  for (const heading of ['Important Conventions', 'Design system', 'Documentation Sync']) {
    assert.ok(section(claude, heading).length > 200, `${heading} is still a real section of .claude/CLAUDE.md`);
  }
});

check('every ADR is summarised with an id, a title and a status', () => {
  const adrs = adrSummaries();
  assert.ok(adrs.length > 0, 'there are decision records to summarise');
  const dir = path.join(REPO_ROOT, 'docs/architecture/decisions');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md');
  assert.equal(adrs.length, files.length, 'README.md is the index, not a record');
  for (const a of adrs) {
    assert.match(a.id, /^\d{4}$/, `${a.file} has a four-digit id in its front matter`);
    assert.notEqual(a.title, a.file, `${a.file} has a title, not a filename fallback`);
    assert.notEqual(a.status, 'unknown', `${a.file} declares a status`);
    assert.ok(fs.existsSync(path.join(REPO_ROOT, a.file)), `${a.file} exists at the path the rubric cites`);
  }
});

check('a missing decisions directory is an empty list, never a throw', () => {
  assert.deepEqual(adrSummaries('docs/architecture/decisions-that-do-not-exist'), []);
  assert.equal(readIfPresent('no/such/file.md'), '', 'a rubric source is never load-bearing');
});

console.log(`\n${passed} checks passed.`);
