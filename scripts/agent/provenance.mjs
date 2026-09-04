#!/usr/bin/env node
// Which AGENT wrote this diff — as trailers, so `git log` can be queried for it.
//
// THE GAP THIS CLOSES: the commit bodies an automated lane writes here say which
// LANE committed (`Proposed by scripts/agent/dispatch.mjs from issue #12`,
// `Dispatched-by: someone`). That is honest and it is unqueryable: it names the
// pipe, not the model, not the prompt the model was given, and not the run whose
// logs still exist. With a growing share of this tree written by agents, the
// question that actually gets asked after a bad change is "what produced this,
// and what else did that produce" — and today the answer is a grep over prose.
//
// A trailer block answers it in one command:
//
//   git log --format='%H %(trailers:key=Agent-model,valueonly)'
//   git log --grep '^Agent-harness: scripts/agent/dispatch.mjs@1' --format=%H
//
// ─────────────────────────────────────────────────────────────────────────────
// ONE VOCABULARY, TWO SPELLINGS — AND WHY THIS FILE OWNS BOTH
//
// This repository grew TWO designs for the same fact, in two files, and they
// COLLIDED. `scripts/release/provenance.mjs` defined a compact
// `Agent-Provenance: agent=…; model=…; lane=…; task=…` one-liner for foreign
// lanes and documented it in CONTRIBUTING.md. This file defined the four-key
// expanded block below and refused any `Agent-*` key outside it. Both rules ran
// on every commit through `scripts/release/commit-msg.mjs` — so the trailer
// CONTRIBUTING.md told an outside lane to write was REJECTED by the
// commit-convention gate, with five findings, as an undefined key plus four
// missing ones. Two vocabularies for one question is how that happens; there is
// now one, and it lives here, and the release module reads it rather than
// re-declaring it.
//
// THE EXPANDED FORM — four keys, all required together. What a lane INSIDE this
// repository writes, because it knows all four:
//
//   Agent-model     the model id, exactly as the harness asked for it. The first
//                   thing you change when an eval regresses.
//   Agent-harness   `<path>@<version>` — WHICH driver, at WHICH version. The path
//                   alone would have been true of every dispatch since the file
//                   was created, including the ones written before the bug.
//   Agent-prompt    a digest of the exact instruction text the run used (system
//                   prompt + whatever the harness composed into it). A version
//                   number lies the moment somebody edits a prompt without
//                   bumping it; a digest cannot. Different digest, different
//                   conditions — that is the whole claim it makes.
//   Agent-run       where the evidence is: a workflow-run URL, or `local` when
//                   the harness ran on somebody's machine and there is no log to
//                   link. `local` is a real answer and says so.
//
// PARTIAL IS THE FAILURE MODE. Three of four keys reads as provenance and cannot
// be joined on, so `checkProvenance` treats any expanded key as a promise of all
// four.
//
// THE COMPACT FORM — one trailer, `key=value` pairs. What a FOREIGN lane writes
// when it cannot render four lines into a message template, and the shape
// CONTRIBUTING.md publishes:
//
//   Agent-Provenance: agent=claude-code; model=claude-opus-5; lane=ascent; task=abc123
//
// Every pair is optional and at least one is required — a lane that knows only
// its own name and its model says that much rather than nothing. The pair keys
// are the union of the two designs (`agent`, `lane`, `task` from the compact
// side; `model`, `harness`, `prompt`, `run` from the expanded one) and the value
// rules are the SAME rules: a `harness=` without a version, a `prompt=` that is
// not a digest and a `run=` that is neither URL nor `local` fail identically in
// both spellings, because they are one vocabulary.
//
// WHAT IS REFUSED, in either form: an `Agent-…` key or a pair key outside the
// vocabulary (an invented one is a value no query will ever look for), the same
// key twice (a trailer read answers ambiguously), an empty value, and MIXING the
// two forms in one commit — two answers to one question is the defect this file
// was merged to remove, not a convenience to preserve.
//
// It is silent on a commit that carries no `Agent-*` trailer at all: a human
// commit is not required to claim an agent wrote it, and a gate that demanded
// one would go red on the overwhelming majority of this history.
//
//   node scripts/agent/provenance.mjs --model claude-opus-5 \
//     --harness scripts/agent/dispatch.mjs@1 --prompt-file <file> --run <url>
//
// prints the expanded block on stdout, so a workflow can append it to a message
// file without assembling trailers in bash. `--compact` prints the one-liner
// instead, for a lane whose template has room for a single line.
//
// WHERE IT RUNS: `checkProvenance` is reached from `scripts/release/commit-msg.mjs`
// (through `checkTrailers`, which is the one entry point for a body's trailers),
// which runs in `.githooks/commit-msg` and in ci.yml's `commit-convention` job
// over every commit in the pushed range. A half-written provenance block fails
// the same way a malformed subject does.

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

