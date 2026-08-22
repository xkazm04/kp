/** Quality scoring for the LLM model-comparison matrix — the numbers the Models
 *  tab surfaces so operators pick a provider/model on evidence, not vibes.
 *
 *  Turns the raw judge dimensions (measured by the Python bench matrix,
 *  `pipeline/jobfit/llm/bench`, judged by the Claude CLI) into a single composite
 *  score, per-model overalls, per-op winners, and a per-routing-use-case pick.
 *  Pure + client-safe: NO data and NO I/O here — the measured data is baked into
 *  ./llm-quality-scores by `bake_quality.py`; re-bake (don't hand-edit) after a run.
 *  See docs/architecture/llm-model-matrix.md. */

export interface QualityDims {
  relevance: number;
  correctness: number;
  adherence: number;
}

/** One measured (bench op × model) result — aggregated across the run's scenarios.
 *  Quality dims are measured from the model's REAL LLM output only; a scenario that
 *  errored or fell back to the deterministic template is not the model's work, so it
 *  never feeds the dims (it would just score the identical fallback template). It does
 *  count against ``llmRate`` — reliability is part of "useful for this case". */
export interface QualityCell extends QualityDims {
  /** the judge's own overall 1–10 (kept for reference; the composite is derived) */
  score: number;
  /** did the model's LLM output pass the op's structural contract (majority) */
  valid: boolean;
  /** how many judged LLM scenarios back this cell (confidence) */
  judges: number;
  /** fraction of attempts that produced real LLM output (not an error / deterministic
   *  fallback) — a reliability signal; a low value means the model often failed here */
  llmRate: number;
  /** median wall-clock of the model's LLM scenarios, ms — the speed axis (the instant
   *  deterministic fallback is excluded so it can't fake a fast p50) */
  p50Ms: number;
}

export interface QualityScores {
  /** ISO timestamp of the run this was baked from */
  measuredAt: string;
  /** the judge engine, e.g. "claude-cli" */
  judge: string;
  /** scenarios per cell in the source run (the confidence caveat: small = noisy) */
  limit: number;
  /** measured model slugs (matrix targets), in display order */
  models: string[];
  /** cells[benchOp][modelSlug] — only measured cells present */
  cells: Record<string, Record<string, QualityCell>>;
}

/** The 15 bench ops = the fine-grained "cases", each mapped to the coarser routing
 *  use case an operator actually pins in the Models tab (mirrors REGISTRY_USE_CASE
 *  in pipeline/jobfit/llm/bench/scenarios.py — keep in sync). Several comms ops roll
 *  up into the single "automation" routing use case. `labelKey` indexes i18n
 *  (models.benchOps.<id>); label falls back to a humanized id if absent. */
export interface BenchOp {
  id: string;
  useCase: string;
}

export const BENCH_OPS: readonly BenchOp[] = [
  { id: "match_reasoning", useCase: "match_reasoning" },
  { id: "automation_screen", useCase: "automation" },
  { id: "automation_outreach", useCase: "automation" },
  { id: "automation_rejection", useCase: "automation" },
  { id: "automation_offer", useCase: "automation" },
  { id: "interview_prep", useCase: "automation" },
  { id: "interview_scorecard", useCase: "interview_scorecard" },
  { id: "weight_proposal", useCase: "weight_proposal" },
  { id: "jd_ingest", useCase: "jd_ingest" },
  { id: "devcase_analyze", useCase: "devcase_analyze" },
  { id: "devcase_role_design", useCase: "devcase_role_design" },
  { id: "devcase_case_design", useCase: "devcase_case_design" },
  { id: "devcase_interview_scenario", useCase: "devcase_interview_scenario" },
  { id: "group_compare", useCase: "group_compare" },
  { id: "campaign_pack", useCase: "campaign_pack" },
] as const;

/** Bench ops that feed one routing use case (the "*" catch-all maps to nothing). */
export function opsForUseCase(useCase: string): string[] {
  return BENCH_OPS.filter((o) => o.useCase === useCase).map((o) => o.id);
}

/** Dimension weights — correctness + task-adherence dominate for these grounded
 *  recruiter tools (a fluent but invented answer is worse than an honest gap);
 *  relevance matters but less. Sum = 1. Tune here to re-weight the whole scorecard
 *  without re-running the matrix. (kp's judge has no separate "tone" axis.) */
export const QUALITY_WEIGHTS: QualityDims = {
  correctness: 0.4,
  adherence: 0.35,
  relevance: 0.25,
};

/** A structurally-invalid output is coerced to the deterministic fallback in
 *  production, so it takes a real quality hit even when the prose reads well. */
const INVALID_FACTOR = 0.7;

const clamp10 = (n: number) => Math.round(Math.min(10, Math.max(0, n)) * 10) / 10;

/** Composite quality 0–10 from a cell's dimensions (+ a validity penalty). */
export function qualityComposite(c: QualityCell): number {
  const raw =
    QUALITY_WEIGHTS.correctness * c.correctness +
    QUALITY_WEIGHTS.adherence * c.adherence +
    QUALITY_WEIGHTS.relevance * c.relevance;
  return clamp10(c.valid ? raw : raw * INVALID_FACTOR);
}

