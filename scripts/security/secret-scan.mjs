#!/usr/bin/env node
// Every tracked file, read for a committed credential.
//
// THE GAP THIS CLOSES. Ask the question this repository's own SECURITY.md
// implies — *an agent wrote a key into a file; what stops it reaching a
// release?* — and until this file existed the whole answer was one rule inside
// `scripts/review/constitution-check.mjs`, and that answer had three holes:
//
//   THE TABLE WAS FIVE PATTERNS.  Anthropic, OpenAI project, Google, GitHub,
//   Slack. This app also ships adapters for OpenRouter and Azure, an ElevenLabs
//   voice plane, and deploys onto clouds — an `AKIA…`, an `sk-or-v1-…`, an
//   `sk_…` ElevenLabs key or a pasted `-----BEGIN … PRIVATE KEY-----` block
//   went through untouched. The table below is the single source for both
//   readers now; the diff lens imports it rather than keeping a second copy.
//
//   IT ONLY EVER READ A DIFF.  `constitution-check` scans `base...head`, so a
//   key is seen exactly once — in the range that introduced it. A key that
//   landed before that lens existed, in a file no later pull request touches, is
//   invisible to it forever. This scans the TREE, so the answer to "is there a
//   credential in this repository" stops depending on when it arrived.
//
//   AND A COMMIT TRAILER WAVED IT THROUGH.  `Gate-exemption: <why>` downgrades
//   every blocking finding in the range. It was designed for a live-only smoke
//   test, and an agent that can write a key into a file can also write the
//   sentence that excuses it. `secret` is now un-waivable (UNWAIVABLE_RULES in
//   constitution-check.mjs): the escape hatch stays for the rules it was built
//   for, and a leaked credential is not one of them. Rotation is the fix — the
//   key is in the object database the moment the commit exists, and deleting the
//   line in the next commit does not take it back out.
//
//   npm run security:secrets           # the gate CI runs, over tracked files
//   npm run security:secrets -- --json # machine-readable findings
//
// EXIT CODES: 0 clean · 1 at least one finding, or the tree could not be
// enumerated. The second is deliberate rather than a skip: this file is the
// thing that says "no credential is committed", and it must not be able to say
// it without having looked.
//
// WHAT IT IS NOT. Entropy heuristics and bare prefixes are absent on purpose,
// for the reason the diff lens already gives: a rule that cries wolf gets
// disabled, and then it protects nothing. Every pattern here is structural
// enough that a match is worth stopping a build for, and every one of them was
// checked against the current tree before it was added.

import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, git } from '../review/diff.mjs';

/**
 * Credential shapes with enough structure that a match is worth stopping for.
 *
 * `id` is stable and is what a finding is reported as; `what` is the sentence a
 * human reads. Order matters only in that the first match on a line wins — a
 * line is reported once, not once per overlapping rule.
 *
 * KNOWN GAP, stated rather than silently absent: Polar's `polar_whs_…` webhook
 * secret has exactly the right shape for this table, and this repository takes
 * Polar webhooks. It is not here because `app/_lib/billing/webhook-verify.test.ts`
 * commits a literal of that shape as a fixture, and a rule whose first act is to
 * fail the build on an existing test is a rule that gets deleted rather than
 * obeyed. Replace that fixture with an obviously-inert string and this row can
 * be added in the same change.
 */
export const SECRET_PATTERNS = [
  { id: 'anthropic', re: /sk-ant-api\d{2}-[A-Za-z0-9_-]{20,}/, what: 'an Anthropic API key' },
  { id: 'openai-project', re: /sk-proj-[A-Za-z0-9_-]{20,}/, what: 'an OpenAI project key' },
  // The pre-`sk-proj-` OpenAI shape, still issued and still valid: `sk-` and
  // exactly 48 alphanumerics. Anchored on the length, so `sk-task-42` (the case
  // the diff lens has a fixture for) still does not fire.
  { id: 'openai-legacy', re: /sk-[A-Za-z0-9]{48}/, what: 'an OpenAI secret key' },
  { id: 'openrouter', re: /sk-or-v1-[a-f0-9]{32,}/, what: 'an OpenRouter API key' },
  { id: 'elevenlabs', re: /sk_[a-f0-9]{40,}/, what: 'an ElevenLabs API key' },
  { id: 'google', re: /AIza[0-9A-Za-z_-]{35}/, what: 'a Google API key' },
  { id: 'gcp-service-account', re: /"type"\s*:\s*"service_account"/, what: 'a GCP service-account key file' },
  { id: 'aws', re: /\bAKIA[0-9A-Z]{16}\b/, what: 'an AWS access key id' },
  { id: 'github', re: /gh[pousr]_[A-Za-z0-9]{36}/, what: 'a GitHub token' },
  { id: 'github-fine-grained', re: /github_pat_[A-Za-z0-9_]{60,}/, what: 'a fine-grained GitHub PAT' },
  { id: 'npm', re: /\bnpm_[A-Za-z0-9]{36}\b/, what: 'an npm publish token' },
  { id: 'slack', re: /xox[baprs]-[A-Za-z0-9-]{10,}/, what: 'a Slack token' },
  // Not a vendor shape — the envelope. A pasted deploy key, a JWT signing key or
  // a TLS private key all arrive inside this line.
  {
    id: 'private-key',
    re: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
    what: 'a private key block',
  },
];

