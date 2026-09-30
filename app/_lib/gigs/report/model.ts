import type { GigReportStage } from "../types";

// The report's vocabulary, shared by the template, the deterministic body, the model's
// validator and the runner - import-free apart from one type, so every layer (and the tests)
// reads the same lists.

/** What a section is ABOUT. It decides the rail group the section sits under and which
 *  sections a stage requires; the model names one per section, kp maps anything else to
 *  `other`. Kept in lockstep with gig_report_cli.py SECTION_KINDS (report.test.ts). */
export const GIG_REPORT_SECTION_KINDS = [
  "gig",
  "asks",
  "risks",
  "fit",
  "questions",
  "plans",
  "chosen",
  "draft",
  "evidence",
  "review",
  "outcome",
  "lessons",
  "other",
] as const;
export type GigReportSectionKind = (typeof GIG_REPORT_SECTION_KINDS)[number];

export function isGigReportSectionKind(v: unknown): v is GigReportSectionKind {
  return typeof v === "string" && (GIG_REPORT_SECTION_KINDS as readonly string[]).includes(v);
}

/** The rail's topic groups, in reading order. */
export const GIG_REPORT_GROUPS = [
  { id: "gig", label: "The gig", kinds: ["gig", "asks", "risks", "fit", "questions"] },
  { id: "plan", label: "The plan", kinds: ["plans", "chosen"] },
  { id: "work", label: "The work", kinds: ["draft", "evidence", "review"] },
  { id: "result", label: "The result", kinds: ["outcome", "lessons"] },
  { id: "notes", label: "Notes", kinds: ["other"] },
] as const satisfies readonly { id: string; label: string; kinds: readonly GigReportSectionKind[] }[];

export function groupOfKind(kind: GigReportSectionKind): (typeof GIG_REPORT_GROUPS)[number] {
  return GIG_REPORT_GROUPS.find((g) => (g.kinds as readonly string[]).includes(kind)) ?? GIG_REPORT_GROUPS[GIG_REPORT_GROUPS.length - 1];
}

/** The sections each stage's report carries, in order. Cumulative: a later stage keeps
 *  every earlier section and adds its own. */
const ADDS: Readonly<Record<GigReportStage, readonly GigReportSectionKind[]>> = {
  researched: ["gig", "asks", "risks", "fit", "questions"],
  planned: ["plans"],
  accepted: ["chosen"],
  drafted: ["draft", "evidence", "review"],
  sent: ["outcome"],
  closed: ["lessons"],
};

export const GIG_REPORT_STAGE_ORDER: readonly GigReportStage[] = ["researched", "planned", "accepted", "drafted", "sent", "closed"];

export function stageRank(stage: GigReportStage): number {
  return GIG_REPORT_STAGE_ORDER.indexOf(stage);
}

/** The section kinds a report at `stage` must carry, in reading order. Pure. */
export function sectionPlanFor(stage: GigReportStage): GigReportSectionKind[] {
  const out: GigReportSectionKind[] = [];
  for (const s of GIG_REPORT_STAGE_ORDER) {
    out.push(...ADDS[s]);
    if (s === stage) break;
  }
  return out;
}

/** The human label of a stage (the eyebrow, the rail's stage strip). */
export const GIG_REPORT_STAGE_LABEL: Readonly<Record<GigReportStage, string>> = {
  researched: "Researched",
  planned: "Planned",
  accepted: "Plan accepted",
  drafted: "Drafted",
  sent: "Sent",
  closed: "Closed",
};

/** One section as the page renders it. `html` is TRUSTED here: kp built it (deterministic.ts)
 *  or it passed the allow-list (sanitize.ts) on its way in. */
export type GigReportSection = { id: string; title: string; kind: GigReportSectionKind; html: string };

/** The body of a report: a lead (the first thing the reader sees), the phrase in it that
 *  carries the highlighter (null = none), and the sections. */
export type GigReportBody = { lead: string; highlight: string | null; sections: GigReportSection[] };

/** A stat card in the header: the figure, what it is, and where it came from. */
export type GigReportStat = { n: string; l: string; c: string };
