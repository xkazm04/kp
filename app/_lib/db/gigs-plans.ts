import { isGigPlanSeatId, isGigPlanStatus, type GigPlan, type GigPlanProgress, type GigPlanRow, type GigPlanSeatId } from "../gigs/types";
import { randomId } from "../random-id";
import { ensureDb, safeRowParse } from "./core";

// The gig_plans store (core.ts; gig-mastery S1): one row per seat per proposal round for a
// gig, and at most ONE accepted row per gig. The runner writes running -> ready|failed;
// the operator accepts one ready row (a CAS under `.immediate()`); the pairing and the sync
// mirror the Personas milestone onto the accepted row (progress_json).
//
// Tenancy: every statement binds `workspace_id = ?`, point reads included
// (gigs-plans-tenancy.test.ts). No carve-out, and no tenant default.

type GigPlanDbRow = {
  id: string;
  workspace_id: string;
  gig_id: string;
  seat: string;
  model: string;
  effort: string | null;
  status: string;
  plan_json: string | null;
  fallback_reason: string | null;
  cost_usd: number | null;
  duration_ms: number | null;
  note: string | null;
  accepted_at: string | null;
  progress_json: string | null;
  created_at: string;
  updated_at: string;
};

/** A stored plan in the shape this build writes, else null (the row still renders). */
function planFromJson(json: string | null, id: string): GigPlan | null {
  const p = safeRowParse<Partial<GigPlan>>(json, "gigPlan.plan", id);
  if (!p || typeof p !== "object" || typeof p.summary !== "string" || !Array.isArray(p.steps)) return null;
  return {
    summary: p.summary,
    steps: p.steps.filter((s) => s && typeof s.title === "string").map((s) => ({ title: s.title, doneWhen: typeof s.doneWhen === "string" ? s.doneWhen : "" })),
    decisions: Array.isArray(p.decisions) ? p.decisions.filter((x): x is string => typeof x === "string") : [],
    risks: Array.isArray(p.risks) ? p.risks.filter((x): x is string => typeof x === "string") : [],
    effortHours: p.effortHours && typeof p.effortHours.min === "number" && typeof p.effortHours.max === "number" ? { min: p.effortHours.min, max: p.effortHours.max } : null,
    questions: Array.isArray(p.questions) ? p.questions.filter((x): x is string => typeof x === "string") : [],
  };
}

function progressFromJson(json: string | null, id: string): GigPlanProgress | null {
  const p = safeRowParse<Partial<GigPlanProgress>>(json, "gigPlan.progress", id);
  if (!p || typeof p !== "object" || !Array.isArray(p.goals) || typeof p.updatedAt !== "string") return null;
  return { milestoneId: typeof p.milestoneId === "string" ? p.milestoneId : null, goals: p.goals, updatedAt: p.updatedAt };
}