/**
 * Paths where a key SHAPE is the point, not a leak.
 *
 * `.env.example` documents the shapes an operator must supply; `docs/` and
 * READMEs describe them; and the two script directories below DEFINE the table
 * above and its fixtures, so scanning them reports the rule as a violation of
 * itself. That last carve-out is the same self-reference `SELF_RE` already
 * handles for the diff lens — narrow, named, and not a general "tests are
 * exempt" hole: a key committed in `app/**/*.test.ts` is still a leaked key and
 * still blocks.
 */
export const SECRET_EXEMPT = [
  /^\.env\.example$/,
  /^docs\//,
  /(^|\/)README\.md$/,
  /^scripts\/security\//,
  /^scripts\/review\//,
];

export const isExempt = (p) => SECRET_EXEMPT.some((re) => re.test(p));

/** The first pattern this text matches, or null. One line reports once. */
export function firstSecretIn(text) {
  for (const s of SECRET_PATTERNS) if (s.re.test(text)) return s;
  return null;
}

/** `[{ file, line, id, what }]` — every credential-shaped line in one file. */
export function scanText(file, text) {
  if (isExempt(file)) return [];
  const out = [];
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const hit = firstSecretIn(lines[i]);
    if (hit) out.push({ file, line: i + 1, id: hit.id, what: hit.what });
  }
  return out;
}

// Files whose bytes are not text a credential would be pasted into. Skipped
// before they are read, so the scan stays a couple of seconds over ~2700 files.
export const BINARY_RE =
  /\.(png|jpe?g|gif|webp|avif|ico|pdf|zip|gz|tgz|bz2|xz|7z|woff2?|ttf|otf|eot|mp[34]|wav|ogg|webm|mov|sqlite|sqlite3|db|wasm|node|onnx|bin|pyc|class|jar)$/i;

// Above this, a file is a generated artefact or a data dump rather than
// something a key gets typed into. Skips are COUNTED and printed — a scanner
// that quietly stops looking is the failure this file exists to prevent.
export const MAX_BYTES = 2 * 1024 * 1024;

/**
 * The files git is tracking, repository-relative and forward-slashed.
 *
 * Tracked, not walked: the question is what is COMMITTED. A developer's real
 * `.env` sitting in the working tree is gitignored, is not a leak, and must not
 * turn this red — while `data/kp.sqlite` and `node_modules/` disappear from the
 * scan for free rather than through an ignore list that drifts.
 */
export function trackedFiles(root = REPO_ROOT) {
  return git(['ls-files', '-z'], { cwd: root })
    .split('\0')
    .filter(Boolean)
    .map((p) => p.replace(/\\/g, '/'));
}

/**
 * Scan a list of repository-relative paths.
 *
 * @returns { findings, scanned, skipped: [{ file, why }] }
 */
export function scanFiles(files, { root = REPO_ROOT, read = null } = {}) {
  const readFile =
    read ??
    ((p) => {
      const abs = path.join(root, p);
      const stat = fs.statSync(abs);
      if (stat.size > MAX_BYTES) return { skip: `${Math.round(stat.size / 1024)} KB` };
      return { text: fs.readFileSync(abs, 'utf8') };
    });

  const findings = [];
  const skipped = [];
  let scanned = 0;

  for (const file of files) {
    if (isExempt(file)) continue;
    if (BINARY_RE.test(file)) continue;
    let got;
    try {
      got = readFile(file);
    } catch {
      continue; // a path git tracks that is not on disk right now (sparse, deleted)
    }
    if (got?.skip) {
      skipped.push({ file, why: got.skip });
      continue;
    }
    scanned++;
    findings.push(...scanText(file, got.text));
  }

  return { findings, scanned, skipped };
}

export function render({ findings, scanned, skipped }) {
  // Printed on BOTH paths. A file this gate did not read is the one place a key
  // could still be sitting, so "clean" has to say what it did not look at.
  const note = skipped.length
    ? [`  ${skipped.length} file(s) over ${MAX_BYTES / 1024} KB not read: ${skipped.map((s) => s.file).join(', ')}`]
    : [];

  if (findings.length === 0) {
    return [`secret-scan: no committed credential in ${scanned} tracked text file(s).`, ...note].join('\n');
  }

  const lines = [`secret-scan: ${findings.length} finding(s) over ${scanned} tracked file(s).`, ''];
  for (const f of findings) {
    lines.push(`  ✗ [${f.id}] ${f.file}:${f.line}`);
    lines.push(`      This line looks like ${f.what}.`);
  }
  lines.push(
    '',
    '  Remove the literal AND ROTATE THE CREDENTIAL. It is in the object database from the',
    '  moment the commit exists; deleting the line in the next commit does not take it back.',
    '  If the shape is genuinely an example, the place for it is .env.example or docs/ —',
    '  both already exempt — not an exception added to SECRET_EXEMPT to make this pass.',
    ...note,
  );
  return lines.join('\n');
}

export function parseArgs(argv) {
  return { json: argv.includes('--json') };
}

function main(argv) {
  const args = parseArgs(argv);
  let files;
  try {
    files = trackedFiles();
  } catch (err) {
    process.stderr.write(
      `secret-scan: could not list tracked files (${err.message.split('\n')[0]}).\n` +
        'This gate reads what git tracks, so it cannot report "clean" without it. Run it inside a\n' +
        'git checkout.\n',
    );
    return 1;
  }

  const result = scanFiles(files);
  if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`${render(result)}\n`);
  return result.findings.length ? 1 : 0;
}

if (process.argv[1]?.endsWith('secret-scan.mjs')) {
  process.exit(main(process.argv.slice(2)));
}
