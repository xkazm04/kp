#!/usr/bin/env node
// The ruff ignore list can only get shorter — checked, not remembered.
//
// THE GAP THIS CLOSES: `ruff.toml` says the right thing in prose. Its ignores are
// "debt markers, not policy", the way to burn one down is "delete an entry, run
// `ruff check pipeline/`, fix what surfaces", and `F821` is called out as "the
// only entry here that hides a real bug rather than untidiness" whose one recorded
// occurrence is already fixed. All of that has been true and written down for
// weeks, and the entry is still there — because a ratchet whose pawl is a comment
// only ratchets when somebody remembers.
//
// Nothing measured the list either. `ruff check pipeline/` runs WITH the ignores
// applied, so it reports zero violations of exactly the rules that are rotting:
// the gate is structurally incapable of noticing that an ignore now suppresses
// nothing, or that it suppresses four times what it was written for.
//
// WHAT THIS DOES: runs ruff a second time with `lint.ignore` emptied, counts the
// violations per rule, and holds each ignore entry to a ceiling declared beside it
// in `ruff.toml`:
//
//     # ratchet: F401 <= 5
//     "F401",
//
// THE RULES ARE THE SHARED ONES. `scripts/lint/ratchet.mjs` defines what a
// ratchet is in this repository — the verdict ladder (`undeclared`, `grew`,
// `slack`, `met`, and the measurement `zero`), the report, the flags, the exit
// codes and the "refuses to guess" rule — once, for both this and
// `ts-ratchet.mjs`. Read that file for the protocol; this one is the ruff half:
// the TOML `ignore = [` list, and a `ruff check` with the ignores lifted.
//
// THE ONE VERDICT THAT IS THIS RATCHET'S OWN, and the reason the shared ladder
// reports a measurement (`zero`) rather than a verdict:
//
//   dead        ZERO violations. Here the entry IS the suppression, so an ignore
//               that excuses nothing is rot that still reads as policy — it must
//               go. BLOCKING, and `--tighten` performs the deletion. (On the
//               TypeScript side the entry is a CEILING on a suppression, so the
//               same measurement is a win worth locking at 0 rather than a fault.)
//
// WHY IT REFUSES TO GUESS: if ruff cannot be run, or answers with something that
// is not a JSON array, this exits 1 saying so. The one thing it must never do is
// read a broken invocation as "no violations anywhere" and report every entry
// dead — that would delete the whole ignore list on a `--tighten`.
//
//   npm run lint:ruff-ratchet              # the check (ci.yml, python-gate)
//   npm run lint:ruff-ratchet -- --tighten # delete dead entries, lower ceilings
//   npm run lint:ruff-ratchet -- --json
//
// EXIT CODES: 0 clean · 1 a blocking finding, or ruff could not be believed.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BLOCKING, NOTE, classify, finding as makeFinding, main, parseArgs, renderFindings } from './ratchet.mjs';

export { parseArgs };

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RUFF_CONFIG_PATH = 'ruff.toml';

/** The tree the gate lints — kept identical to ci.yml's `ruff check pipeline/`. */
export const TARGET = 'pipeline/';

/** `# ratchet: F401 <= 5`, anywhere in the comment block above an entry. */
export const MARKER_RE = /#\s*ratchet:\s*([A-Z]+[0-9]+)\s*<=\s*(\d+)\s*$/;

const IGNORE_OPEN_RE = /^\s*ignore\s*=\s*\[/;
const LIST_CLOSE_RE = /^\s*\]/;
const COMMENT_RE = /^\s*#/;
const ENTRY_RE = /^\s*["']([A-Z]+[0-9]+)["']\s*,?\s*(?:#.*)?$/;

/**
 * The line ending the file already uses. Rewriting a CRLF checkout as LF would
 * put every line of `ruff.toml` in the diff of a job whose whole point is to
 * change two numbers — and `--tighten` commits unattended.
 */
const eolOf = (text) => (text.includes('\r\n') ? '\r\n' : '\n');

/**
 * The `ignore` entries of a ruff config, each with the ceiling declared in the
 * comment block directly above it.
 *
 * Returns `null` when there is no `ignore = [` list at all — which is NOT the
 * same as an empty one. An empty list is the goal state and passes; a list this
 * parser could not find means the file moved or changed shape, and reading that
 * as "nothing to check" is how a gate goes quiet.
 */
export function parseIgnores(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => IGNORE_OPEN_RE.test(l));
  if (start === -1) return null;

  const entries = [];
  let comments = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (LIST_CLOSE_RE.test(line)) break;
    if (COMMENT_RE.test(line)) {
      comments.push({ line: i + 1, text: line });
      continue;
    }
    const m = ENTRY_RE.exec(line);
    if (!m) {
      comments = [];
      continue;
    }
    const marker = comments.map((c) => ({ c, m: MARKER_RE.exec(c.text) })).find((x) => x.m && x.m[1] === m[1]);
    entries.push({
      code: m[1],
      line: i + 1,
      ceiling: marker ? Number(marker.m[2]) : null,
      markerLine: marker ? marker.c.line : null,
      blockStart: comments.length > 0 ? comments[0].line : i + 1,
    });
    comments = [];
  }
  return entries;
}

