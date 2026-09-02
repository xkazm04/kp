#!/usr/bin/env node
// WHAT A RATCHET IS IN THIS REPOSITORY — the protocol, written once.
//
// THE GAP THIS CLOSES: `package.json` exposes `lint:ruff-ratchet` and
// `lint:ts-ratchet` as siblings. They solve one problem — lift the suppressions
// the linter cannot see past, count them, compare against a ceiling declared
// beside each one, and lower the ceiling when the tree improves — against two
// different debt formats. The CONCEPT was defined once, in `ruff.toml`'s header,
// and IMPLEMENTED twice: two verdict ladders, two renderers, two `parseArgs`,
// two CLIs with the same exit codes and slightly different words for them. A
// reader who learned the ruff ratchet learned nothing transferable, and the
// TypeScript side's rules were readable only by reading its source.
//
// This module is the shared half. A ratchet is now: a DEBT FILE this module does
// not read, a MEASUREMENT this module does not take, and everything between them
// — which is here.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE PROTOCOL
//
// A ratchet holds a class of suppression to a CEILING: a number, declared beside
// the suppression, in the debt file's own syntax. `classify()` below is the whole
// verdict ladder, and every ratchet in this repository answers with one of its
// six kinds:
//
//   undeclared   the suppression exists and no ceiling was declared for it.
//                BLOCKING, always. Adding a suppression costs you a number, and
//                writing the number is the moment somebody has to look at how big
//                the debt really is.
//   unexplained  a ceiling that is not a non-negative integer, or one with no
//                stated reason where the format has somewhere to put one.
//                BLOCKING. The number records how big the debt is; the sentence
//                is the only thing that records whether it is debt at all.
//   grew         more occurrences than the ceiling. BLOCKING. This is the pawl:
//                the list cannot absorb new debt under an old entry.
//   zero         the suppression now suppresses nothing. What that MEANS is the
//                one thing the two ratchets legitimately disagree about, so this
//                kind is deliberately named after the measurement rather than
//                after a verdict — see "where they differ" below.
//   slack        fewer than the ceiling. A NOTE, never a block: making every
//                removed suppression a red build taxes the fix rather than the
//                debt. `--tighten` records the ground gained, and autofix.yml
//                runs it on every pull request, so ceilings follow the tree down
//                without anyone typing anything.
//   met          exactly at the ceiling. Silence.
//
// EXIT CODES, shared: 0 clean or notes only · 1 a blocking finding, or the debt
// file / the tree could not be read.
//
// REFUSING TO GUESS is part of the protocol, not an implementation detail. A
// measurement that fails must never be read as "nothing found": every entry
// would look burnt down, and a `--tighten` running unattended inside autofix.yml
// would zero or delete the whole list without having opened the tree. Both
// ratchets therefore throw rather than return an empty measurement, and
// `runRatchetCli` turns that into exit 1 with the message.
//
// WHERE THE TWO LEGITIMATELY DIFFER, and why this is a protocol rather than a
// base class:
//
//   the entry     ruff's entry IS the suppression (`"F401",` in `lint.ignore`),
//                 so an entry measuring zero is rot: a live ignore that excuses
//                 nothing reads as policy. `dead`, BLOCKING, and `--tighten`
//                 deletes it.
//                 ts-debt.json's entry is a CEILING ON a suppression, not the
//                 suppression itself, so an entry measuring zero is a WIN worth
//                 keeping — `--tighten` lowers it to 0, which locks the class,
//                 because 0 is a ceiling like any other and the next arrival is
//                 `grew`. A note, not a block.
//
//   the format    `# ratchet: <CODE> <= <N>` in a TOML comment beside the entry,
//                 versus `{ "max": <n>, "why": "<sentence>" }` in JSON. Both
//                 spellings of one idea; neither substrate can host the other's
//                 syntax, and rewriting either to share a literal grammar would
//                 buy a third file to keep in sync rather than remove one.
//
// SO IF A THIRD LANGUAGE ARRIVES: it is a new debt file plus a `measure` and a
// `parse`, both of which are inherently language-specific — and NOT a third copy
// of the ladder, the renderer or the CLI. That is the test this split is meant
// to pass.

/** `BLOCK`s stop a build; `note`s are printed and do not. */
export const BLOCKING = 'blocking';
export const NOTE = 'note';

/**
 * The verdict ladder, shared. Pure, and the only place the ORDER of these
 * questions is decided.
 *
 * `ceiling` is null/undefined when the debt file declares none. `explained` is
 * false when the format has a place for a reason and it is empty — ruff's
 * comment-block form has no machine-readable reason, so it passes true.
 *
 * `zero` is checked before `grew`/`slack` deliberately: "this suppresses
 * nothing" is a statement about the tree that both ratchets want to act on
 * first, even though they then act on it differently.
 */