/** The composite for one (bench op, model slug), or null when not measured. */
export function cellComposite(scores: QualityScores, op: string, modelSlug: string): number | null {
  const c = scores.cells[op]?.[modelSlug];
  return c ? qualityComposite(c) : null;
}

/** The best (highest-composite) model for one bench op. On an exact tie this
 *  returns the first tied model in `scores.models` order — fine for "show me one
 *  representative winner", but NOT for counting wins: that order is the bench
 *  run's record order, not a measurement. Use `topModelsForOp` when every tied
 *  model has to be credited. */
export function bestModelForOp(
  scores: QualityScores,
  op: string
): { model: string; composite: number } | null {
  let best: { model: string; composite: number } | null = null;
  for (const model of scores.models) {
    const c = cellComposite(scores, op, model);
    if (c !== null && (!best || c > best.composite)) best = { model, composite: c };
  }
  return best;
}

/** EVERY model that ties for the top composite on one bench op (empty when the op
 *  has no measured cell). Composites are rounded to one decimal by `clamp10`, so
 *  an exact `===` here is a real dead heat at the precision the scorecard shows,
 *  not a float coincidence. */
export function topModelsForOp(scores: QualityScores, op: string): string[] {
  const best = bestModelForOp(scores, op);
  if (!best) return [];
  return scores.models.filter((m) => cellComposite(scores, op, m) === best.composite);
}

/** The best model for a ROUTING use case = highest mean composite across the bench
 *  ops that feed it (so "automation" weighs screen/outreach/rejection/offer/prep
 *  together). Null when the use case has no measured ops (e.g. the "*" catch-all). */
export function bestModelForUseCase(
  scores: QualityScores,
  useCase: string
): { model: string; composite: number } | null {
  const ops = opsForUseCase(useCase);
  if (!ops.length) return null;
  let best: { model: string; composite: number } | null = null;
  for (const model of scores.models) {
    const comps = ops
      .map((op) => cellComposite(scores, op, model))
      .filter((v): v is number => v !== null);
    if (!comps.length) continue;
    const mean = clamp10(comps.reduce((s, v) => s + v, 0) / comps.length);
    if (!best || mean > best.composite) best = { model, composite: mean };
  }
  return best;
}

export interface ModelOverall {
  model: string;
  /** mean composite across measured ops (null when none) */
  overall: number | null;
  /** measured ops / total ops in the score set (0–1) */
  coverage: number;
  measured: number;
  total: number;
  /** ops where this model is the top scorer — a dead heat credits EVERY tied
   *  model, so the per-model counts can sum to more than `total` */
  wins: number;
  /** median of the model's per-op p50 latencies, ms (the speed axis) */
  p50Ms: number | null;
  /** mean reliability (llmRate) across measured ops — low = often errored/fell back */
  reliability: number | null;
}

const median = (xs: number[]): number =>
  xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0;

/** Per-model overall = mean composite across its measured ops, plus coverage,
 *  outright wins, and a median latency. */
export function modelOverall(scores: QualityScores, model: string): ModelOverall {
  const ops = Object.keys(scores.cells);
  const comps: number[] = [];
  const lats: number[] = [];
  const rels: number[] = [];
  for (const op of ops) {
    const c = cellComposite(scores, op, model);
    if (c !== null) comps.push(c);
    const cell = scores.cells[op]?.[model];
    if (cell) {
      lats.push(cell.p50Ms);
      rels.push(cell.llmRate);
    }
  }
  const overall = comps.length ? clamp10(comps.reduce((s, v) => s + v, 0) / comps.length) : null;
  // Ties count for BOTH models. Asking `bestModelForOp(...)?.model === model`
  // credited a dead heat to whichever tied model came first in `scores.models` —
  // and that array is the bench run's record order, so the rendered "wins" column
  // moved with an artifact of the run instead of the measurement. On the
  // 2026-08-12 matrix that silently docked claude-opus-5 both of its dead heats
  // (automation_offer, devcase_role_design), publishing 10/15 for a model that is
  // top or joint-top on 12.
  const wins = ops.filter((op) => topModelsForOp(scores, op).includes(model)).length;
  return {
    model,
    overall,
    coverage: ops.length ? comps.length / ops.length : 0,
    measured: comps.length,
    total: ops.length,
    wins,
    p50Ms: lats.length ? median(lats) : null,
    reliability: rels.length ? rels.reduce((s, v) => s + v, 0) / rels.length : null,
  };
}

/** Models ranked by overall composite (unmeasured last). */
export function modelRanking(scores: QualityScores): ModelOverall[] {
  return scores.models
    .map((m) => modelOverall(scores, m))
    .sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1));
}

/** Map a routing (provider, model) pin to the OpenRouter slug the matrix measured.
 *  The matrix runs everything via OpenRouter, so a direct-vendor model
 *  (openai → gpt-5.4-mini) maps to its provider-prefixed slug (openai/gpt-5.4-mini);
 *  openrouter models are already slugs. Returns null when there is no model to map. */
const PROVIDER_PREFIX: Record<string, string> = {
  openai: "openai",
  anthropic: "anthropic",
  gemini: "google",
  azure_openai: "openai",
};
export function matrixSlug(provider: string, model: string | null | undefined): string | null {
  if (!model) return null;
  if (provider === "openrouter") return model;
  const prefix = PROVIDER_PREFIX[provider];
  return prefix ? `${prefix}/${model}` : model;
}
