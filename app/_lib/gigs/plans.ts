// The gig plan runner: for each gig of a request, in turn, one proposal ROUND - a row per
// seat of the lineup the gig's brief DIFFICULTY calls for (plan-seats.ts planSeatsFor: easy,
// moderate and unrated one Sonnet 5.5 high seat; hard one Opus 5.5 high seat; very hard
// three - Opus 5.5 xhigh, Fable 5, and GPT 6 Astra at max through the Codex CLI) - and a
// round's seats run IN PARALLEL through pipeline/jobfit/gig_plan_cli.py, so the operator can
// compare their plans side by side on the gig's Plans section and accept exactly one
// (docs/features/gigs/README.md "Plans"). It is the `gig_plans` task's body
// (late-bound-boot.ts); nothing on the task hub imports it.
//
// The rules:
//   - a gig is SKIPPED (and the summary says why) when it is not in this workspace
//     (`not_found`), already has an accepted plan (`accepted` - one per gig, ever), has no
//     research brief yet (`no_brief` - the plan reads it), is flagged as a honeypot
//     (`gig_suspect` - a suspect listing never reaches a model), has left the line
//     (`not_plannable`), or already has a round in flight (`in_flight`, a round younger
//     than GIG_PLAN_IN_FLIGHT_MS); `round_refused` is the store refusing the round (a plan
//     was accepted between the read and the write).
//   - each seat writes `running` first, then `ready` with its plan or `failed` with the
//     reason (the CLI's fallbackReason - `no_provider` keyless, `llm_error:<...>`,
//     `llm_unusable` - or `engine_error` / `aborted` when the spawn itself failed), its
//     cost as the CLI reported it (null = not reported, never 0) and its wall time. One
//     seat's failure never touches the others.
//   - gigs run one after another inside GIG_PLANS_PASS_BUDGET_MS, under the task runner's
//     15-minute wall clock: a gig is not started unless a whole seat timeout still fits
//     (the first gig always starts). The gigs that did not fit come back as `deferred`, and
//     the task continues them as a new `gig_plans` task.
//
// KEYLESS IS A DECISION, NOT A FAULT: with no usable CLI engine (the Claude CLI, or the
// Codex CLI for the GPT seat) a seat answers `no_provider` (exit 0) and its row is `failed`
// with that reason - there is no deterministic plan, and the report says so rather than
// showing a template as a design.
//
// Everything with an effect is injected (GigPlanRunnerDeps) so plans.test.ts runs the
// runner over a fake CLI with no Python, no model and no key.

import { createGigPlanRound, getAcceptedGigPlan, listGigPlans, setGigPlanResult, setGigPlanRunning } from "../db/gigs-plans";
import { getGig } from "../db/gigs";
import { runPythonCli, type CliRunner } from "../jobseeker/python-cli";
import { planSeatsFor, type GigPlanSeat } from "./plan-seats";
import { requestGigReport } from "./report/trigger";
import { gigTrackOf, type Gig, type GigBrief, type GigDifficulty, type GigPlan, type GigPlanRow, type GigStatus } from "./types";

/** Kept in lockstep with gig_plan_cli.py PROMPT_VERSION (plans.test.ts reads both). */
export const GIG_PLAN_PROMPT_VERSION = "gig-plan-v1";
/** The PROPOSAL track's variant (a freelance bid, types.ts gigTrackOf): the same plan schema,
 *  written for the CLIENT - milestones they receive, questions for them, the assumptions the
 *  bid rests on. Lockstep with gig_plan_cli.py PROMPT_VERSION_PROPOSAL (plans.test.ts); the CLI
 *  envelope names the version that ran. */
export const GIG_PLAN_PROPOSAL_PROMPT_VERSION = "gig-plan-v2-proposal";
/** One seat's spawn: the hang backstop over the CLI's own deadline. */
export const GIG_PLAN_SEAT_TIMEOUT_MS = 9 * 60_000;
/** The CLI's deadline, handed over as --timeout-s: a minute under the spawn's kill, so a
 *  slow seat ends as a coded `deadline_exceeded` with its ledger line, not a SIGKILL. */
