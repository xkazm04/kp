// The lifecycle run outcome: what the autonomous runner did on its last step, as a
// closed code, integer facts and coded warnings (challenge-r07 devcase-orchestration/B).
//
// WHY. The lifecycle row is the operator's only window onto the most autonomous thing
// in the product, and it used to show one English sentence the orchestrator composed
// from integers it already held ("published; sourced 0 candidate(s) before sourcing
// failed (...)"). A cs/de/fr recruiter read English, and the three states that need a
// human (held candidates, a crashed sourcing, a halt) were fragments of prose with no
// door to their fix. The member set is declared ONCE here as a closed type; the stored
// token (dev_lifecycle.outcome_json), the label catalog (devcase.lifecycle.outcome.*,
// pinned by devcase-stage-outcome.test.ts) and the row's rendering all derive from it.
//
// `detail` stays: it is the audit and back-compat prose, and every row written before
// the column existed (or by a human door that writes prose) keeps rendering it.
//
// PURE and import-free on purpose. The orchestrator imports this module for TYPES
// only (erased, so it adds nothing to the task-hub route graph); the literals it writes
// are checked against these unions at compile time.

/** What the last runner step concluded. */
export const STAGE_OUTCOME_CODES = [
  "collecting_open", // published; sourcing ran; the apply link is live
  "awaiting_submissions", // live, nobody has submitted yet
  "evaluated", // the drain finished; ranking is next
  "promoted", // the top of the ranking went onto the board
  "halted", // the kill switch stopped the run mid-step
  "canceled", // the background task was canceled mid-step
  "routed_to_human", // the design waits at the review gate
] as const;
export type StageOutcomeCode = (typeof STAGE_OUTCOME_CODES)[number];

/** Something the reader should know about that outcome, counted. */
export const OUTCOME_WARNING_CODES = [
  "held", // promoted to the board but held for human triage (never told they advanced)
  "eval_failed", // an evaluation threw; the submission is unscored
  "sourcing_failed", // proactive sourcing crashed on publish
  "candidates_skipped", // sourcing skipped unreadable candidates
  "scenario_template_only", // every candidate faces template interview probes
  "seed_skeleton_only", // the starter code is a skeleton (prose materials)
  "baseline_unavailable", // no naive-LLM baseline to diff submissions against
] as const;
export type OutcomeWarningCode = (typeof OUTCOME_WARNING_CODES)[number];

/** The integers an outcome may carry. Every catalog message draws its ICU arguments
 *  from this set, and the renderer always supplies all of them (see outcomeMessageValues). */
export const OUTCOME_FACT_KEYS = ["sourced", "skipped", "evaluated", "failed", "promoted", "topN", "floor"] as const;
export type OutcomeFactKey = (typeof OUTCOME_FACT_KEYS)[number];
export type OutcomeFacts = Partial<Record<OutcomeFactKey, number>>;

export type OutcomeWarning = { code: OutcomeWarningCode; count: number };
export type StageOutcome = { code: StageOutcomeCode; facts: OutcomeFacts; warnings: OutcomeWarning[] };

const OUTCOME_SET: ReadonlySet<string> = new Set(STAGE_OUTCOME_CODES);
const WARNING_SET: ReadonlySet<string> = new Set(OUTCOME_WARNING_CODES);
const FACT_SET: ReadonlySet<string> = new Set(OUTCOME_FACT_KEYS);

export const isStageOutcomeCode = (v: unknown): v is StageOutcomeCode => typeof v === "string" && OUTCOME_SET.has(v);
export const isOutcomeWarningCode = (v: unknown): v is OutcomeWarningCode => typeof v === "string" && WARNING_SET.has(v);

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Tolerant reader for a stored outcome (a JSON string or an already-parsed object).
 *  An unknown outcome code, a corrupt blob or a non-object is null (the row falls back
 *  to prose). An unknown warning or fact is DROPPED, never thrown: a row written by a
 *  newer runner must still render on an older reader. */
