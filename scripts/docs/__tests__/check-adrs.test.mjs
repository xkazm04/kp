#!/usr/bin/env node
// Fixtures for the ADR integrity gate. No deps — run with:
//   node scripts/docs/__tests__/check-adrs.test.mjs
//
// The last block runs the validator against the REAL docs/architecture/decisions
// tree, so these fixtures also certify that the committed records are valid.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADR_DIR, parseFrontMatter, parseIndexRows, validate } from '../check-adrs.mjs';
import { DISMISS_RE, parseArgs, resolveRange } from '../check-doc-sync-diff.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const ALWAYS = () => true;
const NEVER = () => false;

function adr(overrides = {}) {
  const fm = {
    id: '"0001"',
    title: 'A decision',
    status: 'accepted',
    date: '2026-08-26',
    supersedes: '[]',
    'superseded-by': 'null',
    tags: '[a, b]',
    ...overrides,
  };
  const lines = Object.entries(fm)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join('\n')}\nsources:\n  - a.ts\n  - b.ts\n---\n\n# A decision\n`;
}

const INDEX = (rows) =>
  ['| ADR | Title | Status | Date |', '| --- | --- | --- | --- |', ...rows].join('\n');
const row = (id, file, title, status, date = '2026-08-26') => `| [${id}](${file}) | ${title} | ${status} | ${date} |`;

// --- front matter -----------------------------------------------------------
check('parses scalars, inline lists and block lists', () => {
  const { data, error } = parseFrontMatter(adr());
  assert.equal(error, null);
  assert.equal(data.id, '0001');
  assert.equal(data.title, 'A decision');
  assert.deepEqual(data.tags, ['a', 'b']);
  assert.deepEqual(data.supersedes, []);
  assert.equal(data['superseded-by'], null);
  assert.deepEqual(data.sources, ['a.ts', 'b.ts']);
});

check('a file with no front matter is an error, not an empty object', () => {
  const { data, error } = parseFrontMatter('# Just a heading\n');
  assert.equal(data, null);
  assert.match(error, /no front matter/);
});

check('unclosed front matter is an error', () => {
  const { error } = parseFrontMatter('---\nid: "0001"\n\n# body\n');
  assert.match(error, /never closed/);
});

check('an unparsable line is reported rather than guessed at', () => {
  const { error } = parseFrontMatter('---\nid: "0001"\nthis is not yaml\n---\n');
  assert.match(error, /unparsable front-matter line/);
});

// --- index table ------------------------------------------------------------
check('index rows parse; prose links are not mistaken for rows', () => {
  const readme = [
    '- swap the framework -> [0001](0001-a.md)',
    INDEX([row('0001', '0001-a.md', 'A decision', 'accepted')]),
  ].join('\n');
  const rows = parseIndexRows(readme);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    id: '0001',
    file: '0001-a.md',
    title: 'A decision',
    status: 'accepted',
    date: '2026-08-26',
  });
});

// --- validation -------------------------------------------------------------
check('a well-formed record with an accurate index passes', () => {
  const { problems } = validate(
    [{ file: '0001-a.md', text: adr() }],
    INDEX([row('0001', '0001-a.md', 'A decision', 'accepted')]),
    ALWAYS,
  );
  assert.deepEqual(problems, []);
});

check('a missing sources path fails — this is the drift check', () => {
  const { problems } = validate(
    [{ file: '0001-a.md', text: adr() }],
    INDEX([row('0001', '0001-a.md', 'A decision', 'accepted')]),
    NEVER,
  );
  assert.equal(problems.length, 2, problems.join('\n'));
  assert.ok(problems.every((p) => /does not exist/.test(p)));
});

check('the filename must carry the id', () => {
  const { problems } = validate(
    [{ file: '0002-a.md', text: adr() }],
    INDEX([row('0001', '0002-a.md', 'A decision', 'accepted')]),
    ALWAYS,
  );
  assert.ok(problems.some((p) => /filename must start with the id/.test(p)));
});

check('an off-vocabulary status fails', () => {
  const { problems } = validate(
    [{ file: '0001-a.md', text: adr({ status: 'final' }) }],
    INDEX([row('0001', '0001-a.md', 'A decision', 'final')]),
    ALWAYS,
  );
  assert.ok(problems.some((p) => /is not one of/.test(p)));
});

check('a non-ISO date fails', () => {
  const { problems } = validate(
    [{ file: '0001-a.md', text: adr({ date: 'Aug 2026' }) }],
    INDEX([row('0001', '0001-a.md', 'A decision', 'accepted', 'Aug 2026')]),
    ALWAYS,
  );
  assert.ok(problems.some((p) => /ISO YYYY-MM-DD/.test(p)));
});

check('a record absent from the index fails', () => {
  const { problems } = validate([{ file: '0001-a.md', text: adr() }], INDEX([]), ALWAYS);
  assert.ok(problems.some((p) => /index has no row for 0001/.test(p)));
});

