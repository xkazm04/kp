import { GIG_ARENAS, GIG_DISCLOSURE_ITEM, type GigArena } from "./types";

// The review checklist per arena - the list the operator ticks on the Gig desk before
// marking a draft sent, and the list the specialist sees in its assignment so it drafts
// against the same bar. Pure data, no imports beyond the vocabulary.
//
// Items are STABLE KEYS, not sentences: GigReview.checklist is keyed by them and
// `mark_sent` looks up GIG_DISCLOSURE_ITEM by key, so a reworded sentence must never
// orphan a stored tick. The UI renders each key through the catalog; every gig folder's
// DELIVERABLE-CONTRACT.md (contract.ts) carries the English meaning below
// (GIG_CHECKLIST_MEANING), because a file the agent reads is not a UI surface.
//
// Every arena carries GIG_DISCLOSURE_ITEM, last, so the AI-use disclosure is the final
// thing the operator confirms before anything goes out (checklists.test.ts pins it).

export const GIG_CHECKLISTS: Readonly<Record<GigArena, readonly string[]>> = {
  security: ["in_scope", "repro_steps", "impact_stated", "no_harmful_testing", "not_duplicate", GIG_DISCLOSURE_ITEM],
  oss_bounty: ["claim_rules_followed", "tests_pass", "scoped_change", "contributing_followed", "pr_description", GIG_DISCLOSURE_ITEM],
  competition: ["rules_read", "no_leakage", "reproducible", "validation_reported", "win_obligations", GIG_DISCLOSURE_ITEM],
  freelance: ["brief_answered", "scope_honest", "no_overclaim", "deliverable_verified", "no_off_platform", GIG_DISCLOSURE_ITEM],
};

/** What each key asks, in one English line - written into the gig folder's rules file
 *  (contract.ts), never rendered to the operator (the catalog owns that copy). */
export const GIG_CHECKLIST_MEANING: Readonly<Record<string, string>> = {
  in_scope: "The target and the vulnerability class are inside the program's published scope.",
  repro_steps: "A triager can reproduce the finding from the written steps alone.",
  impact_stated: "The impact is stated concretely and without exaggeration.",
  no_harmful_testing: "No testing went beyond the program rules: no denial of service, no data taken, no social engineering.",
  not_duplicate: "The finding was checked against disclosed and known reports.",
  claim_rules_followed: "The bounty's claim or assignment rules were respected before work started.",
  tests_pass: "The project's own tests and linters pass locally with the change.",
  scoped_change: "The change is limited to what the issue asks.",
  contributing_followed: "The contributing guide and the licence were followed.",
  pr_description: "The pull request description explains what changed and why.",
  rules_read: "Eligibility, outside-data and team rules were read and are met.",
  no_leakage: "No feature or validation step uses information unavailable at scoring time.",
  reproducible: "The entry can be rebuilt from its code, data and seed.",
  validation_reported: "The local validation score is reported beside the visible one.",
  win_obligations: "What a win would oblige the account holder to release is listed.",
  brief_answered: "Every requirement stated in the brief is answered.",
  scope_honest: "Scope, timeline and price are stated honestly.",
  no_overclaim: "No experience or capability is claimed that is not held.",
  deliverable_verified: "The deliverable was checked against the brief before it goes out.",
  no_off_platform: "No off-platform payment or contact is proposed.",
  [GIG_DISCLOSURE_ITEM]: "The AI-use disclosure sentence goes out with the work.",
};

/** The arena's checklist as a fresh array (the assignment owns its copy). */
export function gigChecklist(arena: GigArena): string[] {
  return [...(GIG_CHECKLISTS[arena] ?? [GIG_DISCLOSURE_ITEM])];
}

/** Every key any arena uses - the catalog-parity test and the UI iterate this. */
export function allGigChecklistKeys(): string[] {
  return [...new Set(GIG_ARENAS.flatMap((a) => GIG_CHECKLISTS[a]))];
}
