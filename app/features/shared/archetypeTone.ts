// ONE archetype fill, for the surfaces that only need the paint.
//
// Two byte-identical copies of the same table used to live in `decisionsTypes.ts`
// and `hiring/schedule/ScheduleTypes.ts`, each carrying a `label` field that NO
// consumer read: every one of the six call sites (three Decisions surfaces, two
// Schedule surfaces, the group-eval primitives) uses `.bg` and takes its visible
// text from `enumLabel("archetype", …)`, which is the localized name. A raw
// English label sitting in a style table is a translation waiting to leak, so it
// is gone rather than moved.
//
// This is deliberately NOT `pipelineTypes.ARCHETYPE_STYLE`: that one is the FULL
// presentation catalog (label + fill + focus ring + glyph) for the board's rich
// candidate rows, and importing it drags `lucide-react` into modules that want a
// background class. The two agree on the fills, and `archetypeTone.test.ts` pins
// that agreement so a hue changed in one place cannot drift from the other.

export type ArchetypeTone = { bg: string };

/** Brand fills per archetype. Tokens only (design:check) — `bg-steel`,
 *  `bg-coral` and `bg-moss` are all theme-remapped in `app/globals.css`. */
export const ARCHETYPE_TONE: Record<string, ArchetypeTone> = {
  bau: { bg: "bg-steel" },
  student: { bg: "bg-coral" },
  career_switcher: { bg: "bg-moss" },
};

/** The fill for an archetype, falling back to the `bau` steel for null and for
 *  any value outside the taxonomy (notably `FALLBACK_ARCHETYPE` = "unknown",
 *  which is intentionally unrouted — see app/_lib/apply.ts). Never throws, so a
 *  new archetype from the pipeline shows up neutral rather than blanking a row. */
export const archetypeTone = (a: string | null): ArchetypeTone => ARCHETYPE_TONE[a ?? "bau"] ?? ARCHETYPE_TONE.bau;
