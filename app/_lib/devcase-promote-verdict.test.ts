// Pins the dev-case promote verdict (challenge-r02 devcase-eval/B): the advance/hold rule
// promoteSubmission writes, lifted into one pure function the postings preview and the
// EvalPanel share, with a CODED reason vocabulary. The DB-side parity half lives in
// devcase-promote.test.ts; the postings preview in app/api/devcase/postings/route.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { IntlMessageFormat } from "intl-messageformat";
import {
  PROMOTE_REASON_CODES,
  foldPromoteResponse,
  promoteAuditReasons,
  promoteReasonMessage,
  promoteVerdict,
  promoteVerdictInputOf,
  type PromoteReason,
} from "./devcase-promote-verdict.ts";

test("a clean floor-clearing score advises advance with one score reason", () => {
  assert.deepEqual(promoteVerdict({ transferScore: 82, floor: 70, authenticityBand: "authentic", confidence: 0.8 }), {
    recommendation: "advance",
    reasons: [{ code: "score_clears_floor", params: { score: 82, floor: 70 } }],
  });
});

test("a blocker sits above the ladder: suspect authenticity holds a 95, and is listed first", () => {
  const v = promoteVerdict({ transferScore: 95, floor: 70, authenticityBand: "suspect", authenticityScore: 28, confidence: 0.9 });
  assert.equal(v.recommendation, "hold");
  assert.deepEqual(v.reasons[0], { code: "authenticity_suspect", params: { score: 28 } });
  assert.equal(v.reasons.at(-1)?.code, "score_clears_floor", "the score reason still explains the ladder, after the blocker");
});

test("thin evidence holds at or below 0.4, and advances just above it", () => {
  const thin = promoteVerdict({ transferScore: 90, floor: 70, confidence: 0.3 });
  assert.equal(thin.recommendation, "hold");
  assert.deepEqual(thin.reasons[0], { code: "low_confidence", params: { confidence: 0.3 } });
  assert.equal(promoteVerdict({ transferScore: 90, floor: 70, confidence: 0.41 }).recommendation, "advance");
  // Absent confidence (legacy bundles) is no signal, not a penalty.
  assert.equal(promoteVerdict({ transferScore: 90, floor: 70, confidence: null }).recommendation, "advance");
});

test("an absent score is its own tier: hold, not_scored, and no reason carrying a score of 0", () => {
  const v = promoteVerdict({ transferScore: null, floor: 70, authenticityBand: "authentic", confidence: 0.8 });
  assert.equal(v.recommendation, "hold");
  assert.deepEqual(v.reasons, [{ code: "not_scored" }]);
  assert.ok(
    !v.reasons.some((r) => "params" in r && (r.params as { score?: unknown }).score === 0),
    "no fabricated 0 score"
  );
  const audit = promoteAuditReasons(v, 70);
  assert.ok(!audit.some((s) => /transfer score 0\b/.test(s)), `the trail must not say 'transfer score 0': ${audit.join("; ")}`);
});

test("the audit sentence stays today's locale-invariant English, score reason first", () => {
  const v = promoteVerdict({ transferScore: 95, floor: 70, authenticityBand: "suspect", authenticityScore: 28, confidence: 0.3 });
  assert.deepEqual(promoteAuditReasons(v, 70), [
    "transfer score 95 vs calibrated floor 70",
    "process authenticity is suspect (28/100)",
    "evaluation evidence-confidence is low (0.3)",
  ]);
});

test("client fold: a non-OK promote carries its code; an OK one carries the landed verdict", () => {
  assert.deepEqual(foldPromoteResponse(500, { error: "boom", code: "DEVCASE_PROMOTE_FAILED" }), {
    state: "error",
    code: "DEVCASE_PROMOTE_FAILED",
  });
  // A refusal with no code (400 'evaluate first') still reads as an error, never a no-op.
  assert.deepEqual(foldPromoteResponse(400, { error: "evaluate the submission first." }), { state: "error", code: null });
  assert.deepEqual(foldPromoteResponse(200, { ok: true, recommendation: "hold", reasonCodes: [{ code: "low_confidence" }] }), {
    state: "promoted",
    recommendation: "hold",
  });
});

const LOCALES = ["en", "cs", "de", "fr"] as const;
function catalogBlock(locale: string): Record<string, string> {
  const file = path.join(process.cwd(), "messages", `${locale}.json`);
  const json = JSON.parse(readFileSync(file, "utf8")) as {
    devcase?: { evalPanel?: { promoteVerdict?: { reasons?: Record<string, string> } } };
  };
  return json.devcase?.evalPanel?.promoteVerdict?.reasons ?? {};
}

