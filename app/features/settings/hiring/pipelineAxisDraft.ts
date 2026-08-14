// Pure editing model for the board's column axis (Settings → Hiring).
//
// No JSX, no hooks, no DB — so every rule the editor enforces is unit-testable,
// and so the CLIENT can answer "is this edit legal?" and "who does it strand?"
// before it asks the server. That matters more here than in most settings
// surfaces: this is the one edit that can leave real candidates off the board,
// and a save that fails validation server-side after the recruiter has
// rearranged six columns is a bad way to find out.
//
// The rules mirror validatePipelineStages in decision-config-schema.ts exactly —
// the server stays authoritative, this is the local echo of it (pinned by
// pipelineAxisDraft.test.ts, which runs both over the same cases).
import type { PipelineStagesRule, PipelineStageRoleWire, PipelineStageWire } from "@/app/_lib/decision-config-schema";
import { PIPELINE_STAGES_MAX } from "@/app/_lib/decision-config-schema";
import type { StageDef } from "@/app/_lib/pipeline-stages";

export type DraftStage = StageDef & {
  /** True for a stage that exists in the SAVED axis. A stage added in this draft
   *  has never been stored, so removing it again strands nobody and needs no
   *  migration — the editor must be able to tell those two removals apart. */
  saved: boolean;
};

export type AxisDraft = {
  stages: DraftStage[];
  /** Stages dropped from the live axis in earlier saves, carried through so the
   *  editor never silently discards the tombstones history depends on. */
  retired: StageDef[];
};

export const AXIS_MAX_STAGES = PIPELINE_STAGES_MAX;

/** Roles that may appear at most once, and must appear at all. Mirrors the server. */
const UNIQUE_ROLES: readonly PipelineStageRoleWire[] = ["entry", "terminal", "offer"];
const REQUIRED_ROLES: readonly PipelineStageRoleWire[] = ["entry", "terminal"];

/** The roles offered in the editor, in the order they read down a funnel. */
export const ASSIGNABLE_ROLES: readonly PipelineStageRoleWire[] = [
  "entry",
  "screening",
  "interview",
  "offer",
  "terminal",
  "custom",
];

// ---- construction ----------------------------------------------------------

export function draftFromStored(rule: PipelineStagesRule): AxisDraft {
  return {
    stages: rule.stages.map((s) => ({ ...(s as StageDef), saved: true })),
    retired: (rule.retired ?? []).map((s) => ({ ...(s as StageDef) })),
  };
}

/**
 * A draft back to the wire shape.
 *
 * Removal is not deletion: a SAVED stage that has left the draft joins `retired`,
 * so a historical event or a stranded candidate can still be given its name. A
 * stage that was only ever a draft addition simply disappears — it was never
 * stored, so nothing references it. A stage RE-ADDED under an id that was
 * previously retired is resurrected out of the tombstones rather than existing
 * in both lists (which the server rejects).
 */
export function draftToStored(draft: AxisDraft, savedStages: readonly StageDef[]): PipelineStagesRule {
  const liveIds = new Set(draft.stages.map((s) => s.id));
  const dropped = savedStages.filter((s) => !liveIds.has(s.id));
  const retained = draft.retired.filter((s) => !liveIds.has(s.id));
  const seen = new Set(retained.map((s) => s.id));
  for (const s of dropped) {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      retained.push(s);
    }
  }
  const wire = (s: StageDef): PipelineStageWire => ({ id: s.id, label: s.label, role: s.role as PipelineStageRoleWire });
  return { stages: draft.stages.map(wire), retired: retained.map(wire) };
}

// ---- editing ---------------------------------------------------------------

/** A URL/storage-safe id derived from a label, uniquified against `taken`.
 *  Ids are minted ONCE, at add time, and never change afterwards — that is what
 *  makes renaming free (it touches no `pipeline_entries.stage` value). */
export function mintStageId(label: string, taken: Iterable<string>): string {
  const base = label
    // NFKD splits an accented letter into base + combining mark, and the ASCII
    // filter below then drops the mark — so a Czech or German label yields a
    // plain-ASCII id ("Ověření" → "Oveen"). That matters because the id is a
    // storage key: it lands in pipeline_entries.stage and travels to the ATS
    // field map, where bare ASCII is the safe assumption. The LABEL keeps its
    // diacritics — that is the half a recruiter actually reads.
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9 _-]/g, "")
    .trim()
    .slice(0, 32);
  const seed = base || "Stage";
  const used = new Set(taken);
  if (!used.has(seed)) return seed;
  for (let n = 2; n < 999; n++) {
    const candidate = `${seed} ${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${seed} ${Date.now()}`;
}

export function addStage(draft: AxisDraft, label: string, role: PipelineStageRoleWire = "custom"): AxisDraft {
  const taken = [...draft.stages.map((s) => s.id), ...draft.retired.map((s) => s.id)];
  const id = mintStageId(label, taken);
  // Inserted BEFORE the terminal stage: a new column almost always belongs in
  // the middle of the funnel, and appending after "Hired" would produce an axis
  // the validator rejects (terminal must be last) on every single add.
  const terminalIdx = draft.stages.findIndex((s) => s.role === "terminal");
  const at = terminalIdx >= 0 ? terminalIdx : draft.stages.length;
  const next = [...draft.stages];
  next.splice(at, 0, { id, label: label.trim() || id, role: role as StageDef["role"], saved: false });
  return { ...draft, stages: next };
}

