// The candidate-facing "what we hold about you" projection for the public /data
// self-service page. Kept PURE + dependency-free so the colocated node --test loads
// it without dragging in better-sqlite3 (same discipline as consent.ts).

/** Presence signals the /data GET reads off the entry to decide which data
 *  categories we actually hold. */
export type HeldSignals = {
  hasContact: boolean;
  hasInterview: boolean;
  hasScore: boolean;
};

/** Project the held-data categories from what the entry ACTUALLY has, rather than
 *  the old hardcoded five-item list (bug-ui-scan-2026-07-09 privacy-consent-provenance
 *  #5) — so a candidate who only applied is never falsely told we hold their
 *  "interview records and notes" or "assessment scores" on a transparency surface.
 *  `cv` + `answers` are inherent to having applied; `contact`/`interview`/`scores`
 *  are listed only when captured. Order is stable so the rendered list never reshuffles. */
export function heldDataCategories(s: HeldSignals): string[] {
  const out: string[] = ["cv"];
  if (s.hasContact) out.push("contact");
  out.push("answers");
  if (s.hasInterview) out.push("interview");
  if (s.hasScore) out.push("scores");
  return out;
}

/** The categories the /data page may RENDER, given whatever the API actually
 *  returned and the labels the page can render.
 *
 *  The render side used to fall back to `Object.keys(labels)` when `held` was
 *  missing — i.e. it re-armed the exact hardcoded five-item over-claim that
 *  {@link heldDataCategories} exists to kill, on the one surface where a false
 *  "we hold your interview records" is a transparency failure rather than a
 *  cosmetic bug. A missing field is not evidence that we hold everything; it is
 *  no evidence at all, so the honest render is NOTHING. Anything the page cannot
 *  label is dropped (an older client against a newer API), and a repeated key is
 *  collapsed so the list can never show a category twice.
 *
 *  Pure and dependency-free like the rest of this module, so the client component
 *  and its node --test both load it. */
export function renderableHeldCategories(held: unknown, labelled: readonly string[]): string[] {
  if (!Array.isArray(held)) return [];
  const canRender = new Set(labelled);
  const out: string[] = [];
  for (const h of held) {
    if (typeof h !== "string" || !canRender.has(h) || out.includes(h)) continue;
    out.push(h);
  }
  return out;
}
