// The reviewer's per-person exclusions from a screening wave ("spare"), as the route
// accepts them and as runScreenWave applies them.
//
// The Art. 22 review is only a review if the reviewer can disagree about one row
// without reshaping everyone else's outcome through the global sliders. So the preview
// lists a Spare control per would-reject row, and the request carries the spared entry
// ids. runScreenWave removes them from the reject set LAST (after the reinstatement
// shield and the holdout draw) and BEFORE the approval token is signed, so:
//   - the token signs the post-spare set: the exclusions are part of what the human
//     approved (registry: bulk-adverse-action-governance / preview-then-approve-the-
//     signed-set, "Removal re-derives the token");
//   - a commit re-derives the same narrowed set from the echoed list, and a commit whose
//     list differs from the previewed one re-derives a different set -> "mismatch";
//   - a spare can only NARROW the set: an id that would not be rejected anyway (shielded,
//     above the cutoff, unscored, held out, not in the cohort) is dropped by
//     effectiveSpare and changes nothing, token included.
//
// Import-free, like screen-wave-contract.ts: the client's state machine and the server
// share the one normalisation.

/** More ids than any real preview would list; past it the request is refused, never
 *  truncated (a silently dropped exclusion would reject someone the reviewer spared). */
export const SPARE_MAX = 500;

export type SpareListRead = { ok: true; ids: string[] } | { ok: false; error: string };

/** The request's `spare` field, trimmed, blanks dropped, de-duplicated and sorted.
 *  Absent is an empty list (an old client is unchanged); anything that is not a
 *  bounded array of strings is refused. */
export function normalizeSpareList(value: unknown): SpareListRead {
  if (value === undefined) return { ok: true, ids: [] };
  if (!Array.isArray(value)) return { ok: false, error: "spare must be an array of pipeline entry ids" };
  if (value.length > SPARE_MAX) return { ok: false, error: `spare lists at most ${SPARE_MAX} entries` };
  const ids = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") return { ok: false, error: "spare must be an array of pipeline entry ids" };
    const id = raw.trim();
    if (id) ids.add(id);
  }
  return { ok: true, ids: [...ids].sort() };
}

/** The spares that actually change the wave: only ids that would otherwise be
 *  rejected. Sorted, so the policy suffix and the event order are stable. */
export function effectiveSpare(wouldReject: Iterable<string>, spare: readonly string[]): string[] {
  const set = new Set(wouldReject);
  return [...new Set(spare)].filter((id) => set.has(id)).sort();
}

/** The policyVersion suffix naming how many people the reviewer spared, so a sealed
 *  record says its wave carried human exclusions. Empty when none: the policyVersion
 *  (and so every existing token and sealed record) is byte-identical to before. */
export function spareSuffix(effective: readonly string[]): string {
  return effective.length > 0 ? `/spared${effective.length}` : "";
}
