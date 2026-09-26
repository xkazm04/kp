// The designed CV's CONTENT rules — pure, no React, so `node --test` holds it.
//
// cvDocument.ts reads a CV into a document; this module decides what the document may
// SAY, held to the registry standard recruiting/cv-content-construction (golden path
// + techniques, forged 2026-09-26). The writer's tools are selection, order, wording
// and grouping; addition belongs to the owner alone. So every rule here either
// reorders, selects or flags — and what a rule cannot fix without a fact becomes an
// owner QUESTION (CvOwnerQuestion), shown in the designer and never printed.

import type { CvLang, CvOwnerQuestion } from "./cvDocument";

// ── self-descriptors ───────────────────────────────────────────────────────────────
//
// technique accomplishment-statements-without-invention: "Results-driven",
// "passionate", "team player" carry no checkable content and are among the phrases
// recruiters most often report disliking. Removing them from GENERATED text is safe;
// in the seeker's OWN words they are flagged, never silently deleted — the person
// whose name is on the page decides.

export const SELF_DESCRIPTORS: Record<CvLang, readonly string[]> = {
  en: [
    "results-driven", "results-oriented", "passionate", "team player", "hard-working", "hardworking", "self-starter",
    "self-motivated", "detail-oriented", "go-getter", "highly motivated", "motivated", "proactive", "dynamic",
    "enthusiastic", "dedicated", "proven track record", "track record", "fast learner", "quick learner",
    "strategic thinker", "think outside the box", "synergy", "thought leader",
  ],
  cs: [
    "cílevědomý", "cílevědomá", "týmový hráč", "týmová hráčka", "pracovitý", "pracovitá", "komunikativní",
    "flexibilní", "spolehlivý", "spolehlivá", "proaktivní", "motivovaný", "motivovaná", "orientovaný na výsledky",
    "orientovaná na výsledky", "odolný vůči stresu", "odolná vůči stresu", "nadšený", "nadšená", "dynamický", "dynamická",
  ],
  de: [
    "teamfähig", "teamplayer", "belastbar", "zielorientiert", "ergebnisorientiert", "hochmotiviert", "motiviert",
    "engagiert", "zuverlässig", "leidenschaftlich", "dynamisch", "kommunikationsstark", "proaktiv", "flexibel",
  ],
  fr: [
    "esprit d'équipe", "dynamique", "motivé", "motivée", "passionné", "passionnée", "rigoureux", "rigoureuse",
    "proactif", "proactive", "orienté résultats", "orientée résultats", "force de proposition", "polyvalent", "polyvalente",
  ],
};

const DESCRIPTOR_PATTERNS: RegExp[] = Object.values(SELF_DESCRIPTORS)
  .flat()
  .map((d) => new RegExp(`(?<![\\p{L}\\d])${d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[-\s]/g, "[-\\s]?")}(?![\\p{L}\\d])`, "iu"));

/** The first self-descriptor in `text`, in any of the four languages, or null. */
export function descriptorIn(text: string): string | null {
  for (const re of DESCRIPTOR_PATTERNS) {
    const m = re.exec(text || "");
    if (m) return m[0];
  }
  return null;
}

/** The self-descriptor questions for the seeker's own lines: the headline, each summary
 *  sentence, each printed bullet — the line quoted verbatim, nothing removed. */
export function descriptorQuestions(input: {
  headline: string | null;
  summarySentences: readonly string[];
  roles: readonly { bullets: readonly { lead: string | null; text: string }[] }[];
}): CvOwnerQuestion[] {
  const out: CvOwnerQuestion[] = [];
  if (input.headline && descriptorIn(input.headline)) out.push({ kind: "self_descriptor", roleIndex: null, text: input.headline });
  for (const s of input.summarySentences) if (descriptorIn(s)) out.push({ kind: "self_descriptor", roleIndex: null, text: s });
  input.roles.forEach((r, roleIndex) => {
    for (const b of r.bullets) {
      const line = b.lead ? `${b.lead}: ${b.text}` : b.text;
      if (descriptorIn(line)) out.push({ kind: "self_descriptor", roleIndex, text: line });
    }
  });
  return out;
}
