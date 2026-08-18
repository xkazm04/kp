// What the Performance funnel band is ALLOWED to claim — pinned against a real
// analytics payload.
//
// UAT 2026-08-17-analytics-sections, findings TOM-ANA-3 and TOM-ANA-9.
//
// Why this file exists at all: both defects it guards were *finished work that
// nothing pointed at*. `hasNoStageTransitions()`, `AnalyticsFunnelEmptyGuide` and
// a fully translated „Nábor je připravený a čeká" were written to stop the brief
// from printing „Nejslabším článkem je Screening s konverzí 0 %" over a pipeline
// nobody had moved — and then left off the render path, where no test could see
// them go. Six `stageQuestionKey` branches were dead in all six. A guard covered
// by nothing is a guard that can be orphaned in silence, which is exactly what
// happened, so the render map is now a value and this file asserts it.
//
// The finding was filed `uncertain` because it reproduces on NEITHER dev host:
// :3001 has movement and :3002 has no entries at all, so the state that produces
// the accusation — **entries exist, nothing has moved** — could not be reached
// live. That state is constructed here, against the real resolver, which is what
// settles it: the claim is not "we argued about a branch", it is "the shipped
// `pipelineAnalytics` returns conversionPct 0 for Screened on a workspace with
// two untouched candidates, and the band refuses to call that a weakest link".
//
// Runner: `npm run test:unit` (node --test, process-isolated, type stripping).
// unit-db.ts MUST stay the first project import — it points KP_DB_PATH at a
// throwaway SQLite file before any store module resolves db-path.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanupUnitDb } from "@/app/_lib/testing/unit-db";
import { pipelineAnalytics, setAnalyticsTarget } from "@/app/_lib/db/analytics";
import { createPipelineEntry, setPipelineEntryStage } from "@/app/_lib/db/pipeline";
import { BOTTLENECK_MIN_SAMPLE } from "@/app/_lib/analytics-bottleneck";
import {
  funnelBandState,
  hasAnyConversionGoal,
  hasNoStageTransitions,
  hasUngoaledStage,
  pickWeakestLink,
  stageQuestionKey,
  stageVerdict,
  type FunnelRow,
} from "./analyticsFunnelEmptyState.ts";

after(() => cleanupUnitDb());

// ---------------------------------------------------------------------------
// Part 1 — the predicates, pure.
// ---------------------------------------------------------------------------

const row = (stage: string, reached: number, conversionPct: number | null): FunnelRow => ({
  stage,
  reached,
  current: reached,
  conversionPct,
});

test("hasNoStageTransitions: a funnel is 'not yet' only while nothing past the entry stage was reached", () => {
  const untouched = [row("Accepted", 4, null), row("Screened", 0, 0), row("Interview", 0, null)];
  assert.equal(hasNoStageTransitions(untouched), true);

  const moved = [row("Accepted", 4, null), row("Screened", 1, 25), row("Interview", 0, 0)];
  assert.equal(hasNoStageTransitions(moved), false, "one hand-off is movement");

  // A single-column axis has no hand-off to be empty of, and an empty funnel must
  // not reach the guide (which destructures `[entry, ...rest]`).
  assert.equal(hasNoStageTransitions([row("Accepted", 4, null)]), false);
  assert.equal(hasNoStageTransitions([]), false);
});

test("stageVerdict: no goal, no colour — not even against a 0%", () => {
  // TOM-ANA-9's exact complaint: „Padesát procent, které u nás nikdo nenastavil,
  // a přesto podle nich něco svítí červeně."
  assert.equal(stageVerdict(0, undefined), "none");
  assert.equal(stageVerdict(0, null), "none");
  assert.equal(stageVerdict(12, undefined), "none", "a low number is still only a number");
  assert.equal(stageVerdict(99, undefined), "none", "and a high one is not a pass either");
  // A goal the org set licenses both verdicts.
  assert.equal(stageVerdict(12, 50), "missed");
  assert.equal(stageVerdict(50, 50), "met", "meeting the goal is not missing it");
  assert.equal(stageVerdict(80, 50), "met");
  // Nothing to judge.
  assert.equal(stageVerdict(null, 50), "none");
});

test("pickWeakestLink: no weakest link without a goal to be weak against", () => {
  const funnel = [row("Accepted", 10, null), row("Screened", 2, 20), row("Interview", 1, 50)];
  assert.equal(pickWeakestLink(funnel, {}), null, "an ungoaled funnel has a lowest number, not a failure");

  // With goals, the largest GAP wins — not the lowest percentage.
  const worst = pickWeakestLink(funnel, { Screened: 30, Interview: 90 });
  assert.equal(worst?.stage, "Interview", "50 vs a 90 goal is a wider miss than 20 vs 30");
  assert.equal(worst?.gap, 40);
  assert.equal(worst?.goal, 90, "the benchmark travels with the verdict so the claim can name it");

  // Stages that clear their goal are not candidates at all.
  assert.equal(pickWeakestLink(funnel, { Screened: 10 }), null);
});

