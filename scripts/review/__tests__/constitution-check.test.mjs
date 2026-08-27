#!/usr/bin/env node
// Fixtures for the deterministic review lens. No deps — run with:
//   node scripts/review/__tests__/constitution-check.test.mjs
//
// Every case is a real unified diff fragment, because the failure mode this
// suite exists to prevent is a rule that reads well and never fires.
import assert from 'node:assert/strict';
import { parseDiff } from '../diff.mjs';
import {
  EXEMPTION_RE,
  allowlistCovers,
  parseArgs,
  render,
  runRules,
  skipBaselineChange,
} from '../constitution-check.mjs';
import { budgetDiff, extractJson, renderMarkdown } from '../agent-review.mjs';
import { adrSummaries, section } from '../rubric.mjs';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

/** Build a one-file unified diff. `added`/`removed` are arrays of line text. */
function diff({ path: p, added = [], removed = [], isNew = false, isDeleted = false }) {
  const head = [`diff --git a/${p} b/${p}`];
  if (isNew) head.push('new file mode 100644', '--- /dev/null', `+++ b/${p}`);
  else if (isDeleted) head.push('deleted file mode 100644', `--- a/${p}`, '+++ /dev/null');
  else head.push(`--- a/${p}`, `+++ b/${p}`);
  head.push(`@@ -1,${Math.max(removed.length, 1)} +1,${Math.max(added.length, 1)} @@`);
  return [...head, ...removed.map((l) => `-${l}`), ...added.map((l) => `+${l}`)].join('\n');
}

const rules = (text, ctx) => {
  const files = parseDiff(text);
  return runRules(files, { changedPaths: [...files.keys()], ...ctx });
};
const has = (findings, rule) => findings.some((f) => f.rule === rule);
const sev = (findings, rule) => findings.find((f) => f.rule === rule)?.severity;

// --- diff parsing -----------------------------------------------------------
check('added lines carry NEW-file line numbers', () => {
  const files = parseDiff(
    ['diff --git a/x.ts b/x.ts', '--- a/x.ts', '+++ b/x.ts', '@@ -10,2 +10,3 @@', ' keep', '+one', '+two'].join('\n'),
  );
  const f = files.get('x.ts');
  assert.deepEqual(
    f.added.map((a) => [a.line, a.text]),
    [
      [11, 'one'],
      [12, 'two'],
    ],
  );
});

check('a new file is flagged as new', () => {
  const f = parseDiff(diff({ path: 'app/api/x/route.ts', added: ['export {}'], isNew: true }));
  assert.equal(f.get('app/api/x/route.ts').isNew, true);
});

check('a deleted file keeps its old path and is flagged deleted', () => {
  const f = parseDiff(diff({ path: 'app/a.test.ts', removed: ['old'], isDeleted: true }));
  assert.equal(f.get('app/a.test.ts').isDeleted, true);
});

check('removed lines carry OLD-file line numbers', () => {
  const files = parseDiff(
    ['diff --git a/x.ts b/x.ts', '--- a/x.ts', '+++ b/x.ts', '@@ -7,2 +7,1 @@', '-gone', ' keep'].join('\n'),
  );
  assert.deepEqual(files.get('x.ts').removed[0], { line: 7, text: 'gone' });
});

// --- gate-weakening rules ---------------------------------------------------
check('.only in a test file blocks', () => {
  const f = rules(diff({ path: 'app/_lib/a.test.ts', added: ['it.only("x", () => {});'] }));
  assert.equal(sev(f, 'test-only'), 'blocking');
});

check('.only in NON-test source does not fire', () => {
  const f = rules(diff({ path: 'app/_lib/a.ts', added: ['const s = "describe.only(";'] }));
  assert.ok(!has(f, 'test-only'));
});

check('a newly skipped JS test blocks', () => {
  const f = rules(diff({ path: 'app/_lib/a.test.ts', added: ['describe.skip("later", () => {});'] }));
  assert.equal(sev(f, 'test-skip'), 'blocking');
});

check('a newly skipped Python test blocks', () => {
  const f = rules(diff({ path: 'pipeline/jobfit/tests/test_x.py', added: ['@unittest.skip("flaky")'] }));
  assert.equal(sev(f, 'test-skip'), 'blocking');
});

