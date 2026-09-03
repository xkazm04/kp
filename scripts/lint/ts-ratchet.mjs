#!/usr/bin/env node
// The suppression list on the TypeScript side can only get shorter — checked,
// not remembered. The pawl `ruff.toml` has, pointed at `app/` and `packages/`.
//
// THE GAP THIS CLOSES: `scripts/lint/ruff-ratchet.mjs` holds every ruff ignore to
// a declared ceiling and `autofix.yml` tightens the numbers unattended, so Python
// debt cannot grow quietly. The TypeScript side — the larger surface, and where
// most agent-authored code lands — had strict types, good rules and NO ceiling.
// `scripts/review/constitution-check.mjs` notices a suppression that arrives in a
// diff, but only as a `warn`, only for the range it happens to be given, and it
// says nothing at all about the sixty already in the tree. Nothing measured the
// total, so nothing could tell "sixty, shrinking" from "sixty, on the way to a
// hundred" — which is the only distinction that makes a suppression debt rather
// than a habit.
//
// WHAT IT COUNTS, over `app/**` and `packages/**` `.ts`/`.tsx`:
//
//   eslint:<rule>          one `eslint-disable` / `-next-line` / `-line` directive
//                          per rule it names. Per RULE, not one lump total: the
//                          39 `react-hooks/exhaustive-deps` are a known, argued
//                          class, and a first `no-restricted-syntax` disable is a
//                          different event entirely — a lump ceiling would let the
//                          second hide under the first.
//   eslint:*               a BLANKET `/* eslint-disable */`, which turns every rule
//                          off for a whole file and names none of them.
//   ts:@ts-expect-error    …and `@ts-ignore` / `@ts-nocheck`, the type-level
//                          equivalent: the compiler is the gate, and these are the
//                          three ways to tell it not to look.
//   directive:unreasoned   a directive with no `-- why` on the line. This is the
//                          second axis, and the one that answers "which of these
//                          are deliberate and which are just old": 17 of today's 59
//                          say why they exist and 42 do not. The ceiling means the
//                          42 can only fall.
//
// EXPLICIT `any` IS DELIBERATELY NOT COUNTED, and the reason is a measurement, not
// an omission: a sweep of `app/` and `packages/` on 2026-08-30 (`as any`, `: any`,
// `any[]`, `<any>`, `, any>`) found ZERO in code. Every hit was the English word
// inside a comment or a test name. A textual counter for `any` would therefore be
// ~130 false positives guarding nothing, and the counter that would not be — one
// that lexes strings and regex literals apart from code — is a parser, and a
// parser that desynchronises on one regex literal fails a build for a sentence.
// The honest gate for `any` is the type checker plus the rule that would have to
// be disabled to introduce one, and THAT disable is counted above.
//
// THE RULES ARE THE SHARED ONES. `scripts/lint/ratchet.mjs` defines what a
// ratchet is in this repository — the verdict ladder (`undeclared`,
// `unexplained`, `grew`, `slack`, `met`, and the measurement `zero`), the report,
// the flags, the exit codes and the "refuses to guess" rule — once, for both this
// and `ruff-ratchet.mjs`. Read that file for the protocol; this one is the
// TypeScript half: the `ts-debt.json` ceilings, and a walk of `app/` and
// `packages/` counting directives.
//
// THE ONE VERDICT THAT IS THIS RATCHET'S OWN, and the reason the shared ladder
// reports a measurement (`zero`) rather than a verdict:
//
//   burnt-down   ZERO occurrences against a non-zero ceiling. A NOTE, and
//                `--tighten` lowers it to 0 — which LOCKS the win, because 0 is a
//                ceiling like any other and the next one to arrive is `grew`.
//                Here the entry is not a suppression, it is a CEILING on one, so
//                deleting it would throw the teeth away at the exact moment they
//                closed. (On the ruff side the entry IS the ignore, so the same
//                measurement is `dead` and blocking.)
//
// WHY IT REFUSES TO GUESS: if `ts-debt.json` cannot be read, or the walk finds no
// source files at all, this exits 1 saying so. The one thing it must never do is
// read "I found nothing" as "there is nothing" — every entry would look burnt down
// and a `--tighten` would zero the whole list against a tree it never opened.
//
//   npm run lint:ts-ratchet              # the check (ci.yml, node-quality)
//   npm run lint:ts-ratchet -- --tighten # lower the ceilings to the tree
//   npm run lint:ts-ratchet -- --json
//
// EXIT CODES: 0 clean or notes only · 1 a blocking finding, or the tree/config
// could not be read.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BLOCKING, NOTE, classify, finding as makeFinding, main, parseArgs, renderFindings } from './ratchet.mjs';