test("the goal-coverage helpers separate 'no goals' from 'some goals'", () => {
  const funnel = [row("Accepted", 10, null), row("Screened", 2, 20), row("Interview", 1, 50)];
  assert.equal(hasAnyConversionGoal(funnel, {}), false);
  assert.equal(hasAnyConversionGoal(funnel, { Screened: 30 }), true);
  // Interview still shows an unjudged number, so the grey-row note stays up.
  assert.equal(hasUngoaledStage(funnel, { Screened: 30 }), true);
  assert.equal(hasUngoaledStage(funnel, { Screened: 30, Interview: 40 }), false);
  // The entry stage has no conversion ratio, so it never demands a goal.
  assert.equal(hasUngoaledStage([row("Accepted", 10, null)], {}), false);
});

test("stageQuestionKey answers all six branches (every one of them was dead)", () => {
  assert.equal(stageQuestionKey("Accepted"), "questionAccepted");
  assert.equal(stageQuestionKey("Screened"), "questionScreened");
  assert.equal(stageQuestionKey("Interview"), "questionInterview");
  assert.equal(stageQuestionKey("Offer"), "questionOffer");
  assert.equal(stageQuestionKey("Hired"), "questionHired");
  // A workspace that renamed its board must still get a sentence.
  assert.equal(stageQuestionKey("Tech screen"), "questionFallback");
});

test("funnelBandState: movement is checked before dwell, and dwell before conversion", () => {
  const untouched = [row("Accepted", 4, null), row("Screened", 0, 0)];

  assert.deepEqual(funnelBandState({ total: 0, funnel: untouched, goals: {}, hasBottleneck: false }), { kind: "no-data" });

  // The regression this whole file exists for: zero transitions never yields a
  // conversion verdict, no matter what else is true of the workspace.
  assert.deepEqual(funnelBandState({ total: 4, funnel: untouched, goals: {}, hasBottleneck: false }), { kind: "no-movement" });
  assert.deepEqual(
    funnelBandState({ total: 4, funnel: untouched, goals: { Screened: 60 }, hasBottleneck: false }),
    { kind: "no-movement" },
    "a workspace that set goals but moved nobody is still 'not yet', not 'failing'"
  );
  assert.deepEqual(
    funnelBandState({ total: 4, funnel: untouched, goals: { Screened: 60 }, hasBottleneck: true }),
    { kind: "no-movement" },
    "four people sitting in the entry column for zero days is not a bottleneck story either"
  );

  const moved = [row("Accepted", 10, null), row("Screened", 2, 20)];
  assert.equal(funnelBandState({ total: 10, funnel: moved, goals: { Screened: 60 }, hasBottleneck: true }).kind, "stalled");
  const weakest = funnelBandState({ total: 10, funnel: moved, goals: { Screened: 60 }, hasBottleneck: false });
  assert.equal(weakest.kind, "weakest");
  assert.equal(weakest.kind === "weakest" ? weakest.link.stage : null, "Screened");

  // Real conversion, no goal → the band reports, it does not judge.
  assert.deepEqual(funnelBandState({ total: 10, funnel: moved, goals: {}, hasBottleneck: false }), { kind: "no-goal" });
  // Every goal-bearing stage clears its goal, and none is left unjudged.
  assert.deepEqual(funnelBandState({ total: 10, funnel: moved, goals: { Screened: 10 }, hasBottleneck: false }), { kind: "healthy" });
});

// ---------------------------------------------------------------------------
// Part 2 — the third fixture state, built against the REAL resolver.
//
// ≥1 pipeline entry and ZERO stage transitions: the state neither dev host could
// produce, and the reason TOM-ANA-3 shipped as `uncertain`.
// ---------------------------------------------------------------------------

// A workspace of its OWN, not the default. The throwaway unit DB self-seeds the
// demo corpus into `workspace`, and the state under test is defined by what is
// absent from it — 52 seeded candidates with real history would drown the
// fixture. `pipelineAnalytics` is workspace-scoped end to end (P1), so an
// unrelated id gives a genuinely first-week tenant on the real resolver.
const WS = "funnel-guard-ws";
let seq = 0;

