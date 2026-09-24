// The prep modal's view of the job interview kit and of the recruiter's per-candidate
// OVERLAY on it (spark interview-kit-template, WP-C). Pure — no React, no fetch — so what
// the modal says will be asked is unit-tested against the agenda that actually asks it.
//
// Three origins, because the recruiter has to tell them apart to edit sensibly:
//   - KIT    — the job's shared questions. Every candidate in the round faces them;
//              dropping or rewriting one changes THIS candidate's interview only.
//   - CV     — this candidate's own probes (the recruiter's imports first, then the
//              generated plan's questions), of which only the first few ride on top of
//              the kit (KIT_OVERLAY_CV_PROBES_ASKED).
//   - ADDED  — questions the recruiter wrote for this candidate.
// …and a state per row (kept / changed / removed), so a rewrite or a drop is visible as
// the recruiter's own act rather than silently becoming "the plan".
//
// Every rule about WHAT is asked comes from app/_lib/interview-kit-overlay.ts, the
// pinned mirror of the agenda; this file only arranges it into rows, and owns the
// overlay's edit operations.

import {
  applyOverlayToKit,
  candidateProbeTexts,
  kitAskedTexts,
  kitProbeId,
  KIT_OVERLAY_CV_PROBES_ASKED,
  KIT_OVERLAY_MAX_ADDED,
  type OverlayPrepSource,
} from "@/app/_lib/interview-kit-overlay";
import { KIT_MAX_MUST_ASKS, type InterviewKit, type KitOverlay, type KitWeight } from "@/app/_lib/interview-kit-types";

export type OverlayOrigin = "kit" | "cv" | "added";
export type OverlayRowState = "kept" | "edited" | "dropped";

export type OverlayRow = {
  /** The id the overlay names this question by — a kit question id, a `cv-…` probe id,
   *  or the recruiter's own added id. */
  id: string;
  origin: OverlayOrigin;
  /** What will be asked: the rewrite when there is one. For a removed row, the text it
   *  would have asked (shown struck through). */
  text: string;
  /** The kit's or the plan's own text, for a row the recruiter may rewrite and revert.
   *  Null for an added question, which has no original. */
  original: string | null;
  state: OverlayRowState;
  mustAsk: boolean;
  /** Whether the interview will ask it. A removed row never is; a CV probe past the cap
   *  is not either, and the modal says so rather than listing it as if it were. */
  asked: boolean;
};

export type OverlayGroup = {
  /** The competency id (added questions name it), "cv", or the loose-additions id. */
  id: string;
  kind: "competency" | "cv" | "loose";
  /** The competency's own title; null for the two groups the view names itself. */
  title: string | null;
  weight: KitWeight | null;
  rows: OverlayRow[];
};

export type OverlayView = {
  /** In the order the interview meets them: the kit's competencies (with this
   *  candidate's additions under each), the loose additions, then the CV probes. */
  groups: OverlayGroup[];
  /** The kit's own must-asks this candidate still faces — the other half of the
   *  kit-wide must-ask budget an added must-ask spends. */
  keptKitMustAsks: number;
  /** Drops and rewrites that name a question this kit version and this plan no longer
   *  have. Kept in the stored overlay (they are harmless and may match again), but
   *  counted so the modal can say they are not being applied. */
  staleRefs: number;
  /** Every id the overlay may usefully name for this candidate: the kit's questions, the
   *  plan's probes (whether or not they ride this branch) and the recruiter's additions. */
  liveIds: ReadonlySet<string>;
};

const LOOSE_ID = "overlay-added";
const clean = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/**
 * Arrange the kit, this candidate's plan and the overlay into the rows the modal
 * renders. `cvProbesRide` is the server's answer to "does this candidate's interview
 * take CV probes at all" (a work-sample debrief or the student script does not); a
 * plan with no chronology takes none either, which is the agenda's own rule.
 */
