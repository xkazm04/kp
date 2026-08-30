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
// EXIT CODES: 0 clean or warnings only · 1 at least one blocking finding.
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

export const EXEMPTION_RE = /^\s*Gate-exemption:\s*(.+)$/im;

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
  { re: /\bself\.skipTest\s*\(/, what: 'a Python test that skips itself' },
];
const ONLY_RE = /\b(?:it|test|describe)\.only\s*\(/;

// Credential shapes with enough structure that a match is worth stopping for.
// Loose prefixes (a bare `sk-`) are deliberately absent: a rule that cries wolf
// gets disabled, and then it protects nothing.
const SECRET_PATTERNS = [
  { re: /sk-ant-api\d{2}-[A-Za-z0-9_-]{20,}/, what: 'an Anthropic API key' },
  { re: /sk-proj-[A-Za-z0-9_-]{20,}/, what: 'an OpenAI project key' },
  { re: /AIza[0-9A-Za-z_-]{35}/, what: 'a Google API key' },
  { re: /gh[pousr]_[A-Za-z0-9]{36}/, what: 'a GitHub token' },
  { re: /xox[baprs]-[A-Za-z0-9-]{10,}/, what: 'a Slack token' },
];
const SECRET_EXEMPT = [/^\.env\.example$/, /^docs\//, /(^|\/)README\.md$/];

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

    for (const { line, text } of file.added) {
      // --- 2. `.only` — silently disables every other test in the file -----
      if (ONLY_RE.test(text) && TEST_FILE_RE.test(p)) {
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
        if (marker.re.test(text)) {
          out.push(
            finding(
              'blocking',
              'test-skip',
              p,
              line,
              `This change adds ${marker.what}.`,
              'Fix the test or fix the code. If the skip is genuinely correct (an unavailable ' +
                'fixture, a live-only smoke), state why in the commit body with `Gate-exemption:`.',
            ),
          );
          break;
        }
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
      if (!matches(SECRET_EXEMPT, p)) {
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
                  'even if the next commit removes the line.',
              ),
            );
            break;
          }
        }
      }

      // --- 6. A new persistent table that never reached the manifest --------
      if (
        /CREATE\s+TABLE/i.test(text) &&
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

  const blocked = blocking.length > 0 && !exemption;
  const order = [...blocking, ...warns];
  lines.push(`constitution: ${blocking.length} blocking · ${warns.length} to note\n`);
  for (const f of order) {
    const glyph = f.severity === 'blocking' ? '✗' : '–';
    lines.push(`  ${glyph} [${f.rule}] ${f.file}:${f.line}`);
    lines.push(`      ${f.message}`);
    lines.push(`      → ${f.fix}`);
    lines.push('');
  }
  if (blocking.length && exemption) {
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
  if (!revExists(range.base)) {
    process.stdout.write(`constitution: no comparable base (${range.base}) — check skipped.\n`);
    return 0;
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

  if (args.json) {
    process.stdout.write(
      `${JSON.stringify({ range, exemption, findings, blocked: findings.some((f) => f.severity === 'blocking') && !exemption }, null, 2)}\n`,
    );
  } else {
    const { text } = render(findings, exemption);
    process.stdout.write(`${text}\n`);
  }

  const blocked = findings.some((f) => f.severity === 'blocking') && !exemption;
  return blocked ? 1 : 0;
}

if (process.argv[1]?.endsWith('constitution-check.mjs')) {
  process.exit(main(process.argv.slice(2)));
}
