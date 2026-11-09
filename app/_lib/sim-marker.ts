// Sim-marker identity primitives. Lives in the foundation layer (app/_lib) so the DB and
// comms modules can filter on it without importing UP into the shell feature; the shell's
// simulation/constants.ts re-exports it so feature importers are unchanged.

export const SIM_MARKER = "(SIM)"; // every sim artifact's title carries this — used to reset cleanly
// The marker is BOTH a purge key (resetSim deletes by it) and a read-side filter
// key (gsim-l2-105 / REC-11): live aggregates — analytics funnel/ROI, the Today
// rail — must never count demo residue as real hiring data. Both derivations are
// single-sourced here so the writer, the purge and every filter can't drift.
/** SQL LIKE pattern matching any sim-marked title (pair with a `LIKE ?` param). */
export const SIM_TITLE_LIKE = `%${SIM_MARKER}%`;
/** True when a job/entry title carries the sim marker. NULL/undefined titles are
 *  real data (analysis-only entries) and must be kept by callers filtering rows. */
export function isSimTitle(title: string | null | undefined): boolean {
  return typeof title === "string" && title.includes(SIM_MARKER);
}
/** Stamp the (SIM) marker onto a title so a simulated pipeline entry is purgeable
 *  by resetSim AND excluded by every analytics filter — the ONE marker the writer,
 *  the purge and every aggregate share (single-sourced here so they can't drift).
 *  Idempotent: an already-marked title is returned unchanged (never "(SIM) (SIM)"). */
export function markSimTitle(title: string): string {
  return isSimTitle(title) ? title : `${title} ${SIM_MARKER}`;
}