/** The expanded block, in the order it is rendered. All four are required together. */
export const PROVENANCE_KEYS = ['Agent-model', 'Agent-harness', 'Agent-prompt', 'Agent-run'];

/** The compact spelling: one trailer carrying `key=value` pairs. */
export const COMPACT_KEY = 'Agent-Provenance';

/** The shape the compact trailer is documented as, quoted in every message about it. */
export const COMPACT_SHAPE = 'agent=<name>; model=<id>; lane=<name>; task=<id>';

/**
 * The pair keys the compact form may carry — the union of both original designs,
 * which is what makes them one vocabulary rather than two. `agent`/`lane`/`task`
 * describe WHO ran it and WHY; `model`/`harness`/`prompt`/`run` are the expanded
 * block's four, spelled lowercase, and validated by the same rules.
 */
export const COMPACT_FIELDS = ['agent', 'model', 'lane', 'task', 'harness', 'prompt', 'run'];

/** Any `Agent-…` trailer at all — the trigger for requiring a whole, single form. */
const AGENT_TRAILER_RE = /^(Agent-[A-Za-z0-9-]+):[ \t]*(.*)$/;

/**
 * Trailers in a commit body, as `[key, value]` in source order. Deliberately a
 * line reader rather than `git interpret-trailers`: this has to be pure so the
 * fixtures cover the rule, and a trailer this repository writes is always a
 * whole line.
 */
export function agentTrailers(body) {
  const out = [];
  for (const line of String(body ?? '').split(/\r?\n/)) {
    const m = line.match(AGENT_TRAILER_RE);
    if (m) out.push([m[1], m[2].trim()]);
  }
  return out;
}