export { parseArgs };

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TS_DEBT_PATH = 'ts-debt.json';

/** The trees the ratchet reads. Product TypeScript — the surface agents write into. */
export const ROOTS = ['app', 'packages'];

/** Directories a walk never descends into, whatever they contain. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage']);

const SOURCE_RE = /\.tsx?$/;

/**
 * A directive is `//` or `/*` followed only by SPACES OR TABS.
 *
 * `\s*` would be the obvious spelling and is wrong here in one direction that
 * matters: this regex runs over whole-file text, where `\s` also matches a
 * newline, so `/*` on one line and `eslint-disable` on the next would be counted
 * as one directive by the check and as none by every line-oriented tool a human
 * verifies it with. Same rule for both detectors below.
 *
 * The line form REQUIRES the `-next-line` / `-line` suffix because eslint does:
 * a bare `// eslint-disable` is not a directive at all, it is prose, and this
 * tree has prose that says exactly that (ChannelsTab.tsx explains a migration off
 * six of them). Only the block form may omit the suffix.
 */
export const ESLINT_DIRECTIVE_RE =
  /(?:\/\/[ \t]*eslint-disable-(?:next-line|line)|\/\*[ \t]*eslint-disable(?:-next-line|-line)?)\b([^\n]*)/g;

export const TS_DIRECTIVE_RE = /(?:\/\/|\/\*)[ \t]*(@ts-(?:ignore|expect-error|nocheck))\b/g;

/**
 * The rules one directive names. `['*']` for a blanket disable, which names none
 * and switches off all of them.
 *
 * Two things are cut before the split: eslint's `--` reason syntax, and the end
 * of a block comment. Both are prose; neither is a rule name.
 */
export function rulesOf(rest) {
  let body = rest.split('--')[0];
  const close = body.indexOf('*/');
  if (close !== -1) body = body.slice(0, close);
  const names = body
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return names.length ? names : ['*'];
}

/** A directive states its reason when the rest of its line carries eslint's `--`. */
export const isReasoned = (rest) => rest.includes('--');

/**
 * `Map<key, count>` for ONE file's text. Pure — the walk is separate so the rules
 * can be tested against a string.
 */
export function countIn(text, into = new Map()) {
  const bump = (key) => into.set(key, (into.get(key) ?? 0) + 1);
  for (const [, rest] of text.matchAll(ESLINT_DIRECTIVE_RE)) {
    for (const rule of rulesOf(rest)) bump(`eslint:${rule}`);
    if (!isReasoned(rest)) bump('directive:unreasoned');
  }
  // `directive:unreasoned` is an ESLINT axis only: `--` is eslint's reason
  // syntax and `@ts-` directives have none, so counting them on that axis would
  // record a missing reason for a comment that cannot carry one.
  for (const [, directive] of text.matchAll(TS_DIRECTIVE_RE)) bump(`ts:${directive}`);
  return into;
}

// --- reading the tree ---------------------------------------------------------

/** Every `.ts`/`.tsx` under the given roots, repo-relative, sorted. */
export function sourceFiles(roots = ROOTS, root = REPO_ROOT) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (SOURCE_RE.test(e.name)) out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  for (const r of roots) walk(path.join(root, r));
  return out.sort();
}

/**
 * `Map<key, count>` over the whole tree.
 *
 * Throws when the walk found nothing. An empty walk and a clean tree produce the
 * same empty map, and reading the first as the second is how `--tighten` would
 * zero every ceiling in the file without opening a single source file.
 */