export function parseStageOutcome(raw: unknown): StageOutcome | null {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      /* a corrupt column reads as "no outcome": the row keeps its prose detail */
      return null;
    }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as { code?: unknown; facts?: unknown; warnings?: unknown };
  if (!isStageOutcomeCode(o.code)) return null;
  const facts: OutcomeFacts = {};
  if (o.facts && typeof o.facts === "object" && !Array.isArray(o.facts)) {
    for (const [k, n] of Object.entries(o.facts as Record<string, unknown>)) {
      if (FACT_SET.has(k) && isCount(n)) facts[k as OutcomeFactKey] = n;
    }
  }
  const warnings: OutcomeWarning[] = [];
  if (Array.isArray(o.warnings)) {
    for (const w of o.warnings) {
      const ww = w as { code?: unknown; count?: unknown } | null;
      if (ww && isOutcomeWarningCode(ww.code) && isCount(ww.count)) warnings.push({ code: ww.code, count: ww.count });
    }
  }
  return { code: o.code, facts, warnings };
}

/** The doors a warning (or the outcome itself) opens. Every one already exists:
 *  the Decisions tab, the row's Re-source handler (POST /api/devcase/source), and the
 *  control room's reconcile (POST /api/devcase/control). No new route. */
export type OutcomeAction =
  | { warning: "held"; action: "open_decisions"; href: string }
  | { warning: "sourcing_failed"; action: "re_source" }
  | { action: "resume" };

export const DECISIONS_HREF = "/?tab=decisions";

export function outcomeActions(outcome: { code?: StageOutcomeCode; facts?: OutcomeFacts; warnings: readonly OutcomeWarning[] }, ctx: { caseId: string | null | undefined }): OutcomeAction[] {
  const out: OutcomeAction[] = [];
  if (outcome.code === "halted" || outcome.code === "canceled") out.push({ action: "resume" });
  for (const w of outcome.warnings) {
    if (w.code === "held" && w.count > 0) out.push({ warning: "held", action: "open_decisions", href: DECISIONS_HREF });
    else if (w.code === "sourcing_failed" && ctx.caseId) out.push({ warning: "sourcing_failed", action: "re_source" });
    // Everything else explains (materials fell back, evaluations failed, candidates
    // were skipped): there is no one-click fix, and a button with no fix would lie.
  }
  return out;
}

/** The stages each outcome describes. A stored outcome whose stage the row has LEFT
 *  (a human approved, redesigned or closed since the runner wrote it) is stale; the
 *  row then renders the human door's prose detail instead. */
const OUTCOME_STAGES: Record<StageOutcomeCode, readonly string[]> = {
  collecting_open: ["published", "collecting"],
  awaiting_submissions: ["published", "collecting"],
  evaluated: ["ranked"],
  promoted: ["promoted"],
  halted: ["approved", "published", "collecting", "ranked"],
  canceled: ["approved", "published", "collecting", "ranked"],
  routed_to_human: ["awaiting_approval", "designed"],
};

/** Every fact key, zero-defaulted: the ICU arguments a catalog message may name.
 *  next-intl throws on a missing argument, so a message can never be handed fewer. */
export function outcomeMessageValues(outcome: { code?: StageOutcomeCode; facts: OutcomeFacts; warnings?: readonly OutcomeWarning[] }): Record<OutcomeFactKey, number> {
  const values = {} as Record<OutcomeFactKey, number>;
  for (const k of OUTCOME_FACT_KEYS) values[k] = outcome.facts[k] ?? 0;
  return values;
}

export type LifecycleDetailView =
  | { kind: "coded"; code: StageOutcomeCode; values: Record<OutcomeFactKey, number>; warnings: OutcomeWarning[] }
  | { kind: "prose"; text: string }
  | { kind: "none" };

/** What the row's detail line shows: the coded outcome when there is one that still
 *  describes the row's stage, else the legacy/human prose, else nothing. `stage`
 *  omitted skips the staleness check. */
export function lifecycleDetailView(row: { stage?: string; outcome: unknown; detail: string | null | undefined }): LifecycleDetailView {
  const outcome = parseStageOutcome(row.outcome);
  if (outcome && (row.stage === undefined || OUTCOME_STAGES[outcome.code].includes(row.stage))) {
    return { kind: "coded", code: outcome.code, values: outcomeMessageValues(outcome), warnings: outcome.warnings };
  }
  return row.detail ? { kind: "prose", text: row.detail } : { kind: "none" };
}