check('an index row with no record fails', () => {
  const { problems } = validate(
    [{ file: '0001-a.md', text: adr() }],
    INDEX([
      row('0001', '0001-a.md', 'A decision', 'accepted'),
      row('0009', '0009-ghost.md', 'Ghost', 'accepted'),
    ]),
    ALWAYS,
  );
  assert.ok(problems.some((p) => /index row 0009 has no matching record/.test(p)));
});

check('an index title that drifted from the record fails', () => {
  const { problems } = validate(
    [{ file: '0001-a.md', text: adr() }],
    INDEX([row('0001', '0001-a.md', 'Something else', 'accepted')]),
    ALWAYS,
  );
  assert.ok(problems.some((p) => /title .* != record title/.test(p)));
});

check('supersede links must be reciprocal', () => {
  const one = adr({ id: '"0001"', status: 'superseded', 'superseded-by': '"0002"' });
  const twoBroken = adr({ id: '"0002"', title: 'Replacement' });
  const { problems } = validate(
    [
      { file: '0001-a.md', text: one },
      { file: '0002-b.md', text: twoBroken },
    ],
    INDEX([
      row('0001', '0001-a.md', 'A decision', 'superseded'),
      row('0002', '0002-b.md', 'Replacement', 'accepted'),
    ]),
    ALWAYS,
  );
  assert.ok(problems.some((p) => /does not list 0001 in supersedes/.test(p)));
});

check('a reciprocal supersede pair passes', () => {
  const one = adr({ id: '"0001"', status: 'superseded', 'superseded-by': '"0002"' });
  const two = adr({ id: '"0002"', title: 'Replacement', supersedes: '[0001]' });
  const { problems } = validate(
    [
      { file: '0001-a.md', text: one },
      { file: '0002-b.md', text: two },
    ],
    INDEX([
      row('0001', '0001-a.md', 'A decision', 'superseded'),
      row('0002', '0002-b.md', 'Replacement', 'accepted'),
    ]),
    ALWAYS,
  );
  assert.deepEqual(problems, []);
});

check('superseded-by without the superseded status fails', () => {
  const { problems } = validate(
    [{ file: '0001-a.md', text: adr({ 'superseded-by': '"0002"' }) }],
    INDEX([row('0001', '0001-a.md', 'A decision', 'accepted')]),
    ALWAYS,
  );
  assert.ok(problems.some((p) => /superseded-by is set/.test(p)));
});

check('duplicate ids fail', () => {
  const { problems } = validate(
    [
      { file: '0001-a.md', text: adr() },
      { file: '0001-b.md', text: adr({ title: 'Twin' }) },
    ],
    INDEX([row('0001', '0001-a.md', 'A decision', 'accepted')]),
    ALWAYS,
  );
  assert.ok(problems.some((p) => /duplicate ADR id 0001/.test(p)));
});

// --- doc-sync diff helpers --------------------------------------------------
check('diff args parse', () => {
  assert.deepEqual(parseArgs(['--base', 'origin/main', '--head', 'HEAD']), {
    base: 'origin/main',
    head: 'HEAD',
  });
  assert.deepEqual(parseArgs([]), { base: null, head: 'HEAD' });
});

check('an unresolvable base falls back to the parent commit', () => {
  assert.deepEqual(resolveRange({ base: 'origin/main', head: 'HEAD' }, () => false), {
    base: 'HEAD~1',
    head: 'HEAD',
  });
  assert.deepEqual(resolveRange({ base: 'origin/main', head: 'HEAD' }, () => true), {
    base: 'origin/main',
    head: 'HEAD',
  });
});

check('the dismissal trailer is recognised anywhere in a commit body', () => {
  const body = 'feat(x): thing\n\nSome prose.\n\nDoc-sync: internal-only — extracted a helper\n';
  const m = body.match(DISMISS_RE);
  assert.ok(m);
  assert.match(m[1], /internal-only/);
  assert.equal('feat(x): thing\n\nno trailer here\n'.match(DISMISS_RE), null);
});

// --- the real tree ----------------------------------------------------------
check('real ADR tree: every record is valid and the index agrees', () => {
  const dir = path.join(REPO_ROOT, ADR_DIR);
  assert.ok(fs.existsSync(dir), `${ADR_DIR} is missing`);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md').sort();
  assert.ok(files.length > 0, 'no decision records found');
  const records = files.map((file) => ({ file, text: fs.readFileSync(path.join(dir, file), 'utf8') }));
  const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
  const { problems } = validate(records, readme, (p) => fs.existsSync(path.join(REPO_ROOT, p)));
  assert.deepEqual(problems, [], `\n${problems.join('\n')}`);
});

console.log(`\n${passed} checks passed.`);
