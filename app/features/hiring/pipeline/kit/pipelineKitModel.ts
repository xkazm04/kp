/*
 * The Hiring pipeline kit view's data-to-rows mapping (Gate K2 port of the One Measure winner's
 * "Hiring pipeline" surface). Pure: it takes the board payload the current tab already loads
 * (usePipelineBoardData: GET /api/pipeline -> entries, the workspace's axis, rejectedByLane) and
 * returns what the kit parts draw. Nothing here fetches and nothing here invents a field.
 *
 * LIVENESS (brief: name the source of every field the view shows):
 *   dot / row shape  <- Entry.stageChangedAt vs Entry.createdAt. The store stamps both at insert
 *                       (createPipelineEntry) and re-stamps stage_changed_at on a move, so a later
 *                       stage_changed_at IS a recorded move ("walked"); equal = added at this stage
 *                       and never moved ("placed"); neither = nothing on record (dashed). The winner
 *                       read per-entry events instead; the board payload has none (the events feed is
 *                       7 days and names no from-stage), so the stamp is the honest board-wide proof.
 *   layer            <- Entry.stage on the resolved axis (StageDef.label, tone by StageDef.role).
 *   left the funnel  <- rejectedByLane (rejected rows stay off the board payload: counted, not listed).
 *   match / skyline  <- canonicalScoreOf(entry) (the board's one displayed match score).
 *   waiting on you   <- needsHumanDecision(approvalKind) && status active (the tab's `approvals`).
 *   age / median     <- days since stageChangedAt ?? createdAt.
 */
import type { StageTone, ShapeKind } from "../../../../_components/kit/types.ts";
import type { Entry, StageDef } from "../../../shared/pipelineTypes.ts";

export const OUT = "__out";
const DAY = 86_400_000;

export type Ctx = { score: (e: Entry) => number | null; needs: (e: Entry) => boolean; now: number };

/** A stage's tone comes from its ROLE on the workspace axis, never from its name. */
export function roleTone(role: StageDef["role"] | null | undefined): StageTone {
  switch (role) {
    case "entry": return "accepted";
    case "screening": case "homework": return "screened";
    case "interview": case "scoring": return "interview";
    case "offer": return "offer";
    case "terminal": return "hired";
    default: return "default";
  }
}

/** How the entry reached its stage (see LIVENESS). */
export function provenance(e: Pick<Entry, "createdAt" | "stageChangedAt">): Extract<ShapeKind, "solid" | "ring" | "dashed"> {
  if (!e.stageChangedAt && !e.createdAt) return "dashed";
  if (e.stageChangedAt && e.stageChangedAt !== e.createdAt) return "solid";
  return "ring";
}

/** Whole days in the current stage; null when nothing is dated. */
export function ageDays(e: Pick<Entry, "createdAt" | "stageChangedAt">, now: number): number | null {
  const at = Date.parse(e.stageChangedAt ?? e.createdAt ?? "");
  return Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / DAY)) : null;
}

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Every entry ranked by match, highest first, never-scored last (label breaks ties, stable). */
export function rankByMatch(entries: readonly Entry[], ctx: Pick<Ctx, "score">): { ranked: Entry[]; rankOf: Map<string, number> } {
  const key = (e: Entry) => ctx.score(e) ?? -1;
  const ranked = entries.slice().sort((a, b) => key(b) - key(a) || a.candidateLabel.localeCompare(b.candidateLabel));
  return { ranked, rankOf: new Map(ranked.map((e, i) => [e.id, i])) };
}

export type LayerModel = {
  id: string; label: string; tone: StageTone; count: number; waiting: number; walked: number; placed: number;
  medianAge: number | null; exit?: boolean; retired?: boolean;
};

