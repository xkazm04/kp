#!/usr/bin/env node
// A FAKE `claude` CLI for e2e/gig-lifecycle.spec.ts: the Python LLM layer spawns `claude`
// from PATH (pipeline/jobfit/claude_cli.py, `shutil.which("claude")`), so a directory holding
// this script's shim, put FIRST on the kp server's PATH, answers every Claude CLI call the gig
// lifecycle makes - deterministically, with no network, no key and no spend.
//
// The shims (the platform picks one; the spec puts that directory first on PATH):
//   bin-win/claude.cmd   `node "%~dp0..\fake-claude.mjs" %*` - Windows resolves `claude`
//                        through PATHEXT, and claude_cli.py invokes the resolved path
//   bin-posix/claude     `exec node "$(dirname "$0")/../fake-claude.mjs" "$@"`
//
// What it answers (the shapes claude_cli.py parses, `_parse_envelope`):
//   --version                    "2.1.245 (Claude Code)" (the VERIFIED_CLI_VERSION pin)
//   auth status --json           {"loggedIn": true, ...}
//   -p --output-format json ...  the prompt arrives on stdin; the use case is recognised by
//                                the instructions' first line (a stable marker of each CLI's
//                                prompt, gig_brief_cli.py / gig_plan_cli.py), the untrusted
//                                payload is read from between its nonce fences, and the answer
//                                is ONE result envelope: {type, subtype: "success", is_error,
//                                result: <JSON text>, structured_output (under --json-schema),
//                                total_cost_usd, duration_ms, num_turns, session_id, usage,
//                                modelUsage}.
//
// Deterministic behaviour, driven only by the call's own input:
//   brief (gig-brief-v4, `Describe the gig ...`): a fixed valid brief; its category follows
//     the listing title ("Web development · ..."), three challenges, and every past withdraw
//     reason the payload carries is repeated word for word as a challenge (the prompt's rule).
//     Its DIFFICULTY picks the plan lineup (plan-seats.ts): `very_hard` for the bakery landing
//     page and any title holding `[very-hard]` or `[fable-fails]` (three seats: Opus xhigh,
//     Fable, GPT through the fake `codex` beside this file), `moderate` otherwise (one Sonnet
//     seat). The v4 fields: language "en", two missing artifacts, an outreach message for a
//     freelance listing, work kind "digital".
//   plan (gig-plan-v1, `Plan the gig ...`): one plan per `--model`, different per seat so a
//     reader can tell the columns apart (its summary names the seat); a gig whose title holds
//     `[fable-fails]` makes the Fable seat exit 1 with no output (a failed seat). The GPT seat
//     is answered by fake-codex.mjs, which logs to the same file.
//     The PROPOSAL track's variant (gig-plan-v2-proposal, a freelance gig) opens with the same
//     words; the log's `planVariant` says which one ran ("proposal" when the instructions ask
//     for the plan the CLIENT is shown, else "build").
//   report (gig-report-v1, `Write the report for the gig ...`): one section per kind the
//     instructions list, each with a <script> the report's sanitizer must strip.
//   proposal (gig-proposal-v2, `Write the client proposal for the gig ...`): a client proposal
//     built from the fenced plan (its steps are the milestones) and the brief's missing
//     artifacts; its understanding carries a <script> the page must render as TEXT, and its
//     message ends with the disclosure sentence the instructions name.
//   anything else: exit 1, logged, so an unexpected call is visible rather than answered.
//
// Every call is appended as one JSON line to $FAKE_CLAUDE_LOG (argv, the parsed flags, the
// use case, the untrusted payload it read), which is what the spec asserts on.

import { appendFileSync } from "node:fs";

const COST = { brief: 0.01, fable: 0.02, opus: 0.05, sonnet: 0.01, report: 0.03, proposal: 0.04 };
const SEATS = { "claude-fable-5": "fable", "claude-opus-5-5": "opus", "claude-sonnet-5-5": "sonnet" };

function flags(argv) {
  const out = { print: false, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-p" || a === "--print") out.print = true;
    else if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--") && next !== "-p") {
        out[key] = next;
        i++;
      } else out[key] = true;
    } else out.positional.push(a);
  }
  return out;
}