export const GIG_PLAN_CLI_TIMEOUT_S = 480;
/** One pass: under the task runner's 15-minute wall clock with a minute to spare. */
export const GIG_PLANS_PASS_BUDGET_MS = 14 * 60_000;
/** A queued/running round younger than this is in flight; an older one was orphaned by a
 *  restart and no longer blocks a new round. */
export const GIG_PLAN_IN_FLIGHT_MS = 20 * 60_000;
/** Gig ids one `gig_plans` task accepts (POST /api/gigs/plans validates the same bound). */
export const GIG_PLANS_MAX_GIGS = 50;
/** Characters of the listing handed to the seats (gig_plan_cli.py MAX_PAGE_CHARS). */
const LISTING_CHARS = 20_000;

/** Statuses a plan still informs: before dispatch, and a gig still being worked. */
export const GIG_PLANNABLE_STATUSES: readonly GigStatus[] = ["new", "qualified", "dispatched", "drafted", "in_review"];

export const GIG_PLAN_SKIP_REASONS = ["not_found", "accepted", "no_brief", "gig_suspect", "not_plannable", "in_flight", "round_refused", "aborted"] as const;
export type GigPlanSkipReason = (typeof GIG_PLAN_SKIP_REASONS)[number];

/** The `gig_plans` task's result (plus `continuedAs`, added by late-bound-boot.ts). */
export type GigPlansSummary = {
  /** Gigs a round was run for. */
  gigs: number;
  /** Seats that answered with a plan / that failed, across those gigs. */
  ready: number;
  failed: number;
  skipped: { gigId: string; reason: GigPlanSkipReason }[];
  /** Gigs not started because the pass budget could not fit one more round. */
  deferred: string[];
};

export type GigPlanRunnerDeps = {
  runCli: CliRunner;
  /** The lineup for a brief's difficulty (plan-seats.ts planSeatsFor). */
  seatsFor: (difficulty: GigDifficulty | null | undefined) => readonly GigPlanSeat[];
  /** A FIXED lineup for every gig, whatever its difficulty (tests); absent = seatsFor. */
  seats?: readonly GigPlanSeat[];
  getGig: typeof getGig;
  listGigPlans: typeof listGigPlans;
  getAcceptedGigPlan: typeof getAcceptedGigPlan;
  createGigPlanRound: typeof createGigPlanRound;
  setGigPlanRunning: typeof setGigPlanRunning;
  setGigPlanResult: typeof setGigPlanResult;
  nowMs: () => number;
  log: (line: string, error?: unknown) => void;
};

export function defaultGigPlanRunnerDeps(): GigPlanRunnerDeps {
  return {
    runCli: runPythonCli,
    seatsFor: planSeatsFor,
    getGig,
    listGigPlans,
    getAcceptedGigPlan,
    createGigPlanRound,
    setGigPlanRunning,
    setGigPlanResult,
    nowMs: () => Date.now(),
    log: (line, error) => (error === undefined ? console.warn(`[gigs:plans] ${line}`) : console.error(`[gigs:plans] ${line}`, error)),
  };
}

// ---------------------------------------------------------------------------
// The plan's shape (kp's gate; gig_plan_cli.py coerce_plan is the first line)
// ---------------------------------------------------------------------------

const LIST_MARKER = /^(?:[-*•]\s+|\d+[.)]\s+|(?:step\s+)?\d+\s*[:.)-]\s+)/i;

function clampLine(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim().replace(LIST_MARKER, "").replace(/^#+/, "").trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function clampList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const s = clampLine(item, 300);
    if (s && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
    if (out.length >= 8) break;
  }
  return out;
}

/** A seat's `result` as kp stores it, or null when it is unusable: no summary, or fewer than
 *  4 / more than 9 steps that each carry a title AND a `doneWhen` (a step with no done-when
 *  is not checkable, so it cannot become a goal the agent reports on). */
export function parseGigPlan(raw: unknown): GigPlan | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const summary = clampLine(r.summary, 900);
  if (!summary || !Array.isArray(r.steps)) return null;
  const steps: GigPlan["steps"] = [];
  for (const item of r.steps) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const step = item as Record<string, unknown>;
    const title = clampLine(step.title, 160);
    const doneWhen = clampLine(step.doneWhen, 300);
    if (title && doneWhen) steps.push({ title, doneWhen });
  }
  if (steps.length < 4 || steps.length > 9) return null;
  let effortHours: GigPlan["effortHours"] = null;
  const e = r.effortHours && typeof r.effortHours === "object" && !Array.isArray(r.effortHours) ? (r.effortHours as Record<string, unknown>) : null;
  if (e) {
    const min = typeof e.min === "number" && Number.isFinite(e.min) ? e.min : NaN;
    const max = typeof e.max === "number" && Number.isFinite(e.max) ? e.max : NaN;
    if (min > 0 && max >= min && max <= 2000) effortHours = { min: Math.round(min * 10) / 10, max: Math.round(max * 10) / 10 };
  }
  return { summary, steps, decisions: clampList(r.decisions), risks: clampList(r.risks), effortHours, questions: clampList(r.questions) };
}