/** `Map<code, count>` over a ruff JSON diagnostics array. */
export function countByCode(diagnostics) {
  const counts = new Map();
  for (const d of diagnostics) {
    const code = d?.code;
    if (typeof code !== 'string') continue; // a syntax error carries no rule code
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return counts;
}

const finding = (severity, rule, line, message, fix) =>
  makeFinding(severity, rule, RUFF_CONFIG_PATH, message, fix, { line });

/**
 * Pure. `counts` is a `Map<code, count>` measured with the ignores lifted.
 *
 * The ladder is `classify()` in ratchet.mjs; this maps each kind to the sentence
 * a reader of THIS debt file needs. `met` says nothing, which is the whole point
 * of a ratchet that has caught up with its tree.
 */
export function runChecks(entries, counts) {
  const out = [];
  for (const e of entries) {
    const actual = counts.get(e.code) ?? 0;
    switch (classify({ ceiling: e.ceiling, actual })) {
      case 'undeclared':
      case 'unexplained':
        out.push(
          finding(
            BLOCKING,
            'undeclared',
            e.line,
            `\`${e.code}\` is ignored with no ceiling declared.`,
            `Put \`# ratchet: ${e.code} <= ${actual}\` in the comment block above it, with a sentence saying what ` +
              'the debt is. An ignore that names no number cannot be shown to be shrinking, which is the only ' +
              'thing that makes it debt rather than policy.',
          ),
        );
        break;
      case 'zero':
        out.push(
          finding(
            BLOCKING,
            'dead',
            e.line,
            `\`${e.code}\` is ignored and violated nowhere in ${TARGET} — the entry suppresses nothing.`,
            `Delete the \`"${e.code}",\` line and its comment block from ${RUFF_CONFIG_PATH}. This is the check ` +
              "ruff.toml's header asks a human to run by hand; an ignore with no known violation is a gate that " +
              'has stopped meaning anything. `npm run lint:ruff-ratchet -- --tighten` does the deletion.',
          ),
        );
        break;
      case 'grew':
        out.push(
          finding(
            BLOCKING,
            'grew',
            e.line,
            `\`${e.code}\` is violated ${actual} time(s) in ${TARGET}, above its declared ceiling of ${e.ceiling}.`,
            `Fix the ${actual - e.ceiling} new one(s): \`ruff check ${TARGET} --config 'lint.ignore = []' --select ${e.code}\` ` +
              'lists them. Raising the ceiling instead is adding an entry to make a red build green, which ' +
              `${RUFF_CONFIG_PATH} forbids without recording why.`,
          ),
        );
        break;
      case 'slack':
        out.push(
          finding(
            NOTE,
            'slack',
            e.line,
            `\`${e.code}\`: ${actual} violation(s) left, ceiling still says ${e.ceiling}.`,
            'Run `npm run lint:ruff-ratchet -- --tighten` to record the ground gained (autofix.yml does this on ' +
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

// --- measuring the tree -------------------------------------------------------

/**
 * Violation counts per rule with `lint.ignore` emptied — the same `select` the
 * gate uses, so this measures exactly the rules the ignore list is hiding.
 *
 * `--config "lint.ignore = []"` rather than `--ignore ""`: a CLI `--select` does
 * NOT clear the config's `ignore`, so selecting an ignored rule on its own
 * silently matches nothing (the reason autofix.yml's `--fix --select F401,F541`
 * had to grow the same override).
 */
export function ruffCounts({ root = REPO_ROOT, spawn = spawnSync } = {}) {
  const res = spawn(
    'ruff',
    ['check', TARGET, '--config', 'lint.ignore = []', '--output-format', 'json', '--exit-zero'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (res.error) {
    throw new Error(
      `could not run ruff (${res.error.code ?? res.error.message}). CI installs ruff==0.15.0; locally: pip install ruff==0.15.0`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(res.stdout ?? '');
  } catch {
    throw new Error(
      'ruff did not answer with JSON, and an unreadable answer must not be read as "no violations" — ' +
        `every entry would look dead.\n${String(res.stderr || res.stdout || '').trim().slice(0, 800)}`,
    );
  }
  if (!Array.isArray(parsed)) throw new Error('ruff returned JSON that is not an array of diagnostics.');
  return countByCode(parsed);
}

// --- --tighten: the shrink, performed rather than requested --------------------

/** Lower every declared ceiling to what the tree actually carries. */
export function tightenCeilings(text, entries, counts) {
  const lines = text.split(/\r?\n/);
  for (const e of entries) {
    if (e.markerLine === null) continue;
    const actual = counts.get(e.code) ?? 0;
    if (actual === 0 || actual >= e.ceiling) continue; // dead entries are pruned, not re-numbered
    lines[e.markerLine - 1] = lines[e.markerLine - 1].replace(MARKER_RE, `# ratchet: ${e.code} <= ${actual}`);
  }
  return lines.join(eolOf(text));
}

/**
 * Delete entries by code, with the comment block that explains them — an
 * explanation left behind after its entry is exactly the rot the `dead` rule
 * exists to catch, one level up.
 *
 * Refuses to return a rewrite it cannot re-read: if parsing the result does not
 * yield precisely the codes that should be left, the original text comes back
 * unchanged. `--tighten` runs unattended inside autofix.yml, so a bad splice
 * has to be a no-op rather than a committed one.
 */
export function pruneEntries(text, codes) {
  if (codes.length === 0) return text;
  const before = parseIgnores(text);
  if (before === null) return text;

  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => IGNORE_OPEN_RE.test(l));
  const drop = new Set();
  let blockStart = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (LIST_CLOSE_RE.test(line)) break;
    if (COMMENT_RE.test(line)) {
      if (blockStart === null) blockStart = i;
      continue;
    }
    const m = ENTRY_RE.exec(line);
    if (m && codes.includes(m[1])) {
      for (let j = blockStart === null ? i : blockStart; j <= i; j++) drop.add(j);
    }
    blockStart = null;
  }
  if (drop.size === 0) return text;

  const next = lines.filter((_, i) => !drop.has(i)).join(eolOf(text));
  const expected = before.map((e) => e.code).filter((c) => !codes.includes(c));
  const actual = (parseIgnores(next) ?? []).map((e) => e.code);
  if (expected.length !== actual.length || expected.some((c, i) => c !== actual[i])) return text;
  return next;
}

// --- CLI ----------------------------------------------------------------------
//
// The flags, the report, the exit codes and the "a no-op --tighten writes
// nothing" rule are `runRatchetCli`'s, shared with ts-ratchet. What is ruff's
// own is named here: which file to read, how to measure, and what to say.

export const NAME = 'ruff-ratchet';

export const CLEAN = `${NAME}: every ignore in ${RUFF_CONFIG_PATH} declares a ceiling, still suppresses something, and suppresses no more than it did.`;

export const render = (findings) => renderFindings(findings, CLEAN);

/** The whole spec of this ratchet, exported so a fixture can drive it. */
export function spec(argv, { root = REPO_ROOT, read = fs.readFileSync, write = fs.writeFileSync, counts = null } = {}) {
  const file = path.join(root, RUFF_CONFIG_PATH);
  return {
    name: NAME,
    argv,
    load: () => {
      const text = read(file, 'utf8');
      const entries = parseIgnores(text);
      return entries === null ? null : { text, entries };
    },
    unreadable: `no \`ignore = [\` list found in ${RUFF_CONFIG_PATH}. The gate reads that file; if it moved, this check is not checking anything.`,
    measure: () => counts ?? ruffCounts({ root }),
    check: ({ entries, counts: c }) => runChecks(entries, c),
    tighten: ({ text, entries, counts: c }) => {
      const dead = entries.filter((e) => (c.get(e.code) ?? 0) === 0).map((e) => e.code);
      const next = pruneEntries(tightenCeilings(text, entries, c), dead);
      const log = [];
      for (const e of entries) {
        const actual = c.get(e.code) ?? 0;
        if (actual === 0) log.push(`  ${RUFF_CONFIG_PATH}: ${e.code} suppressed nothing — entry deleted.`);
        else if (e.ceiling !== null && actual < e.ceiling) log.push(`  ${RUFF_CONFIG_PATH}: ${e.code} ${e.ceiling} -> ${actual}.`);
      }
      return { text: next, log };
    },
    write: (text) => write(file, text, 'utf8'),
    tightenMessages: {
      none: 'nothing to tighten — every ceiling already matches the tree.',
      done: 'rewrote the ignore list. Re-run without --tighten to confirm.',
    },
    clean: CLEAN,
  };
}

if (process.argv[1]?.endsWith('ruff-ratchet.mjs')) main(spec(process.argv.slice(2)));