/** `a=1; b=2` → `{a: '1', b: '2'}`. Tolerant of spacing; ignores anything with no `=`. */
export function parsePairs(value) {
  const out = {};
  for (const part of String(value ?? '').split(/\s*;\s*/)) {
    const m = /^([A-Za-z][\w-]*)\s*=\s*(.+)$/.exec(part.trim());
    if (m) out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}

/** A short, stable digest of the instruction text a run was given. */
export function promptDigest(text) {
  return `sha256:${createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex').slice(0, 16)}`;
}

const DIGEST_RE = /^sha256:[0-9a-f]{16,64}$/;
const HARNESS_RE = /^[\w./-]+@[\w.+-]+$/;
const RUN_RE = /^(?:https?:\/\/\S+|local)$/;

/**
 * The value rules, keyed by the FIELD name (lowercase, form-independent). This
 * table is the whole reason the two spellings are one vocabulary: `Agent-harness:
 * dispatch.mjs` and `Agent-Provenance: harness=dispatch.mjs` are the same
 * mistake, and before the merge only the first of them was caught.
 */
const VALUE_RULES = {
  harness: [
    HARNESS_RE,
    (v) =>
      `"${v}" is not \`<path-or-name>@<version>\`. The path alone is true of every run the ` +
      'driver has ever made, including the ones before the change you are looking for.',
  ],
  prompt: [
    DIGEST_RE,
    (v) =>
      `"${v}" is not a \`sha256:<hex>\` digest. A hand-written version number stops being ` +
      'true the first time somebody edits a prompt without bumping it; a digest of the text cannot.',
  ],
  run: [
    RUN_RE,
    (v) => `"${v}" is neither a URL nor \`local\`. Point at the run whose logs still exist, or say \`local\` and mean it.`,
  ],
};

/**
 * What one commit body says about the agent that wrote it, normalised across
 * both spellings.
 *
 * Pure. Returns `{ form, agent, model, lane, task, harness, prompt, run }`;
 * `form` is `'none' | 'expanded' | 'compact' | 'mixed'` and every other field is
 * a string or null. This is the ONE reader — the query in
 * scripts/release/provenance.mjs calls it rather than parsing `Agent-*` again,
 * which is why a commit written by this repository's own dispatch lane now
 * counts as agent-authored instead of reading as a human's.
 */
export function readProvenance(body) {
  const found = agentTrailers(body);
  const record = { form: 'none', agent: null, model: null, lane: null, task: null, harness: null, prompt: null, run: null };
  if (found.length === 0) return record;

  const compact = found.filter(([key]) => key === COMPACT_KEY);
  const expanded = found.filter(([key]) => key !== COMPACT_KEY);

  if (compact.length && expanded.length) record.form = 'mixed';
  else if (compact.length) record.form = 'compact';
  else record.form = 'expanded';

  for (const [key, value] of expanded) {
    const field = key.slice('Agent-'.length).toLowerCase();
    if (field in record && field !== 'form' && record[field] === null) record[field] = value || null;
  }
  for (const [, value] of compact) {
    for (const [field, v] of Object.entries(parsePairs(value))) {
      if (field in record && field !== 'form' && record[field] === null) record[field] = v || null;
    }
  }
  return record;
}

/**
 * Judge the `Agent-*` trailers of one commit body.
 * Pure. Returns problems; empty means "no provenance claimed" or "a complete one
 * in exactly one of the two spellings".
 */
export function checkProvenance(body) {
  const found = agentTrailers(body);
  if (found.length === 0) return [];

  const problems = [];
  const compact = found.filter(([key]) => key === COMPACT_KEY);
  const expanded = found.filter(([key]) => key !== COMPACT_KEY);

  if (compact.length && expanded.length) {
    problems.push(
      `this commit carries both spellings of the provenance vocabulary — the \`${COMPACT_KEY}:\` one-liner AND ` +
        `the ${PROVENANCE_KEYS.join('/')} block. Two answers to one question cannot be joined on; write one form.`,
    );
    return problems;
  }

  const fail = (field, value) => {
    const rule = VALUE_RULES[field];
    if (rule && value && !rule[0].test(value)) problems.push(rule[1](value));
  };

  if (compact.length) {
    if (compact.length > 1) {
      problems.push(`"${COMPACT_KEY}:" appears twice — a trailer read with \`git log --format=%(trailers)\` would answer ambiguously.`);
    }
    for (const [, value] of compact) {
      if (value === '') {
        problems.push(`"${COMPACT_KEY}:" is empty — a blank value is a claim that reads as an answer.`);
        continue;
      }
      const pairs = parsePairs(value);
      const fields = Object.keys(pairs);
      if (fields.length === 0) {
        problems.push(
          `\`${COMPACT_KEY}: ${value}\` holds no \`key=value\` pair, so nothing can read it — ` +
            `the shape is \`${COMPACT_SHAPE}\``,
        );
        continue;
      }
      for (const field of fields) {
        if (!COMPACT_FIELDS.includes(field)) {
          problems.push(
            `\`${COMPACT_KEY}\` carries \`${field}=\`, which is not a field this repository defines, so nothing will ` +
              `ever query it. The fields are: ${COMPACT_FIELDS.join(', ')}.`,
          );
          continue;
        }
        if (!pairs[field]) problems.push(`\`${COMPACT_KEY}\` carries an empty \`${field}=\` — a blank value is a claim that reads as an answer.`);
        else fail(field, pairs[field]);
      }
    }
    return problems;
  }

  const seen = new Map();
  for (const [key, value] of expanded) {
    if (!PROVENANCE_KEYS.includes(key)) {
      problems.push(
        `"${key}:" is not a provenance trailer this repository defines, so nothing will ever query it. ` +
          `The block is exactly: ${PROVENANCE_KEYS.join(', ')} — or the one-line \`${COMPACT_KEY}: ${COMPACT_SHAPE}\`.`,
      );
      continue;
    }
    if (seen.has(key)) {
      problems.push(`"${key}:" appears twice — a trailer read with \`git log --format=%(trailers)\` would answer ambiguously.`);
      continue;
    }
    seen.set(key, value);
  }

  for (const key of PROVENANCE_KEYS) {
    if (!seen.has(key)) {
      problems.push(
        `this commit claims agent provenance but has no "${key}:" trailer — three of four keys cannot be ` +
          'joined on, which is the same as none. Emit the whole block or none of it.',
      );
    } else if (seen.get(key) === '') {
      problems.push(`"${key}:" is empty — a blank value is a claim that reads as an answer.`);
    }
  }

  for (const key of PROVENANCE_KEYS) {
    const field = key.slice('Agent-'.length).toLowerCase();
    if (seen.has(key)) fail(field, seen.get(key));
  }

  return problems;
}

/** Render the expanded block. Throws rather than emitting a half-block. */
export function renderProvenance({ model, harness, prompt, run }) {
  const block = {
    'Agent-model': model,
    'Agent-harness': harness,
    'Agent-prompt': prompt,
    'Agent-run': run || 'local',
  };
  const lines = PROVENANCE_KEYS.map((key) => `${key}: ${String(block[key] ?? '').trim()}`);
  const problems = checkProvenance(lines.join('\n'));
  if (problems.length) throw new Error(`provenance: refusing to render an invalid block:\n  - ${problems.join('\n  - ')}`);
  return lines.join('\n');
}

/**
 * Render the compact one-liner, for a lane whose commit template has room for a
 * single trailer. Same refusal: an unreadable line is not emitted.
 */
export function renderCompact(fields) {
  const pairs = COMPACT_FIELDS.filter((f) => fields?.[f]).map((f) => `${f}=${String(fields[f]).trim()}`);
  const line = `${COMPACT_KEY}: ${pairs.join('; ')}`;
  const problems = checkProvenance(line);
  if (problems.length) throw new Error(`provenance: refusing to render an invalid trailer:\n  - ${problems.join('\n  - ')}`);
  return line;
}

// --- cli ---------------------------------------------------------------------

export function parseArgs(argv) {
  const out = { model: null, harness: null, prompt: null, promptFile: null, run: null, agent: null, lane: null, task: null, compact: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--model') out.model = argv[++i];
    else if (argv[i] === '--harness') out.harness = argv[++i];
    else if (argv[i] === '--prompt') out.prompt = argv[++i];
    else if (argv[i] === '--prompt-file') out.promptFile = argv[++i];
    else if (argv[i] === '--run') out.run = argv[++i];
    else if (argv[i] === '--agent') out.agent = argv[++i];
    else if (argv[i] === '--lane') out.lane = argv[++i];
    else if (argv[i] === '--task') out.task = argv[++i];
    else if (argv[i] === '--compact') out.compact = true;
  }
  return out;
}

function main(argv) {
  const args = parseArgs(argv);
  const promptText = args.promptFile ? fs.readFileSync(args.promptFile, 'utf8') : args.prompt;
  const prompt = promptText ? promptDigest(promptText) : '';
  try {
    process.stdout.write(
      `${
        args.compact
          ? renderCompact({ agent: args.agent, model: args.model, lane: args.lane, task: args.task, harness: args.harness, prompt, run: args.run })
          : renderProvenance({ model: args.model, harness: args.harness, prompt, run: args.run })
      }\n`,
    );
    return 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
}

// Compared as a resolved URL, not by filename: `scripts/release/provenance.mjs`
// is also called provenance.mjs, and it now IMPORTS this module — an
// `endsWith('provenance.mjs')` guard would run this CLI as a side effect of
// `npm run provenance` and exit 1 before the query ever printed.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
