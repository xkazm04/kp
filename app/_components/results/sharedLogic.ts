/**
 * The decisions inside `shared.tsx`, lifted out of the JSX so they can be read
 * and tested without a renderer.
 *
 * Everything here was previously an inline expression in a component body:
 * `dedupe(items)` before the map, the `hasOpened ||` latch, the
 * `anchorBand.length === 2` guard, and two bare `.slice(0, n)` caps with the
 * reason for each number in a comment beside it. None of them had a test, and
 * three of them are the kind of rule that reads as decoration until it is
 * deleted — the dedupe in particular is load-bearing (repeated lines collide as
 * React keys and mis-bind hover state; see `app/_lib/dedupe.ts`).
 */
import { dedupe } from "@/app/_lib/dedupe";

/**
 * At most three parsing notes. The engine can emit a dozen near-identical
 * remarks on a bad scan; the panel is a trust artifact, not a log viewer.
 * Deduped BEFORE the slice so the cap counts DISTINCT notes — capping first
 * would let three copies of one note fill the whole allowance.
 */
export const PARSING_NOTES_CAP = 3;

/** At most five grounding sources, for the same reason at a longer list. */
export const GROUNDING_SOURCES_CAP = 5;

/** Distinct items in caller order, capped. Empty in → empty out, never a hole. */
export function cappedDistinct(items: readonly string[] | undefined | null, cap: number): string[] {
  return dedupe(items ?? []).slice(0, cap);
}

/**
 * A list's items as rendered: distinct, in caller order. `BulletList` routes
 * every LLM-filled string list in the report through this, so no call site can
 * forget the dedupe or drift on how it is done.
 */
export function bulletItems(items: readonly string[]): string[] {
  return dedupe(items);
}

/**
 * `<LazyDetails>`'s mount latch: children mount on the first expand and stay
 * mounted. `true` never falls back to `false` — a re-collapse must NOT unmount
 * the (already parsed) content, which is the entire point of the component.
 */
export function latchOpen(hasOpened: boolean, isOpen: boolean): boolean {
  return hasOpened || isOpen;
}

/**
 * The deterministic market anchor is a [lo, hi] pair or it is not rendered.
 * A one-element or three-element array reaching the `{lo, hi}` message would
 * print "undefined" as a salary figure — the panel exists to make a pay number
 * defensible, so a malformed band is shown as nothing at all.
 */
export function isAnchorBand(band: readonly number[] | undefined | null): band is readonly [number, number] {
  return Array.isArray(band) && band.length === 2 && band.every((n) => typeof n === "number" && Number.isFinite(n));
}
