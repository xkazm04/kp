import type { GigKpiInput } from "../gigs/kpi";
import {
  GIG_OUTCOME_SOURCES,
  isGigArena,
  isGigAttemptStatus,
  isGigOutcomeVerdict,
  type GigArena,
  type GigLesson,
  type GigOutcome,
  type GigOutcomeSource,
  type GigOutcomeVerdict,
  type GigReview,
  type RecipeRef,
} from "../gigs/types";
import { randomId } from "../random-id";
import { ensureDb, safeRowParse } from "./core";

// Gig outcomes and the lessons they teach (app/_lib/gigs/types.ts).
//
// gig_outcomes is APPEND-ONLY: the external judge's verdict on a sent piece of work.
// This module exports no UPDATE and no DELETE for it, and gigs-outcomes.test.ts scans
// every app/_lib source to keep it that way. A corrected verdict is a NEWER row; the KPI
// fold (gigs/kpi.ts) reads the latest per attempt.
//
// gig_lessons is the queue the registry lander drains: a lesson is appended per outcome
// and recipe, and `landed_at` is stamped once it reached the recipe's LESSONS.md.
//
// Tenancy: every statement binds `workspace_id = ?`, point reads included
// (gigs-outcomes-tenancy.test.ts, gigs-lessons-tenancy.test.ts). No carve-out, and no
// tenant default.

type GigOutcomeRow = {
  id: string;
  workspace_id: string;
  gig_id: string;
  attempt_id: string | null;
  verdict: string;
  amount: number | null;
  currency: string | null;
  feedback_text: string | null;
  source: string;
  recorded_at: string;
};

type GigLessonRow = {
  id: string;
  workspace_id: string;
  outcome_id: string;
  recipe_slug: string;
  recipe_version: string;
  arena: string;
  verdict: string;
  bullets_json: string;
  landed_at: string | null;
  created_at: string;
};

function coerceOutcomeSource(value: string): GigOutcomeSource {
  return (GIG_OUTCOME_SOURCES as readonly string[]).includes(value) ? (value as GigOutcomeSource) : "manual";
}

function gigOutcomeFromRow(row: GigOutcomeRow): GigOutcome {
  return {
    id: row.id,
    gigId: row.gig_id,
    attemptId: row.attempt_id,
    // Written from typed values only; an unknown verdict reads as the neutral one.
    verdict: isGigOutcomeVerdict(row.verdict) ? row.verdict : "no_response",
    amount: typeof row.amount === "number" && Number.isFinite(row.amount) ? row.amount : null,
    currency: row.currency,
    feedbackText: row.feedback_text,
    source: coerceOutcomeSource(row.source),
    recordedAt: row.recorded_at,
  };
}

function gigLessonFromRow(row: GigLessonRow): GigLesson {
  const bullets = safeRowParse<unknown>(row.bullets_json, "gigLesson.bullets", row.id);
  return {
    id: row.id,
    outcomeId: row.outcome_id,
    recipe: { slug: row.recipe_slug, version: row.recipe_version },
    arena: isGigArena(row.arena) ? row.arena : "freelance",
    verdict: isGigOutcomeVerdict(row.verdict) ? row.verdict : "no_response",
    bullets: Array.isArray(bullets) ? bullets.filter((b): b is string => typeof b === "string") : [],
    landedAt: row.landed_at,
    createdAt: row.created_at,
  };
}

export type AppendGigOutcomeInput = {
  gigId: string;
  /** Null when the verdict was recorded against the gig, not a specific attempt. */
  attemptId: string | null;
  verdict: GigOutcomeVerdict;
  amount: number | null;
  currency: string | null;
  feedbackText: string | null;
  source: GigOutcomeSource;
};

/** Append one verdict. Null when the gig is not in this workspace, or when `attemptId`
 *  names an attempt that is not one of THIS gig's attempts in this workspace - the
 *  checks and the INSERT share one IMMEDIATE transaction. Never updates a prior row. */
