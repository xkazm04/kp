// UAT LUC-ANA-13 — the Art. 12 traceability read-back, pinned on BOTH sides.
//
// The finding was not a broken parser. `parseSealTraceability` was correct, documented,
// and carried eleven assertions in decision-attribution.test.ts. It had ZERO production
// callers: the prompt version behind a ranking and the model's own words about the
// candidate it crowned were sealed on every group-eval record and rendered on no screen,
// recoverable only by reading raw payload_json out of the JSON dossier. A unit suite that
// exercises a function proves nothing about whether any surface CALLS it — which is
// exactly how this survived a full cycle unnoticed.
//
// So this file pins the call site itself (the rate-limit-contract.test.ts idiom: route
// modules import via the "@/…" alias, which the bare test runner does not resolve, so the
// guard reads source), and re-pins the parser's honesty rule against the two payload
// shapes that actually exist in a deployed database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseSealTraceability } from "../../../../_lib/decision-attribution.ts";

const APP_DIR = fileURLToPath(new URL("../../../../", import.meta.url));
const DETAIL = "features/insights/analytics/sections/DecisionRecordDetail.tsx";

const read = (rel: string): string => readFileSync(APP_DIR + rel, "utf8");

/** Every non-test source file under app/, relative to app/. */
function sourceFiles(dir = "", out: string[] = []): string[] {
  for (const entry of readdirSync(APP_DIR + dir, { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      sourceFiles(rel, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

// ---- the sealed shapes ------------------------------------------------------------

// Exactly what the six group-eval records in the seeded workspace carry: they were
// sealed before W0.3 added the traceability fields. Kept verbatim so the "not recorded"
// branch is pinned against real data rather than an imagined absence.
const PRE_W03 = JSON.stringify({
  kind: "group_eval_lead",
  actor: "auto:group-eval",
  policyVersion: "llm",
  candidateRef: "m-cand-007-jd-hsfmmm6i",
  rationale: "6 candidate(s) for Senior Java Backend Engineer (SIM). Recommended lead: Vít Malý (fit 80).",
  reasonCode: "lead",
  inputs: { score: 80, candidates: 6, roleTitle: "Senior Java Backend Engineer (SIM)" },
  createdAt: "2026-07-02T20:40:58.838Z",
});

// What group-eval-run.ts seals today.
const W03 = JSON.stringify({
  kind: "group_eval_lead",
  inputs: {
    score: 80,
    candidates: 6,
    roleTitle: "Senior Java Backend Engineer (SIM)",
    cohortSource: "top",
    cohortSize: 11,
    promptVersion: ["match-reasoning@3", "match-reasoning@4"],
    leadReasoning: {
      verdict: "Strongest Kafka and Spring Boot depth in the field.",
      strengths: ["Kafka at scale", "Spring Boot"],
      gaps: ["No Oracle exposure"],
    },
  },
});

test("a pre-W0.3 seal reports its ABSENCE — never an empty-but-present block", () => {
  // The honesty rule the render depends on: null means "this record cannot answer the
  // Art. 12 question", which the detail row states in words. An empty shell here would
  // have produced a block of blank fields that reads as "recorded, and empty".
  assert.equal(parseSealTraceability(PRE_W03), null);
});

test("a W0.3 seal reads back the prompt version(s) and the lead's words VERBATIM", () => {
  const trace = parseSealTraceability(W03);
  assert.ok(trace, "the W0.3 shape must parse");
  // Plural: a cache straddling a prompt bump legitimately mixes two versions, and the
  // row renders one chip per version rather than collapsing them.
  assert.deepEqual(trace.promptVersion, ["match-reasoning@3", "match-reasoning@4"]);
  assert.equal(trace.leadReasoning?.verdict, "Strongest Kafka and Spring Boot depth in the field.");
  assert.deepEqual(trace.leadReasoning?.strengths, ["Kafka at scale", "Spring Boot"]);
  assert.deepEqual(trace.leadReasoning?.gaps, ["No Oracle exposure"]);
});

// ---- the call site ----------------------------------------------------------------

test("parseSealTraceability has at least one PRODUCTION caller", () => {
  // The finding, stated as an assertion. `grep -rn parseSealTraceability app/` used to
  // find the definition and its tests and nothing else.
  const callers = sourceFiles().filter(
    (f) => f !== "_lib/decision-attribution.ts" && read(f).includes("parseSealTraceability")
  );
  assert.ok(
    callers.length > 0,
    "the Art. 12 read-back is written and never called — the whole point of LUC-ANA-13"
  );
  assert.ok(
    callers.includes(DETAIL),
    `the sealed-record detail row must be one of them (found: ${callers.join(", ") || "none"})`
  );
});

test("the detail row renders the not-recorded state, not a blank", () => {
  const src = read(DETAIL);
  // A null parse MUST reach copy. Without this the honest "we cannot answer that" state
  // degrades into an empty region, which reads as "there was nothing to say".
  assert.match(src, /traceAbsent/, "the absent-traceability sentence must be rendered");
  assert.match(src, /traceNotRecorded/, "a missing prompt version must say so");
  assert.match(src, /traceLeadAbsent/, "a prompt version with no model text must say so");
});

test("only group-eval records are asked the Art. 12 question", () => {
  const src = read(DETAIL);
  // Other kinds (an advance, an offer, a human scorecard) never had a prompt behind
  // them, so a "not recorded" line there would be noise dressed as a compliance gap.
  assert.match(src, /startsWith\("group_eval"\)/, "the block must be gated to the group-eval family");
});
