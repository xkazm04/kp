"use client";

import { useEffect, useMemo, useState } from "react";
import type { ArrivalDelta } from "@/app/features/library/jds/intake/IntakeArrivalMotion";

// PER-TURN ARRIVAL for the seeker's studio planes — the same question the intake
// studio's `useArrivalDelta` answers ("what did my last sentence buy?"), asked of a
// flat list of sheet rows instead of a RoleBrief.
//
// It exists rather than reusing that hook because that one diffs a `RoleBrief` through
// `diffBrief`; a CV suggestion and a fit gap are not briefs. What IS reused is the
// contract and the motion: this returns the exported `ArrivalDelta` shape and
// `ArrivalList` renders it — so the stagger (40 ms, capped at twelve, dropped under
// reduced motion) stays defined in exactly one place and is never re-typed here.
//
// Two identities per row, as over there: `id` is what the DELTA calls the row (stable
// across a rewrite), `fingerprint` is what it currently says. A new id ARRIVES; a
// known id with a new fingerprint CHANGED and is re-keyed by ArrivalList so the CSS
// replays. Everything else keeps its element and stays still.
//
// The previous snapshot is STATE adjusted during render (the sanctioned
// "derive-from-props" pattern, as `NavSectionRail` resets its previewed section) and
// not a ref written during render, which is neither allowed nor correct under
// concurrent rendering.

export type SheetRow = { id: string; fingerprint: string };

/** How long an arrival stays live. Past this the delta clears, so a row that landed
 *  and then sits there is not permanently marked "new", and a re-render for any other
 *  reason cannot replay the cascade. Matches the intake studio's own window. */
const ARRIVAL_WINDOW_MS = 1400;

const NO_ARRIVAL: ArrivalDelta = { arriving: new Set(), changed: new Set(), orderOf: () => -1 };

type Snapshot = { added: readonly string[]; changed: readonly string[] };
const EMPTY: Snapshot = { added: [], changed: [] };

/** The rows' VALUE identity — what makes this a new snapshot rather than a re-render
 *  of the same one. The separators are control characters, which cannot occur in a
 *  section name, a skill or a sentence. */
function snapshotKey(rows: readonly SheetRow[]): string {
  return rows.map((r) => `${r.id}\u0000${r.fingerprint}`).join("\u0001");
}

type Seen = { key: string; fingerprints: ReadonlyMap<string, string> };

function snapshotOf(rows: readonly SheetRow[]): Seen {
  return { key: snapshotKey(rows), fingerprints: new Map(rows.map((r) => [r.id, r.fingerprint])) };
}

export function useSheetArrival(rows: readonly SheetRow[]): ArrivalDelta {
  const key = snapshotKey(rows);
  // `null` = nothing seen yet. The FIRST snapshot is history whatever its age:
  // opening a finished conversation must not animate every suggestion it already
  // holds as if it had just arrived.
  const [seen, setSeen] = useState<Seen | null>(null);
  const [delta, setDelta] = useState<Snapshot>(EMPTY);

  if (seen === null) {
    setSeen(snapshotOf(rows));
  } else if (seen.key !== key) {
    const next = snapshotOf(rows);
    const added: string[] = [];
    const changed: string[] = [];
    for (const [id, fingerprint] of next.fingerprints) {
      const before = seen.fingerprints.get(id);
      if (before === undefined) added.push(id);
      else if (before !== fingerprint) changed.push(id);
    }
    setSeen(next);
    if (added.length > 0 || changed.length > 0) setDelta({ added, changed });
  }

  useEffect(() => {
    if (delta === EMPTY) return;
    const timer = window.setTimeout(() => setDelta(EMPTY), ARRIVAL_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [delta]);

  return useMemo(() => {
    if (delta === EMPTY) return NO_ARRIVAL;
    const order = new Map(delta.added.map((id, i) => [id, i]));
    return {
      arriving: new Set(delta.added),
      changed: new Set(delta.changed),
      orderOf: (id: string) => order.get(id) ?? -1,
    };
  }, [delta]);
}
