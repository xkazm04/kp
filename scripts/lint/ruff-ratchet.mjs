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
// THE FOUR RULES, and which direction each one forces:
//
//   undeclared  an ignore with no `# ratchet:` marker. Adding an entry now costs
//               you a number, which is the moment somebody has to look at how big
//               the debt actually is. BLOCKING.
//   grew        more violations than the ceiling. The list cannot absorb new
//               debt under an old entry — the failure mode where "5x unused
//               imports" quietly becomes fifty. BLOCKING.
//   dead        ZERO violations. The ignore has stopped meaning anything, so it
//               must go: this is `ruff.toml`'s own one-command procedure for
//               retiring `F821`, run by CI instead of by whoever remembers.
//               BLOCKING — and `--tighten` performs the deletion.
//   slack       fewer violations than the ceiling. A NOTE, not a block: making
//               every burnt-down violation a red build would tax the fix rather
//               than the debt. `--tighten` lowers the ceilings, and autofix.yml
//               runs it on every pull request, so the recorded numbers follow the
//               tree down without anyone typing anything.
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

const finding = (severity, rule, line, message, fix) => ({ severity, rule, file: RUFF_CONFIG_PATH, line, message, fix });

/** Pure. `counts` is a `Map<code, count>` measured with the ignores lifted. */
export function runChecks(entries, counts) {
  const out = [];
  for (const e of entries) {
    const actual = counts.get(e.code) ?? 0;
    if (e.ceiling === null) {
      out.push(
        finding(
          'blocking',
          'undeclared',
          e.line,
          `\`${e.code}\` is ignored with no ceiling declared.`,
          `Put \`# ratchet: ${e.code} <= ${actual}\` in the comment block above it, with a sentence saying what ` +
            'the debt is. An ignore that names no number cannot be shown to be shrinking, which is the only ' +
            'thing that makes it debt rather than policy.',
        ),
      );
      continue;
    }
    if (actual === 0) {
      out.push(
        finding(
          'blocking',
          'dead',
          e.line,
          `\`${e.code}\` is ignored and violated nowhere in ${TARGET} — the entry suppresses nothing.`,
          `Delete the \`"${e.code}",\` line and its comment block from ${RUFF_CONFIG_PATH}. This is the check ` +
            "ruff.toml's header asks a human to run by hand; an ignore with no known violation is a gate that " +
            'has stopped meaning anything. `npm run lint:ruff-ratchet -- --tighten` does the deletion.',
        ),
      );
      continue;
    }
    if (actual > e.ceiling) {
      out.push(
        finding(
          'blocking',
          'grew',
          e.line,
          `\`${e.code}\` is violated ${actual} time(s) in ${TARGET}, above its declared ceiling of ${e.ceiling}.`,
          `Fix the ${actual - e.ceiling} new one(s): \`ruff check ${TARGET} --config 'lint.ignore = []' --select ${e.code}\` ` +
            'lists them. Raising the ceiling instead is adding an entry to make a red build green, which ' +
            `${RUFF_CONFIG_PATH} forbids without recording why.`,
        ),
      );
      continue;
    }
    if (actual < e.ceiling) {
      out.push(
        finding(
          'note',
          'slack',
          e.line,
          `\`${e.code}\`: ${actual} violation(s) left, ceiling still says ${e.ceiling}.`,
          'Run `npm run lint:ruff-ratchet -- --tighten` to record the ground gained (autofix.yml does this on ' +
            'every pull request). Until then the entry would let the debt grow back to the old number.',
        ),
      );
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

export function parseArgs(argv) {
  return { tighten: argv.includes('--tighten'), json: argv.includes('--json') };
}

export function render(findings) {
  if (findings.length === 0)
    return `ruff-ratchet: every ignore in ${RUFF_CONFIG_PATH} declares a ceiling, still suppresses something, and suppresses no more than it did.`;
  const lines = findings.map(
    (f) => `${f.severity === 'blocking' ? 'BLOCK' : ' note'}  ${f.file}:${f.line}  [${f.rule}] ${f.message}\n        ${f.fix}`,
  );
  const blocking = findings.filter((f) => f.severity === 'blocking').length;
  lines.push('', `${blocking} blocking, ${findings.length - blocking} note(s).`);
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const file = path.join(REPO_ROOT, RUFF_CONFIG_PATH);
  const text = fs.readFileSync(file, 'utf8');
  const entries = parseIgnores(text);
  if (entries === null) {
    console.error(`ruff-ratchet: no \`ignore = [\` list found in ${RUFF_CONFIG_PATH}. The gate reads that file; if it moved, this check is not checking anything.`);
    process.exit(1);
  }

  const counts = ruffCounts();

  if (args.tighten) {
    const dead = entries.filter((e) => (counts.get(e.code) ?? 0) === 0).map((e) => e.code);
    let next = tightenCeilings(text, entries, counts);
    next = pruneEntries(next, dead);
    if (next === text) {
      console.log('ruff-ratchet: nothing to tighten — every ceiling already matches the tree.');
      return;
    }
    fs.writeFileSync(file, next, 'utf8');
    for (const e of entries) {
      const actual = counts.get(e.code) ?? 0;
      if (actual === 0) console.log(`  ${RUFF_CONFIG_PATH}: ${e.code} suppressed nothing — entry deleted.`);
      else if (e.ceiling !== null && actual < e.ceiling) console.log(`  ${RUFF_CONFIG_PATH}: ${e.code} ${e.ceiling} -> ${actual}.`);
    }
    console.log('ruff-ratchet: rewrote the ignore list. Re-run without --tighten to confirm.');
    return;
  }

  const findings = runChecks(entries, counts);
  if (args.json) console.log(JSON.stringify(findings, null, 2));
  else console.log(render(findings));
  process.exit(findings.some((f) => f.severity === 'blocking') ? 1 : 0);
}

if (process.argv[1]?.endsWith('ruff-ratchet.mjs')) {
  try {
    main();
  } catch (err) {
    console.error(`ruff-ratchet: ${err.message}`);
    process.exit(1);
  }
}
