// GET /api/pipeline, folded for /one's two pipeline views (pipelineSlice, decisionsQueue).
// Pure parse — the aging and "new arrival" questions are answered HERE, at read time,
// with the same predicates the sidebar badge uses (attention.ts): a stage's aging tier on
// this workspace's own axis (aging-policy.ts) and the axis's `entry` role.
import { agingTierAt } from "@/app/_lib/aging-policy";
import { needsHumanDecision } from "@/app/_lib/approval-kinds";
import { stageHasRole, type StageDef } from "@/app/_lib/pipeline-stages";

export type OneEntry = {
  id: string;
  /** The candidate's own id (null for a legacy row) — the profile tool's seed fallback. */
  candidateId: string | null;
  label: string;
  jobId: string | null;
  jobTitle: string | null;
  stage: string;
  stageLabel: string;
  stageChangedAt: string | null;
  /** Whole days since the stage changed (null = unknown), computed at read time. */
  ageDays: number | null;
  /** The canonical score the board shows; null = none on record (rendered as a dash). */
  score: number | null;
  stale: boolean;
  isNew: boolean;
  needsDecision: boolean;
  /** The approval gate the entry stands on (null = none). */
  approvalKind: string | null;
  /** On the `calendar` gate: waiting for an interview slot (useScheduleTab's rule). */
  waitingInterview: boolean;
};

export type PipelineRead = { entries: OneEntry[] };

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function parsePipeline(body: unknown, now: number = Date.now()): PipelineRead | null {
  if (body == null || typeof body !== "object") return null;
  const b = body as { entries?: unknown; stages?: unknown };
  if (!Array.isArray(b.entries)) return null;
  const stages: StageDef[] = Array.isArray(b.stages)
    ? (b.stages as unknown[]).filter((s): s is StageDef => s != null && typeof s === "object" && typeof (s as StageDef).id === "string")
    : [];
  const axis = stages.length > 0 ? stages : undefined;
  const entries: OneEntry[] = [];
  for (const raw of b.entries as unknown[]) {
    if (raw == null || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    const id = str(e.id);
    const stage = str(e.stage);
    if (!id || !stage || e.status !== "active") continue;
    const stageChangedAt = str(e.stageChangedAt);
    entries.push({
      id,
      candidateId: str(e.candidateId),
      label: str(e.candidateLabel) ?? id,
      jobId: str(e.jobId),
      jobTitle: str(e.jobTitle),
      stage,
      stageLabel: stages.find((s) => s.id === stage)?.label ?? stage,
      stageChangedAt,
      ageDays: stageChangedAt && Number.isFinite(Date.parse(stageChangedAt)) ? Math.max(0, Math.floor((now - Date.parse(stageChangedAt)) / 86_400_000)) : null,
      score: num(e.canonicalScore) ?? num(e.matchScore),
      stale: agingTierAt(stage, stageChangedAt, now, axis) !== "none",
      isNew: stageHasRole(stage, "entry", axis),
      needsDecision: needsHumanDecision(str(e.approvalKind)),
      approvalKind: str(e.approvalKind),
      waitingInterview: e.approvalKind === "calendar",
    });
  }
  return { entries };
}

/** Oldest known time first; an unknown time sorts LAST. (A "~" sentinel with localeCompare
 *  does not do this: locale collation puts punctuation before digits, so the unknowns came
 *  first and "waiting longest" named someone with no recorded date.) */
export function byKnownTimeFirst(a: string | null, b: string | null): number {
  const ta = a ? Date.parse(a) : NaN;
  const tb = b ? Date.parse(b) : NaN;
  if (Number.isNaN(ta)) return Number.isNaN(tb) ? 0 : 1;
  if (Number.isNaN(tb)) return -1;
  return ta - tb;
}

/** Does an entry belong to the role the user named, in their own words? */
export function matchesRole(e: OneEntry, role: string | undefined): boolean {
  if (!role) return true;
  const q = role.trim().toLowerCase();
  return e.jobId === role || (e.jobTitle ?? "").toLowerCase().includes(q);
}

/** Does an entry's label hold the name the user typed ("open Jana")? Case- and
 *  accent-insensitive, every word of the query must appear. */
export function matchesName(e: Pick<OneEntry, "label">, name: string | undefined): boolean {
  if (!name) return true;
  const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const label = fold(e.label);
  return fold(name).split(/\s+/).filter(Boolean).every((w) => label.includes(w));
}

/** The pipelineSlice selection, as the panel draws it: filter, then order. */
export function sliceEntries(entries: readonly OneEntry[], params: Record<string, string>): OneEntry[] {
  const filter = params.filter;
  const picked = entries.filter(
    (e) => matchesRole(e, params.role) && matchesName(e, params.name) && (filter === "aging" ? e.stale : filter === "new" ? e.isNew : true)
  );
  if (filter === "aging") {
    // Longest-waiting first; an unknown change time sorts last rather than first.
    return picked.sort((a, b) => byKnownTimeFirst(a.stageChangedAt, b.stageChangedAt));
  }
  return picked.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}