/** The CLI's input for one seat: the seat's engine, the gig's TRACK (a freelance bid gets the
 *  client-facing prompt variant, gig-plan-v2-proposal), the listing's facts, the brief (with
 *  its missing artifacts, first message and language), and the listing's own text as the
 *  first page (the brief already followed its links). The CLI fences everything but the
 *  engine and the track as untrusted data. Pure. */
export function gigPlanCliInput(seat: GigPlanSeat, gig: Gig, brief: GigBrief) {
  return {
    seat: seat.seat,
    provider: seat.provider,
    model: seat.model,
    effort: seat.effort,
    track: gigTrackOf(gig.arena),
    arena: gig.arena,
    gig: { title: gig.title, arena: gig.arena, url: gig.url, reward: gig.reward?.text ?? null, deadlineAt: gig.deadlineAt },
    brief: {
      category: brief.category,
      difficulty: brief.difficulty,
      effort: brief.effort,
      markdown: brief.markdown,
      challenges: brief.challenges,
      missingArtifacts: brief.missingArtifacts ?? [],
      outreachMessage: brief.outreachMessage ?? null,
      language: brief.language ?? null,
    },
    pages: [{ url: gig.url, title: gig.title, text: gig.bodyText.slice(0, LISTING_CHARS) }],
  };
}

/** The `gig_plans` task's params, validated (stored on the task row, replayed by a retry):
 *  unique non-empty string ids, at most GIG_PLANS_MAX_GIGS. */
export function parseGigPlansTaskParams(params: Record<string, unknown>): string[] {
  if (!Array.isArray(params.gigIds)) return [];
  const ids = params.gigIds.filter((id): id is string => typeof id === "string" && id.trim() !== "" && id.length <= 200);
  return [...new Set(ids)].slice(0, GIG_PLANS_MAX_GIGS);
}

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