export function composeOverlayView(
  kit: InterviewKit,
  prep: (OverlayPrepSource & { chronology?: unknown }) | null,
  overlay: KitOverlay,
  opts: { cvProbesRide: boolean }
): OverlayView {
  const dropped = new Set(overlay.dropped);
  const edits = new Map(overlay.edited.map((e) => [e.id, e.text]));
  const known = new Set<string>();
  const competencyIds = new Set((kit.competencies ?? []).map((c) => c.id));
  const added = overlay.added.slice(0, KIT_OVERLAY_MAX_ADDED).filter((a) => !dropped.has(a.id));

  const addedRow = (a: KitOverlay["added"][number]): OverlayRow => ({
    id: a.id,
    origin: "added",
    text: a.text,
    original: null,
    state: "kept",
    mustAsk: a.mustAsk === true,
    asked: clean(a.text) !== null,
  });
  const refRow = (id: string, origin: "kit" | "cv", original: string, mustAsk: boolean): OverlayRow => {
    known.add(id);
    const isDropped = dropped.has(id);
    const edit = edits.get(id);
    const text = edit ?? original;
    return {
      id,
      origin,
      text,
      original,
      state: isDropped ? "dropped" : edit !== undefined ? "edited" : "kept",
      mustAsk,
      asked: !isDropped && clean(text) !== null,
    };
  };

  let keptKitMustAsks = 0;
  const groups: OverlayGroup[] = (kit.competencies ?? []).map((c) => {
    const rows: OverlayRow[] = [];
    for (const q of c.questions ?? []) {
      const original = typeof q?.id === "string" && q.id !== "" ? clean(q.text) : null;
      if (!original) continue;
      const row = refRow(q.id, "kit", original, q.mustAsk === true);
      if (row.mustAsk && row.state !== "dropped") keptKitMustAsks += 1;
      rows.push(row);
    }
    for (const a of added) if (a.competencyId === c.id) rows.push(addedRow(a));
    return { id: c.id, kind: "competency", title: c.title, weight: c.weight, rows };
  });

  const loose = added.filter((a) => !a.competencyId || !competencyIds.has(a.competencyId));
  if (loose.length > 0) groups.push({ id: LOOSE_ID, kind: "loose", title: null, weight: null, rows: loose.map(addedRow) });

  const hasPlan = Array.isArray(prep?.chronology) && (prep?.chronology as unknown[]).length > 0;
  if (hasPlan) {
    // De-duplicated against the kit AS THIS CANDIDATE FACES IT — a probe that repeats a
    // question the recruiter added is not asked twice, and one that repeats a kit
    // question they dropped is no longer suppressed by it (the agenda's order: overlay,
    // then probes). Built even when the probes do not ride this candidate's branch, so
    // the recruiter's edits to them still count as LIVE (not stale) — they apply again
    // the moment the branch does.
    const asked = kitAskedTexts(applyOverlayToKit(kit, overlay, ""));
    let survivors = 0;
    const rows = candidateProbeTexts(prep, asked).map((text) => {
      const row = refRow(kitProbeId(text), "cv", text, false);
      if (row.asked) {
        row.asked = opts.cvProbesRide && survivors < KIT_OVERLAY_CV_PROBES_ASKED;
        survivors += 1;
      }
      return row;
    });
    if (opts.cvProbesRide && rows.length > 0) groups.push({ id: "cv", kind: "cv", title: null, weight: null, rows });
  }

  for (const a of overlay.added) known.add(a.id);
  const staleRefs = [...new Set([...overlay.dropped, ...overlay.edited.map((e) => e.id)])].filter((id) => !known.has(id)).length;
  return { groups, keptKitMustAsks, staleRefs, liveIds: known };
}

// ---- the overlay's edit operations ------------------------------------------------------

/** Mints an id for a recruiter-added question. `ov-` keeps it clear of kit ids and of the
 *  `cv-` probe ids, so an addition can never alias a question it did not write. */
