// Is the composed App-master spec still about the brief the requestor is looking
// at? Pure, so `spec-vintage.test.ts` pins it without React and without the
// store.
//
// `AppMasterCompose.composedAt` (app/_lib/db/intakes.ts) has been stored since
// P3 and read by NOTHING: the card showed the mandate, the budget and the
// tenure with no word about WHEN any of it was computed. Meanwhile the brief
// keeps moving — every dialog turn and every manual brief edit stamps
// `intakes.updatedAt` — so a requestor can read a spec composed against three
// facets and dispatch it against a brief that now holds nine.
//
// NOT the same rule as the dispatch route's `AGENT_DISPATCH_SPEC_STALE`
// (app/api/agents/dispatch/route.ts:243), which is a SCHEMA check — the stored
// spec no longer parses against `appMasterSpecSchema`. That refusal is about the
// spec's SHAPE; this is about its VINTAGE, and a spec can be stale in this sense
// while parsing perfectly. Keeping them separate is deliberate: folding them
// would make the card claim a refusal the door does not actually make.

/** A row stamped within this of `composedAt` is the compose's OWN write, not a
 *  later edit. The compose route stamps `composedAt` and then writes the row
 *  (app/api/intake/[id]/compose-app-master/route.ts), so `updatedAt` is always a
 *  few milliseconds LATER than the spec it stores — without a grace window every
 *  freshly-composed spec would read as stale the moment the session reloaded. */
export const SPEC_VINTAGE_GRACE_MS = 2_000;

export type SpecVintage =
  /** The brief has not moved since the spec was composed. */
  | "current"
  /** The brief moved after the spec was composed: recompose before dispatching. */
  | "stale"
  /** Nothing composed yet, or a timestamp that will not parse. Says nothing
   *  rather than guessing — an invented "stale" would send a requestor back
   *  through a paid compose for no reason. */
  | "unknown";

function ms(iso: string | null | undefined): number | null {
  if (typeof iso !== "string" || iso.trim() === "") return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

export function specVintage(input: {
  /** `AppMasterCompose.composedAt`. */
  composedAt: string | null | undefined;
  /** The intake row's `updatedAt` — the version the open session was read at. */
  briefUpdatedAt: string | null | undefined;
}): SpecVintage {
  const composed = ms(input.composedAt);
  const updated = ms(input.briefUpdatedAt);
  if (composed === null || updated === null) return "unknown";
  return updated - composed > SPEC_VINTAGE_GRACE_MS ? "stale" : "current";
}
