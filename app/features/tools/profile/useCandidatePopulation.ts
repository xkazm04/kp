"use client";

// The Profile tab's ONE candidate-population read (challenge-r05 profile-roster-matrix/A).
//
// The tab claimed "one candidate population, two projections" and served three reads:
// the roster fetched GET /api/profile (saved profiles only), the matrix fetched
// GET /api/profile/candidates (the CV-identity fold of profiles + analyses), and the
// archetype retire dialog fetched GET /api/profile AGAIN to count one lane — with two
// different lifecycles and a `dataRev` -> `reloadKey` counter whose only job was to
// re-sync the forks after a delete. ProfileTab mounts this hook once and hands the
// same rows to every projection (rosterFromPopulation, the matrix, routedCount).
//
// `active` pauses the read while the tab shows the editor instead of the projections
// (ProfileTab stays mounted underneath it), and re-reads when the editor closes — a
// save there changed the population, and the projections used to pick that up only
// because they remounted and refetched.

import { useCallback, useEffect, useState } from "react";
import { withoutProfile, type PopulationRow } from "@/app/_lib/candidate-population";

export type CandidatePopulation = {
  /** null until the first read lands; a later reload keeps the rows on screen. */
  rows: readonly PopulationRow[] | null;
  /** The last read failed. Each projection shows its own localized load failure —
   *  the route answers a code, never a message a recruiter should read. */
  failed: boolean;
  /** Re-read the population (a delete elsewhere, a save). Never blanks the rows. */
  reload: () => void;
  /** Optimistically drop a deleted profile from every projection at once. */
  prune: (id: string) => void;
};

export function useCandidatePopulation({ active = true }: { active?: boolean } = {}): CandidatePopulation {
  const [rows, setRows] = useState<readonly PopulationRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [rev, setRev] = useState(0);

  useEffect(() => {
    if (!active) return;
    // CANCELLED on unmount, pause or refetch — not merely ignored: an `alive` flag still
    // lets a superseded request hold its connection and parse a body nobody reads.
    const controller = new AbortController();
    fetch("/api/profile/candidates", { signal: controller.signal })
      .then(async (r) => ({ ok: r.ok, body: (await r.json()) as { error?: string; candidates?: unknown } }))
      .then(({ ok, body }) => {
        if (controller.signal.aborted) return;
        // `ok` makes a body-less non-200 a failure instead of a silently empty population.
        if (!ok || body.error) {
          setFailed(true);
          return;
        }
        setFailed(false);
        setRows((body.candidates as PopulationRow[]) ?? []);
      })
      .catch(() => {
        // An abort is OUR cancellation, never a failure to report.
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [active, rev]);

  const reload = useCallback(() => setRev((v) => v + 1), []);
  const prune = useCallback((id: string) => setRows((prev) => (prev ? withoutProfile(prev, id) : prev)), []);

  return { rows, failed, reload, prune };
}
