// Fixtures for the goal-a82c273d meter. The failure these exist for: when the
// `facts:` ternary in status-decisions.ts became a FACT_EXTRACTORS registry, the
// probe found no kind literals on that line and printed REASON_COVERAGE=0 — a
// reading, not the exit-2 "re-teach me" its header promises.
//
//   node --test scripts/kpi/__tests__/explainability-reason-coverage.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { measure, serverFactKindsOf, ProbeMoved } from "../explainability-reason-coverage.mjs";

const VISIBLE = `export const CANDIDATE_VISIBLE_DECISION_KINDS: ReadonlySet<string> = new Set([
  "auto_rejected",
  "rejected",
  "ai_scorecard",
  "interview_cancelled",
]);`;

const redact = (preamble, factsExpr) => `
export function redactDecisionForCandidate(record: SealedDecisionLike): CandidateDecisionView | null {
  if (!CANDIDATE_VISIBLE_DECISION_KINDS.has(record.kind)) return null;${preamble}
  return {
    kind: record.kind,
    createdAt: record.createdAt,
    attribution: sealedActorAttribution(record.actor, record.kind),
    reasonCode: record.reasonCode,
    facts: ${factsExpr},
  };
}
`;

/** main before #60: the inline ternary. */
const TERNARY_DECISIONS = VISIBLE + redact("", `record.kind === "auto_rejected" ? autoRejectFacts(record.payloadJson) : null`);

/** #60's shape: a registry looked up by kind, the call site naming no kind at all. */
const REGISTRY_DECISIONS =
  VISIBLE +
  `
const FACT_EXTRACTORS: ReadonlyMap<string, (payloadJson: string) => CandidateDecisionFacts | null> = new Map([
  ["auto_rejected", autoRejectFacts],
  ["ai_scorecard", aiScorecardFacts],
]);
` +
  redact(`\n  const extract = FACT_EXTRACTORS.get(record.kind);`, `extract ? extract(record.payloadJson) : null`);

const clientWith = (codes) => `
  const decisionKindLabels: Record<string, string> = {
    auto_rejected: t("decisions.kinds.auto_rejected"),
    rejected: t("decisions.kinds.rejected"),
    ai_scorecard: t("decisions.kinds.ai_scorecard"),
    interview_cancelled: t("decisions.kinds.interview_cancelled"),
  };
  ${codes.map((c) => `{t("decisions.reasons.${c}")}`).join("\n  ")}
`;
const enWith = (codes) =>
  JSON.stringify({ status: { decisions: { reasons: Object.fromEntries(codes.map((c) => [c, `${c} copy`])) } } });

test("#60-shaped registry: ai_scorecard rubric facts count, the reading is > 0", () => {
  const r = measure({
    decisionsSrc: REGISTRY_DECISIONS,
    clientSrc: clientWith(["reject", "rubric"]),
    enJson: enWith(["reject", "rubric"]),
  });
  assert.deepEqual(r.server_fact_kinds, ["auto_rejected", "ai_scorecard"]);
  assert.ok(r.value > 0, `registry shape read as ${r.value}`);
  assert.equal(r.value, 2);
  assert.equal(r.denominator, 4);
  assert.deepEqual(r.unlabelled_kinds, []);
});

test("the pre-#60 inline ternary still reads 1", () => {
  const r = measure({ decisionsSrc: TERNARY_DECISIONS, clientSrc: clientWith(["reject"]), enJson: enWith(["reject"]) });
  assert.deepEqual(r.server_fact_kinds, ["auto_rejected"]);
  assert.equal(r.value, 1);
});

test("a registry key the allowlist hides is not a door", () => {
  const src = REGISTRY_DECISIONS.replace(`["ai_scorecard", aiScorecardFacts],`, `["ai_scorecard", aiScorecardFacts],\n  ["offer_terms", offerFacts],`);
  assert.deepEqual(
    measure({ decisionsSrc: src, clientSrc: clientWith(["reject", "rubric"]), enJson: enWith(["reject", "rubric"]) }).server_fact_kinds,
    ["auto_rejected", "ai_scorecard"]
  );
});

test("copy with no server facts still reads 0 (layers must agree)", () => {
  const src = VISIBLE + redact("", "null");
  assert.deepEqual(serverFactKindsOf(src), []);
  assert.equal(measure({ decisionsSrc: src, clientSrc: clientWith(["reject"]), enJson: enWith(["reject"]) }).value, 0);
});

test("an unrecognised facts shape exits as MOVED, never as a silent 0", () => {
  const dispatch = VISIBLE + redact("", `factsFor(record)`);
  assert.throws(() => serverFactKindsOf(dispatch), ProbeMoved);
  const notAMap = VISIBLE + `\nconst FACT_EXTRACTORS = buildExtractors();\n` + redact(`\n  const extract = FACT_EXTRACTORS.get(record.kind);`, `extract ? extract(record.payloadJson) : null`);
  assert.throws(() => serverFactKindsOf(notAMap), ProbeMoved);
});

test("the tree this test runs in parses", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const read = (p) => readFileSync(path.join(root, p), "utf8");
  const r = measure({
    decisionsSrc: read("app/_lib/status-decisions.ts"),
    clientSrc: read("app/status/[token]/StatusClient.tsx"),
    enJson: read("messages/en.json"),
  });
  assert.ok(r.server_fact_kinds.length > 0 && r.value > 0, JSON.stringify(r.server_fact_kinds));
});