const SAMPLE: Record<(typeof PROMOTE_REASON_CODES)[number], PromoteReason[]> = {
  authenticity_suspect: [
    { code: "authenticity_suspect", params: { score: 28 } },
    { code: "authenticity_suspect", params: {} },
  ],
  debrief_cleared: [{ code: "debrief_cleared" }],
  low_confidence: [{ code: "low_confidence", params: { confidence: 0.3 } }],
  not_scored: [{ code: "not_scored" }],
  score_below_floor: [{ code: "score_below_floor", params: { score: 61, floor: 70 } }],
  score_clears_floor: [{ code: "score_clears_floor", params: { score: 82, floor: 70 } }],
  trace_unwitnessed: [{ code: "trace_unwitnessed" }],
};

test("every reason code renders in en/cs/de/fr with its params: no raw key, no missing ICU argument", () => {
  for (const locale of LOCALES) {
    const block = catalogBlock(locale);
    for (const code of PROMOTE_REASON_CODES) {
      const template = block[code];
      assert.equal(typeof template, "string", `${locale}: devcase.evalPanel.promoteVerdict.reasons.${code} missing`);
      for (const reason of SAMPLE[code]) {
        const { key, values } = promoteReasonMessage(reason);
        assert.equal(key, code);
        const out = String(new IntlMessageFormat(template, locale).format(values));
        assert.ok(out.length > 0 && !out.includes("{"), `${locale}/${code} rendered '${out}'`);
        if (reason.code === "score_clears_floor" || reason.code === "score_below_floor") {
          assert.ok(out.includes("82") || out.includes("61"), `${locale}/${code} carries the score: '${out}'`);
        }
        if (reason.code === "authenticity_suspect" && reason.params.score != null) {
          assert.ok(out.includes("28"), `${locale}/${code} carries the authenticity score: '${out}'`);
        }
      }
    }
  }
});

test("C2/C4: the unwitnessed hold and the debrief clearance are inputs of the one rule, each with its code", () => {
  const base = { transferScore: 88, floor: 70, authenticityBand: "authentic", confidence: 0.9 };
  const held = promoteVerdict({ ...base, unwitnessedTrace: true });
  assert.equal(held.recommendation, "hold");
  assert.ok(held.reasons.some((r) => r.code === "trace_unwitnessed"));
  const cleared = promoteVerdict({ ...base, unwitnessedTrace: true, debriefCleared: true });
  assert.equal(cleared.recommendation, "advance");
  assert.ok(cleared.reasons.some((r) => r.code === "debrief_cleared"));
  assert.ok(!cleared.reasons.some((r) => r.code === "trace_unwitnessed"));
  // A clearance lifts the authorship holds ONLY: floor, absent score and thin evidence still hold.
  const below = promoteVerdict({ ...base, transferScore: 40, unwitnessedTrace: true, debriefCleared: true });
  assert.equal(below.recommendation, "hold");
  assert.ok(below.reasons.some((r) => r.code === "score_below_floor"));
  assert.equal(promoteVerdict({ ...base, transferScore: null, debriefCleared: true, unwitnessedTrace: true }).recommendation, "hold");
  assert.equal(promoteVerdict({ ...base, confidence: 0.2, debriefCleared: true, unwitnessedTrace: true }).recommendation, "hold");
  // Nothing to lift = no clearance reason; a clearance never turns a hold into an advance on its own.
  assert.ok(!promoteVerdict({ ...base, debriefCleared: true }).reasons.some((r) => r.code === "debrief_cleared"));
});

test("promoteVerdictInputOf reads the unwitnessed trace and asks for the clearance only when a hold exists", () => {
  let asked = 0;
  const isCleared = () => (asked += 1, true);
  const plain = promoteVerdictInputOf({ transfer: { transferScore: 80 }, integrity: { witness: { verdict: "witnessed" } } }, null, 70, isCleared);
  assert.equal(plain.unwitnessedTrace, false);
  assert.equal(plain.debriefCleared, false);
  assert.equal(asked, 0, "no hold, no clearance read");
  const unw = promoteVerdictInputOf({ transfer: { transferScore: 80 }, integrity: { witness: { verdict: "unwitnessed" } } }, null, 70, isCleared);
  assert.equal(unw.unwitnessedTrace, true);
  assert.equal(unw.debriefCleared, true);
});
