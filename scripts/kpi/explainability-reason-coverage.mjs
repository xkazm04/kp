#!/usr/bin/env node
// KPI meter — "Candidate-readable reason coverage" (goal a82c273d, "Every
// automated step is explainable to the candidate: each AI verdict along the
// thread carries reasons a candidate could read").
//
// WHAT IT COUNTS, and why this number and not a nearby one. A candidate reading
// /status/<token> sees a LABEL for every decision kind ("Interview assessed with
// AI assistance") and a REASON for almost none. A label is not an explanation —
// Art. 86 asks for the "main elements of the decision" — so the number that
// tracks the goal is: of the candidate-visible decision kinds, how many actually
// put a reason in front of the candidate?
//
// Three independent layers must ALL agree before a kind counts, because each
// alone is satisfiable without the candidate reading anything:
//   1. server  — `redactDecisionForCandidate` (app/_lib/status-decisions.ts) can
//                emit a non-null `facts` for the kind. Today that branch names
//                "auto_rejected" alone, in the file's own words: "Null for
//                everything else."
//   2. catalog — messages/en.json has a `status.decisions.reasons.<code>` string.
//   3. render  — StatusClient.tsx actually renders `decisions.reasons.<code>`.
// A kind with server facts and no copy renders nothing; copy with no facts
// renders nothing. Counting the intersection is what stops this becoming the
// vacuous counter ADR-0008 was written against.
//
// Keyless, network-free, read-only: files are read through `git show <ref>:path`,
// so it measures ANY ref without a checkout and a pre-merge baseline stays
// reproducible after the merge. Run `git fetch` first for a remote ref.
//
//   node scripts/kpi/explainability-reason-coverage.mjs              # origin/main
//   node scripts/kpi/explainability-reason-coverage.mjs --ref HEAD --json
//
// Exit 0 = a number. Exit 2 = a source moved and the parse no longer bites, so
// NO number is printed. That failure mode is deliberate: this probe reads source
// text, and a refactor (say, a dispatch map replacing the ternary) must show up
// as "re-teach me", never as a silent 0 that looks like a regression or a silent
// pass that looks like progress.
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const refArg = args.indexOf("--ref");
const REF = refArg >= 0 ? args[refArg + 1] : "origin/main";
const JSON_OUT = args.includes("--json");

const DECISIONS_TS = "app/_lib/status-decisions.ts";
const STATUS_CLIENT = "app/status/[token]/StatusClient.tsx";
const EN_CATALOG = "messages/en.json";

