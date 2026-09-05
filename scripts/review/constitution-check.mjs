#!/usr/bin/env node
// The deterministic half of "something reads the change back".
//
// ~90% of commits here are AI-written. typecheck/lint/tests prove the code
// COMPILES AND PASSES; none of them notices when a change quietly widened its
// own permission to pass — a skipped test, a suppression directive, a raised
// skip baseline, a new API route with no stated auth posture, a new table that
// never reached the tenancy manifest. Those are the moves that make a gate stop
// meaning anything, and they are exactly the "forbidden change classes" the
// App-master programme already names.
//
// This lens needs NO API KEY and no network: it is regex-over-the-diff, runs in
// under a second, and gates every push and PR. The judgement lens that reads
// intent lives in agent-review.mjs beside it.
//
//   node scripts/review/constitution-check.mjs --base origin/main --head HEAD
//   npm run review:constitution                       # HEAD~1..HEAD
//
// EXIT CODES: 0 clean or warnings only · 1 at least one blocking finding ·
//             2 the check could not run (no comparable base) — deliberately not
//             0, because the pre-push hook reads a 0 as "this change was read".
//
// THE ESCAPE HATCH IS A SENTENCE, NOT A FLAG. A blocking finding is downgraded
// when any commit in the range carries:
//
//   Gate-exemption: <why this one is legitimate>
//
// A reviewer reading `git log` sees the claim and can disagree with it. There is
// deliberately no per-line suppression comment: those get copy-pasted.

import fs from 'node:fs';
import path from 'node:path';
import {
  REPO_ROOT,
  diffForRange,
  messagesForRange,
  parseDiff,
  resolveRange,
  revExists,
} from './diff.mjs';
import { SECRET_PATTERNS, isExempt as isSecretExempt } from '../security/secret-scan.mjs';
import { codeOnlyLine, withoutCommentsLine } from './source-mask.mjs';

export const EXEMPTION_RE = /^\s*Gate-exemption:\s*(.+)$/im;

/**
 * The findings a commit trailer may NOT wave through.
 *
 * `Gate-exemption:` was built for the rules that are legitimately right
 * sometimes — a live-only smoke test really does need a skip — and it downgraded
 * every blocking finding in the range, including a committed credential. An
 * agent that can write a key into a file can also write the sentence that
 * excuses it, and a leaked key is not a judgement call: it is in the object
 * database from the moment the commit exists, and the fix is rotation rather
 * than a reviewer agreeing with a sentence. So `secret` stands whatever the
 * trailer says, and the hatch stays open for everything it was designed for.
 */
export const UNWAIVABLE_RULES = new Set(['secret']);

/**
 * Does this set of findings block, given the range's exemption trailer (or null)?
 *
 * The single answer both `render()` and the exit code read, so the message a
 * human sees and the code CI reads can never disagree.
 */
export function blockedBy(findings, exemption) {
  const blocking = findings.filter((f) => f.severity === 'blocking');
  if (blocking.length === 0) return false;
  if (!exemption) return true;
  return blocking.some((f) => UNWAIVABLE_RULES.has(f.rule));
}

// Paths whose edits change how changes are JUDGED. Not wrong — but a reviewer
// should always see them called out as a category rather than as 40 more lines.
export const GATE_PATHS = [
  /^\.github\/workflows\//,
  /^\.githooks\//,
  /^eslint\.config\.mjs$/,
  /^ruff\.toml$/,
  // The two debt ceilings and the scripts that hold them. Editing a ceiling is
  // a legitimate move and a reviewable one — it is also the cheapest way to make
  // a growing suppression list stop being reported, which is precisely why it
  // belongs in the category rather than in the diff's forty other lines.
  /^ts-debt\.json$/,
  /^scripts\/lint\//,
  /^playwright\.config\.ts$/,
  /^scripts\/design\//,
  /^scripts\/docs\//,
  /^scripts\/review\//,
  // The workflow ratchet and the credential table. Widening SECRET_EXEMPT is a
  // one-line edit that stops a whole directory being read for keys — precisely
  // the shape this category exists to put in front of a reviewer.
  /^scripts\/security\//,
  /^scripts\/i18n-check\.mjs$/,
  /^pipeline\/jobfit\/tests\/run_gated\.py$/,
  /^app\/api\/rate-limit-contract\.test\.ts$/,
  /^app\/_lib\/tenancy\.ts$/,
];