export function removeStage(draft: AxisDraft, id: string): AxisDraft {
  return { ...draft, stages: draft.stages.filter((s) => s.id !== id) };
}

export function renameStage(draft: AxisDraft, id: string, label: string): AxisDraft {
  return { ...draft, stages: draft.stages.map((s) => (s.id === id ? { ...s, label } : s)) };
}

export function setStageRole(draft: AxisDraft, id: string, role: PipelineStageRoleWire): AxisDraft {
  return { ...draft, stages: draft.stages.map((s) => (s.id === id ? { ...s, role: role as StageDef["role"] } : s)) };
}

/** Move a stage one position up (-1) or down (+1). A move that would run off
 *  either end is a no-op rather than an error — the editor disables those
 *  buttons, and a keyboard repeat should not throw. */
export function moveStage(draft: AxisDraft, id: string, delta: -1 | 1): AxisDraft {
  const from = draft.stages.findIndex((s) => s.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= draft.stages.length) return draft;
  const next = [...draft.stages];
  [next[from], next[to]] = [next[to], next[from]];
  return { ...draft, stages: next };
}

// ---- validation ------------------------------------------------------------

/** A machine reason a draft cannot be saved. The UI owns the copy; this owns the
 *  rule, so the message and the check can never disagree. */
export type AxisProblem =
  | { code: "tooFew" }
  | { code: "tooMany"; max: number }
  | { code: "emptyLabel" }
  | { code: "duplicateLabel"; label: string }
  | { code: "missingRole"; role: PipelineStageRoleWire }
  | { code: "duplicateRole"; role: PipelineStageRoleWire }
  | { code: "entryNotFirst" }
  | { code: "terminalNotLast" };

/** Every reason this draft would be refused, in the order a reader should fix
 *  them. Empty ⇒ the server will accept it. */
export function axisProblems(draft: AxisDraft): AxisProblem[] {
  const problems: AxisProblem[] = [];
  const { stages } = draft;
  if (stages.length < 2) problems.push({ code: "tooFew" });
  if (stages.length > AXIS_MAX_STAGES) problems.push({ code: "tooMany", max: AXIS_MAX_STAGES });
  if (stages.some((s) => s.label.trim() === "")) problems.push({ code: "emptyLabel" });

  // Duplicate LABELS are legal on the wire (ids are what must be unique) but are
  // a usability trap: two columns reading "Interview" cannot be told apart on the
  // board or in a migration prompt. Refused here, deliberately stricter than the
  // server.
  const byLabel = new Map<string, number>();
  for (const s of stages) {
    const key = s.label.trim().toLowerCase();
    if (!key) continue;
    byLabel.set(key, (byLabel.get(key) ?? 0) + 1);
  }
  for (const [label, n] of byLabel) if (n > 1) problems.push({ code: "duplicateLabel", label });

  for (const role of REQUIRED_ROLES) {
    if (!stages.some((s) => s.role === role)) problems.push({ code: "missingRole", role });
  }
  for (const role of UNIQUE_ROLES) {
    if (stages.filter((s) => s.role === role).length > 1) problems.push({ code: "duplicateRole", role });
  }
  if (stages.length > 0 && stages[0].role !== "entry" && stages.some((s) => s.role === "entry")) {
    problems.push({ code: "entryNotFirst" });
  }
  if (stages.length > 0 && stages[stages.length - 1].role !== "terminal" && stages.some((s) => s.role === "terminal")) {
    problems.push({ code: "terminalNotLast" });
  }
  return problems;
}

// ---- impact ----------------------------------------------------------------

/** A saved stage this draft removes, and how many candidates are standing on it. */
export type StrandedStage = { stage: StageDef; count: number };

/**
 * Which saved columns this draft drops WITH people still on them.
 *
 * A stage the draft only ever added is not reported — it was never stored, so
 * nobody can be on it. A stage dropped with zero occupants is not reported
 * either: that removal is free, and warning about it would train the reader to
 * dismiss the warning that matters.
 */
export function strandedByDraft(
  draft: AxisDraft,
  savedStages: readonly StageDef[],
  counts: Record<string, number>
): StrandedStage[] {
  const liveIds = new Set(draft.stages.map((s) => s.id));
  return savedStages
    .filter((s) => !liveIds.has(s.id))
    .map((stage) => ({ stage, count: counts[stage.id] ?? 0 }))
    .filter((s) => s.count > 0);
}

/** Structural equality against the saved wire shape — the dirty flag. */
export function axisEqualsStored(draft: AxisDraft, stored: PipelineStagesRule, savedStages: readonly StageDef[]): boolean {
  return JSON.stringify(draftToStored(draft, savedStages)) === JSON.stringify(stored);
}
