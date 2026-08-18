// Pins the calibration HONESTY contract at the source level — the one the UAT drain
// of 2026-08-17 found broken not in the data layer but in the wiring to the screen.
//
// The defect this file exists to prevent recurring (KAT-L1-001 rec 2 · KAT-ANA-1 ×3 ·
// LUC-ANA-2 · KAT-L1-006): the route computed a per-source `leakage` descriptor and
// could serve a `holdout` clean arm on every request, and NO surface could reach
// either — the selector union was two-valued, neither `Payload` type declared
// `leakage`, and the section headline hardcoded `?source=pipeline` and printed
// „automated decisions on this score are defensible" over the arm whose outcome
// labels that same score produced. Nothing failed: no test, no type error, no lint.
// That is precisely the gap a source-level contract test closes.
//
// Idiom note: there is no render/DOM test layer in this repo (see
// analyticsCalibrationFamilyApplyGate.test.ts, file-intake-gate.test.ts), and the
// verdict logic lives in a .tsx that Node's type-stripping runner cannot import, so
// these are structural assertions over the source. They are ordered, not merely
// textual, where the ordering IS the guarantee (see the structural-bar test).
//
// Runner: Node's built-in test runner with type stripping.
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

/** Code only. These files EXPLAIN the coin-flip mistake in prose, so a naive
 *  "0.25 must not appear" would fail on its own postmortem. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const panel = read("./AnalyticsCalibrationPanel.tsx");
const header = read("./AnalyticsCalibrationHeader.tsx");
const suggestion = read("./AnalyticsThresholdSuggestion.tsx");
const diagram = read("./AnalyticsReliabilityDiagram.tsx");
const quality = read("./sections/QualityInstrument.tsx");
// The pure verdict/skill logic moved out of QualityInstrument.tsx into this plain
// module so node:test can EXECUTE it — see calibrationVerdict.test.ts, which now
// pins the behaviour these source-level assertions could only approximate.
const verdict = read("./calibrationVerdict.ts");

// ─── 1. The clean arm is reachable ────────────────────────────────────────────

test("the source selector offers the holdout clean arm", () => {
  assert.match(
    header,
    /value:\s*"holdout"/,
    "the source Select must offer holdout — it is the only arm whose outcome the score did not produce",
  );
  assert.match(header, /t\(SOURCE_KEY\.holdout\)/, "the holdout option must carry its own localized label");
  assert.match(header, /measuresHoldout/, "the holdout arm must say what it measures");
  assert.match(header, /exclusionHoldout/, "the holdout arm must state its own inclusion/exclusion rule");
});

test("no calibration surface narrows the source back to two values", () => {
  // The regression that caused the finding: a hand-written union that silently
  // dropped the third producer the route has always been able to serve.
  for (const [name, src] of [
    ["AnalyticsCalibrationPanel.tsx", panel],
    ["AnalyticsCalibrationHeader.tsx", header],
  ] as const) {
    assert.doesNotMatch(
      src,
      /"pipeline"\s*\|\s*"analysis"(?!\s*\|)/,
      `${name} must use CalibrationSource, not a hand-written two-valued union`,
    );
  }
  assert.match(panel, /useState<CalibrationSource>\("pipeline"\)/, "the panel's source state must be the closed vocabulary");
});

// ─── 2. The disclosure the payload already ships reaches the reader ───────────

test("both Payload types declare leakage", () => {
  assert.match(panel, /leakage\?:\s*CalibrationLeakage/, "the panel payload must declare leakage");
  assert.match(quality, /leakage\?:\s*CalibrationLeakage/, "the section headline payload must declare leakage");
});

test("the disclosure renders the note AND the ceiling, keyed off the stable code", () => {
  // The route's `note`/`ceiling` are English; the app runs in four locales, so the
  // UI keys localized copy off `leakage.code` (which exists for exactly that) —
  // but it must render BOTH halves. A note without its ceiling overstates the
  // clean arm just as badly as no disclosure overstates the dirty one.
  assert.match(header, /"score-caused-label":\s*\{\s*note:/, "the high-leakage code must map to localized copy");
  assert.match(header, /"reviewer-saw-score":\s*\{\s*note:/, "the medium-leakage code must map to localized copy");
  assert.match(header, /"no-automated-leakage":\s*\{\s*note:/, "the clean-arm code must map to localized copy");
  assert.match(header, /t\(copy\.note\)/, "the note must be rendered");
  assert.match(header, /t\(copy\.ceiling\)/, "the ceiling must be rendered beside the note");
  // Above the fold, beside the number — not a tooltip and not a details/summary.
  assert.doesNotMatch(header, /<details/, "the leakage disclosure must not be collapsed behind a disclosure widget");
  assert.doesNotMatch(header, /title=\{t\(copy\./, "the leakage disclosure must not hide in a title attribute");
});

test("both the panel and the section headline render the same disclosure", () => {
  assert.match(panel, /<CalibrationLeakageNote/, "the panel must render the leakage disclosure");
  assert.match(quality, /<CalibrationLeakageNote/, "the section headline must render the leakage disclosure");
});

// ─── 3. The structural bar (the point of the whole item) ──────────────────────

test("a high-leakage source cannot produce a trustworthy verdict", () => {
  // This is an ORDER assertion, not a text one. `verdictFor` must return the
  // non-accuracy verdict for a score-caused label BEFORE it reaches the skill
  // ladder, so no Brier score — however good — can route a circular arm to
  // `trustworthy`. Move the guard below the ladder and this fails.
  //
  // UPDATED DELIBERATELY (not deleted): `verdictFor` moved from
  // sections/QualityInstrument.tsx to ./calibrationVerdict.ts, because the unit
  // runner cannot import a `.tsx` and this guarantee could therefore only be
  // asserted by reading source text. The behavioural version now lives in
  // calibrationVerdict.test.ts ("a high-leakage arm is circular even with a
  // PERFECT Brier score"). This layout assertion is kept as the cheap tripwire
  // for someone re-inlining the logic into a component.
  const start = verdict.indexOf("export function verdictFor(");
  assert.ok(start > 0, "verdictFor must exist and be exported from calibrationVerdict.ts");
  const body = verdict.slice(start);

  const guard = body.search(/leakage\?\.level === "high"/);
  assert.ok(guard > 0, "verdictFor must branch on leakage.level === 'high'");
  assert.match(body, /return "circular"/, "a score-caused arm must get its own verdict, not a softened good one");

  const trustworthy = body.indexOf('return "trustworthy"');
  assert.ok(trustworthy > 0, "verdictFor must still be able to award a trustworthy verdict to a clean arm");
  assert.ok(
    guard < trustworthy,
    "the high-leakage guard must sit ABOVE the skill ladder — otherwise a good Brier on a circular arm reads as trustworthy",
  );
  assert.equal(
    (body.match(/return "trustworthy"/g) ?? []).length,
    1,
    "there must be exactly ONE path to a trustworthy verdict, so the guard cannot be bypassed",
  );
});

test("the section headline leads with the clean arm whenever it can be judged", () => {
  assert.match(quality, /source=holdout/, "the headline must read the holdout arm, not only the pipeline arm");
  assert.match(quality, /leadsWithHoldout/, "the headline must prefer the falsifiable arm when it clears the gate");
});

// ─── 4. The honest yardstick ──────────────────────────────────────────────────

test("the coin-flip reference is gone, replaced by the cohort base rate", () => {
  // 0.25 is the Brier of a 50/50 coin. On a cohort that advances 86 % of the time
  // it is the wrong bar, and using it let a NEGATIVE skill score (-0.332 on the
  // seeded host) render under „a comfortable margin over guessing".
  assert.doesNotMatch(code(quality), /COIN_FLIP_BRIER/, "the coin-flip constant must not return");
  assert.doesNotMatch(code(quality), /0\.25/, "0.25 must not be reintroduced as a comparison bar");
  // The arithmetic moved to ./calibrationVerdict.ts with the verdict it feeds;
  // AnalyticsCalibrationHeader re-exports it so existing importers still resolve.
  // Its NUMBERS are pinned for real in calibrationVerdict.test.ts against the live
  // seeded cohort (n=21, positives=18, brier=0.1631 → skill −0.332).
  assert.match(verdict, /export function calibrationSkill/, "the base-rate/skill arithmetic must live in one place");
  assert.match(verdict, /baseRate \* \(1 - baseRate\)/, "the base-rate Brier is p(1-p) — the constant predictor's score");
  assert.match(verdict, /1 - result\.brier \/ baseBrier/, "the skill score is 1 - brier/baseBrier");
  assert.match(header, /export \{ calibrationSkill/, "the header must keep re-exporting it for existing call sites");
  assert.match(quality, /statBaseBrier/, "the base-rate Brier must be shown beside the model's Brier");
  assert.match(quality, /statSkill/, "the skill score must be shown");
  assert.match(panel, /t\("skill"\)/, "the panel must show the skill score next to the Brier score");
});

test("the reliability diagram can draw the floor and the base rate", () => {
  // A curve that steps from observed 0.00 to 1.00 exactly at the auto-reject floor
  // is the signature of a score-caused label. The reader can only see that if the
  // floor is drawn on the plot.
  assert.match(diagram, /threshold\?:\s*number \| null/, "the diagram must accept the live auto-reject floor");
  assert.match(diagram, /baseRate\?:\s*number \| null/, "the diagram must accept the cohort base rate");
  assert.match(diagram, /srThreshold/, "the floor marker needs a screen-reader equivalent");
  assert.match(diagram, /srBaseRate/, "the base-rate line needs a screen-reader equivalent");
  assert.match(panel, /threshold=\{source === "pipeline"/, "the panel must pass the floor only for the arm that has one");
});

// ─── 5. Absences that explain themselves ──────────────────────────────────────

test("an arm that cannot yet be judged prints its accrual horizon", () => {
  assert.match(header, /export function CalibrationAccrualNote/, "the accrual horizon must be a shared primitive");
  assert.match(header, /minOutcomes - n/, "the horizon is the remaining decisions, not a restatement of the gate");
  assert.match(panel, /<CalibrationAccrualNote/, "the uncalibrated panel state must state when the arm becomes judgeable");
  assert.match(quality, /<CalibrationAccrualNote/, "the headline must print the clean arm's horizon while it accrues");
});

test("an absent threshold recommendation explains which gate it failed", () => {
  assert.match(suggestion, /export function ThresholdSuggestionAbsent/, "a null recommendation must render an explanation");
  assert.match(panel, /<ThresholdSuggestionAbsent/, "the panel must render it instead of nothing");
  assert.match(suggestion, /recAbsentNoFloor/, "a floor at an extreme is a different absence from a thin band");
});

test("the recommender prints its own contamination caveat beside Apply", () => {
  // KAT-L1-006: the recommendation reads the band advance rates that the floor it
  // proposes to move helped produce. That belongs at the click, not in a doc.
  assert.match(suggestion, /leakage\?:\s*CalibrationLeakage/, "the suggestion must receive the arm's leakage");
  assert.match(suggestion, /leakage\.level === "high"/, "the caveat must be conditioned on the leakage level");
  assert.match(suggestion, /recLeakageCaveat/, "the caveat copy must be rendered");
  assert.match(panel, /leakage=\{data\.leakage\}/, "the panel must thread leakage into the suggestion");
});

test("no per-family floor is stated as a fact, not left blank", () => {
  const chips = read("./AnalyticsFamilyFloorChips.tsx");
  assert.match(chips, /familyFloorsNone/, "an empty override map must say every family uses the global floor");
});

// ─── 6. The outcome axis is a VISIBLE choice (UAT KAT-L1-003, recurrence 2) ────
//
// The defect survived a full cycle because the round before it shipped honest
// DISCLOSURE („advanced past screening") and nothing else: Interview, Offer and
// Hired stayed one label, so the question the analytics Character opens the tab
// with had no answer anywhere. These pin the CAPABILITY, and pin that adding it
// did not re-introduce a silent re-definition of "success".

test("the panel offers the outcome axis as a labelled, switchable choice", () => {
  assert.match(panel, /useState<CalibrationOutcomeAxis>\("advance"\)/, "the axis must be closed-vocabulary state, defaulting to the historical label");
  assert.match(panel, /outcome=\$\{outcome\}/, "the axis must reach the route");
  assert.match(header, /value:\s*"hired"/, "the axis must be an on-screen option, not a URL trick");
  assert.match(header, /t\(OUTCOME_KEY\.advance\)/, "each option carries its own localized label");
  assert.match(header, /t\(OUTCOME_KEY\.hired\)/);
});

test("every axis states what its positive label means, per source", () => {
  // A selector that changes the numbers without changing the sentence beside them
  // IS the silent re-definition this item exists to end.
  assert.match(header, /measuresPipelineHired/, "the hire axis must say what it measures");
  assert.match(header, /exclusionPipelineHired/, "…and who it excludes, which is most of the pipeline");
  assert.match(header, /measuresHoldoutHired/);
  assert.match(header, /exclusionHoldoutHired/);
  assert.match(header, /MEASURES_KEY\[source\]\[outcome\]/, "the copy must be keyed on the arm, not on the source alone");
  assert.match(header, /EXCLUSION_KEY\[source\]\[outcome\]/);
  // The CV-analysis producer has no stages, so the control is absent AND explained.
  assert.match(header, /outcomeAnalysisUnavailable/, "an unavailable axis must say why, not vanish");
});

test("the panel labels the axis the payload REPORTS, not the one it asked for", () => {
  // The route falls back for the analysis producer. Labelling off local state would
  // caption an advance curve as a hire curve for exactly that case.
  assert.match(panel, /outcome\?:\s*CalibrationOutcomeAxis/, "the payload type must declare the echoed axis");
  assert.match(panel, /const axis: CalibrationOutcomeAxis = data\?\.outcome \?\? outcome/);
  assert.match(panel, /axisObservedHired/, "the plotted y axis must be renamed on the hire arm");
  assert.match(panel, /baseRateLegendHired/);
  assert.match(panel, /skillHintHired/, "the skill yardstick must name the hire base rate, not the advance one");
  assert.match(panel, /uncalibratedBodyHired/, "even the not-yet-calibrated copy must name the right outcome");
});

test("the advance-axis-only surfaces are withheld on the hire axis, and say so", () => {
  // pipelineCalibrationBandCandidates labels candidates on the advance axis, and
  // the threshold recommendation is derived from advance rates. Showing either
  // under a hire curve would be the same category error, one layer down.
  assert.match(panel, /axis === "advance" \? \(\s*<ScoreBands/, "the band drilldown is advance-axis only");
  assert.match(panel, /outcomeHiredScopeNote/, "…and its absence is explained, not blank");
  assert.match(panel, /source === "pipeline" && axis === "advance" \? \(/, "the threshold suggestion stays on the advance axis");
});

test("the section headline states the scope of its verdict", () => {
  // KAT-L1-003(a): the scope lived only in a small "what counts" line inside the
  // panel, so the headline read as a verdict on the score in general.
  assert.match(quality, /scopeLabel/, "the verdict must name what it judges");
  assert.match(quality, /scopeAdvance/);
  assert.match(quality, /outcome=hired/, "the headline must read the hire arm too");
  assert.match(quality, /hiredAxisReady/, "…and report it when it can be judged");
  assert.match(quality, /hiredAxisPending/, "…or state its horizon when it cannot (G1)");
  // The verdict vocabulary that just shipped must survive untouched.
  for (const key of ["verdictGood", "verdictWeak", "verdictBad", "verdictCircular", "verdictUnknown"]) {
    assert.match(quality, new RegExp(`title: "${key}"`), `the ${key} verdict must still exist`);
  }
});

// ─── 7. Configuration is not a measurement (UAT LUC-ANA-14) ───────────────────

test("the sealed policy record survives an uncalibrated sample", () => {
  // The compliance Character's Art. 12 record of what the gate WAS disappeared
  // because the reliability curve did not have enough points — two facts with
  // nothing to do with each other. The organising rule: configuration is evidence
  // about the POLICY, the curve is evidence about the SAMPLE, and only the second
  // needs a sample.
  const gate = panel.indexOf("!data.calibrated ? (");
  assert.ok(gate > 0, "the honesty gate must still exist");
  const strip = panel.indexOf("<ThresholdHistoryStrip");
  const chips = panel.indexOf("<AnalyticsFamilyFloorChips");
  assert.ok(strip > 0 && chips > 0, "both configuration surfaces must still render");
  // They must sit AFTER the calibrated/uncalibrated ternary closes, i.e. after the
  // ScoreBands that is the last thing inside its measured branch.
  const measuredEnd = panel.indexOf("outcomeHiredScopeNote");
  assert.ok(measuredEnd > gate, "precondition: the measured branch is located");
  assert.ok(strip > measuredEnd, "the sealed floor history must render outside the measurement gate");
  assert.ok(chips > measuredEnd, "the per-family floor chips must render outside it too");
  assert.match(panel, /LUC-ANA-14/, "the fix must cite the finding it closes");
});

test("the sample-dependent claims stay INSIDE the gate", () => {
  // Ungating these would trade one honesty defect for another: a drift cohort and a
  // score band are claims ABOUT the sample.
  const gate = panel.indexOf("!data.calibrated ? (");
  const measuredEnd = panel.indexOf("outcomeHiredScopeNote");
  const drift = panel.indexOf("<DriftStrip");
  const bands = panel.indexOf("<ScoreBands");
  assert.ok(drift > gate && drift < measuredEnd, "the drift strip is a claim about the sample");
  assert.ok(bands > gate && bands < measuredEnd, "the score bands are a claim about the sample");
});

test("the history strip and the chips read their own data, so they can stand alone", () => {
  const strip = read("./AnalyticsThresholdHistoryStrip.tsx");
  assert.match(strip, /fetch\(url\)/, "the strip must own its fetch, not ride the calibration payload");
  assert.match(
    strip,
    /if \(failed \|\| !data \|\| data\.history\.length === 0\) return null/,
    "…and self-suppress when there is no sealed history, so lifting it adds no empty chrome",
  );
  assert.match(strip, /historyBy/, "the approver is the half of the record the compliance reader came for");
  assert.match(strip, /historyFingerprint/, "…together with the seal fingerprint");
});
