#!/usr/bin/env node
// Fixtures for the committed-credential scanner. No deps — run with:
//   node scripts/security/__tests__/secret-scan.test.mjs
//
// Two things are being pinned here and they fail in opposite directions.
//
// EVERY PATTERN FIRES. A credential table is the easiest thing in a repository
// to get subtly wrong — one quantifier off and a row matches nothing, forever,
// while the gate goes on reporting "clean". Each row below has a literal of its
// real shape, and each of those literals is inert: this directory is on
// SECRET_EXEMPT precisely because it has to hold them.
//
// AND THE REAL TREE IS CLEAN. The last case runs the scanner over what git
// actually tracks. It is what makes the gate a measurement rather than a claim —
// and it is what would catch a new pattern that is right in principle and wrong
// against this repository (the reason Polar's `polar_whs_…` shape is documented
// as a gap in secret-scan.mjs rather than added to the table).
import assert from 'node:assert/strict';
import {
  BINARY_RE,
  MAX_BYTES,
  SECRET_PATTERNS,
  firstSecretIn,
  isExempt,
  render,
  scanFiles,
  scanText,
  trackedFiles,
} from '../secret-scan.mjs';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

/** An inert literal of each shape. Keyed by pattern id, so a NEW row with no
 *  fixture fails the coverage case below rather than shipping unexercised. */
const SAMPLES = {
  anthropic: 'const k = "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx";',
  'openai-project': 'OPENAI_API_KEY=sk-proj-AbCdEfGhIjKlMnOpQrStUvWx',
  'openai-legacy': 'const k = "sk-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKL";',
  openrouter: 'key: "sk-or-v1-0123456789abcdef0123456789abcdef"',
  elevenlabs: 'ELEVENLABS_API_KEY=sk_0123456789abcdef0123456789abcdef01234567',
  google: 'const k = "AIzaSyA1234567890123456789012345678901234";',
  'gcp-service-account': '  "type": "service_account",',
  aws: 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
  github: 'token: ghp_0123456789abcdefghij0123456789abcdef',
  'github-fine-grained': `token: github_pat_${'A'.repeat(70)}`,
  npm: '//registry.npmjs.org/:_authToken=npm_0123456789abcdefghij0123456789abcdef',
  slack: 'SLACK_BOT_TOKEN=xoxb-123456789012-abcdefghijkl',
  'private-key': '-----BEGIN RSA PRIVATE KEY-----',
};

// --- the table --------------------------------------------------------------
check('every pattern has a fixture, and every fixture has a pattern', () => {
  const ids = SECRET_PATTERNS.map((p) => p.id);
  assert.deepEqual([...ids].sort(), Object.keys(SAMPLES).sort());
  assert.equal(new Set(ids).size, ids.length, 'duplicate pattern id');
});

for (const [id, line] of Object.entries(SAMPLES)) {
  check(`${id}: the shape fires`, () => {
    const hit = firstSecretIn(line);
    assert.ok(hit, `${id} matched nothing — the row is decoration`);
    assert.equal(hit.id, id, `${id} was claimed by ${hit.id}`);
  });
}

check('a line reports ONCE, not once per overlapping rule', () => {
  const f = scanText('app/_lib/a.ts', SAMPLES.anthropic);
  assert.equal(f.length, 1);
});

// The whole reason bare prefixes and entropy heuristics are absent: a rule that
// cries wolf gets disabled, and then it protects nothing.
check('near-misses do not fire', () => {
  for (const line of [
    'const id = "sk-task-42";',
    'assert.equal(redact("sk-ant-api03-AbC123_def-XYZ"), "sk-ant-***");', // too short
    'const stage = "sk_offer";',
    'import { AIzaHelper } from "./x";',
    'const c = "AKIA" + suffix;',
    '-----BEGIN PUBLIC KEY-----',
    'npm_config_cache=/tmp/npm',
  ]) {
    assert.equal(firstSecretIn(line), null, `false positive on: ${line}`);
  }
});

// --- exemptions -------------------------------------------------------------
check('the paths where a key SHAPE is the point are exempt', () => {
  for (const p of [
    '.env.example',
    'docs/architecture/llm.md',
    'README.md',
    'packages/voice-tts/README.md',
    'scripts/security/secret-scan.mjs',
    'scripts/security/__tests__/secret-scan.test.mjs',
    'scripts/review/__tests__/constitution-check.test.mjs',
  ]) {
    assert.equal(isExempt(p), true, `${p} should be exempt`);
    assert.deepEqual(scanText(p, SAMPLES.google), []);
  }
});

// Narrow and named, not a general "tests are exempt" hole — that hole is exactly
// where an agent's fixture key would live.
check('a key in an ORDINARY test file still blocks', () => {
  assert.equal(isExempt('app/_lib/billing/webhook.test.ts'), false);
  assert.equal(scanText('app/_lib/billing/webhook.test.ts', SAMPLES.aws).length, 1);
  assert.equal(isExempt('e2e/journey.spec.ts'), false);
  assert.equal(isExempt('docs-site/app/page.tsx'), false); // `docs/` is a directory, not a prefix
});

// --- reading files ----------------------------------------------------------
check('line numbers are 1-based and survive CRLF', () => {
  const f = scanText('app/a.ts', `const a = 1;\r\n${SAMPLES.google}\r\nconst b = 2;`);
  assert.deepEqual(
    f.map((x) => [x.line, x.id]),
    [[2, 'google']],
  );
});

check('binary and oversize files are skipped — and the skip is COUNTED, not silent', () => {
  const files = ['app/a.ts', 'public/logo.png', 'data/big.json', '.env.example'];
  const read = (p) => (p === 'data/big.json' ? { skip: '4096 KB' } : { text: SAMPLES.slack });
  const r = scanFiles(files, { read });
  assert.equal(r.scanned, 1, 'only app/a.ts is readable text outside the exempt set');
  assert.equal(r.findings.length, 1);
  assert.deepEqual(
    r.skipped.map((s) => s.file),
    ['data/big.json'],
  );
  assert.match(render(r), /not read: data\/big\.json/);
  assert.ok(BINARY_RE.test('public/logo.png'));
  assert.ok(!BINARY_RE.test('app/a.ts'));
  assert.ok(MAX_BYTES > 0);
});

check('a tracked path that is not on disk is skipped rather than crashing the gate', () => {
  const read = () => {
    throw new Error('ENOENT');
  };
  assert.deepEqual(scanFiles(['app/gone.ts'], { read }), { findings: [], scanned: 0, skipped: [] });
});

check('the report names rotation, because deleting the line does not undo the leak', () => {
  const r = scanFiles(['app/a.ts'], { read: () => ({ text: SAMPLES.github }) });
  const text = render(r);
  assert.match(text, /ROTATE THE CREDENTIAL/);
  assert.match(text, /app\/a\.ts:1/);
  assert.match(render({ findings: [], scanned: 12, skipped: [] }), /no committed credential in 12/);
});

// --- the coupling: this runs against the real repository --------------------
check('no tracked file in THIS repository carries a credential', () => {
  const files = trackedFiles();
  assert.ok(files.length > 100, `git listed ${files.length} tracked files — the scan would be vacuous`);
  const { findings } = scanFiles(files);
  assert.deepEqual(
    findings.map((f) => `${f.file}:${f.line} [${f.id}]`),
    [],
  );
});

console.log(`\n${passed} checks passed.`);
