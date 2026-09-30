import type { GigReportFacts } from "./facts";
import { deterministicReportBody, deterministicSection, reportMeta, reportStats } from "./deterministic";
import { GIG_REPORT_STAGE_LABEL, isGigReportSectionKind, sectionPlanFor, type GigReportBody, type GigReportSection } from "./model";
import { sanitizeReportHtml } from "./sanitize";
import { renderGigReportPage, type GigReportProvenance } from "./template";

// Sanitise, then assemble: the model's answer (gig_report_cli.py `result`) is validated into
// a body kp trusts - every section's HTML re-serialized through the allow-list
// (sanitize.ts), the lead and titles clamped to plain text, the ids re-minted - and the page
// is filled from the fixed template. When the model wrote no usable body (keyless, a failed
// or unusable call, KP_OFFLINE) the body is kp's own (deterministic.ts). When it wrote one
// but left out a section the stage requires, kp writes that section itself, in the stage
// plan's order, and the footer names it.

export const GIG_REPORT_LIMITS = {
  leadChars: 480,
  highlightChars: 160,
  titleChars: 90,
  sectionHtmlChars: 16_000,
  minSections: 3,
  maxSections: 14,
} as const;

function plain(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function slug(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return s || null;
}

/** The model's `result` as a body kp trusts, or null when it is unusable (no lead, fewer
 *  than GIG_REPORT_LIMITS.minSections sections with a title and a non-empty body). Section
 *  ids become `s-<slug>` (unique), unknown kinds `other`, and the highlight is kept only when
 *  it is literally part of the lead. Pure apart from the parser. */
export function parseGigReportBody(raw: unknown): GigReportBody | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const lead = plain(r.lead, GIG_REPORT_LIMITS.leadChars);
  if (!lead || !Array.isArray(r.sections)) return null;
  const hl = plain(r.highlight, GIG_REPORT_LIMITS.highlightChars);
  const sections: GigReportSection[] = [];
  const ids = new Set<string>();
  for (const item of r.sections.slice(0, GIG_REPORT_LIMITS.maxSections)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const s = item as Record<string, unknown>;
    const title = plain(s.title, GIG_REPORT_LIMITS.titleChars);
    const html = typeof s.html === "string" ? sanitizeReportHtml(s.html.slice(0, GIG_REPORT_LIMITS.sectionHtmlChars)) : "";
    if (!title || !html.replace(/<[^>]*>/g, "").trim()) continue;
    const kind = isGigReportSectionKind(s.kind) ? s.kind : "other";
    let id = `s-${slug(s.id) ?? kind}`;
    for (let n = 2; ids.has(id); n++) id = `s-${slug(s.id) ?? kind}-${n}`;
    ids.add(id);
    sections.push({ id, title, kind, html });
  }
  if (sections.length < GIG_REPORT_LIMITS.minSections) return null;
  return { lead, highlight: hl && lead.includes(hl) ? hl : null, sections };
}

/** The model's body with every section the stage requires and the model left out written
 *  by kp, placed after the last section of an earlier kind in the stage plan. Pure. */
export function fillRequiredSections(facts: GigReportFacts, body: GigReportBody): { body: GigReportBody; filled: string[] } {
  const plan = sectionPlanFor(facts.stage, facts.track);
  const sections = [...body.sections];
  const filled: string[] = [];
  for (const [i, kind] of plan.entries()) {
    if (sections.some((s) => s.kind === kind)) continue;
    const earlier = new Set(plan.slice(0, i));
    let at = 0;
    sections.forEach((s, j) => {
      if (earlier.has(s.kind)) at = j + 1;
    });
    let section = deterministicSection(facts, kind);
    if (sections.some((s) => s.id === section.id)) section = { ...section, id: `${section.id}-kp` };
    sections.splice(at, 0, section);
    filled.push(kind);
  }
  return { body: { ...body, sections }, filled };
}

export type AssembleInput = {
  facts: GigReportFacts;
  /** The CLI's `result` when its `source` was "llm"; null otherwise. */
  modelResult: unknown;
  model: string | null;
  fallbackReason: string | null;
  costUsd: number | null;
  generatedAt: string;
};

export type AssembledReport = { html: string; source: "llm" | "deterministic"; fallbackReason: string | null; filled: string[] };

/** The report file's HTML. Pure apart from the parser. */
export function assembleGigReport(input: AssembleInput): AssembledReport {
  const { facts } = input;
  const parsed = input.modelResult === null ? null : parseGigReportBody(input.modelResult);
  const source: "llm" | "deterministic" = parsed ? "llm" : "deterministic";
  const fallbackReason = parsed ? null : input.modelResult !== null ? "llm_unusable" : (input.fallbackReason ?? "no_provider");
  const { body, filled } = parsed ? fillRequiredSections(facts, parsed) : { body: deterministicReportBody(facts), filled: [] };
  const provenance: GigReportProvenance = {
    source,
    model: parsed ? input.model : null,
    fallbackReason,
    costUsd: input.costUsd,
    generatedAt: input.generatedAt,
    factsAt: facts.factsAt,
    filled,
  };
  const html = renderGigReportPage({
    title: facts.gig.title,
    railTitle: facts.gig.title.length > 60 ? `${facts.gig.title.slice(0, 59)}…` : facts.gig.title,
    railSub: `kp gig report · ${facts.gig.arenaLabel}`,
    eyebrow: [facts.gig.arenaLabel, facts.gig.typeLabel, GIG_REPORT_STAGE_LABEL[facts.stage]],
    lead: body.lead,
    highlight: body.highlight,
    meta: reportMeta(facts),
    listingUrl: facts.gig.url || null,
    stage: facts.stage,
    stats: reportStats(facts),
    sections: body.sections,
    provenance,
  });
  return { html, source, fallbackReason, filled };
}
