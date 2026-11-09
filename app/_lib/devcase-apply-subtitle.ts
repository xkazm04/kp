import { isTechnicalFamily } from "../features/tools/analyze/cohort/cohortTypes.ts";

// Catalog key for the apply page's one-line instruction. Live-work (a
// materialized seed) and repo-link are different submit paths; a single
// "submit a repository link" sentence contradicts the surface the candidate
// is about to use.
export function applySubtitleKey(hasSeed: boolean): "subtitleLive" | "subtitleRepo" {
  return hasSeed ? "subtitleLive" : "subtitleRepo";
}

// ---- The door's register (CX S43) --------------------------------------------------
//
// An assignment is not always code. The door used to tell a sales or ops candidate that
// we grade "not just the final code" — developer wording on every role. The case's role
// family decides the register: a technical family (TECHNICAL_FAMILIES — software and
// data/AI) keeps the developer wording; every other family reads the role-neutral one.
// A case with no recorded family keeps the developer wording, which is what the design
// chain records for an unclassified need (buildNeed.ts defaults to software_engineering).

export type DoorRegister = "software" | "general";

/** The role family a dev case was cut for: the need's (what the design chain recorded),
 *  else the role spec's. Defensive — both are persisted JSON. */
export function caseRoleFamily(need: unknown, role: unknown): string | null {
  for (const source of [need, role]) {
    const family = source && typeof source === "object" ? (source as { roleFamily?: unknown }).roleFamily : null;
    if (typeof family === "string" && family.trim()) return family.trim();
  }
  return null;
}

export function doorRegister(roleFamily: string | null): DoorRegister {
  return roleFamily === null || isTechnicalFamily(roleFamily) ? "software" : "general";
}

/** The live work surface's process sentence for that register. */
export function workIntroKey(register: DoorRegister): "intro" | "introGeneral" {
  return register === "software" ? "intro" : "introGeneral";
}

/** The chat panel's intro. With no real AI behind the tabs (keyless, or a reply has
 *  already come back from the scripted fallback) the door says so plainly and does NOT
 *  promise that good prompts count — there is nothing there to prompt. */
export function chatIntroKey(assistantLive: boolean, sawScriptedReply: boolean): "chatIntro" | "chatIntroStandIn" {
  return assistantLive && !sawScriptedReply ? "chatIntro" : "chatIntroStandIn";
}
