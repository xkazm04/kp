// Logical grouping of the routing table (Settings → Models). The flat 25-row
// use-case list read as one undifferentiated wall; these sections mirror the
// hiring process the use cases plug into, so an operator scanning for "where
// does the LLM touch interviews" lands on a titled cluster instead of grepping
// row labels. Section titles resolve via models.routing.sections.<key>; each
// row's one-sentence description via models.useCaseDesc.<id> (both in the
// catalog, 4 locales).
//
// The membership list is validated against LLM_USE_CASES by the colocated test:
// every use case must appear in EXACTLY one section, so adding a use case
// without placing it is a failing test, not a silently unsectioned row. The
// renderer still tolerates a server use case this module doesn't know (it lands
// in a trailing "other" bucket) — the client must not blank on a newer server.

export type RoutingSection = { key: string; useCases: readonly string[] };

export const ROUTING_SECTIONS: readonly RoutingSection[] = [
  // The catch-all pin every unpinned use case inherits — kept first, alone.
  { key: "default", useCases: ["*"] },
  // Scoring candidates against roles and each other.
  { key: "matching", useCases: ["match_reasoning", "group_compare", "weight_proposal", "agent_fit"] },
  // The pipeline's generated messages and ad copy.
  { key: "automation", useCases: ["automation", "campaign_pack"] },
  // Getting a role into the system — parsed, or talked through.
  { key: "roles", useCases: ["jd_ingest", "role_intake", "role_intake_voice"] },
  // Reading candidates: CVs, profiles, public footprint.
  { key: "profiles", useCases: ["cv_analysis", "profile_extract", "profile_draft", "github_analysis"] },
  // Interview outputs.
  { key: "interviews", useCases: ["interview_scorecard"] },
  // The work-sample (dev-case) assignment lifecycle, design → evaluation.
  {
    key: "assignments",
    useCases: [
      "devcase_analyze",
      "devcase_role_design",
      "devcase_case_design",
      "devcase_interview_scenario",
      "devcase_seed",
      "devcase_reflect",
      "devcase_evaluate",
      "devcase_judge",
      "devcase_tooling",
      "devcase_transfer",
    ],
  },
] as const;

/** Fallback bucket for server use cases this module doesn't know yet. */
export const OTHER_SECTION_KEY = "other";

/** Partition the server's use-case list into the declared sections (preserving
 *  each section's curated order), with unknown ids collected under "other".
 *  Sections with no member present are dropped. */
export function sectionizeUseCases(useCases: readonly string[]): { key: string; useCases: string[] }[] {
  const present = new Set(useCases);
  const placed = new Set<string>();
  const out: { key: string; useCases: string[] }[] = [];
  for (const section of ROUTING_SECTIONS) {
    const members = section.useCases.filter((u) => present.has(u));
    members.forEach((u) => placed.add(u));
    if (members.length) out.push({ key: section.key, useCases: members });
  }
  const other = useCases.filter((u) => !placed.has(u));
  if (other.length) out.push({ key: OTHER_SECTION_KEY, useCases: other });
  return out;
}