function log(entry) {
  const file = process.env.FAKE_CLAUDE_LOG;
  if (!file) return;
  try {
    appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...entry })}\n`, "utf8");
  } catch {
    // the log is the spec's evidence, never the call's: a failed append must not fail the answer
  }
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

/** The JSON between `<<<UNTRUSTED_<nonce>>>>` and `<<<END_UNTRUSTED_<nonce>>>>`, or null. */
function fencedPayload(prompt) {
  // The fence's own line (the instructions name the markers inline once before it).
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

function classifyPrompt(prompt) {
  if (prompt.includes("Describe the gig in the fenced region below")) return "brief";
  if (prompt.includes("Plan the gig in the fenced region below")) return "plan";
  if (prompt.includes("Write the report for the gig in the fenced region below")) return "report";
  if (prompt.includes("Write the client proposal for the gig in the fenced region below")) return "proposal";
  return "unknown";
}

/** A client proposal (gig-proposal-v2) from the fenced plan and brief: the plan's steps are the
 *  milestones, the brief's missing artifacts the asks, and the message ends with the disclosure
 *  sentence the instructions quote. The understanding carries a <script> the page must escape. */
function proposalFor(prompt, payload) {
  const listing = payload?.untrusted_listing ?? {};
  const brief = payload?.untrusted_brief ?? {};
  const plan = payload?.untrusted_plan ?? null;
  const disclosure = /ENDS with this sentence exactly as given: "([^"]+)"/.exec(prompt)?.[1] ?? "";
  const artifacts = Array.isArray(brief.missingArtifacts) ? brief.missingArtifacts : [];
  const questions = Array.isArray(plan?.questions) ? plan.questions : [];
  return {
    title: String(listing.title ?? "The work"),
    understanding: `You need ${String(listing.title ?? "the work").toLowerCase()}. <script>alert("proposal")</script> Done means the files are delivered and checked.`,
    approach: ["Keep the scope to the listing's own words.", "Check every requirement before delivery."],
    milestones: (Array.isArray(plan?.steps) ? plan.steps : []).map((s) => ({ title: s.title, delivers: s.doneWhen })),
    timeline: "The milestones run in order once your questions are answered.",
    effort: plan?.effortHours ? { minHours: plan.effortHours.min, maxHours: plan.effortHours.max } : null,
    questions,
    artifacts,
    message: ["Hello,", "", "I would build this as one light page and check it against your brief.", ...artifacts.map((a) => `- ${a}`), "", disclosure].join("\n"),
  };
}

/** A report body (gig-report-v1) with one section per kind the instructions list, each carrying a
 *  <script> kp's sanitizer must strip before the file is written (the spec asserts it). */
function reportFor(prompt, payload) {
  const title = String(payload?.untrusted_facts?.gig?.title ?? "the gig");
  const kinds = [...prompt.matchAll(/kind "([a-z]+)", title "([^"]+)"/g)].map((m) => ({ kind: m[1], title: m[2] }));
  return {
    lead: `The fake report for ${title}: take it.`,
    highlight: "take it",
    sections: kinds.map(({ kind, title: t }) => ({
      id: kind,
      title: t,
      kind,
      html: `<p>The ${kind} point.</p><figure><table><thead><tr><th>Fact</th><th>Value</th></tr></thead><tbody><tr><td>Kind</td><td>${kind}</td></tr></tbody></table><figcaption><strong>Fake.</strong> Source: the fake CLI.</figcaption></figure><script>alert("${kind}")</script>`,
    })),
  };
}

function categoryFor(title) {
  if (/landing|website|web page|web app/i.test(title)) return "Web development · Landing page";
  if (/iso-8601|validat|python|script/i.test(title)) return "Software development · Python utility";
  return "Software development · Small task";
}

/** The difficulty the fake brief rates a listing (the lineup the plans then field). */
function difficultyFor(title) {
  return /bakery|\[very-hard\]|\[fable-fails\]/i.test(title) ? "very_hard" : "moderate";
}

function briefFor(payload) {
  const listing = payload?.untrusted_listing ?? {};
  const title = typeof listing.title === "string" ? listing.title : "Untitled gig";
  const past = Array.isArray(payload?.untrusted_past_withdraw_reasons) ? payload.untrusted_past_withdraw_reasons.filter((r) => typeof r === "string") : [];
  const category = categoryFor(title);
  const challenges = [
    "The client names no acceptance criteria for the finished work.",
    "The budget is tight for the amount of polish the listing asks for.",
    "The deadline leaves little room for a revision round.",
  ];
  // The prompt's rule: a past withdraw reason this gig shares is written in exactly its words.
  for (const r of past) if (!challenges.includes(r)) challenges.push(r);
  return {
    category,
    title: `${category.split(" · ")[0]} · ${title}`.slice(0, 90),
    difficulty: difficultyFor(title),
    difficultyReason: "A small, well-bounded build with one integration point.",
    effort: { minHours: 4, maxHours: 8, note: "Most of the time goes to checking the result against the brief." },
    challenges: challenges.slice(0, 7),
    summary: `The client wants ${title.toLowerCase()}. The work is small and self-contained. Done means the files are delivered and checked against the listing.`,
    asks: ["Deliver the finished files", "Explain how the result was checked"],
    language: "en",
    listingEnglish: null,
    missingArtifacts: ["The brand assets (logo and colours)", "The acceptance criteria for the finished work"],
    outreachMessage:
      listing.arena === "freelance"
        ? [
            "Hello,",
            "",
            `Your listing for ${title.toLowerCase()} caught my attention: it is a small, well-bounded build and I would start by restating your requirements as a checklist. Before starting I would need:`,
            "- the brand assets (logo and colours)",
            "- the acceptance criteria for the finished work",
            "",
            "Best regards",
          ].join("\n")
        : null,
    workKind: "digital",
    workKindReason: "The deliverable is files an agent at a computer can build and check.",
  };
}

function planFor(seat, payload) {
  const title = payload?.untrusted_gig?.title ?? "the gig";
  const lead = { fable: "Fable plan", opus: "Opus plan", sonnet: "Sonnet plan" }[seat] ?? "Plan";
  const steps = [
    { title: `${lead}: restate the brief and its acceptance criteria`, doneWhen: "NOTES.md lists every requirement of the brief." },
    { title: `${lead}: build the deliverable`, doneWhen: "The deliverable files exist under deliverable/." },
    { title: `${lead}: verify it against the brief`, doneWhen: "Every requirement in NOTES.md is marked checked." },
    { title: `${lead}: write the cover note`, doneWhen: "The draft text names what was delivered and how it was checked." },
  ];
  if (seat === "opus") steps.push({ title: `${lead}: review the whole once more`, doneWhen: "A second read found nothing to fix." });
  return {
    summary: `${lead} for ${title}: deliver a small, checked result. Keep the scope to what the listing states.`,
    steps,
    decisions: [`${lead} keeps the scope to the listing's own words.`],
    risks: [`${lead} risk: the client may expect more polish than the budget covers.`],
    effortHours: seat === "opus" ? { min: 5, max: 9 } : { min: 4, max: 8 },
    questions: [`${lead} asks: which browsers must the result support?`],
  };
}

