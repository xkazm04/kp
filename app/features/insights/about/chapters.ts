/**
 * Structure only. Every user-visible string for a chapter lives in the `about`
 * catalog under `about.chapters.<key>` and is resolved at render time, so this
 * file carries the deck's ORDER, its anchors and its handoff targets, and
 * nothing a translator would need to touch.
 *
 * `key` is the i18n key; `id` is the anchor and the rail target. They differ on
 * purpose: anchors are part of the URL contract (`?tab=about#human-gates`) and
 * must stay stable even if a catalog key is later reorganised.
 */
/**
 * A literal union, not `string`. next-intl types its keys off en.json, so a
 * template like t(`chapters.${key}.title`) only typechecks when `key` is a
 * closed set. That strictness is the point: renaming a catalog key without
 * updating this list is a compile error rather than a missing string at
 * runtime.
 */
export type ChapterKey = "jd" | "scoring" | "screening" | "archetypes" | "assignments" | "gates";

export type ChapterDef = {
  id: string;
  key: ChapterKey;
  n: number;
  /** The live workspace tab that performs this mechanism. */
  tab: string;
};

/*
 * The six mechanisms this deck explains.
 *
 * Scope note: the previous About tab was a 24-item capability browser with a
 * PlantUML diagram per item, which is an internal architecture reference. This
 * deck replaces it with six chapters chosen because each one is a thing a
 * reader would otherwise have to take on trust: how a role gets written, how a
 * person gets a number, who gets filtered and by what, how different kinds of
 * candidate are handled without one rule flattening them, what a work sample
 * proves in an era when anyone can delegate it, and where a human must still
 * decide.
 *
 * Copy discipline, in the catalog rather than here: `eyebrow` is the category
 * in two or three words, `title` is the CLAIM the scene makes, `lede` is the
 * mechanism in two or three sentences. Everything else is diegetic. It lives
 * inside the art as a real label on a real part, and no caption ever explains
 * an animation.
 *
 * Every number and stage name in the copy is quoted from the running code.
 * Where a chapter states a threshold, that threshold is a constant somewhere in
 * `pipeline/jobfit/` or `app/_lib/`. The deck is only worth building if it
 * stays true, so treat those strings as coupled to those constants, in all four
 * locales.
 */

export const CHAPTERS: readonly ChapterDef[] = [
  { id: "job-descriptions", key: "jd", n: 1, tab: "library" },
  { id: "scoring", key: "scoring", n: 2, tab: "analyze" },
  { id: "screening", key: "screening", n: 3, tab: "pipeline" },
  { id: "archetypes", key: "archetypes", n: 4, tab: "archetypes" },
  { id: "assignments", key: "assignments", n: 5, tab: "assignments" },
  { id: "human-gates", key: "gates", n: 6, tab: "decisions" },
] as const;