/**
 * A candidate who applied and has not been touched since — no
 * `setPipelineEntryStage` anywhere.
 *
 * `stage` is passed EXPLICITLY because `createPipelineEntry`'s default is
 * `screenedLandingStage()` ("a caller that names no stage is filing an
 * already-assessed candidate"). The applicant path does not take that default:
 * both real intakes file at the board's entry column — `apply/[id]/route.ts:400`
 * and `lead-intake.ts:232` — and that is the arrival this fixture reproduces.
 */
function untouchedEntry(): void {
  seq += 1;
  createPipelineEntry({
    candidateId: `guard-c${seq}`,
    candidateLabel: `Guard Candidate ${seq}`,
    jobId: "guard-job",
    jobTitle: "Guard Role",
    stage: "Accepted",
    workspaceId: WS,
  });
}

test("REPRO: two untouched candidates make the real payload claim Screening converts 0%", () => {
  // Deliberately BELOW the bottleneck sample floor, which is what Tomáš's
  // workspace looked like — with 3+ in one column the old code would have led
  // with the stall claim instead, and the conversion accusation never appears.
  assert.ok(2 < BOTTLENECK_MIN_SAMPLE, "the repro depends on staying under the bottleneck floor");
  untouchedEntry();
  untouchedEntry();

  const data = pipelineAnalytics(null, undefined, WS);
  assert.equal(data.total, 2, "entries exist — this is NOT the tab-level first-run state");
  assert.equal(data.bottleneck, null, "no dwell story, so conversion is what the band would reach for");
  assert.equal(data.funnel[1].stage, "Screened", "the shipped axis, unmodified");

  // The exact figure the display-type headline was built from
  // (`db/analytics.ts` conversionPct = reached[i] / reached[i-1]).
  assert.equal(data.funnel[0].reached, 2);
  assert.equal(data.funnel[1].reached, 0);
  assert.equal(data.funnel[1].conversionPct, 0, "0% because nobody MOVED, not because everybody failed");

  // …and the selector that used to consume it: `targets.conversion[stage] ?? 50`
  // over every stage with a conversionPct. Reproduced here so the regression is
  // pinned by the code that caused it, not by a paraphrase of it.
  const legacyWorst = data.funnel
    .filter((f) => f.conversionPct != null)
    .map((f) => ({ stage: f.stage, pct: f.conversionPct as number, gap: (data.targets.conversion[f.stage] ?? 50) - (f.conversionPct as number) }))
    .filter((x) => x.gap > 0)
    .sort((a, b) => b.gap - a.gap)[0];
  assert.deepEqual(
    { stage: legacyWorst?.stage, pct: legacyWorst?.pct },
    { stage: "Screened", pct: 0 },
    "briefWeakestClaim(Screened, 0) — the sentence TOM-ANA-3 read on screen"
  );
});

test("GUARD: that same payload resolves to 'not yet', and no goal can turn it into a verdict", () => {
  const data = pipelineAnalytics(null, undefined, WS);
  assert.equal(hasNoStageTransitions(data.funnel), true);
  assert.deepEqual(
    funnelBandState({
      total: data.total,
      funnel: data.funnel,
      goals: data.targets.conversion,
      hasBottleneck: data.bottleneck != null,
    }),
    { kind: "no-movement" },
    "the band renders AnalyticsFunnelEmptyGuide — „Nábor je připravený a čeká. Konverze měří pohyb.\""
  );

  // Even after the org sets a goal, movement is still the prior condition.
  setAnalyticsTarget("Screened", 60, WS);
  const withGoal = pipelineAnalytics(null, undefined, WS);
  assert.equal(withGoal.targets.conversion.Screened, 60, "the goal really landed");
  assert.equal(
    funnelBandState({
      total: withGoal.total,
      funnel: withGoal.funnel,
      goals: withGoal.targets.conversion,
      hasBottleneck: withGoal.bottleneck != null,
    }).kind,
    "no-movement"
  );
});

