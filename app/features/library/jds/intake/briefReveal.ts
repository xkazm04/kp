// How a brief line ENTERS the panel.
//
// Three modes, and the distinction between the first two is the whole point:
//
//   fade    — the line was already in the brief when this panel first painted.
//             It is not news; it fades in with everything else (one linear
//             opacity pass, `animate-arrive-in`) and is done.
//   type    — the line landed WHILE the requestor was watching. It types itself
//             out, because the surface's promise is "you watch the structure
//             being built while you talk" and a sentence that simply appears
//             does not read as having been written.
//   settled — the line has already entered. It must NOT re-animate: the engine
//             re-emits the entire brief on every sweep, so re-animating on
//             identity would make the whole panel flicker each time one word
//             changed somewhere else.
//
// `seen === null` means "first classification of this panel" — everything
// present at that moment is history, however recently the server wrote it.
export type RevealMode = "fade" | "type" | "settled";

export function classifyReveal(seen: ReadonlySet<string> | null, keys: readonly string[]): Map<string, RevealMode> {
  const out = new Map<string, RevealMode>();
  for (const k of keys) out.set(k, seen === null ? "fade" : seen.has(k) ? "settled" : "type");
  return out;
}

/** Keys carried forward — the UNION, not the latest list. A line that vanishes
 *  from one sweep and returns in the next (the extraction re-phrases a facet,
 *  then reverts) is not new, and typing it again would be a lie about what just
 *  happened. */
export function rememberKeys(seen: ReadonlySet<string> | null, keys: readonly string[]): Set<string> {
  const next = new Set(seen ?? []);
  for (const k of keys) next.add(k);
  return next;
}

/** How long a typed line takes, and therefore how long the panel says it is
 *  writing. Bounded: a 400-character success criterion must not hold the
 *  indicator for ten seconds, so long text types in wider steps instead. */
export const TYPE_TICK_MS = 16;
export const TYPE_MAX_MS = 900;

export function typeStep(length: number): number {
  return Math.max(1, Math.ceil(length / Math.max(1, Math.floor(TYPE_MAX_MS / TYPE_TICK_MS))));
}