/** The sieve's layers: the axis in order, any retired column someone still stands in, then the exit. */
export function buildLayers(axis: readonly StageDef[], retired: readonly StageDef[], entries: readonly Entry[], rejected: Record<string, number>, ctx: Ctx): LayerModel[] {
  const onAxis = new Set(axis.map((s) => s.id));
  const stranded = [...new Set(entries.map((e) => e.stage).filter((s) => !onAxis.has(s)))];
  const defs: { def: StageDef; retired?: boolean }[] = [
    ...axis.map((def) => ({ def })),
    ...stranded.map((id) => ({ def: retired.find((r) => r.id === id) ?? { id, label: id, role: "custom" as const }, retired: true })),
  ];
  const layers: LayerModel[] = defs.map(({ def, retired: r }) => {
    const here = entries.filter((e) => e.stage === def.id);
    const shapes = here.map(provenance);
    return {
      id: def.id, label: def.label, tone: r ? "quiet" : roleTone(def.role), count: here.length,
      waiting: here.filter(ctx.needs).length,
      walked: shapes.filter((s) => s === "solid").length,
      placed: shapes.filter((s) => s === "ring").length,
      medianAge: median(here.map((e) => ageDays(e, ctx.now)).filter((d): d is number => d != null)),
      retired: r,
    };
  });
  const out = Object.values(rejected).reduce((a, b) => a + b, 0);
  layers.push({ id: OUT, label: "", tone: "out", count: out, waiting: 0, walked: 0, placed: 0, medianAge: null, exit: true });
  return layers;
}

export type Dot = { id: string; layer: string; shape: ShapeKind; tone: StageTone; needs: boolean; rank: number };

/** One dot per entry (in rank order, then folded by shape inside the Sieve) plus one exit per rejected row. */
export function sieveDots(ranked: readonly Entry[], layers: readonly LayerModel[], ctx: Ctx): Dot[] {
  const tone = new Map(layers.map((l) => [l.id, l.tone]));
  const dots: Dot[] = ranked.map((e, rank) => ({ id: e.id, layer: e.stage, shape: provenance(e), tone: tone.get(e.stage) ?? "default", needs: ctx.needs(e), rank }));
  const out = layers.find((l) => l.exit)?.count ?? 0;
  for (let i = 0; i < out; i++) dots.push({ id: `${OUT}:${i}`, layer: OUT, shape: "exit", tone: "out", needs: false, rank: ranked.length + i });
  return dots;
}

export type Filters = { query: (e: Entry) => boolean; layer: string | null; needsOnly: boolean; role: string | null; brush: readonly [number, number] | null };

/** Whether an entry survives the filters; `skipLayer` answers "would it, ignoring the layer" (the dimming set). */
export function passes(e: Entry, f: Filters, rankOf: ReadonlyMap<string, number>, ctx: Pick<Ctx, "needs">, skipLayer = false): boolean {
  if (!skipLayer && f.layer && e.stage !== f.layer) return false;
  if (f.role && (e.jobTitle ?? "") !== f.role) return false;
  if (f.needsOnly && !ctx.needs(e)) return false;
  const r = rankOf.get(e.id) ?? -1;
  if (f.brush && (r < f.brush[0] || r > f.brush[1])) return false;
  return f.query(e);
}

/** The list: waiting-on-you first, then by match rank. */
export function listRows(entries: readonly Entry[], f: Filters, rankOf: ReadonlyMap<string, number>, ctx: Pick<Ctx, "needs">): Entry[] {
  return entries
    .filter((e) => passes(e, f, rankOf, ctx))
    .sort((a, b) => Number(ctx.needs(b)) - Number(ctx.needs(a)) || (rankOf.get(a.id) ?? 0) - (rankOf.get(b.id) ?? 0));
}

/** Dots the other filters exclude (layer selection dims nothing: the layer IS the selection). */
export function dimmed(entries: readonly Entry[], f: Filters, rankOf: ReadonlyMap<string, number>, ctx: Pick<Ctx, "needs">): Set<string> {
  return new Set(entries.filter((e) => !passes(e, f, rankOf, ctx, true)).map((e) => e.id));
}

/** The skyline's presets as rank ranges; null when a preset has nothing to select. */
export function presets(ranked: readonly Entry[], ctx: Pick<Ctx, "score">): { top10: [number, number] | null; over70: [number, number] | null; never: [number, number] | null } {
  const n = ranked.length;
  const scored = ranked.filter((e) => ctx.score(e) != null).length;
  const over = ranked.filter((e) => (ctx.score(e) ?? -1) >= 70).length;
  return {
    top10: scored ? [0, Math.min(9, scored - 1)] : null,
    over70: over ? [0, over - 1] : null,
    never: scored < n ? [scored, n - 1] : null,
  };
}