function rowToPlan(row: GigPlanDbRow): GigPlanRow {
  return {
    id: row.id,
    gigId: row.gig_id,
    // written from typed values only; the fallbacks keep a retired vocabulary renderable
    seat: isGigPlanSeatId(row.seat) ? row.seat : "sonnet",
    model: row.model,
    effort: row.effort,
    status: isGigPlanStatus(row.status) ? row.status : "failed",
    plan: planFromJson(row.plan_json, row.id),
    fallbackReason: row.fallback_reason,
    costUsd: row.cost_usd,
    durationMs: row.duration_ms,
    note: row.note,
    acceptedAt: row.accepted_at,
    progress: progressFromJson(row.progress_json, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type NewGigPlanRow = { seat: GigPlanSeatId; model: string; effort: string | null };

/** Queue one proposal round: one `queued` row per seat. Refused (null) when the gig already
 *  has an accepted plan or is not in this workspace. */
export function createGigPlanRound(workspaceId: string, gigId: string, seats: readonly NewGigPlanRow[]): GigPlanRow[] | null {
  const d = ensureDb();
  const run = d.transaction((): string[] | null => {
    const gig = d.prepare(`SELECT id FROM gigs WHERE id = ? AND workspace_id = ?`).get(gigId, workspaceId);
    if (!gig) return null;
    const accepted = d.prepare(`SELECT id FROM gig_plans WHERE gig_id = ? AND workspace_id = ? AND accepted_at IS NOT NULL LIMIT 1`).get(gigId, workspaceId);
    if (accepted) return null;
    const now = new Date().toISOString();
    const insert = d.prepare(
      `INSERT INTO gig_plans (id, workspace_id, gig_id, seat, model, effort, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`
    );
    const ids: string[] = [];
    for (const s of seats) {
      const id = randomId("gplan");
      insert.run(id, workspaceId, gigId, s.seat, s.model, s.effort, now, now);
      ids.push(id);
    }
    return ids;
  });
  const ids = run.immediate();
  if (!ids) return null;
  return ids.map((id) => getGigPlan(workspaceId, id)).filter((p): p is GigPlanRow => p !== null);
}

/** Every plan row of a gig, newest round first. */
export function listGigPlans(workspaceId: string, gigId: string): GigPlanRow[] {
  const rows = ensureDb()
    .prepare(`SELECT * FROM gig_plans WHERE gig_id = ? AND workspace_id = ? ORDER BY created_at DESC, rowid ASC`)
    .all(gigId, workspaceId) as GigPlanDbRow[];
  return rows.map(rowToPlan);
}

export function getGigPlan(workspaceId: string, planId: string): GigPlanRow | null {
  const row = ensureDb().prepare(`SELECT * FROM gig_plans WHERE id = ? AND workspace_id = ?`).get(planId, workspaceId) as GigPlanDbRow | undefined;
  return row ? rowToPlan(row) : null;
}

/** The runner's first write: `queued` -> `running`. Null when the row is gone or moved. */
export function setGigPlanRunning(workspaceId: string, planId: string): GigPlanRow | null {
  const res = ensureDb()
    .prepare(`UPDATE gig_plans SET status = 'running', updated_at = ? WHERE id = ? AND workspace_id = ? AND status = 'queued'`)
    .run(new Date().toISOString(), planId, workspaceId);
  return res.changes > 0 ? getGigPlan(workspaceId, planId) : null;
}

/** The runner's last write: `ready` with the plan, or `failed` with the reason. */
export function setGigPlanResult(
  workspaceId: string,
  planId: string,
  result: { plan: GigPlan | null; fallbackReason: string | null; costUsd: number | null; durationMs: number | null }
): GigPlanRow | null {
  const status = result.plan ? "ready" : "failed";
  const res = ensureDb()
    .prepare(
      `UPDATE gig_plans SET status = ?, plan_json = ?, fallback_reason = ?, cost_usd = ?, duration_ms = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ? AND status IN ('queued', 'running')`
    )
    .run(
      status,
      result.plan ? JSON.stringify(result.plan) : null,
      result.plan ? null : (result.fallbackReason ?? "unknown").slice(0, 200),
      result.costUsd,
      result.durationMs,
      new Date().toISOString(),
      planId,
      workspaceId
    );
  return res.changes > 0 ? getGigPlan(workspaceId, planId) : null;
}

export type AcceptGigPlanResult = { ok: true; plan: GigPlanRow } | { ok: false; reason: "not_found" | "not_ready" | "already_accepted" };

/** Accept one `ready` plan for its gig, with the operator's optional note. A CAS under
 *  `.immediate()`: a second acceptance for the same gig is `already_accepted`. */
export function acceptGigPlan(workspaceId: string, planId: string, note: string | null): AcceptGigPlanResult {
  const d = ensureDb();
  const run = d.transaction((): { ok: true } | { ok: false; reason: "not_found" | "not_ready" | "already_accepted" } => {
    const row = d.prepare(`SELECT gig_id, status FROM gig_plans WHERE id = ? AND workspace_id = ?`).get(planId, workspaceId) as Pick<GigPlanDbRow, "gig_id" | "status"> | undefined;
    if (!row) return { ok: false, reason: "not_found" };
    if (row.status !== "ready") return { ok: false, reason: "not_ready" };
    const other = d.prepare(`SELECT id FROM gig_plans WHERE gig_id = ? AND workspace_id = ? AND accepted_at IS NOT NULL LIMIT 1`).get(row.gig_id, workspaceId);
    if (other) return { ok: false, reason: "already_accepted" };
    const now = new Date().toISOString();
    const res = d
      .prepare(`UPDATE gig_plans SET accepted_at = ?, note = ?, updated_at = ? WHERE id = ? AND workspace_id = ? AND status = 'ready' AND accepted_at IS NULL`)
      .run(now, note?.trim() ? note.trim().slice(0, 2000) : null, now, planId, workspaceId);
    return res.changes > 0 ? { ok: true } : { ok: false, reason: "already_accepted" };
  });
  const out = run.immediate();
  if (!out.ok) return out;
  const plan = getGigPlan(workspaceId, planId);
  return plan ? { ok: true, plan } : { ok: false, reason: "not_found" };
}

/** The gig's accepted plan, or null when none is accepted yet. */
export function getAcceptedGigPlan(workspaceId: string, gigId: string): GigPlanRow | null {
  const row = ensureDb()
    .prepare(`SELECT * FROM gig_plans WHERE gig_id = ? AND workspace_id = ? AND accepted_at IS NOT NULL ORDER BY accepted_at DESC LIMIT 1`)
    .get(gigId, workspaceId) as GigPlanDbRow | undefined;
  return row ? rowToPlan(row) : null;
}

/** The pairing and the sync mirror the milestone onto the accepted plan. */
export function setGigPlanProgress(workspaceId: string, planId: string, progress: GigPlanProgress): GigPlanRow | null {
  const res = ensureDb()
    .prepare(`UPDATE gig_plans SET progress_json = ?, updated_at = ? WHERE id = ? AND workspace_id = ? AND accepted_at IS NOT NULL`)
    .run(JSON.stringify(progress), new Date().toISOString(), planId, workspaceId);
  return res.changes > 0 ? getGigPlan(workspaceId, planId) : null;
}