test("once ONE candidate moves, the band starts speaking — and names the goal it judged against", () => {
  const { entry } = createPipelineEntry({
    candidateId: "guard-mover",
    candidateLabel: "Guard Mover",
    jobId: "guard-job",
    jobTitle: "Guard Role",
    stage: "Accepted",
    workspaceId: WS,
  });
  setPipelineEntryStage(entry.id, "Screened", undefined, WS);

  const data = pipelineAnalytics(null, undefined, WS);
  assert.equal(hasNoStageTransitions(data.funnel), false, "one hand-off ends the 'not yet' state");
  assert.ok((data.funnel[1].conversionPct ?? 0) > 0, "a real conversion figure now exists");

  const band = funnelBandState({
    total: data.total,
    funnel: data.funnel,
    goals: data.targets.conversion,
    hasBottleneck: data.bottleneck != null,
  });
  // 1 of 3 reached Screened = 33%, against the 60% goal set above.
  assert.equal(band.kind, "weakest");
  if (band.kind === "weakest") {
    assert.equal(band.link.stage, "Screened");
    assert.equal(band.link.goal, 60, "the claim carries its own benchmark");
    assert.ok(band.link.gap > 0);
  }

  // And with the goal cleared, the identical data yields a reading, not a verdict.
  setAnalyticsTarget("Screened", null, WS);
  const ungoaled = pipelineAnalytics(null, undefined, WS);
  assert.equal(ungoaled.targets.conversion.Screened, undefined);
  assert.deepEqual(
    funnelBandState({
      total: ungoaled.total,
      funnel: ungoaled.funnel,
      goals: ungoaled.targets.conversion,
      hasBottleneck: ungoaled.bottleneck != null,
    }),
    { kind: "no-goal" },
    "same numbers, no org goal — nothing is coral"
  );
});

// ---------------------------------------------------------------------------
// Part 3 — the guard is ON THE RENDER PATH.
//
// The predicates above can all pass while nothing renders them; that is precisely
// the state this drain found (`hasNoStageTransitions` + `AnalyticsFunnelEmptyGuide`
// correct, translated, and reachable from nowhere). There is no DOM test layer in
// this repo, so the reachability claim is asserted at the source level — the same
// idiom as analyticsCalibrationFamilyApplyGate.test.ts / file-intake-gate.test.ts.
// ---------------------------------------------------------------------------

const briefing = readFileSync(fileURLToPath(new URL("./sections/PerformanceBriefing.tsx", import.meta.url)), "utf8");

test("PerformanceBriefing resolves its band through funnelBandState and renders the guide", () => {
  assert.match(briefing, /funnelBandState/, "the band's branch comes from the tested resolver, not a fresh inline chain");
  assert.match(briefing, /import\s*\{[^}]*FunnelEmptyGuide[^}]*\}\s*from\s*"\.\.\/AnalyticsFunnelEmptyGuide"/, "the guide is imported");
  assert.match(briefing, /<FunnelEmptyGuide/, "…and actually rendered — an import alone is how it got orphaned last time");
  assert.match(briefing, /"no-movement"/, "the zero-transition branch is handled, not just resolved");
});

test("no funnel surface reconstructs the invented 50% benchmark", () => {
  // TOM-ANA-9. The literal is what made the accusation possible; if it comes back
  // anywhere near a conversion target, every coral row is unfounded again.
  for (const [name, src] of [
    ["PerformanceBriefing.tsx", briefing],
    // AnalyticsFunnelPanel.tsx was DELETED with item 11 (orphan triage): it had no
    // importer, and every affordance it owned now lives in PerformanceBriefing's funnel
    // band or AnalyticsStageDwellPanel. Dropping the read, not the guard.
    ["analyticsFunnelEmptyState.ts", readFileSync(fileURLToPath(new URL("./analyticsFunnelEmptyState.ts", import.meta.url)), "utf8")],
  ] as const) {
    // Strip comments first — the files DESCRIBE the removed fallback on purpose.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /conversion\[[^\]]+\]\s*\?\?\s*\d/, `${name} still defaults a conversion goal`);
  }
});

// ---------------------------------------------------------------------------
// Part 4 — the residual gap, pinned so it is visible rather than surprising.
// ---------------------------------------------------------------------------

test("KNOWN GAP: a candidate FILED at the screening stage is indistinguishable from one moved there", () => {
  const GAP_WS = "funnel-guard-landing-ws";
  // `createPipelineEntry`'s default landing stage — the CV-analysis intake path,
  // which files an already-assessed candidate straight into Screened.
  for (const n of [1, 2]) {
    createPipelineEntry({
      candidateId: `landing-c${n}`,
      candidateLabel: `Landing Candidate ${n}`,
      jobId: "landing-job",
      jobTitle: "Landing Role",
      workspaceId: GAP_WS,
    });
  }
  const data = pipelineAnalytics(null, undefined, GAP_WS);
  assert.equal(data.funnel[1].reached, 2, "they land at Screened without ever transitioning");

  // The funnel payload carries reached/current counts and no transition count, so
  // "2 people were screened" and "2 people were filed as screened" are the same
  // rows. The guard therefore reads this as movement and the band goes on to
  // report Interview's 0%. Closing it needs a transition count from
  // `pipelineAnalytics` (app/_lib/db/analytics.ts) — see the doc's Known gaps.
  assert.equal(hasNoStageTransitions(data.funnel), false, "documented limit, not an accident");
  assert.equal(data.funnel[2].conversionPct, 0);
});