export function appendGigOutcome(workspaceId: string, input: AppendGigOutcomeInput): GigOutcome | null {
  const d = ensureDb();
  const id = randomId("gout");
  const run = d.transaction((): GigOutcomeRow | null => {
    const gig = d.prepare(`SELECT id FROM gigs WHERE id = ? AND workspace_id = ?`).get(input.gigId, workspaceId);
    if (!gig) return null;
    if (input.attemptId !== null) {
      const attempt = d
        .prepare(`SELECT id FROM gig_attempts WHERE id = ? AND gig_id = ? AND workspace_id = ?`)
        .get(input.attemptId, input.gigId, workspaceId);
      if (!attempt) return null;
    }
    const row: GigOutcomeRow = {
      id,
      workspace_id: workspaceId,
      gig_id: input.gigId,
      attempt_id: input.attemptId,
      verdict: input.verdict,
      amount: typeof input.amount === "number" && Number.isFinite(input.amount) ? input.amount : null,
      currency: input.currency?.trim() ? input.currency.trim().slice(0, 16) : null,
      feedback_text: input.feedbackText?.trim() ? input.feedbackText.trim().slice(0, 8000) : null,
      source: input.source,
      recorded_at: new Date().toISOString(),
    };
    d.prepare(
      `INSERT INTO gig_outcomes (id, workspace_id, gig_id, attempt_id, verdict, amount, currency, feedback_text, source, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      row.id,
      row.workspace_id,
      row.gig_id,
      row.attempt_id,
      row.verdict,
      row.amount,
      row.currency,
      row.feedback_text,
      row.source,
      row.recorded_at
    );
    return row;
  });
  const row = run.immediate();
  return row ? gigOutcomeFromRow(row) : null;
}

/** Oldest first (rowid breaks a same-millisecond tie in append order); with `gigId`,
 *  one gig's verdict history. */
export function listGigOutcomes(workspaceId: string, opts: { gigId?: string } = {}): GigOutcome[] {
  const d = ensureDb();
  const rows = (
    opts.gigId
      ? d
          .prepare(`SELECT * FROM gig_outcomes WHERE workspace_id = ? AND gig_id = ? ORDER BY recorded_at ASC, rowid ASC`)
          .all(workspaceId, opts.gigId)
      : d.prepare(`SELECT * FROM gig_outcomes WHERE workspace_id = ? ORDER BY recorded_at ASC, rowid ASC`).all(workspaceId)
  ) as GigOutcomeRow[];
  return rows.map(gigOutcomeFromRow);
}

export type AppendGigLessonInput = {
  outcomeId: string;
  recipe: RecipeRef;
  arena: GigArena;
  verdict: GigOutcomeVerdict;
  /** Generalizable bullets only - no account, credential, client name or path. The
   *  caller distils them; this store trims, drops empties and caps the count. */
  bullets: readonly string[];
};

/** Queue one lesson for the registry lander. Null when the outcome is not in this
 *  workspace (checked in the same IMMEDIATE transaction as the INSERT). */
export function appendGigLesson(workspaceId: string, input: AppendGigLessonInput): GigLesson | null {
  const d = ensureDb();
  const id = randomId("gles");
  const bullets = input.bullets
    .map((b) => (typeof b === "string" ? b.trim().slice(0, 500) : ""))
    .filter(Boolean)
    .slice(0, 20);
  const run = d.transaction((): boolean => {
    const outcome = d.prepare(`SELECT id FROM gig_outcomes WHERE id = ? AND workspace_id = ?`).get(input.outcomeId, workspaceId);
    if (!outcome) return false;
    d.prepare(
      `INSERT INTO gig_lessons (id, workspace_id, outcome_id, recipe_slug, recipe_version, arena, verdict, bullets_json, landed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
    ).run(
      id,
      workspaceId,
      input.outcomeId,
      input.recipe.slug,
      input.recipe.version,
      input.arena,
      input.verdict,
      JSON.stringify(bullets),
      new Date().toISOString()
    );
    return true;
  });
  if (!run.immediate()) return null;
  const row = d.prepare(`SELECT * FROM gig_lessons WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as
    | GigLessonRow
    | undefined;
  return row ? gigLessonFromRow(row) : null;
}

/** Lessons not yet landed in the registry, oldest first. */
export function listPendingGigLessons(workspaceId: string): GigLesson[] {
  const rows = ensureDb()
    .prepare(`SELECT * FROM gig_lessons WHERE workspace_id = ? AND landed_at IS NULL ORDER BY created_at ASC, rowid ASC`)
    .all(workspaceId) as GigLessonRow[];
  return rows.map(gigLessonFromRow);
}

/** Stamp `landed_at` on the given lessons. Only still-pending rows move (the first
 *  landing date is kept); returns how many were stamped. */
export function markGigLessonsLanded(workspaceId: string, ids: readonly string[]): number {
  const unique = [...new Set(ids.filter((v) => typeof v === "string" && v))];
  if (unique.length === 0) return 0;
  const d = ensureDb();
  const now = new Date().toISOString();
  const stmt = d.prepare(`UPDATE gig_lessons SET landed_at = ? WHERE id = ? AND workspace_id = ? AND landed_at IS NULL`);
  const run = d.transaction((): number => {
    let changed = 0;
    for (const id of unique) changed += stmt.run(now, id, workspaceId).changes;
    return changed;
  });
  return run.immediate();
}

type KpiAttemptRow = {
  id: string;
  gig_id: string;
  specialist_id: string;
  status: string;
  cost_usd: number | null;
  review_json: string | null;
  sent_at: string | null;
  created_at: string;
};

/** Gather the rows the pure fold (gigs/kpi.ts foldGigKpi) reads - projections only, no
 *  bodies or deliverables. Every statement binds the workspace. */
export function readGigKpiInput(workspaceId: string, now: string = new Date().toISOString()): GigKpiInput {
  const d = ensureDb();
  const attempts = (
    d
      .prepare(
        `SELECT id, gig_id, specialist_id, status, cost_usd, review_json, sent_at, created_at
         FROM gig_attempts WHERE workspace_id = ?`
      )
      .all(workspaceId) as KpiAttemptRow[]
  ).flatMap((r) => {
    if (!isGigAttemptStatus(r.status)) return [];
    const review = safeRowParse<GigReview>(r.review_json, "gigAttempt.review", r.id);
    return [
      {
        id: r.id,
        gigId: r.gig_id,
        specialistId: r.specialist_id,
        status: r.status,
        costUsd: typeof r.cost_usd === "number" && Number.isFinite(r.cost_usd) ? r.cost_usd : null,
        review: review && typeof review === "object" ? review : null,
        sentAt: r.sent_at,
        createdAt: r.created_at,
      },
    ];
  });
  const outcomes = (
    d
      .prepare(`SELECT id, gig_id, attempt_id, verdict, recorded_at FROM gig_outcomes WHERE workspace_id = ? ORDER BY recorded_at ASC, rowid ASC`)
      .all(workspaceId) as Pick<GigOutcomeRow, "id" | "gig_id" | "attempt_id" | "verdict" | "recorded_at">[]
  ).flatMap((r) =>
    isGigOutcomeVerdict(r.verdict)
      ? [{ id: r.id, gigId: r.gig_id, attemptId: r.attempt_id, verdict: r.verdict, recordedAt: r.recorded_at }]
      : []
  );
  const gigs = (
    d.prepare(`SELECT id, arena FROM gigs WHERE workspace_id = ?`).all(workspaceId) as { id: string; arena: string }[]
  ).flatMap((r) => (isGigArena(r.arena) ? [{ id: r.id, arena: r.arena }] : []));
  const specialists = d.prepare(`SELECT id FROM gig_specialists WHERE workspace_id = ?`).all(workspaceId) as { id: string }[];
  return { attempts, outcomes, gigs, specialists, now };
}
