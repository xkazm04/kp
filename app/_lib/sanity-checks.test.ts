import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitSanityChecks,
  countSanityWarns,
  isSanityWarn,
  authenticityBand,
  trustLedger,
  trustWarnCount,
  scoreBlocked,
  trustedScoreTotal,
  type TrustFinding,
} from "./sanity-checks.ts";

// One representative string per engine emitter (pipeline.py), so a renamed or
// new warn shape that the classifier misses shows up as a test to update —
// keeping the classifier and the engine's vocabulary in lockstep.
const ENGINE_WARNS = [
  "Profile text is short",
  "Score outside expected range",
  "Score total (95) disagrees with its breakdown (components sum to 40, off by 55) — verify the score before trusting it",
  "Archetype routing is low-confidence — Experienced hire at 35% (no detection signals fired); verify the candidate's archetype before trusting the score",
  "Salary range is inconsistent",
  "Salary range needs manual review",
  "Profile text was short — assessment may be less reliable (manual review)",
  "Score section missing — defaulted to 0 (manual review)",
  "Salary range was reversed — corrected (manual review)",
  "Interview kit unavailable — insight skipped (manual review)",
];

const ENGINE_OKS = [
  "Profile text length OK",
  "Score is inside 0-100",
  "Score total matches its breakdown",
  "Archetype routing OK — Experienced hire at 82% confidence",
  "Salary range order OK",
  "Salary range seems plausible",
  "No salary estimate produced",
];

test("every engine warn shape classifies as a warn", () => {
  for (const check of ENGINE_WARNS) assert.equal(isSanityWarn(check), true, check);
});

test("every engine ok/neutral shape classifies as ok", () => {
  for (const check of ENGINE_OKS) assert.equal(isSanityWarn(check), false, check);
});

test("splitSanityChecks partitions and preserves order", () => {
  const { warns, oks } = splitSanityChecks([ENGINE_OKS[0], ENGINE_WARNS[0], ENGINE_OKS[1], ENGINE_WARNS[1]]);
  assert.deepEqual(warns, [ENGINE_WARNS[0], ENGINE_WARNS[1]]);
  assert.deepEqual(oks, [ENGINE_OKS[0], ENGINE_OKS[1]]);
});

test("countSanityWarns matches the split", () => {
  const mixed = [...ENGINE_OKS, ...ENGINE_WARNS];
  assert.equal(countSanityWarns(mixed), ENGINE_WARNS.length);
  assert.equal(countSanityWarns(ENGINE_OKS), 0);
  assert.equal(countSanityWarns([]), 0);
});

test("authenticityBand: null without an authenticity check, else by warn count (idea-cae71d45)", () => {
  assert.equal(authenticityBand(["Salary range order OK"]), null); // older payload, no screen
  assert.equal(authenticityBand(["Authenticity checks passed — language reads specific and concrete."]), "high");
  assert.equal(authenticityBand(["Authenticity: heavy generic/buzzword phrasing — verify (manual review)."]), "medium");
  assert.equal(
    authenticityBand([
      "Authenticity: heavy generic/buzzword phrasing — verify (manual review).",
      "Authenticity: stated experience exceeds a plausible career span (manual review).",
    ]),
    "low"
  );
});

// ── Trust findings born coded (challenge-r07 results-core/A) ─────────────────
// The engine now states each finding with a code, a severity and a scope. When
// the payload carries them, the ledger classifies by severity ONLY; the regex
// above survives solely as the reader for payloads saved before the field existed.
type Finding = TrustFinding;
const f = (code: string, severity: Finding["severity"], scope: Finding["scope"], text: string, value: string | null = null): Finding => ({
  code, severity, scope, text, value,
});

