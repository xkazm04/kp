import type { GigArena } from "./types";

// Per-arena specialist defaults - a leaf, so dispatch.ts, requirements.ts (and a future UI)
// can read the numbers and the name without importing specialist.ts, which reaches the
// whole hire tail (mintAndDispatch -> the pipeline board) through its hire function.

/** Per-attempt spend ceiling by arena (USD). A competition run iterates experiments;
 *  a freelance proposal is mostly writing. The operator may override at hire time. */
export const GIG_DEFAULT_BUDGET_USD: Readonly<Record<GigArena, number>> = {
  security: 5,
  oss_bounty: 5,
  competition: 10,
  freelance: 3,
};

/** One connector CATEGORY a specialist is hired with, and the deliverable that needs it. */
export type GigArenaTool = { connector: string; why: string };

/** The tools each arena's specialist is hired with. THE RULE: a tool only when a
 *  deliverable needs it, and each says which. A requested connector is a capability
 *  Personas designs a phase around - `source_control` on a freelance specialist made
 *  Personas design a GitHub-commit phase nobody asked for (2026-09-25 dry run), when a
 *  freelance deliverable is files in the gig folder. So:
 *   - freelance, security and competition deliverables are files in the gig folder
 *     (a proposal, a report, an entry built locally): `research` only;
 *   - an open-source bounty's deliverable IS a change to someone else's repository, so it
 *     alone keeps `source_control` - to clone and test, never to push (the operator sends);
 *   - `ai` (competition) went: a model-provider connector is not what an entry needs, the
 *     run already is a model. */
export const GIG_ARENA_TOOLS: Readonly<Record<GigArena, readonly GigArenaTool[]>> = {
  security: [
    { connector: "research", why: "read the program's published scope and rules, and the disclosed reports a duplicate check needs" },
  ],
  oss_bounty: [
    {
      connector: "source_control",
      why: "clone the project's repository to build the change and run its tests locally; nothing is pushed or opened - the operator sends",
    },
    { connector: "research", why: "read the issue, the bounty's claim rules and the project's contributing guide" },
  ],
  competition: [
    { connector: "research", why: "read the competition's rules, data description and evaluation metric" },
  ],
  freelance: [{ connector: "research", why: "check vendor facts and public docs the brief depends on" }],
};

/** Connector CATEGORIES each arena's persona is hired with (GIG_ARENA_TOOLS, projected). */
export const GIG_ARENA_CONNECTORS: Readonly<Record<GigArena, readonly string[]>> = {
  security: GIG_ARENA_TOOLS.security.map((t) => t.connector),
  oss_bounty: GIG_ARENA_TOOLS.oss_bounty.map((t) => t.connector),
  competition: GIG_ARENA_TOOLS.competition.map((t) => t.connector),
  freelance: GIG_ARENA_TOOLS.freelance.map((t) => t.connector),
};

/** The taxonomy role family a specialist works in when the operator names none. */
export const GIG_DEFAULT_FAMILY: Readonly<Record<GigArena, string>> = {
  security: "software_engineering",
  oss_bounty: "software_engineering",
  competition: "data_ai",
  freelance: "general_professional",
};

/** Arena display label in the persona's name (Personas is not a localized surface). */
export const GIG_ARENA_LABEL: Readonly<Record<GigArena, string>> = {
  security: "Security",
  oss_bounty: "Open-source bounty",
  competition: "Competition",
  freelance: "Freelance",
};

const NICHE_MAX = 80;

/** One line, bounded: the niche is operator free text that lands in a persona name. */
export function cleanNiche(niche: string | null | undefined): string {
  const one = (niche ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return one.slice(0, NICHE_MAX) || "general";
}

/** "<Arena> specialist - <niche>". */
export function gigSpecialistName(spec: { arena: GigArena; niche: string }): string {
  return `${GIG_ARENA_LABEL[spec.arena]} specialist - ${cleanNiche(spec.niche)}`;
}