// Prose describing the rules is not a violation of them. docs/development/change-review.md
// is the rule table in words: its `test-skip` row contains a literal `@unittest.skip` and its
// `suppression` row contains `eslint-disable`. On its first run this check blocked the very
// commit that introduced its own documentation — the same self-reference SELF_RE already
// guards for scripts/review/.
check('a markdown file DESCRIBING a skipped test does not block', () => {
  const f = rules(diff({ path: 'docs/development/change-review.md', added: ['| `test-skip` | blocking | a new `@unittest.skip` |'] }));
  assert.ok(!has(f, 'test-skip'));
});

check('a markdown file DESCRIBING a suppression does not note', () => {
  const f = rules(diff({ path: 'docs/x.md', added: ['A new `eslint-disable` is a note, never a block.'] }));
  assert.ok(!has(f, 'suppression'));
});

check('a real skip in code still blocks after the prose carve-out', () => {
  const f = rules(diff({ path: 'pipeline/jobfit/tests/test_y.py', added: ['@unittest.skip("flaky")'] }));
  assert.equal(sev(f, 'test-skip'), 'blocking');
});

check('deleting a test file blocks', () => {
  const f = rules(diff({ path: 'app/_lib/a.test.ts', removed: ['it("x", () => {});'], isDeleted: true }));
  assert.equal(sev(f, 'test-deletion'), 'blocking');
});

check('deleting ordinary source does not fire the test rule', () => {
  const f = rules(diff({ path: 'app/_lib/a.ts', removed: ['export const a = 1;'], isDeleted: true }));
  assert.ok(!has(f, 'test-deletion'));
});

check('a suppression directive is a note, not a block', () => {
  const f = rules(diff({ path: 'app/_lib/a.ts', added: ['// eslint-disable-next-line no-console'] }));
  assert.equal(sev(f, 'suppression'), 'warn');
});

check('a @ts-expect-error is a note', () => {
  const f = rules(diff({ path: 'app/_lib/a.ts', added: ['// @ts-expect-error narrowing'] }));
  assert.equal(sev(f, 'suppression'), 'warn');
});

check('this directory does not report its own rule table', () => {
  const f = rules(diff({ path: 'scripts/review/constitution-check.mjs', added: ['{ re: /eslint-disable/ }'] }));
  assert.ok(!has(f, 'suppression'));
});

// --- secrets ----------------------------------------------------------------
check('a structured API key blocks', () => {
  const f = rules(diff({ path: 'app/_lib/a.ts', added: ['const k = "AIzaSyA1234567890123456789012345678901234";'] }));
  assert.equal(sev(f, 'secret'), 'blocking');
});

check('.env.example may show key SHAPES', () => {
  const f = rules(diff({ path: '.env.example', added: ['GEMINI_API_KEY=AIzaSyA1234567890123456789012345678901234'] }));
  assert.ok(!has(f, 'secret'));
});

check('a bare "sk-" prefix does not fire — a rule that cries wolf gets disabled', () => {
  const f = rules(diff({ path: 'app/_lib/a.ts', added: ['const id = "sk-task-42";'] }));
  assert.ok(!has(f, 'secret'));
});

// --- tenancy ----------------------------------------------------------------
check('a new table without the tenancy manifest blocks', () => {
  const f = rules(diff({ path: 'app/_lib/db/core.ts', added: ['  CREATE TABLE IF NOT EXISTS widgets ('] }));
  assert.equal(sev(f, 'tenancy-manifest'), 'blocking');
});

check('a new table WITH the manifest touched passes', () => {
  const text = [
    diff({ path: 'app/_lib/db/core.ts', added: ['  CREATE TABLE widgets ('] }),
    diff({ path: 'app/_lib/tenancy.ts', added: ['  "widgets",'] }),
  ].join('\n');
  assert.ok(!has(rules(text), 'tenancy-manifest'));
});

check('a temp table in a test does not fire', () => {
  const f = rules(diff({ path: 'app/_lib/db/core.test.ts', added: ['db.exec("CREATE TABLE tmp (id)");'] }));
  assert.ok(!has(f, 'tenancy-manifest'));
});

