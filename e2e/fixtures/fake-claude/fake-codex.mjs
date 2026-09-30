#!/usr/bin/env node
// A FAKE `codex` CLI for e2e/gig-lifecycle.spec.ts, beside fake-claude.mjs and put first on the
// kp server's PATH the same way: the GPT 6 Astra plan seat (app/_lib/gigs/plan-seats.ts) runs
// through the pin-only Codex CLI engine (pipeline/jobfit/llm/adapters/codex_cli.py), which spawns
// `codex exec ... -` resolved from PATH. This answers that call deterministically, with no
// network, no key and no spend.
//
// The shims: bin-win/codex.cmd (`node "%~dp0..\fake-codex.mjs" %*`) and bin-posix/codex.
//
// What it answers (the shapes codex_cli.py reads, verified against codex-cli 0.157.1):
//   exec [flags] -     the prompt on stdin; the plan use case recognised by its instructions'
//                      first line (gig_plan_cli.py), the untrusted payload read from between
//                      its nonce fences; the answer - ONE plan JSON - written to the
//                      `-o <file>` last-message file, and the `--json` event stream on stdout
//                      (thread.started, turn.started, item.completed agent_message,
//                      turn.completed with token usage - tokens, never dollars).
//   anything else      exit 1, logged, so an unexpected call is visible rather than answered.
//
// Every call is appended as one JSON line to $FAKE_CLAUDE_LOG (the same file fake-claude.mjs
// writes), marked `cli: "codex"`, with the flags the spec asserts on: the model, the effort
// (`-c model_reasoning_effort=<level>`), the sandbox, the disabled tools, the output schema.

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

function log(entry) {
  const file = process.env.FAKE_CLAUDE_LOG;
  if (!file) return;
  try {
    appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), pid: process.pid, cli: "codex", ...entry })}\n`, "utf8");
  } catch {
    // the log is the spec's evidence, never the call's: a failed append must not fail the answer
  }
}

function value(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

function configValue(argv, key) {
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] === "-c" && argv[i + 1].startsWith(`${key}=`)) return argv[i + 1].slice(key.length + 1);
  }
  return null;
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

/** The JSON between `<<<UNTRUSTED_<nonce>>>>` and `<<<END_UNTRUSTED_<nonce>>>>`, or null. */
function fencedPayload(prompt) {
  const open = /^<<<UNTRUSTED_([0-9a-f]+)>>>\r?$/m.exec(prompt);
  if (!open) return null;
  const close = `<<<END_UNTRUSTED_${open[1]}>>>`;
  const start = open.index + open[0].length;
  const end = prompt.indexOf(close, start);
  if (end < 0) return null;
  try {
    return JSON.parse(prompt.slice(start, end));
  } catch {
    return null;
  }
}

function planFor(payload) {
  const title = payload?.untrusted_gig?.title ?? "the gig";
  const lead = "GPT plan";
  return {
    summary: `${lead} for ${title}: split the work into a checked build and a short handover. Keep the scope to what the listing states.`,
    steps: [
      { title: `${lead}: list the requirements as a checklist`, doneWhen: "NOTES.md holds one line per requirement of the brief." },
      { title: `${lead}: build the deliverable`, doneWhen: "The deliverable files exist under deliverable/." },
      { title: `${lead}: check every requirement`, doneWhen: "Every line in NOTES.md is marked checked." },
      { title: `${lead}: write the handover note`, doneWhen: "The draft text names what was delivered and how it was checked." },
    ],
    decisions: [`${lead} keeps the scope to the listing's own words.`],
    risks: [`${lead} risk: the client may want a second revision round.`],
    effortHours: { min: 3, max: 7 },
    questions: [],
  };
}

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "--version" || argv[0] === "-V") {
    process.stdout.write("codex-cli 0.157.1\n");
    return 0;
  }
  const base = {
    argv,
    model: value(argv, "-m"),
    effort: configValue(argv, "model_reasoning_effort"),
    sandbox: value(argv, "--sandbox"),
    allowedTools: null,
    maxTurns: null,
    jsonSchema: argv.includes("--output-schema"),
  };
  if (argv[0] !== "exec" || argv[argv.length - 1] !== "-") {
    log({ ...base, useCase: "unsupported", answered: "exit_1", payload: null });
    process.stderr.write("fake codex: only `codex exec ... -` is answered\n");
    return 1;
  }
  const prompt = await readStdin();
  const payload = fencedPayload(prompt);
  const out = value(argv, "-o");
  const schemaPath = value(argv, "--output-schema");
  let schemaRequired = null;
  if (schemaPath) {
    try {
      schemaRequired = JSON.parse(readFileSync(schemaPath, "utf8")).required ?? null;
    } catch {
      schemaRequired = null;
    }
  }
  if (!prompt.includes("Plan the gig in the fenced region below") || !out) {
    log({ ...base, useCase: "unknown", answered: "exit_1", payload });
    emit({ type: "turn.failed", error: { message: "fake codex: this prompt is not one the gig lifecycle spec scripts" } });
    return 1;
  }
  const answer = JSON.stringify(planFor(payload));
  writeFileSync(out, answer, "utf8");
  log({ ...base, useCase: "plan", seat: "gpt", answered: "ok", payload, schemaRequired });
  emit({ type: "thread.started", thread_id: `fake-${process.pid}` });
  emit({ type: "turn.started" });
  emit({ type: "item.completed", item: { id: "item_0", type: "agent_message", text: answer } });
  emit({ type: "turn.completed", usage: { input_tokens: 15000, cached_input_tokens: 0, output_tokens: 400, reasoning_output_tokens: 0 } });
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    log({ argv: process.argv.slice(2), useCase: "crashed", error: String(err) });
    process.stderr.write(`fake codex crashed: ${String(err)}\n`);
    process.exitCode = 1;
  }
);
