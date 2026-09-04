// Saved-view COLLECTION logic (views-earn-their-name). The board's saved views are
// its memory — a named {search + facets + sort} preset a recruiter returns to. This
// module is the PURE core of managing the collection: the localStorage-shape
// migration, the "which view opens on mount" default-precedence decision, and the
// upsert/rename/set-default array transforms — all extracted so they're unit-pinnable
// under `node --test` (no React, no DOM, no localStorage). The per-view filter shape
// and its normalization live in pipeline-board-filters.ts; this layer only manages
// the LIST and the default marking.
//
// Stored shape (backward compatible)
// ----------------------------------
// The persisted value under `kp.pipelineViews` stays a bare SavedView[] — unchanged
// from before this direction. The default marking rides as an OPTIONAL `isDefault`
// flag on at most ONE view in that array. So:
//   • an old array written before this direction (no flags anywhere) loads fine —
//     no default, every field present;
//   • an old reader that ignores `isDefault` still sees a valid view array;
//   • we enforce "at most one default" on load, so a hand-edited or double-flagged
//     store can't apply two defaults.

import { type SavedView } from "./pipelineBoardFilters";

/** Coerce the raw JSON.parse of the stored value into a clean SavedView[]:
 *  - a non-array (corrupt / legacy object) → [];
 *  - each element must be an object carrying string `id` + `name`, else it's dropped
 *    (a corrupt row never poisons the list);
 *  - `isDefault` is honored on the FIRST flagged view only — any later flag is
 *    cleared, so exactly one default can ever apply. */
export function normalizeStoredViews(raw: unknown): SavedView[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedView[] = [];
  let defaultTaken = false;
  for (const el of raw) {
    if (!el || typeof el !== "object") continue;
    const r = el as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.name !== "string") continue;
    const view = { ...(el as SavedView) };
    if (view.isDefault) {
      if (defaultTaken) view.isDefault = false; // second+ default → demote
      else defaultTaken = true;
    }
    out.push(view);
  }
  return out;
}

/** The id of the default view, or null if none is marked. */
export function defaultViewId(views: readonly SavedView[]): string | null {
  return views.find((v) => v.isDefault)?.id ?? null;
}

/** Default-precedence decision — which saved view (if any) should open on mount.
 *
 *  An explicit shared/deep link ALWAYS WINS: if the URL carries any view-encoding
 *  param (a pasted link the sharer sent), we return null so the board opens exactly
 *  what the link encodes and the viewer's own default never silently overrides it.
 *  Only a bare visit (no such params) falls back to the marked default. */
export function defaultViewToApply(
  views: readonly SavedView[],
  hasExplicitViewParams: boolean
): SavedView | null {
  if (hasExplicitViewParams) return null;
  return views.find((v) => v.isDefault) ?? null;
}

/** Set (or clear) the default marking so exactly `id` is the default. Passing null
 *  clears every flag. Returns a new array; inputs are untouched.
 *
 *  This is the SETTER. The toggle-off rule ("clicking the current default clears
 *  it") is `toggleDefault` below — it used to live only in this comment, which
 *  meant the rule was re-derived at the call site and nothing could test it. */
export function withDefault(views: readonly SavedView[], id: string | null): SavedView[] {
  return views.map((v) => (Boolean(v.isDefault) === (v.id === id) ? v : { ...v, isDefault: v.id === id }));
}

/** Toggle the default marking for `id`: mark it, unless it is ALREADY the default,
 *  in which case the board goes back to having NO default. That second half is the
 *  whole point — a recruiter who set a default must be able to unset it with the
 *  same control, without a second "clear default" affordance.
 *
 *  An id that is not in the list clears the marking rather than inventing a default
 *  for a view that no longer exists (a stale row in a just-deleted view's menu). */
export function toggleDefault(views: readonly SavedView[], id: string): SavedView[] {
  return withDefault(views, defaultViewId(views) === id ? null : id);
}

/** Save `view` into the list, OVERWRITING any existing view with the same (trimmed)
 *  name — a save under an existing name replaces it, matching the modal's explicit
 *  "replaces the existing view" note. The overwritten slot's default marking is
 *  carried onto the incoming view unless the caller already set one, so re-saving the
 *  default view keeps it default. Overwriting keeps the view's POSITION in the list
 *  (map-replace, not drop-to-end) so re-saving under a name doesn't reshuffle the
 *  recruiter's view order; a genuinely new name appends (insertion order). Any
 *  stray same-named duplicate (a hand-edited store) collapses into the first slot. */
export function upsertViewByName(views: readonly SavedView[], view: SavedView): SavedView[] {
  const name = view.name.trim();
  const prior = views.find((v) => v.name === name);
  const merged: SavedView = { ...view, name, isDefault: view.isDefault ?? prior?.isDefault };
  if (!prior) return [...views, merged];
  let replaced = false;
  const out: SavedView[] = [];
  for (const v of views) {
    if (v.name !== name) {
      out.push(v);
    } else if (!replaced) {
      out.push(merged); // replace in place, at the existing view's position
      replaced = true;
    }
    // any later same-named duplicate is dropped, collapsing into the first slot
  }
  return out;
}

/** Rename the view with `id` to `name` (trimmed), KEEPING its identity — same id,
 *  same encoded filters, same default marking. Only the label changes, so a share
 *  link (which encodes filters, never the name/id) is unaffected. A no-op if the id
 *  isn't present or the trimmed name is empty. */
export function renameStoredView(views: readonly SavedView[], id: string, name: string): SavedView[] {
  const trimmed = name.trim();
  if (!trimmed) return views.slice();
  return views.map((v) => (v.id === id ? { ...v, name: trimmed } : v));
}

/** True when the value collides with an EXISTING view's name (trimmed), excluding the
 *  view being edited (`exceptId`) — so the modal can warn that saving/renaming will
 *  replace another view. */
export function nameCollides(views: readonly SavedView[], name: string, exceptId?: string): boolean {
  const trimmed = name.trim();
  return views.some((v) => v.name === trimmed && v.id !== exceptId);
}