check('the Worker schema is not the app database', () => {
  const f = rules(diff({ path: 'edge/schema.sql', added: ['CREATE TABLE outbox (id TEXT);'] }));
  assert.ok(!has(f, 'tenancy-manifest'));
});

// --- route auth posture -----------------------------------------------------
const ROUTES_SRC = `
export const PUBLIC_API_PREFIXES = [
  "/api/auth/",
  "/api/apply/",
];
`;

check('a new gated route with requireOperator passes', () => {
  const f = rules(
    diff({ path: 'app/api/widgets/route.ts', added: ['import { requireOperator } from "@/app/_lib/auth/require-operator";'], isNew: true }),
    { publicRoutesSource: ROUTES_SRC },
  );
  assert.ok(!has(f, 'route-auth-posture'));
});

check('a new route with neither guard nor allowlist blocks', () => {
  const f = rules(
    diff({ path: 'app/api/widgets/route.ts', added: ['export async function GET() { return Response.json({}); }'], isNew: true }),
    { publicRoutesSource: ROUTES_SRC },
  );
  assert.equal(sev(f, 'route-auth-posture'), 'blocking');
});

check('a new route under an allowlisted prefix is public by declaration', () => {
  const f = rules(
    diff({ path: 'app/api/apply/[id]/route.ts', added: ['export async function POST() {}'], isNew: true }),
    { publicRoutesSource: ROUTES_SRC },
  );
  assert.ok(!has(f, 'route-auth-posture'));
  assert.equal(sev(f, 'open-route-rate-limit'), 'warn'); // …but it should be limited
});

check('an allowlisted route that DOES rate-limit gets no note', () => {
  const f = rules(
    diff({ path: 'app/api/apply/[id]/route.ts', added: ['await rateLimit(req, "apply");'], isNew: true }),
    { publicRoutesSource: ROUTES_SRC },
  );
  assert.ok(!has(f, 'open-route-rate-limit'));
});

check('a [token] route is a capability surface, not an unstated posture', () => {
  const f = rules(
    diff({ path: 'app/api/schedule/[token]/route.ts', added: ['export async function GET() {}'], isNew: true }),
    { publicRoutesSource: ROUTES_SRC },
  );
  assert.ok(!has(f, 'route-auth-posture'));
});

check('an EDITED (not new) route is not re-litigated', () => {
  const f = rules(
    diff({ path: 'app/api/widgets/route.ts', added: ['  const x = 1;'] }),
    { publicRoutesSource: ROUTES_SRC },
  );
  assert.ok(!has(f, 'route-auth-posture'));
});

check('allowlistCovers matches by prefix and exact path', () => {
  assert.equal(allowlistCovers(ROUTES_SRC, 'app/api/apply/[id]/route.ts'), true);
  assert.equal(allowlistCovers(ROUTES_SRC, 'app/api/auth/route.ts'), true);
  assert.equal(allowlistCovers(ROUTES_SRC, 'app/api/widgets/route.ts'), false);
  assert.equal(allowlistCovers('', 'app/api/apply/x/route.ts'), false);
});

// --- skip baseline ----------------------------------------------------------
check('raising KP_SKIP_BASELINE blocks', () => {
  const text = diff({
    path: '.github/workflows/ci.yml',
    removed: ['          KP_SKIP_BASELINE: "5"'],
    added: ['          KP_SKIP_BASELINE: "7"'],
  });
  const f = rules(text);
  assert.equal(sev(f, 'skip-baseline-raised'), 'blocking');
  assert.deepEqual(
    (({ from, to }) => ({ from, to }))(skipBaselineChange(parseDiff(text))),
    { from: 5, to: 7 },
  );
});

check('LOWERING the baseline is a repair, not a violation', () => {
  const f = rules(
    diff({
      path: '.github/workflows/ci.yml',
      removed: ['          KP_SKIP_BASELINE: "5"'],
      added: ['          KP_SKIP_BASELINE: "4"'],
    }),
  );
  assert.ok(!has(f, 'skip-baseline-raised'));
});

// --- gate machinery ---------------------------------------------------------
check('editing gate machinery is always surfaced, never blocking', () => {
  const f = rules(diff({ path: 'eslint.config.mjs', added: ['  rules: {},'] }));
  assert.equal(sev(f, 'gate-configuration'), 'warn');
});