export function treeCounts({ roots = ROOTS, root = REPO_ROOT, read = fs.readFileSync } = {}) {
  const files = sourceFiles(roots, root);
  if (files.length === 0) {
    throw new Error(
      `no .ts/.tsx files found under ${roots.join(', ')} — that is not "no debt", it is a walk that ` +
        'did not reach the tree. Run this from the repository root.',
    );
  }
  const counts = new Map();
  for (const f of files) countIn(read(path.join(root, f), 'utf8'), counts);
  return counts;
}

// --- the ceilings -------------------------------------------------------------

/**
 * `{ key: { max, why } }` from ts-debt.json, or `null` when the file is not
 * readable in the shape this check needs — which is NOT the same as an empty set
 * of ceilings. An empty `ceilings` object is a legal (if unlikely) state and
 * passes; a file that lost its shape must stop the check, not pass it.
 */
export function parseCeilings(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.ceilings !== 'object' || parsed.ceilings === null) {
    return null;
  }
  return parsed.ceilings;
}

const finding = (severity, rule, key, message, fix) => makeFinding(severity, rule, TS_DEBT_PATH, message, fix, { key });

/**
 * Pure. `ceilings` is the parsed object, `counts` is a `Map<key, count>`.
 *
 * The ladder is `classify()` in ratchet.mjs; this maps each kind to the sentence
 * a reader of THIS debt file needs. The first loop is this ratchet's own shape of
 * `undeclared` — it is driven by the TREE (a suppression kind nobody declared)
 * rather than by an entry, because ts-debt.json has no line for the undeclared
 * case to be found on.
 */
export function runChecks(ceilings, counts) {
  const out = [];

  for (const [key, count] of [...counts.entries()].sort()) {
    if (count === 0) continue;
    if (!Object.hasOwn(ceilings, key)) {
      out.push(
        finding(
          BLOCKING,
          'undeclared',
          key,
          `\`${key}\` occurs ${count} time(s) and ${TS_DEBT_PATH} declares no ceiling for it.`,
          `Add \`"${key}": { "max": ${count}, "why": "<what this suppression is and when it goes away>" }\` ` +
            'to `ceilings`. A suppression kind that names no number cannot be shown to be shrinking, which ' +
            'is the only thing that makes it debt rather than policy.',
        ),
      );
    }
  }

  for (const [key, entry] of Object.entries(ceilings).sort()) {
    const max = entry?.max;
    const why = typeof entry?.why === 'string' ? entry.why.trim() : '';
    const actual = counts.get(key) ?? 0;

    switch (classify({ ceiling: max ?? null, actual, explained: why !== '' })) {
      case 'undeclared':
      case 'unexplained':
        out.push(
          finding(
            BLOCKING,
            'unexplained',
            key,
            !Number.isInteger(max) || max < 0
              ? `\`${key}\` has no integer \`max\`.`
              : `\`${key}\` declares a ceiling of ${max} and no \`why\`.`,
            !Number.isInteger(max) || max < 0
              ? 'Every entry is `{ "max": <n>, "why": "<sentence>" }`. A ceiling that is not a number is not a ceiling.'
              : 'Say what the suppression is for and what would retire it. The number records how big the debt is; ' +
                'the sentence is the only thing that records whether it is debt at all — which is the difference ' +
                'between a deliberate exception and an old one nobody has re-read.',
          ),
        );
        break;
      case 'grew':
        out.push(
          finding(
            BLOCKING,
            'grew',
            key,
            `\`${key}\` occurs ${actual} time(s), above its declared ceiling of ${max}.`,
            `Remove the ${actual - max} new one(s), or fix the code under them. Raising the ceiling instead is ` +
              'editing the gate to pass the change — the move docs/architecture/decisions/0007-repo-laws-are-gates.md ' +
              'exists to make visible. If it is genuinely right, raise it in its own commit and say why in `why`.',
          ),
        );
        break;
      case 'zero':
        // A ceiling of 0 with nothing left is the goal state, and silence is the
        // correct report for it. Anything above 0 is a win that has not been
        // recorded yet, which is what --tighten is for.
        if (max > 0) {
          out.push(
            finding(
              NOTE,
              'burnt-down',
              key,
              `\`${key}\`: nothing left in the tree, ceiling still says ${max}.`,
              'Run `npm run lint:ts-ratchet -- --tighten` to record the win as a ceiling of 0 (autofix.yml does this ' +
                'on every pull request). Until then the entry would let the whole class grow straight back.',
            ),
          );
        }
        break;
      case 'slack':
        out.push(
          finding(
            NOTE,
            'slack',
            key,
            `\`${key}\`: ${actual} left, ceiling still says ${max}.`,
            'Run `npm run lint:ts-ratchet -- --tighten` to record the ground gained (autofix.yml does this on ' +
              'every pull request). Until then the entry would let the debt grow back to the old number.',
          ),
        );
        break;
      default:
        break; // `met` — exactly at the ceiling, and nothing to say about it
    }
  }

  return out;
}