/** JSON with every non-ASCII character escaped (`·` -> `·`): the envelope then reads the
 *  same through any console code page the spawning side decodes with. */
function asciiJson(value) {
  return JSON.stringify(value).replace(/[\u0080-￿]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function envelope({ result, structured, model, cost }) {
  const text = JSON.stringify(result);
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    result: text,
    ...(structured ? { structured_output: result } : {}),
    total_cost_usd: cost,
    duration_ms: 1200,
    duration_api_ms: 1100,
    num_turns: 1,
    session_id: `fake-${process.pid}-${Date.now()}`,
    usage: { input_tokens: 1000, output_tokens: 400, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    modelUsage: { [model || "claude-sonnet-5-5"]: { inputTokens: 1000, outputTokens: 400, costUSD: cost } },
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const f = flags(argv);

  if (f.version === true || argv[0] === "--version" || argv[0] === "-v") {
    process.stdout.write("2.1.245 (Claude Code)\n");
    return 0;
  }
  if (f.positional[0] === "auth" && f.positional[1] === "status") {
    process.stdout.write(`${JSON.stringify({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "max" })}\n`);
    return 0;
  }
  if (!f.print) {
    log({ argv, useCase: "unsupported" });
    process.stderr.write("fake claude: only -p calls are answered\n");
    return 1;
  }

  const prompt = await readStdin();
  const useCase = classifyPrompt(prompt);
  const payload = fencedPayload(prompt);
  const model = typeof f.model === "string" ? f.model : null;
  const effort = typeof f.effort === "string" ? f.effort : null;
  const base = {
    argv,
    useCase,
    model,
    effort,
    allowedTools: typeof f.allowedTools === "string" ? f.allowedTools : null,
    disallowedTools: typeof f.disallowedTools === "string" ? f.disallowedTools : null,
    maxTurns: typeof f["max-turns"] === "string" ? Number(f["max-turns"]) : null,
    jsonSchema: typeof f["json-schema"] === "string",
    outputFormat: typeof f["output-format"] === "string" ? f["output-format"] : null,
    payload,
  };

  if (useCase === "brief") {
    const result = briefFor(payload);
    log({ ...base, answered: "ok", cost: COST.brief });
    process.stdout.write(`${asciiJson(envelope({ result, structured: base.jsonSchema, model, cost: COST.brief }))}\n`);
    return 0;
  }

  if (useCase === "plan") {
    const seat = SEATS[model] ?? "unknown";
    const title = String(payload?.untrusted_gig?.title ?? "");
    if (seat === "fable" && title.includes("[fable-fails]")) {
      log({ ...base, seat, answered: "exit_1" });
      process.stderr.write("fake claude: the Fable seat is scripted to fail for this gig\n");
      return 1;
    }
    const result = planFor(seat, payload);
    const cost = COST[seat] ?? 0.01;
    log({ ...base, seat, planVariant: prompt.includes("the plan you would show the CLIENT") ? "proposal" : "build", answered: "ok", cost });
    process.stdout.write(`${asciiJson(envelope({ result, structured: false, model, cost }))}\n`);
    return 0;
  }

  if (useCase === "report") {
    const result = reportFor(prompt, payload);
    log({ ...base, answered: "ok", cost: COST.report });
    process.stdout.write(`${asciiJson(envelope({ result, structured: false, model, cost: COST.report }))}\n`);
    return 0;
  }

  if (useCase === "proposal") {
    const result = proposalFor(prompt, payload);
    log({ ...base, answered: "ok", cost: COST.proposal });
    process.stdout.write(`${asciiJson(envelope({ result, structured: false, model, cost: COST.proposal }))}\n`);
    return 0;
  }

  log({ ...base, answered: "exit_1" });
  process.stderr.write("fake claude: this prompt is not one the gig lifecycle spec scripts\n");
  return 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    log({ argv: process.argv.slice(2), useCase: "crashed", error: String(err) });
    process.stderr.write(`fake claude crashed: ${String(err)}\n`);
    process.exitCode = 1;
  }
);