check('ordinary source does not trip the gate-machinery rule', () => {
  const f = rules(diff({ path: 'app/_lib/a.ts', added: ['const x = 1;'] }));
  assert.ok(!has(f, 'gate-configuration'));
});

// --- rendering and the exemption --------------------------------------------
check('a clean diff renders as clean and does not block', () => {
  const { text, blocked } = render([], null);
  assert.equal(blocked, false);
  assert.match(text, /no finding/);
});

check('a blocking finding blocks; the trailer waives it ON THE RECORD', () => {
  const findings = rules(diff({ path: 'app/_lib/a.test.ts', added: ['it.only("x", () => {});'] }));
  assert.equal(render(findings, null).blocked, true);
  const waived = render(findings, ' the fixture is unavailable in CI ');
  assert.equal(waived.blocked, false);
  assert.match(waived.text, /waived by commit trailer/);
});

check('warnings alone never block', () => {
  const findings = rules(diff({ path: 'app/_lib/a.ts', added: ['// eslint-disable-next-line x'] }));
  assert.equal(render(findings, null).blocked, false);
});

check('the exemption trailer is found anywhere in a commit body', () => {
  assert.match('feat: x\n\nGate-exemption: live-only smoke\n'.match(EXEMPTION_RE)[1], /live-only/);
  assert.equal('feat: x\n\nnothing here\n'.match(EXEMPTION_RE), null);
});

check('cli args parse', () => {
  assert.deepEqual(parseArgs(['--base', 'main', '--json']), { base: 'main', head: 'HEAD', json: true });
});

// --- the judgement lens's pure parts ---------------------------------------
check('a small diff is passed through whole', () => {
  const d = 'diff --git a/x b/x\n+one\n';
  assert.deepEqual(budgetDiff(d, 1000), { text: d, truncated: false, droppedChars: 0 });
});

check('an oversized diff is cut at a file boundary and reports the drop', () => {
  const big = `diff --git a/a b/a\n${'+x\n'.repeat(200)}diff --git a/b b/b\n${'+y\n'.repeat(200)}`;
  const r = budgetDiff(big, 500);
  assert.equal(r.truncated, true);
  assert.ok(r.droppedChars > 0);
  assert.ok(!r.text.includes('+y'));
});

check('fenced, bare and prose-wrapped JSON replies all parse', () => {
  assert.deepEqual(extractJson('```json\n{"findings":[]}\n```'), { findings: [] });
  assert.deepEqual(extractJson('{"findings":[]}'), { findings: [] });
  assert.deepEqual(extractJson('Here you go:\n{"findings":[]}\nHope that helps.'), { findings: [] });
  assert.equal(extractJson('no json at all'), null);
});

check('review markdown separates blocking from notes', () => {
  const md = renderMarkdown({
    backend: 'Anthropic API',
    model: 'claude-sonnet-5',
    summary: 'Adds a widget.',
    findings: [
      { severity: 'blocking', category: 'reversed-decision', file: 'a.ts', line: 3, rule: 'ADR 0002', finding: 'Swaps SQLite for an ORM.', why: 'breaks the single-file backup story' },
      { severity: 'note', category: 'scope', file: 'b.ts', line: 9, finding: 'Unrelated rename.' },
    ],
  });
  assert.match(md, /1 blocking · 1 to note/);
  assert.ok(md.indexOf('ADR 0002') < md.indexOf('Unrelated rename'));
});

// --- the rubric reads the REAL repository -----------------------------------
check('rubric: section() extracts a real CLAUDE.md section', () => {
  const md = '## A\nalpha\n\n## B — long\nbeta\n\n## C\ngamma\n';
  assert.equal(section(md, 'B'), '## B — long\nbeta');
  assert.equal(section(md, 'nope'), '');
});

check('rubric: the real ADR set is discoverable and every record has an id', () => {
  const adrs = adrSummaries();
  assert.ok(adrs.length >= 1, 'no ADRs found — rubric would lose the decision list');
  for (const a of adrs) assert.match(a.id, /^\d{4}$/, `bad id in ${a.file}`);
});

console.log(`\n${passed} checks passed.`);
