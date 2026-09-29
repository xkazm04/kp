import { GIG_PERSONA_MODEL, GIG_PLAN_SEATS } from "@/app/_lib/gigs/plan-seats";
import type { Gig, GigAttempt, GigGoalStatus, GigPlanRow } from "@/app/_lib/gigs/types";
import type { SpecialistRow } from "./wire";

// ---------------------------------------------------------------------------
// Pairing: one persona per gig, following its accepted plan (the proof's Pairing tab)
// ---------------------------------------------------------------------------
//
// A gig's persona is the specialist hired for THAT gig (`gigId === gig.id`); the pairing
// also points `gig.specialistId` at it. A gig that ran through a niche specialist before
// pairing existed (an attempt, no persona) keeps the old routing view. The milestone is
// the accepted plan: each step one goal, its state as the agent reports it in
// PLAN-STATUS.json and kp mirrors to Personas (`progress` on the accepted row). Pure:
// pinned by pairing.test.ts.

export function gigPersonaOf(gig: Pick<Gig, "id" | "specialistId">, specialists: readonly SpecialistRow[]): SpecialistRow | null {
  const own = specialists.filter((s) => s.gigId === gig.id);
  return own.find((s) => s.id === gig.specialistId) ?? own[0] ?? null;
}

/** Worked the old way: a run went to a niche specialist and no persona was paired since. */
export function isLegacyRouted(persona: SpecialistRow | null, latest: GigAttempt | null): boolean {
  return persona === null && latest !== null;
}

/** "Opus 5.5 · high": the seat lineup's name for the model, with the persona's effort. */
export function personaModelLabel(): string {
  const seat = GIG_PLAN_SEATS.find((s) => s.model === GIG_PERSONA_MODEL.model);
  const name = seat ? (seat.label.split(" · ")[0] ?? seat.label) : GIG_PERSONA_MODEL.model;
  return `${name} · ${GIG_PERSONA_MODEL.effort}`;
}

export type MilestoneRow = { index: number; title: string; doneWhen: string; status: GigGoalStatus; progress: number; note: string | null };

/** The accepted plan's steps with each goal's reported state; a step nobody reported on
 *  is open at 0 (never guessed forward). */
export function milestoneRows(accepted: GigPlanRow | null): MilestoneRow[] {
  const steps = accepted?.plan?.steps ?? [];
  const goals = accepted?.progress?.goals ?? [];
  return steps.map((step, index) => {
    const g = goals.find((x) => x.stepIndex === index) ?? null;
    const progress = g ? Math.max(0, Math.min(100, Math.round(g.progress))) : 0;
    return { index, title: step.title, doneWhen: step.doneWhen, status: g?.status ?? "open", progress: g?.status === "done" ? 100 : progress, note: g?.note ?? null };
  });
}

/** The milestone as one figure: goals done of all, and the mean progress. */
export function milestoneTotals(rows: readonly MilestoneRow[]): { done: number; total: number; pct: number } {
  const total = rows.length;
  const done = rows.filter((r) => r.status === "done").length;
  const pct = total === 0 ? 0 : Math.round(rows.reduce((n, r) => n + r.progress, 0) / total);
  return { done, total, pct };
}