export type OverlayMint = () => string;
export const mintOverlayId: OverlayMint = () =>
  `ov-${
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 10)
      : Math.random().toString(36).slice(2, 12)
  }`;

/** Remove a kit question or a CV probe for this candidate. A rewrite stays recorded, so
 *  restoring the question brings the rewrite back with it. */
export function overlayDrop(o: KitOverlay, id: string): KitOverlay {
  return o.dropped.includes(id) ? o : { ...o, dropped: [...o.dropped, id] };
}

export function overlayRestore(o: KitOverlay, id: string): KitOverlay {
  return o.dropped.includes(id) ? { ...o, dropped: o.dropped.filter((x) => x !== id) } : o;
}

/** Rewrite a kit question or a CV probe. Rewriting it back to its original text (or to
 *  nothing) CLEARS the rewrite rather than storing a no-op one. */
export function overlayEdit(o: KitOverlay, id: string, text: string, original: string): KitOverlay {
  const next = text.trim();
  const others = o.edited.filter((e) => e.id !== id);
  if (!next || next === original.trim()) return others.length === o.edited.length ? o : { ...o, edited: others };
  const at = o.edited.findIndex((e) => e.id === id);
  if (at < 0) return { ...o, edited: [...o.edited, { id, text: next }] };
  const edited = [...o.edited];
  edited[at] = { id, text: next };
  return { ...o, edited };
}

export const overlayRevert = (o: KitOverlay, id: string): KitOverlay => overlayEdit(o, id, "", "");

export const canAddToOverlay = (o: KitOverlay): boolean => o.added.length < KIT_OVERLAY_MAX_ADDED;

/** Whether an added question may be (or be made) a must-ask: the kit-wide budget, spent
 *  by the kit's own must-asks this candidate still faces plus the recruiter's. */
export function canMarkAddedMustAsk(o: KitOverlay, keptKitMustAsks: number, id: string | null = null): boolean {
  const already = id ? o.added.find((a) => a.id === id)?.mustAsk === true : false;
  if (already) return true;
  return keptKitMustAsks + o.added.filter((a) => a.mustAsk).length < KIT_MAX_MUST_ASKS;
}

/** Add a question for this candidate — under a competency, or (null) on its own at the
 *  end of the kit. A blank question, or one past the cap, is a no-op. */
export function overlayAdd(
  o: KitOverlay,
  input: { competencyId: string | null; text: string; mustAsk: boolean },
  mint: OverlayMint = mintOverlayId
): KitOverlay {
  const text = input.text.trim();
  if (!text || !canAddToOverlay(o)) return o;
  return { ...o, added: [...o.added, { id: mint(), competencyId: input.competencyId, text, mustAsk: input.mustAsk }] };
}

export function overlayRemoveAdded(o: KitOverlay, id: string): KitOverlay {
  return o.added.some((a) => a.id === id) ? { ...o, added: o.added.filter((a) => a.id !== id) } : o;
}

/** Rewrite (or re-flag) a question the recruiter added. Blank text is a no-op — removing
 *  it is its own action. */
export function overlayPatchAdded(o: KitOverlay, id: string, patch: { text?: string; mustAsk?: boolean }): KitOverlay {
  const text = patch.text === undefined ? undefined : patch.text.trim();
  if (text === "") return o;
  return {
    ...o,
    added: o.added.map((a) => (a.id === id ? { ...a, ...(text !== undefined ? { text } : {}), ...(patch.mustAsk !== undefined ? { mustAsk: patch.mustAsk } : {}) } : a)),
  };
}

/** Forget drops and rewrites that match nothing this candidate's interview asks. */
export function overlayPruneStale(o: KitOverlay, view: Pick<OverlayView, "liveIds">): KitOverlay {
  const dropped = o.dropped.filter((id) => view.liveIds.has(id));
  const edited = o.edited.filter((e) => view.liveIds.has(e.id));
  return dropped.length === o.dropped.length && edited.length === o.edited.length ? o : { ...o, dropped, edited };
}