function git(argv) {
  return execFileSync("git", argv, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

function show(path) {
  try {
    return git(["show", `${REF}:${path}`]);
  } catch {
    bail(`cannot read ${path} at ${REF} — the file moved or the ref is unfetched`);
  }
}

function bail(why) {
  console.error(`explainability-reason-coverage: ${why}`);
  console.error(`  No reading taken. Re-teach the probe rather than recording a number it did not measure.`);
  process.exit(2);
}

try {
  git(["rev-parse", "--verify", `${REF}^{commit}`]);
} catch {
  bail(`ref "${REF}" does not resolve (a remote ref needs \`git fetch origin\` first)`);
}
const sha = git(["rev-parse", "--short", REF]).trim();

// --- layer 0: the allowlist. Every kind a candidate may see at all. -----------
const decisionsSrc = show(DECISIONS_TS);
const allowMatch = decisionsSrc.match(/CANDIDATE_VISIBLE_DECISION_KINDS[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/);
if (!allowMatch) bail(`CANDIDATE_VISIBLE_DECISION_KINDS is no longer a \`new Set([...])\` literal in ${DECISIONS_TS}`);
const visibleKinds = [...allowMatch[1].matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
if (visibleKinds.length === 0) bail(`parsed CANDIDATE_VISIBLE_DECISION_KINDS but found no kinds in it`);

// --- layer 1: server. Which kinds can carry a non-null `facts`? --------------
// The property is built inside redactDecisionForCandidate's returned literal.
// Everything from `facts:` to the end of that line is the expression; every
// kind string named in it is a kind that can be given facts.
const redactIdx = decisionsSrc.indexOf("export function redactDecisionForCandidate");
if (redactIdx < 0) bail(`redactDecisionForCandidate is gone from ${DECISIONS_TS}`);
const factsMatch = decisionsSrc.slice(redactIdx).match(/\n\s*facts:([\s\S]*?),\n\s*\};/);
if (!factsMatch) bail(`could not locate the \`facts:\` property of redactDecisionForCandidate's returned literal`);
const factsExpr = factsMatch[1];
const serverFactKinds = [...new Set([...factsExpr.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]))];
const strayServer = serverFactKinds.filter((k) => !visibleKinds.includes(k));
if (strayServer.length) bail(`the \`facts:\` expression names ${strayServer.join(", ")}, which is not in the visible allowlist — the parse is reading something other than kinds`);

// --- layer 2: catalog. Which reason strings exist for a candidate to read? ----
let catalogCodes;
try {
  const en = JSON.parse(show(EN_CATALOG));
  const reasons = en?.status?.decisions?.reasons;
  if (!reasons || typeof reasons !== "object") bail(`messages/en.json has no status.decisions.reasons object`);
  catalogCodes = Object.keys(reasons);
} catch (e) {
  if (e?.code === "ERR_INVALID_ARG_TYPE" || e instanceof SyntaxError) bail(`messages/en.json did not parse as JSON at ${REF}`);
  throw e;
}

// --- layer 3: render. Which of those strings does the candidate page print? ---
const clientSrc = show(STATUS_CLIENT);
const renderedCodes = [...new Set([...clientSrc.matchAll(/["'`]decisions\.reasons\.([a-zA-Z0-9_]+)["'`]/g)].map((m) => m[1]))];
if (renderedCodes.length === 0) bail(`${STATUS_CLIENT} renders no decisions.reasons.* key — the candidate-facing reason surface moved`);

// --- the intersection ---------------------------------------------------------
// A reason code and a decision kind are not the same vocabulary (the render gate
// today is `d.reasonCode === "reject" && d.facts`), so a kind counts when it can
// carry facts AND at least one rendered, catalogued reason code exists to print
// beside them. With one code and one fact-bearing kind this is exact; the moment
// either side widens, this file is the thing to sharpen — see Known limits below.
const readableCodes = renderedCodes.filter((c) => catalogCodes.includes(c));
const value = Math.min(serverFactKinds.length, readableCodes.length);

// --- the ratchet beside it: kinds with no candidate-facing LABEL at all -------
// StatusClient builds `decisionKindLabels` as literal keys because next-intl
// keys are typed, and the file's own comment names the failure mode: "a kind the
// server starts exposing without copy here degrades to a de-snaked raw value
// below". That degraded path prints English snake_case to a candidate in every
// locale, and nothing fails when it happens — the allowlist and the label map
// are two lists in two files that no gate compares. This counts the drift.
const labelsBlock = clientSrc.match(/const decisionKindLabels[^=]*=\s*\{([\s\S]*?)\n\s*\};/);
if (!labelsBlock) bail(`decisionKindLabels is no longer an object literal in ${STATUS_CLIENT}`);
const labelledKinds = [...new Set([...labelsBlock[1].matchAll(/^\s*([a-z0-9_]+):/gm)].map((m) => m[1]))];
const unlabelledKinds = visibleKinds.filter((k) => !labelledKinds.includes(k));

const report = {
  ref: REF,
  sha,
  value,
  denominator: visibleKinds.length,
  visible_kinds: visibleKinds,
  server_fact_kinds: serverFactKinds,
  catalog_reason_codes: catalogCodes,
  rendered_reason_codes: renderedCodes,
  readable_reason_codes: readableCodes,
  labelled_kinds: labelledKinds,
  unlabelled_kinds: unlabelledKinds,
};

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`  candidate-visible decision kinds ...... ${visibleKinds.length}  (${visibleKinds.join(", ")})`);
  console.log(`  kinds that can carry facts (server) ... ${serverFactKinds.length}  (${serverFactKinds.join(", ") || "none"})`);
  console.log(`  reason strings in messages/en.json .... ${catalogCodes.length}  (${catalogCodes.join(", ") || "none"})`);
  console.log(`  reason strings the page renders ....... ${renderedCodes.length}  (${renderedCodes.join(", ") || "none"})`);
  console.log(`  kinds with a localized label .......... ${labelledKinds.length}`);
  console.log(`REASON_COVERAGE=${value}/${visibleKinds.length} at ${REF}=${sha}`);
  console.log(`UNLABELLED_KINDS=${unlabelledKinds.length}${unlabelledKinds.length ? "  (" + unlabelledKinds.join(", ") + ")" : ""}`);
}

// Known limits, stated so the next reader does not over-trust the number:
//  - It counts DOORS, not corpus rows: "this kind CAN show a reason", not "N% of
//    real verdicts did". The corpus-walking counter is idea 43bcd466, unshipped.
//  - The denominator is every visible kind, including ones no candidate is owed
//    a reason for (interview_cancelled). The goal's own denominator is the
//    AI-verdict subset — 5 kinds are sealed by machine writers today
//    (auto_rejected, auto_advanced, ai_scorecard, group_eval_lead,
//    group_eval_advisory) — which is why the KPI's target is 5 and not 14.