const TEST_FILE_RE = /(\.test\.[tj]sx?|\.spec\.[tj]sx?|\.test\.mjs)$|(^|\/)test_[^/]+\.py$|\/e2e\/[^/]+\.spec\.ts$/;

// Suppression directives. Each is legitimate somewhere; each is also the
// cheapest way to make a gate stop reporting. Surfaced, never silently allowed.
const SUPPRESSIONS = [
  { re: /eslint-disable(-next-line|-line)?\b/, what: 'eslint suppression' },
  { re: /@ts-(ignore|expect-error)\b/, what: 'TypeScript error suppression' },
  { re: /#\s*noqa\b/, what: 'ruff/flake8 suppression' },
  { re: /#\s*type:\s*ignore\b/, what: 'mypy suppression' },
  { re: /\/\*\s*istanbul ignore/, what: 'coverage suppression' },
];

// Skipped or disabled tests. `.only` is separated out: it does not disable one
// test, it disables every OTHER test in the file, silently.
const SKIP_MARKERS = [
  { re: /\b(?:it|test|describe)\.skip\s*\(/, what: 'a skipped JS test' },
  { re: /\b(?:xit|xdescribe|xtest)\s*\(/, what: 'a skipped JS test' },
  { re: /\btest\.describe\.skip\s*\(/, what: 'a skipped Playwright block' },
  { re: /@unittest\.skip\b/, what: 'a skipped Python test' },
  { re: /@unittest\.skip(?:If|Unless)\s*\(/, what: 'a conditionally skipped Python test' },
  { re: /@pytest\.mark\.skipif\s*\(/, what: 'a conditionally skipped Python test' },
  { re: /@pytest\.mark\.skip\b(?!if)/, what: 'a skipped Python test' },
  { re: /\bself\.skipTest\s*\(/, what: 'a Python test that skips itself' },
];
const ONLY_RE = /\b(?:it|test|describe)\.only\s*\(/;

/**
 * A CONDITIONAL skip that states its reason is a different animal from a bare one.
 *
 * `test.skip("later", …)` removes coverage. `test.skip(cond, "the llm_usage ledger
 * is empty on this database")` is a test declaring the precondition it needs — it
 * runs whenever the precondition holds, and the sentence in the second argument is
 * exactly what a `Gate-exemption:` trailer would have said, except it lives beside
 * the code instead of in one commit message. Blocking those taught the only lesson
 * a false positive can teach: waive the range and move on.
 *
 * The shape, uniformly across both languages: the FIRST argument is not a string
 * literal (so it is a condition), and a string argument follows it (the reason).
 * `@unittest.skip("flaky")` and `describe.skip("later", …)` open with a string and
 * are therefore still bare skips, which is the whole point.
 *
 * @param blob  the call text, starting at the marker match, with later added lines
 *              appended — a Playwright `test.skip(` is routinely three lines.
 * @returns the reason string, or null when this is a bare skip.
 */
export function skipReason(blob) {
  const open = blob.indexOf('(');
  if (open === -1) return null;
  let depth = 0;
  let end = -1;
  for (let i = open; i < blob.length; i += 1) {
    if (blob[i] === '(') depth += 1;
    else if (blob[i] === ')') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const args = blob.slice(open + 1, end === -1 ? blob.length : end);

  // Split on top-level commas only: a condition may itself be a call.
  const parts = [];
  let depth2 = 0;
  let start = 0;
  for (let i = 0; i < args.length; i += 1) {
    const c = args[i];
    if (c === '(' || c === '[' || c === '{') depth2 += 1;
    else if (c === ')' || c === ']' || c === '}') depth2 -= 1;
    else if (c === ',' && depth2 === 0) {
      parts.push(args.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(args.slice(start));

  const trimmed = parts.map((p) => p.trim()).filter((p) => p.length);
  if (trimmed.length < 2) return null;
  if (/^["'`]/.test(trimmed[0])) return null; // opens with a title/description: a bare skip
  for (const part of trimmed.slice(1)) {
    const m = /^(?:reason\s*=\s*)?(["'`])([\s\S]*?)\1/.exec(part);
    if (m && m[2].trim()) return m[2].trim();
  }
  return null;
}

/** The marker's line plus the few added lines after it — enough to close the call. */
function skipCallBlob(added, index, matchIndex) {
  const parts = [added[index].text.slice(matchIndex)];
  for (let k = index + 1; k < Math.min(index + 8, added.length); k += 1) parts.push(added[k].text);
  return parts.join('\n');
}

// Credential shapes with enough structure that a match is worth stopping for.
// Loose prefixes (a bare `sk-`) are deliberately absent: a rule that cries wolf
// gets disabled, and then it protects nothing.
//
// THE TABLE MOVED, and it is one table now. `scripts/security/secret-scan.mjs`
// reads the whole tracked TREE with it (`npm run security:secrets`), because
// this lens only ever sees one range — a key that landed before it existed, in a
// file no later pull request touches, is invisible here forever. Two copies of a
// credential list is two lists, and the one nobody edits is the one that decides
// whether a leak is caught.

// This directory DEFINES the patterns above, so scanning its own source for
// them reports the rule table as a violation of itself. Content rules skip it;
// rule 9 still surfaces that the review machinery was edited, which is the
// signal that actually matters here.
const SELF_RE = /^scripts\/review\//;

// …and the same reasoning covers PROSE. `docs/development/change-review.md` is the
// rule table written out in words, so the row explaining `test-skip` contains the
// literal `@unittest.skip` and the row explaining `suppression` contains
// `eslint-disable`. On its first run this check blocked the very commit that
// introduced its own documentation. A markdown file cannot hold a skipped test or
// a live suppression — only a description of one — so the two CONTENT rules that
// match on tokens alone skip prose. The secret rule deliberately does NOT: a key
// pasted into a doc is still a leaked key, and it has SECRET_EXEMPT for the paths
// where an example belongs.
const PROSE_RE = /\.(md|mdx)$/i;

// `CREATE TABLE` only means "a new persistent app table" inside the app's own
// source. A temp table in a fixture, or the Worker's own D1 schema in edge/,
// is not what the tenancy manifest governs.
const APP_SOURCE_RE = /^app\//;

function finding(severity, rule, file, line, message, fix) {
  return { severity, rule, file, line, message, fix };
}

function matches(list, path) {
  return list.some((re) => re.test(path));
}

/**
 * Pure rule engine.
 *
 * @param files    Map from parseDiff()
 * @param context  { publicRoutesSource, changedPaths }
 * @returns findings[]
 */
export function runRules(files, context = {}) {
  const out = [];
  const changed = new Set(context.changedPaths ?? [...files.keys()]);
  const publicRoutes = context.publicRoutesSource ?? '';

  for (const file of files.values()) {
    const p = file.path;

    // --- 1. A deleted test file -------------------------------------------
    if (file.isDeleted && TEST_FILE_RE.test(p)) {
      out.push(
        finding(
          'blocking',
          'test-deletion',
          p,
          1,
          'A test file was deleted.',
          'If the behaviour it covered is gone, say so in the commit body. If it is not gone, ' +
            'the coverage just left the repository — restore it or replace it.',
        ),
      );
    }

    if (SELF_RE.test(p)) continue; // see SELF_RE

    for (let ai = 0; ai < file.added.length; ai += 1) {
      const { line, text } = file.added[ai];
      // The three CONTENT rules below read a MASKED line, not the raw one: a
      // comment that mentions `CREATE TABLE` or `it.skip(` is a description, and
      // a rule that cannot tell a description from the thing described gets
      // waived rather than fixed (that is how commit 83852794 happened). Which
      // mask matters: `codeOnly` for the rules that look for a CALL, and
      // `withoutComments` for the tenancy rule, whose subject nearly always
      // lives INSIDE a string. The `suppression` rule below deliberately keeps
      // the raw text — an `eslint-disable` IS a comment, so masking comments
      // there would delete the rule instead of sharpening it.
      const code = codeOnlyLine(text, p);
      const uncommented = withoutCommentsLine(text, p);

      // --- 2. `.only` — silently disables every other test in the file -----
      if (ONLY_RE.test(code) && TEST_FILE_RE.test(p)) {
        out.push(
          finding(
            'blocking',
            'test-only',
            p,
            line,
            '`.only` disables every OTHER test in this file, and CI stays green while doing it.',
            'Remove it before committing. This is a debugging aid, never a landed change.',
          ),
        );
      }

      // --- 3. Skipped tests --------------------------------------------------
      for (const marker of PROSE_RE.test(p) ? [] : SKIP_MARKERS) {
        const m = marker.re.exec(code);
        if (!m) continue;
        const reason = skipReason(skipCallBlob(file.added, ai, m.index));
        if (reason) {
          out.push(
            finding(
              'warn',
              'test-skip',
              p,
              line,
              `A conditional skip that states its reason: "${reason}".`,
              'Noted, not blocked: the test still runs whenever the condition is false, and the reason ' +
                'is beside the code rather than in one commit message. Check the condition can actually ' +
                'become false in CI — a condition that is always true is a bare skip with extra words.',
            ),
          );
        } else {
          out.push(
            finding(
              'blocking',
              'test-skip',
              p,
              line,
              `This change adds ${marker.what}.`,
              'Fix the test or fix the code. If the skip is genuinely correct (an unavailable ' +
                'fixture, a live-only smoke), make it a CONDITIONAL skip with a reason — ' +
                '`test.skip(cond, "why")`, `@pytest.mark.skipif(cond, reason="why")` — or state why in ' +
                'the commit body with `Gate-exemption:`.',
            ),
          );
        }
        break;
      }

      // --- 4. Suppression directives ----------------------------------------
      for (const s of PROSE_RE.test(p) ? [] : SUPPRESSIONS) {
        if (s.re.test(text)) {
          out.push(
            finding(
              'warn',
              'suppression',
              p,
              line,
              `Adds ${s.what}.`,
              'Legitimate sometimes — but the line above it should say why, so the next reader ' +
                'does not have to reconstruct it.',
            ),
          );
          break;
        }
      }

      // --- 5. Hardcoded credentials -----------------------------------------
      if (!isSecretExempt(p)) {
        for (const s of SECRET_PATTERNS) {
          if (s.re.test(text)) {
            out.push(
              finding(
                'blocking',
                'secret',
                p,
                line,
                `This line looks like ${s.what}.`,
                'Move it to an env var and ROTATE the key — it is in the object database now, ' +
                  'even if the next commit removes the line. This one finding is NOT waivable by ' +
                  '`Gate-exemption:`; the same table reads the whole tree in ' +
                  '`npm run security:secrets`.',
              ),
            );
            break;
          }
        }
      }

      // --- 6. A new persistent table that never reached the manifest --------
      if (
        /CREATE\s+TABLE/i.test(uncommented) &&
        APP_SOURCE_RE.test(p) &&
        !TEST_FILE_RE.test(p) &&
        !changed.has('app/_lib/tenancy.ts')
      ) {
        out.push(
          finding(
            'blocking',
            'tenancy-manifest',
            p,
            line,
            'A new table is created, but app/_lib/tenancy.ts was not touched in this change.',
            'The tenancy manifest is fail-closed (see docs/architecture/decisions/' +
              '0002-sqlite-single-file-persistence.md): scope the table to a workspace and list it, ' +
              'with a colocated *-tenancy.test.ts. Adding it to the exempt list needs the reasoning, ' +
              'not just the line.',
          ),
        );
      }
    }

    // --- 7. A new API route with no stated auth posture ---------------------
    if (file.isNew && /^app\/api\/.+\/route\.ts$/.test(p)) {
      const body = file.added.map((a) => a.text).join('\n');
      const isTokenRoute = /\[token\]|\[erasureToken\]/.test(p);
      const guards = /requireOperator|isOperator|requireWorkspace/.test(body);
      const allowlisted = allowlistCovers(publicRoutes, p);
      if (!guards && !allowlisted && !isTokenRoute) {
        out.push(
          finding(
            'blocking',
            'route-auth-posture',
            p,
            1,
            'New API route: it neither calls requireOperator nor sits under a prefix in ' +
              'app/_lib/auth/public-routes.ts.',
            'Auth here is fail-closed by shape (ADR 0005). Either call requireOperator — the ' +
              'proxy gate is not defence in depth on its own — or add the prefix to ' +
              'PUBLIC_API_PREFIXES with a comment saying why the route is public.',
          ),
        );
      }
      if (allowlisted && !/rateLimit\s*\(/.test(body)) {
        out.push(
          finding(
            'warn',
            'open-route-rate-limit',
            p,
            1,
            'New PUBLIC API route with no rateLimit() call.',
            'Every open route that spends money or spawns a subprocess is rate limited per IP and ' +
              'per token. If this one does neither, say so; otherwise add the limiter and its ' +
              'assertion in app/api/rate-limit-contract.test.ts.',
          ),
        );
      }
    }
  }

  // --- 8. A raised Python skip baseline -----------------------------------
  const baseline = skipBaselineChange(files);
  if (baseline && baseline.to > baseline.from) {
    out.push(
      finding(
        'blocking',
        'skip-baseline-raised',
        baseline.file,
        baseline.line,
        `KP_SKIP_BASELINE was raised from ${baseline.from} to ${baseline.to}.`,
        'That baseline exists so a critical Python test cannot silently stop running. Raising it ' +
          'is allowed — with the derivation comment updated to name the newly tolerated skip, and ' +
          '`Gate-exemption:` in the commit body.',
      ),
    );
  }

  // --- 9. Gate machinery touched (always surfaced, never blocking) ---------
  const gateEdits = [...changed].filter((p) => matches(GATE_PATHS, p)).sort();
  if (gateEdits.length) {
    out.push(
      finding(
        'warn',
        'gate-configuration',
        gateEdits[0],
        1,
        `This change edits the machinery that judges changes: ${gateEdits.join(', ')}.`,
        'Not a problem by itself — but read it as a category. A gate edit that makes the same ' +
          'change pass is the failure mode docs/architecture/decisions/0007-repo-laws-are-gates.md ' +
          'exists to prevent.',
      ),
    );
  }

  return out;
}

/** Does any PUBLIC_API_PREFIXES entry in `source` cover this route path? */
export function allowlistCovers(source, routePath) {
  if (!source) return false;
  const block = source.match(/PUBLIC_API_PREFIXES\s*=\s*\[([\s\S]*?)\]/);
  if (!block) return false;
  const prefixes = [...block[1].matchAll(/["'`](\/api\/[^"'`]*)["'`]/g)].map((m) => m[1]);
  // `app/api/foo/bar/route.ts` -> `/api/foo/bar`
  const url = `/${routePath.replace(/^app\//, '').replace(/\/route\.ts$/, '')}`;
  return prefixes.some((prefix) => url === prefix.replace(/\/$/, '') || url.startsWith(prefix));
}

/** Detect a raise of the CI skip baseline across the diff. */
export function skipBaselineChange(files) {
  const read = (entries) => {
    for (const e of entries) {
      const m = e.text.match(/KP_SKIP_BASELINE\s*:\s*["']?(\d+)["']?/);
      if (m) return { value: Number(m[1]), line: e.line };
    }
    return null;
  };
  for (const file of files.values()) {
    const before = read(file.removed);
    const after = read(file.added);
    if (before && after) return { file: file.path, line: after.line, from: before.value, to: after.value };
  }
  return null;
}

// --- CLI --------------------------------------------------------------------

export function parseArgs(argv) {
  const out = { base: null, head: 'HEAD', json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') out.base = argv[++i];
    else if (argv[i] === '--head') out.head = argv[++i];
    else if (argv[i] === '--json') out.json = true;
  }
  return out;
}

export function render(findings, exemption) {
  const blocking = findings.filter((f) => f.severity === 'blocking');
  const warns = findings.filter((f) => f.severity === 'warn');
  const lines = [];

  if (!findings.length) {
    lines.push('constitution: ✓ no finding. (This lens checks gate integrity, not correctness —');
    lines.push('              the judgement lens is scripts/review/agent-review.mjs.)');
    return { text: lines.join('\n'), blocked: false };
  }

  const blocked = blockedBy(findings, exemption);
  const unwaivable = blocking.filter((f) => UNWAIVABLE_RULES.has(f.rule));
  const order = [...blocking, ...warns];
  lines.push(`constitution: ${blocking.length} blocking · ${warns.length} to note\n`);
  for (const f of order) {
    const glyph = f.severity === 'blocking' ? '✗' : '–';
    lines.push(`  ${glyph} [${f.rule}] ${f.file}:${f.line}`);
    lines.push(`      ${f.message}`);
    lines.push(`      → ${f.fix}`);
    lines.push('');
  }
  if (unwaivable.length && exemption) {
    lines.push(`  A commit trailer is on the record — "${exemption.trim()}" — and it does NOT waive`);
    lines.push(`  ${unwaivable.map((f) => `[${f.rule}]`).join(' ')}. A committed credential is not a`);
    lines.push('  judgement call: remove the literal and rotate the key.');
  } else if (blocking.length && exemption) {
    lines.push(`  Blocking findings waived by commit trailer — "${exemption.trim()}"`);
    lines.push('  The waiver is on the record; a reviewer can disagree with it.');
  } else if (blocked) {
    lines.push('  Fix the blocking findings, or state the exemption in a commit body:');
    lines.push('      Gate-exemption: <why this one is legitimate>');
  }
  return { text: lines.join('\n'), blocked };
}

function main(argv) {
  const args = parseArgs(argv);
  const range = resolveRange(args, revExists);

  // A CHECK THAT DID NOT RUN IS NOT A GREEN CHECK. This printed "check skipped"
  // and returned 0, and `.githooks/pre-push` reads that exit code as "clean" —
  // so a clone whose `origin/main` was never fetched pushed to main with the
  // deterministic lens silently doing nothing. Two behaviours, both loud:
  //
  //   base requested but absent, parent commit available -> run the NARROW range
  //     (HEAD~1..HEAD, resolveRange's fallback) and SAY the range narrowed.
  //     Shallow CI checkouts land here and a narrow review beats none.
  //   no comparable base at all (a root commit) -> exit 2. Nothing was read;
  //     the caller must not be told it was.
  if (args.base && !revExists(args.base)) {
    process.stdout.write(
      `constitution: ${args.base} is not in this clone — reviewing ${range.base}..${range.head} instead.\n` +
        '              This is a NARROWER range than the one you asked for; `git fetch origin main` widens it.\n',
    );
  }
  if (!revExists(range.base)) {
    process.stdout.write(
      `constitution: no comparable base (${range.base}) — NOTHING was reviewed.\n` +
        '              This exits non-zero on purpose: a check that did not run must not read as a pass.\n',
    );
    return 2;
  }

  const files = parseDiff(diffForRange(range));
  if (files.size === 0) {
    process.stdout.write('constitution: no changes in range.\n');
    return 0;
  }

  const routesPath = path.join(REPO_ROOT, 'app/_lib/auth/public-routes.ts');
  const publicRoutesSource = fs.existsSync(routesPath) ? fs.readFileSync(routesPath, 'utf8') : '';

  const findings = runRules(files, { publicRoutesSource, changedPaths: [...files.keys()] });
  const exemptionMatch = messagesForRange(range).match(EXEMPTION_RE);
  const exemption = exemptionMatch ? exemptionMatch[1] : null;

  const blocked = blockedBy(findings, exemption);

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ range, exemption, findings, blocked }, null, 2)}\n`);
  } else {
    const { text } = render(findings, exemption);
    process.stdout.write(`${text}\n`);
  }

  return blocked ? 1 : 0;
}

if (process.argv[1]?.endsWith('constitution-check.mjs')) {
  process.exit(main(process.argv.slice(2)));
}