function costOf(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/** Why this gig gets no round, or null when it may. */
function skipReason(workspaceId: string, gig: Gig | null, deps: GigPlanRunnerDeps, nowMs: number): GigPlanSkipReason | null {
  if (!gig) return "not_found";
  if (deps.getAcceptedGigPlan(workspaceId, gig.id)) return "accepted";
  if (gig.status === "suspect") return "gig_suspect";
  if (!GIG_PLANNABLE_STATUSES.includes(gig.status)) return "not_plannable";
  if (!gig.brief) return "no_brief";
  const inFlight = deps
    .listGigPlans(workspaceId, gig.id)
    .some((p) => (p.status === "queued" || p.status === "running") && nowMs - Date.parse(p.updatedAt) < GIG_PLAN_IN_FLIGHT_MS);
  return inFlight ? "in_flight" : null;
}

/** One seat: running -> the CLI -> ready | failed. Never throws. */
async function runSeat(
  workspaceId: string,
  gig: Gig,
  brief: GigBrief,
  row: GigPlanRow,
  seat: GigPlanSeat,
  deps: GigPlanRunnerDeps,
  signal: AbortSignal | undefined
): Promise<"ready" | "failed"> {
  const startedMs = deps.nowMs();
  try {
    if (!deps.setGigPlanRunning(workspaceId, row.id)) return "failed";
  } catch (error) {
    deps.log(`${gig.id}/${seat.seat}: could not mark the seat running`, error);
    return "failed";
  }
  let plan: GigPlan | null = null;
  let reason = "engine_error";
  let costUsd: number | null = null;
  try {
    const out = await deps.runCli({
      module: "gig_plan_cli",
      files: { "input.json": gigPlanCliInput(seat, gig, brief) },
      args: (f) => ["--input-json", f["input.json"], "--timeout-s", String(GIG_PLAN_CLI_TIMEOUT_S)],
      signal,
      llm: true,
      timeoutMs: GIG_PLAN_SEAT_TIMEOUT_MS,
    });
    costUsd = costOf(out.costUsd);
    plan = out.source === "llm" ? parseGigPlan(out.result) : null;
    if (!plan) reason = typeof out.fallbackReason === "string" && out.fallbackReason ? out.fallbackReason.slice(0, 120) : "llm_unusable";
  } catch (error) {
    reason = signal?.aborted ? "aborted" : "engine_error";
    deps.log(`${gig.id}/${seat.seat}: the plan engine failed`, error);
  }
  try {
    const stored = deps.setGigPlanResult(workspaceId, row.id, {
      plan,
      fallbackReason: plan ? null : reason,
      costUsd,
      durationMs: Math.max(0, deps.nowMs() - startedMs),
    });
    return plan && stored ? "ready" : "failed";
  } catch (error) {
    deps.log(`${gig.id}/${seat.seat}: could not store the seat's result`, error);
    return "failed";
  }
}

/** Plan each gig in turn, its seats in parallel. See the header for the rules. */
export async function runGigPlans(
  workspaceId: string,
  gigIds: readonly string[],
  opts: { signal?: AbortSignal; deps?: Partial<GigPlanRunnerDeps>; passBudgetMs?: number } = {}
): Promise<GigPlansSummary> {
  const deps: GigPlanRunnerDeps = { ...defaultGigPlanRunnerDeps(), ...opts.deps };
  const summary: GigPlansSummary = { gigs: 0, ready: 0, failed: 0, skipped: [], deferred: [] };
  const passBudgetMs = opts.passBudgetMs ?? GIG_PLANS_PASS_BUDGET_MS;
  const passStartedMs = deps.nowMs();
  const ids = [...new Set(gigIds)];
  for (const [i, gigId] of ids.entries()) {
    if (opts.signal?.aborted) {
      for (const rest of ids.slice(i)) summary.skipped.push({ gigId: rest, reason: "aborted" });
      break;
    }
    // Every gig after the first starts only if a whole seat timeout still fits the pass.
    if (summary.gigs > 0 && passBudgetMs - (deps.nowMs() - passStartedMs) < GIG_PLAN_SEAT_TIMEOUT_MS) {
      summary.deferred = ids.slice(i);
      break;
    }
    const gig = deps.getGig(workspaceId, gigId);
    const skip = skipReason(workspaceId, gig, deps, deps.nowMs());
    if (skip || !gig || !gig.brief) {
      summary.skipped.push({ gigId, reason: skip ?? "no_brief" });
      continue;
    }
    const brief = gig.brief;
    const lineup = deps.seats ?? deps.seatsFor(brief.difficulty);
    const rows = deps.createGigPlanRound(workspaceId, gig.id, lineup.map((s) => ({ seat: s.seat, model: s.model, effort: s.effort })));
    if (!rows || rows.length === 0) {
      summary.skipped.push({ gigId, reason: "round_refused" });
      continue;
    }
    summary.gigs += 1;
    const outcomes = await Promise.all(
      rows.map((row) => {
        // The row's own seat in this round's lineup (the seat id AND the effort: Opus runs at
        // high on a hard gig and at xhigh on a very hard one).
        const seat =
          lineup.find((s) => s.seat === row.seat && s.model === row.model && s.effort === row.effort) ??
          lineup.find((s) => s.seat === row.seat) ?? { seat: row.seat, provider: "claude_cli" as const, model: row.model, effort: row.effort, label: row.seat };
        return runSeat(workspaceId, gig, brief, row, seat, deps, opts.signal);
      })
    );
    for (const o of outcomes) summary[o] += 1;
    // The gig's report (gigs/report/trigger.ts): best-effort, never part of the round.
    requestGigReport(workspaceId, gig.id, "planned");
  }
  return summary;
}
