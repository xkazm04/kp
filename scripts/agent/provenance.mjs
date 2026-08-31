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
// THE FOUR KEYS, and why each one is required rather than nice to have:
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
// be joined on, so `checkProvenance` treats any Agent-* trailer as a promise of
// all four — and refuses a key outside the set, because an invented one is a
// value no query will ever look for. It is silent on a commit that carries none:
// a human commit is not required to claim an agent wrote it.
//
//   node scripts/agent/provenance.mjs --model claude-opus-5 \
//     --harness scripts/agent/dispatch.mjs@1 --prompt-file <file> --run <url>
//
// prints the block on stdout, so a workflow can append it to a message file
// without assembling trailers in bash.
//
// WHERE IT RUNS: `checkProvenance` is called by scripts/release/commit-msg.mjs,
// which runs in `.githooks/commit-msg` and in ci.yml's `commit-convention` job
// over every commit in the pushed range. A half-written provenance block fails
// the same way a malformed subject does.

import fs from 'node:fs';
import { createHash } from 'node:crypto';

/** The block, in the order it is rendered. All four are required together. */
export const PROVENANCE_KEYS = ['Agent-model', 'Agent-harness', 'Agent-prompt', 'Agent-run'];

/** Any `Agent-…` trailer at all — the trigger for requiring the whole block. */
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

/** A short, stable digest of the instruction text a run was given. */
export function promptDigest(text) {
  return `sha256:${createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex').slice(0, 16)}`;
}

const DIGEST_RE = /^sha256:[0-9a-f]{16,64}$/;
const HARNESS_RE = /^[\w./-]+@[\w.+-]+$/;
const RUN_RE = /^(?:https?:\/\/\S+|local)$/;

/**
 * Judge the Agent-* trailers of one commit body.
 * Pure. Returns problems; empty means "no provenance claimed" or "a complete one".
 */
export function checkProvenance(body) {
  const found = agentTrailers(body);
  if (found.length === 0) return [];

  const problems = [];
  const seen = new Map();
  for (const [key, value] of found) {
    if (!PROVENANCE_KEYS.includes(key)) {
      problems.push(
        `"${key}:" is not a provenance trailer this repository defines, so nothing will ever query it. ` +
          `The block is exactly: ${PROVENANCE_KEYS.join(', ')}.`,
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

  const harness = seen.get('Agent-harness');
  if (harness && !HARNESS_RE.test(harness)) {
    problems.push(
      `"Agent-harness: ${harness}" is not \`<path-or-name>@<version>\`. The path alone is true of every run the ` +
        'driver has ever made, including the ones before the change you are looking for.',
    );
  }
  const prompt = seen.get('Agent-prompt');
  if (prompt && !DIGEST_RE.test(prompt)) {
    problems.push(
      `"Agent-prompt: ${prompt}" is not a \`sha256:<hex>\` digest. A hand-written version number stops being ` +
        'true the first time somebody edits a prompt without bumping it; a digest of the text cannot.',
    );
  }
  const run = seen.get('Agent-run');
  if (run && !RUN_RE.test(run)) {
    problems.push(
      `"Agent-run: ${run}" is neither a URL nor \`local\`. Point at the run whose logs still exist, or say ` +
        '`local` and mean it.',
    );
  }

  return problems;
}

/** Render the block. Throws rather than emitting a half-block. */
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

// --- cli ---------------------------------------------------------------------

export function parseArgs(argv) {
  const out = { model: null, harness: null, prompt: null, promptFile: null, run: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--model') out.model = argv[++i];
    else if (argv[i] === '--harness') out.harness = argv[++i];
    else if (argv[i] === '--prompt') out.prompt = argv[++i];
    else if (argv[i] === '--prompt-file') out.promptFile = argv[++i];
    else if (argv[i] === '--run') out.run = argv[++i];
  }
  return out;
}

function main(argv) {
  const args = parseArgs(argv);
  const promptText = args.promptFile ? fs.readFileSync(args.promptFile, 'utf8') : args.prompt;
  try {
    process.stdout.write(
      `${renderProvenance({
        model: args.model,
        harness: args.harness,
        prompt: promptText ? promptDigest(promptText) : '',
        run: args.run,
      })}\n`,
    );
    return 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (process.argv[1]?.endsWith('provenance.mjs')) {
  process.exit(main(process.argv.slice(2)));
}
