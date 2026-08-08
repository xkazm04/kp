import type { RoleBrief } from "./rolespec";

// The LIVE JD draft — a DETERMINISTIC, client-side render of the current
// RoleBrief into posting-shaped markdown, so the requestor watches the JD
// forming as they talk without any per-exchange LLM cost. It deliberately
// mirrors the section shape of the real build's composeMarkdown
// (app/_lib/jd-build-run.ts) minus what only the build knows (grounded market
// salary, template rendering) — the FINAL JD is still generated at Promote;
// this is the working preview, and the UI labels it so.
//
// Pure + dependency-free (strings injected by the caller from next-intl) so
// the contract is unit-testable without React (intake-draft.test.ts).

export type DraftStrings = {
  untitled: string;
  level: (seniority: string) => string;
  aboutRole: string;
  outcomes: string;
  responsibilities: string;
  whatBring: string;
  niceToHave: string;
  languages: string;
};

export function briefDraftMarkdown(brief: RoleBrief | null, s: DraftStrings): string {
  if (!brief) return "";
  const musts = (brief.requirements ?? []).filter((r) => r.kind === "must_have").map((r) => r.skill);
  const nices = (brief.requirements ?? []).filter((r) => r.kind === "nice_to_have").map((r) => r.skill);
  const lines: string[] = [];
  lines.push(`# ${brief.title?.trim() || s.untitled}`);
  // Seniority prints only when it was actually captured (stated or inferred) —
  // the schema default must not read as a decided level (the provenance law).
  const seniorityKnown = brief.spineProvenance?.seniority && brief.spineProvenance.seniority !== "default";
  if (seniorityKnown && brief.seniority) lines.push(`**${s.level(brief.seniority)}**`);
  if (brief.summary?.trim()) {
    lines.push("", `## ${s.aboutRole}`, brief.summary.trim());
  }
  const section = (heading: string, items: string[] | undefined) => {
    const kept = (items ?? []).map((i) => i.trim()).filter(Boolean);
    if (kept.length) {
      lines.push("", `## ${heading}`);
      kept.forEach((item) => lines.push(`- ${item}`));
    }
  };
  section(s.outcomes, brief.successCriteria);
  section(s.responsibilities, brief.responsibilities);
  section(s.whatBring, musts);
  section(s.niceToHave, nices);
  section(s.languages, brief.languages);
  return lines.join("\n");
}

// Whether the draft has anything worth showing yet (drives the empty state).
export function briefDraftHasContent(brief: RoleBrief | null): boolean {
  if (!brief) return false;
  return Boolean(
    brief.title?.trim() ||
      (brief.requirements ?? []).length ||
      (brief.successCriteria ?? []).length ||
      (brief.responsibilities ?? []).length
  );
}
