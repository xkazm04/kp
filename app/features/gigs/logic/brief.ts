import type { GigBriefSection, GigDifficulty } from "@/app/_lib/gigs/types";

/** How many of the four difficulty bars are filled; 0 for `unrated`, which is drawn
 *  hollow and dashed - an absence, never "easy". */
export function difficultyBars(d: GigDifficulty): 0 | 1 | 2 | 3 | 4 {
  return d === "easy" ? 1 : d === "moderate" ? 2 : d === "hard" ? 3 : d === "very_hard" ? 4 : 0;
}

/** A brief heading's plain text: its Markdown escapes and emphasis removed. RESTATES
 *  research.ts `plainHeadingText` (a server module the client must not import);
 *  brief.test.ts runs both over one document and fails if they part. A comparator,
 *  never an id source. */
export function briefHeadingText(raw: string): string {
  return raw
    .replace(/\\([\\*`<#.\-[\]])/g, "$1")
    .replace(/\*\*|`/g, "")
    .trim();
}

/** The brief's heading ids for Markdown.tsx's `headingId` hook. The ids are the ones the
 *  server minted with ONE assigner when it wrote the brief (`brief.sections`); nothing is
 *  re-slugged here. Pure in its argument (React may render twice): the heading's position
 *  picks its section, and a heading whose level or text does not match that section gets
 *  NO id rather than a guessed one. kp's brief has no level-1 heading, so positions align;
 *  a document that ever carries one degrades to unaddressed headings, not wrong ones. */
export function briefHeadingResolver(sections: readonly GigBriefSection[]): (h: { index: number; level: 1 | 2 | 3; text: string }) => string | undefined {
  return (h) => {
    const s = sections[h.index];
    if (!s || s.level !== h.level || s.text !== briefHeadingText(h.text)) return undefined;
    return s.id;
  };
}
