// challenge-r07 results-core/B — the decision brief and its gate. Pins that the
// recruiter's advance/pass is taken with the engine's open flags in view: Advance
// acknowledges each one, Pass on a strong read names a reason, Hold and clearing are
// never gated, and every PATCH path the editor has carries the acknowledgements.
//
//   node scripts/run-unit-tests.mjs app/_components/results/decisionBrief.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decisionBasis,
  decisionBrief,
  decisionGate,
  dispositionPatchBody,
  settleDisposition,
} from "./decisionBrief.ts";

const WARN_A = "Credential: the role appears to require a CISSP, not found in the candidate's credentials - verify before advancing (manual review).";
const WARN_B = "Score check: the skills component disagrees with the evidence - verify the score before trusting it (manual review).";
const OK_LINE = "Salary band is inside the expected range.";

const score = (n: number) => ({ total: n, experience: n, skills: 0, roleSeniority: 0, education: 0, traits: 0 });

const flagged = {
  sanityChecks: [OK_LINE, WARN_A, WARN_B],
  score: score(80),
  jobFit: { missingSkills: ["Kubernetes", "Go"] },
};

test("case 1: the brief carries the open warns and the job-fit gaps; a clean JD-less run is an empty brief", () => {
  const brief = decisionBrief(flagged);
  assert.deepEqual(brief.openWarns, [WARN_A, WARN_B]);
  assert.deepEqual(brief.missing, ["Kubernetes", "Go"]);
  const empty = decisionBrief({ sanityChecks: [OK_LINE], score: score(50) });
  assert.deepEqual(empty.openWarns, []);
  assert.deepEqual(empty.missing, []);
  // coded payloads are read by severity, not prose
  const coded = decisionBrief({
    sanityChecks: ["Blind screening PARTIAL. Verify manually."],
    trustFindings: [{ code: "blind_redaction_partial", severity: "warn", scope: "identity", text: "Blind screening PARTIAL. Verify manually." }],
  });
  assert.deepEqual(coded.openWarns, ["Blind screening PARTIAL. Verify manually."]);
  // a corrupt stored payload never throws
  assert.deepEqual(decisionBrief(null).openWarns, []);
  assert.deepEqual(decisionBrief({ sanityChecks: "nope", score: "x" }).openWarns, []);
});

test("case 2: advance needs every open warn acknowledged", () => {
  const brief = decisionBrief(flagged);
  assert.deepEqual(decisionGate(brief, "advance", { acknowledged: [] }), { canSave: false, needs: "ack", pending: [WARN_A, WARN_B] });
  assert.deepEqual(decisionGate(brief, "advance", { acknowledged: [WARN_A] }), { canSave: false, needs: "ack", pending: [WARN_B] });
  assert.deepEqual(decisionGate(brief, "advance", { acknowledged: [WARN_A, WARN_B] }), { canSave: true });
});

test("case 3: passing a strong read needs a reason", () => {
  const brief = decisionBrief(flagged); // total 80 >= SCORE_STRONG_MIN
  assert.equal(brief.strong, true);
  assert.deepEqual(decisionGate(brief, "pass", { note: "" }), { canSave: false, needs: "reason" });
  assert.deepEqual(decisionGate(brief, "pass", { note: "   " }), { canSave: false, needs: "reason" });
  assert.deepEqual(decisionGate(brief, "pass", { note: "Salary out of reach" }), { canSave: true });
  const weak = decisionBrief({ ...flagged, score: score(40) });
  assert.deepEqual(decisionGate(weak, "pass", { note: "" }), { canSave: true });
});

test("case 4: hold and clearing are never gated; re-saving the stored disposition is never gated", () => {
  const brief = decisionBrief(flagged);
  assert.deepEqual(decisionGate(brief, "hold", { acknowledged: [] }), { canSave: true });
  assert.deepEqual(decisionGate(brief, "", { acknowledged: [] }), { canSave: true });
  assert.deepEqual(decisionGate(brief, "advance", { acknowledged: [], stored: "advance" }), { canSave: true });
});

test("the basis keeps only acknowledgements of warnings that were actually open", () => {
  const brief = decisionBrief(flagged);
  const basis = decisionBasis(brief, [WARN_A, "invented line"], new Date("2026-09-23T10:00:00Z"));
  assert.deepEqual(basis, { score: 80, openWarns: [WARN_A, WARN_B], acknowledged: [WARN_A], decidedAt: "2026-09-23T10:00:00.000Z" });
});

test("editor: a refused advance rolls the optimistic pick back to the stored value", () => {
  assert.equal(settleDisposition({ attempted: "advance", stored: "hold", ok: false, code: "DISPOSITION_ACK_REQUIRED" }), "hold");
  assert.equal(settleDisposition({ attempted: "advance", stored: "", ok: false, code: "DISPOSITION_ACK_REQUIRED" }), "");
  assert.equal(settleDisposition({ attempted: "advance", stored: "hold", ok: true }), "advance");
  // a network failure is not a refusal: the pick stays on screen with the error
  assert.equal(settleDisposition({ attempted: "pass", stored: "", ok: false, code: null }), "pass");
});

test("editor: every PATCH path (pick, autosave, blur, keepalive flush) carries `acknowledged`", () => {
  assert.deepEqual(dispositionPatchBody("advance", "n", [WARN_A]), { disposition: "advance", note: "n", acknowledged: [WARN_A] });
  const src = readFileSync(new URL("./DispositionEditor.tsx", import.meta.url), "utf8");
  // No hand-built body survives: the old `{ disposition: …, note: … }` literal is how an
  // autosave or unmount flush re-issued an advance without its acknowledgements.
  assert.doesNotMatch(src, /JSON\.stringify\(\{\s*disposition/);
  const bodies = src.match(/JSON\.stringify\(dispositionPatchBody\(/g) ?? [];
  assert.ok(bodies.length >= 2, `both fetch sites (save + keepalive flush) must build the body with dispositionPatchBody; found ${bodies.length}`);
  assert.match(src, /keepalive: true/);
  assert.match(src, /settleDisposition\(/, "the save path must settle the optimistic pick through settleDisposition");
});
