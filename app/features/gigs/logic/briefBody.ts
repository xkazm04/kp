import type { GigBriefSection } from "@/app/_lib/gigs/types";

// ---------------------------------------------------------------------------
// The brief's Markdown, cut where the proof sets parts of it as structure
// ---------------------------------------------------------------------------
//
// The brief closes with "Sources read" (the sidebar lists the links as rows instead) and
// carries "Expected challenges" (set as rows with Withdraw for this, BriefChallenges.tsx).
// Both are located by the section the SERVER declared (`brief.sections`), never re-parsed.
// `dropFirst` also takes out the first `## ` section ("What the gig is") when the hero has
// already set it as the lead, so the words are not read twice. Pure: briefBody.test.ts.

export const SOURCES_SECTION_ID = "sources-read";

export type BriefBody = {
  /** The prose before the challenges (or all of it). */
  body: string;
  /** Where the challenges sit: the section the server declared, when there are rows to set. */
  challenges: GigBriefSection | null;
  /** The prose after the challenges section. */
  after: string;
  /** The "Sources read" section, when the Markdown carried one (its heading moves to the list). */
  sources: GigBriefSection | null;
};

export function briefBody(markdown: string, sections: readonly GigBriefSection[], challengesHeading: string, hasChallenges: boolean, dropFirst = false): BriefBody {
  const sourcesSection = sections.find((s) => s.id === SOURCES_SECTION_ID) ?? null;
  const cut = sourcesSection ? markdown.indexOf(`\n## ${sourcesSection.text}\n`) : -1;
  const cutAtStart = sourcesSection !== null && markdown.startsWith(`## ${sourcesSection.text}\n`);
  let full = cut >= 0 ? markdown.slice(0, cut) : cutAtStart ? "" : markdown;
  if (dropFirst) {
    const first = /^##\s+/m.exec(full);
    const next = first ? full.indexOf("\n## ", first.index + 1) : -1;
    if (first) full = full.slice(0, first.index) + (next >= 0 ? full.slice(next + 1) : "");
  }
  const challengesSection = sections.find((s) => s.text === challengesHeading) ?? null;
  const marker = challengesSection && hasChallenges ? `## ${challengesSection.text}\n` : null;
  const inner = marker ? full.indexOf(`\n${marker}`) : -1;
  const at = marker ? (full.startsWith(marker) ? 0 : inner >= 0 ? inner + 1 : -1) : -1;
  const next = at >= 0 ? full.indexOf("\n## ", at) : -1;
  return {
    body: at >= 0 ? full.slice(0, at) : full,
    challenges: at >= 0 ? challengesSection : null,
    after: at >= 0 && next >= 0 ? full.slice(next + 1) : "",
    sources: cut >= 0 || cutAtStart ? sourcesSection : null,
  };
}
