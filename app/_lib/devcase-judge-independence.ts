// ONE THREAD (gap 5) — "is the judge the generator?", as a value a surface can render.
//
// `devcase_judge` is the seat that GRADES this pipeline's own output — role-fit
// verdicts, artifact quality, the strict certification gates
// (pipeline/jobfit/devcase/llm_judge.py owns the invariant). Until the seat carried a
// default of its own it fell back to the generator's engine and model, so a default
// install marked its own homework, and the only trace was a stderr line inside offline
// harnesses no recruiter ever runs. The Python side now stamps the seat identities onto
// the evaluation bundle (`judgeIndependence`); this module is the read boundary and the
// rendering DECISION, kept pure so it can be tested without a DOM (this repo has no
// component-test harness — every test here is node:test over `.ts`).
//
// THE RENDERING RULE, and why it is asymmetric. Only the BAD state is shown.
//
//   * `self_grading` → say so. The reviewer is weighing evidence whose quality gate was
//     the same model that produced it.
//   * `independent` → say NOTHING. The runtime evaluation is not itself judged — the
//     judge seat runs in the calibration and lifecycle harnesses — so a green "judge
//     independent" chip beside a submission's scores would claim a check this bundle
//     never had. Recording the fact is honest; advertising it as a pass is not.
//   * `absent` → nothing, for two different reasons that both mean "we cannot say": a
//     bundle saved before this field existed, and a deterministic keyless evaluation,
//     which had no generating model for a judge to be independent OF.

/** The seat identities behind one evaluation, as `judge_independence()` emits them
 *  (`provider/model`, with `default` for the CLI's own configured default). */
export type JudgeIndependence = {
  generator: string;
  judge: string;
  independent: boolean;
};

/** What the integrity strip should say about the judge seat. */
export type JudgeSeatState = "absent" | "independent" | "self_grading";

/** Narrow a raw, stored `judgeIndependence` blob to the typed shape, or null.
 *
 *  Defensive at the trust boundary like `normalizeScorecardEntities`: the eval bundle
 *  crosses the Python/TS seam as free-form JSON (there is no codegen'd schema for it),
 *  so a legacy row, a partial emit or a hand-edited blob can carry any shape. Anything
 *  that is not a complete, string-labelled, boolean-verdicted record reads as **absent**
 *  — never as a pass, and never as an accusation. */
export function normalizeJudgeIndependence(raw: unknown): JudgeIndependence | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.independent !== "boolean") return null;
  const generator = typeof r.generator === "string" ? r.generator.trim() : "";
  const judge = typeof r.judge === "string" ? r.judge.trim() : "";
  if (!generator || !judge) return null;
  return { generator, judge, independent: r.independent };
}

/** The panel state for one evaluation's judge seat. See the rendering rule above. */
export function judgeSeatState(raw: unknown): JudgeSeatState {
  const ji = normalizeJudgeIndependence(raw);
  if (!ji) return "absent";
  return ji.independent ? "independent" : "self_grading";
}
