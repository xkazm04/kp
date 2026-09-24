import type { GigArena } from "./types";

// Per-arena specialist defaults - a leaf, so dispatch.ts (and a future UI) can read the
// numbers without importing specialist.ts, which reaches the whole hire tail
// (mintAndDispatch -> the pipeline board) through its hire function.

/** Per-attempt spend ceiling by arena (USD). A competition run iterates experiments;
 *  a freelance proposal is mostly writing. The operator may override at hire time. */
export const GIG_DEFAULT_BUDGET_USD: Readonly<Record<GigArena, number>> = {
  security: 5,
  oss_bounty: 5,
  competition: 10,
  freelance: 3,
};

/** Connector CATEGORIES each arena's persona needs. */
export const GIG_ARENA_CONNECTORS: Readonly<Record<GigArena, readonly string[]>> = {
  security: ["research", "source_control"],
  oss_bounty: ["source_control", "research"],
  competition: ["research", "ai"],
  freelance: ["research", "source_control"],
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