test("trustLedger: coded findings split by severity, never by the prose regex", () => {
  const findings = [
    f("blind_redaction_partial", "warn", "identity", "Blind screening PARTIAL — no candidate name detected to redact (redacted: email); the name may have reached the model. Verify manually."),
    f("job_context_unreadable", "warn", "input", "Structured job context was unreadable and was ignored (JSONDecodeError) — requirement grading fell back to JD text.", "JSONDecodeError"),
    f("salary_order_ok", "ok", "salary", "Salary range order OK"),
    // An ok finding whose words happen to say "failed" stays ok: the code decides.
    f("odd_ok", "ok", "input", "Nothing failed here"),
    f("score_section_missing", "blocker", "score", "Score section missing — defaulted to 0 (manual review)"),
  ];
  const analysis = { sanityChecks: findings.map((x) => x.text), trustFindings: findings };
  const { warns, oks } = trustLedger(analysis);
  assert.deepEqual(warns, [findings[0].text, findings[1].text, findings[4].text]);
  assert.deepEqual(oks, ["Salary range order OK", "Nothing failed here"]);
  assert.equal(trustWarnCount(analysis), 3);
  // The regex misfire this replaces: both of these read as clean passes to it.
  assert.equal(isSanityWarn(findings[0].text), false);
  assert.equal(isSanityWarn(findings[1].text), false);
});

test("trustLedger: a legacy payload (no trustFindings) falls back to the regex split unchanged", () => {
  const mixed = [ENGINE_OKS[0], ENGINE_WARNS[0], ENGINE_OKS[1], ENGINE_WARNS[1]];
  for (const legacy of [{ sanityChecks: mixed }, { sanityChecks: mixed, trustFindings: null }]) {
    assert.deepEqual(trustLedger(legacy), splitSanityChecks(mixed));
    assert.equal(trustWarnCount(legacy), countSanityWarns(mixed));
  }
  assert.deepEqual(trustLedger({}), { warns: [], oks: [] });
});

test("authenticityBand: coded authenticity findings are counted by severity, injection never counts", () => {
  const clean = f("authenticity_clean", "ok", "authenticity", "Authenticity: reads fine (manual review wording, but ok)");
  const warn = (code: string) => f(code, "warn", "authenticity", `Authenticity: ${code}`);
  const injection = f("injection_instructions", "warn", "input", "Prompt-injection screen: … (manual review).");
  const band = (fs: Finding[]) => authenticityBand(fs.map((x) => x.text), fs);
  assert.equal(band([injection]), null);
  assert.equal(band([clean, injection]), "high");
  assert.equal(band([warn("authenticity_buzzwords")]), "medium");
  assert.equal(band([warn("authenticity_buzzwords"), warn("authenticity_few_specifics")]), "low");
});

test("scoreBlocked / trustedScoreTotal: a defaulted score is unscored, never a finite 0", () => {
  const zero = { total: 0, experience: 0, skills: 0, roleSeniority: 0, education: 0, traits: 0 };
  const blocker = f("score_section_missing", "blocker", "score", "Score section missing — defaulted to 0 (manual review)");
  const coded = { score: zero, sanityChecks: [blocker.text], trustFindings: [blocker] };
  assert.equal(scoreBlocked(coded), true);
  assert.equal(trustedScoreTotal(coded), null);
  // The stored-score path for a legacy payload that carries only the sentence.
  const legacy = { score: zero, sanityChecks: [blocker.text] };
  assert.equal(scoreBlocked(legacy), true);
  assert.equal(trustedScoreTotal(legacy), null);
  // A genuinely measured 0 (no blocker) stays a finite 0.
  assert.equal(trustedScoreTotal({ score: zero, sanityChecks: [], trustFindings: [] }), 0);
  // A score-scope WARN is not a blocker: the number was computed, just doubted.
  const warned = { score: { ...zero, skills: 12, total: 12 }, trustFindings: [f("score_total_divergent", "warn", "score", "…")] };
  assert.equal(scoreBlocked(warned), false);
  assert.equal(trustedScoreTotal(warned), 12);
  assert.equal(trustedScoreTotal({ score: null }), null);
});