// --- --tighten: the shrink, performed rather than requested --------------------

/**
 * Lower every ceiling to what the tree actually carries, and return the file
 * text. Never raises one: a ceiling that follows the debt upward is a log, not a
 * ratchet.
 *
 * Rewritten through `JSON.stringify(…, 2)` — the same shape check-actions.mjs
 * writes its allowlist in, and the reason ts-debt.json is committed in exactly
 * that formatting: a `--tighten` that reflowed the file would put every line of
 * it in the diff of a job whose whole point is to change two numbers, and this
 * runs unattended inside autofix.yml.
 *
 * Unknown top-level keys (`$comment`) are preserved in place by the spread.
 */
export function tighten(text, counts) {
  const current = JSON.parse(text);
  const ceilings = {};
  for (const [key, entry] of Object.entries(current.ceilings)) {
    const actual = counts.get(key) ?? 0;
    const max = Number.isInteger(entry?.max) ? entry.max : null;
    ceilings[key] = max === null || actual >= max ? entry : { ...entry, max: actual };
  }
  return `${JSON.stringify({ ...current, ceilings }, null, 2)}\n`;
}

// --- CLI ----------------------------------------------------------------------
//
// The flags, the report, the exit codes and the "a no-op --tighten writes
// nothing" rule are `runRatchetCli`'s, shared with ruff-ratchet. What is this
// ratchet's own is named here: which file to read, how to measure, and what to
// say.

export const NAME = 'ts-ratchet';

export const CLEAN = `${NAME}: every suppression in ${ROOTS.join('/ and ')}/ is declared in ${TS_DEBT_PATH}, explained, and no more numerous than it was.`;

export const render = (findings) => renderFindings(findings, CLEAN);

/** The whole spec of this ratchet, exported so a fixture can drive it. */
export function spec(argv, { root = REPO_ROOT, read = fs.readFileSync, write = fs.writeFileSync, counts = null } = {}) {
  const file = path.join(root, TS_DEBT_PATH);
  return {
    name: NAME,
    argv,
    load: () => {
      const text = read(file, 'utf8');
      const ceilings = parseCeilings(text);
      return ceilings === null ? null : { text, entries: ceilings };
    },
    unreadable:
      `${TS_DEBT_PATH} has no readable \`ceilings\` object. The gate reads that file; if it moved or ` +
      'changed shape, this check is not checking anything.',
    measure: () => counts ?? treeCounts({ root }),
    check: ({ entries, counts: c }) => runChecks(entries, c),
    tighten: ({ text, entries, counts: c }) => ({
      text: tighten(text, c),
      log: Object.entries(entries)
        .filter(([key, entry]) => Number.isInteger(entry?.max) && (c.get(key) ?? 0) < entry.max)
        .map(([key, entry]) => `  ${TS_DEBT_PATH}: ${key} ${entry.max} -> ${c.get(key) ?? 0}.`),
    }),
    write: (text) => write(file, text, 'utf8'),
    tightenMessages: {
      none: 'nothing to tighten — every ceiling already matches the tree.',
      done: 'lowered the ceilings. Re-run without --tighten to confirm.',
    },
    clean: CLEAN,
  };
}

if (process.argv[1]?.endsWith('ts-ratchet.mjs')) main(spec(process.argv.slice(2)));