export function classify({ ceiling, actual, explained = true }) {
  if (ceiling === null || ceiling === undefined) return 'undeclared';
  if (!Number.isInteger(ceiling) || ceiling < 0) return 'unexplained';
  if (!explained) return 'unexplained';
  if (actual === 0) return 'zero';
  if (actual > ceiling) return 'grew';
  if (actual < ceiling) return 'slack';
  return 'met';
}

/**
 * One finding. `extra` carries whatever the debt format can point at — a line
 * number for a config file, a key for a JSON entry — and the renderer prints a
 * location only when there is one.
 */
export const finding = (severity, rule, file, message, fix, extra = {}) => ({
  severity,
  rule,
  file,
  message,
  fix,
  ...extra,
});

/** `--tighten` lowers the ceilings; `--json` prints the findings verbatim. */
export function parseArgs(argv) {
  return { tighten: argv.includes('--tighten'), json: argv.includes('--json') };
}

/** `file:line` when the format can point at a line, `file` when it cannot. */
const locate = (f) => (f.line === undefined || f.line === null ? f.file : `${f.file}:${f.line}`);

/**
 * The shared report. `clean` is the sentence a ratchet prints when it has
 * nothing to say — which is the one part worth spelling out per ratchet, because
 * it is where a reader learns what was actually checked.
 */
export function renderFindings(findings, clean) {
  if (findings.length === 0) return clean;
  const lines = findings.map(
    (f) => `${f.severity === BLOCKING ? 'BLOCK' : ' note'}  ${locate(f)}  [${f.rule}] ${f.message}\n        ${f.fix}`,
  );
  const blocking = findings.filter((f) => f.severity === BLOCKING).length;
  lines.push('', `${blocking} blocking, ${findings.length - blocking} note(s).`);
  return lines.join('\n');
}

export const hasBlocking = (findings) => findings.some((f) => f.severity === BLOCKING);

/**
 * The CLI both ratchets are. Everything here was written twice before: read the
 * debt file, refuse to continue if it lost the shape the gate reads, measure the
 * tree, then either rewrite the ceilings or report against them.
 *
 * `tighten` returns `{ text, log }` — the whole new file, plus the lines to print
 * about what moved. Returning text identical to the input is how a ratchet says
 * "nothing to tighten", and NOTHING IS WRITTEN in that case: `--tighten` runs
 * unattended inside autofix.yml, so a no-op job must produce an empty diff.
 *
 * @param {object} spec
 * @param {string} spec.name        the tool name every message is prefixed with
 * @param {string[]} spec.argv      process.argv.slice(2)
 * @param {() => object|null} spec.load   `{ text, entries }`, or null when the
 *                                        debt file lost its shape
 * @param {string} spec.unreadable  what to say when `load` answers null
 * @param {(entries) => any} spec.measure  the tree. Throws rather than guesses.
 * @param {(ctx) => object} spec.check     `(entries, counts) => findings`
 * @param {(ctx) => {text, log}} spec.tighten
 * @param {(text) => void} spec.write
 * @param {{none: string, done: string}} spec.tightenMessages
 * @param {string} spec.clean
 * @returns {number} the process exit code
 */
export function runRatchetCli({
  name,
  argv,
  load,
  unreadable,
  measure,
  check,
  tighten,
  write,
  tightenMessages,
  clean,
  log = console.log,
  err = console.error,
}) {
  const args = parseArgs(argv);
  const loaded = load();
  if (loaded === null) {
    err(`${name}: ${unreadable}`);
    return 1;
  }

  const counts = measure(loaded.entries);

  if (args.tighten) {
    const { text, log: moved } = tighten({ ...loaded, counts });
    if (text === loaded.text) {
      log(`${name}: ${tightenMessages.none}`);
      return 0;
    }
    write(text);
    for (const line of moved) log(line);
    log(`${name}: ${tightenMessages.done}`);
    return 0;
  }

  const findings = check({ ...loaded, counts });
  log(args.json ? JSON.stringify(findings, null, 2) : renderFindings(findings, clean));
  return hasBlocking(findings) ? 1 : 0;
}

/**
 * Run a ratchet's CLI as a process: the try/catch both mains carried, in which
 * "the tree could not be measured" is exit 1 with the reason rather than a
 * stack trace or, worse, a pass.
 */
export function main(spec) {
  try {
    // Exit explicitly only on failure. Falling off the end on success lets the
    // report flush on its own — `process.exit()` immediately after a write to a
    // pipe is how a CI log loses the last line of the thing it is quoting.
    const code = runRatchetCli(spec);
    if (code !== 0) process.exit(code);
  } catch (e) {
    console.error(`${spec.name}: ${e.message}`);
    process.exit(1);
  }
}
