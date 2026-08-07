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
