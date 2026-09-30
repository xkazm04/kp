import type { GigReportStage } from "../types";
import { GIG_REPORT_CSS } from "./report-css";
import {
  GIG_REPORT_GROUPS,
  GIG_REPORT_STAGE_LABEL,
  GIG_REPORT_STAGE_ORDER,
  groupOfKind,
  stageRank,
  type GigReportSection,
  type GigReportStat,
} from "./model";
import { escapeHtml, safeHttpsHref } from "./sanitize";

// The report's fixed page skeleton: ONE self-contained HTML document, no script, no external
// request. The stylesheet is report-css.ts; this file owns the markup around the sections:
//
//   nav.rail   the gig's short title, the stage strip (researched -> closed, the current one
//              lit), then the sections NUMBERED and GROUPED by topic (model.ts
//              GIG_REPORT_GROUPS) - generated from the sections, never written by a model
//   header     eyebrow (arena · type · stage), the title, the lead with its highlighted
//              phrase, a meta line (who, when, the listing link), the stat cards
//   sections   <section id> with a numbered h2; the body is the section's (trusted) html
//   footer     provenance: who wrote the body, when, from facts as of when, at what cost,
//              and the kp-deterministic fallback reason when there was no model
//
// Everything interpolated here is escaped except the section bodies, which are trusted by
// construction (deterministic.ts builds them, sanitize.ts re-serializes a model's).

export type GigReportProvenance = {
  source: "llm" | "deterministic";
  /** The model id that wrote the body; null when kp did. */
  model: string | null;
  fallbackReason: string | null;
  costUsd: number | null;
  generatedAt: string;
  factsAt: string;
  /** Section kinds kp filled in because the model's answer did not carry them. */
  filled: string[];
};

export type GigReportPage = {
  title: string;
  /** The rail's short name (the title, clamped). */
  railTitle: string;
  railSub: string;
  eyebrow: string[];
  lead: string;
  highlight: string | null;
  meta: string[];
  listingUrl: string | null;
  stage: GigReportStage;
  stats: GigReportStat[];
  sections: GigReportSection[];
  provenance: GigReportProvenance;
};

function leadHtml(lead: string, highlight: string | null): string {
  if (!highlight) return escapeHtml(lead);
  const at = lead.indexOf(highlight);
  if (at < 0) return escapeHtml(lead);
  return `${escapeHtml(lead.slice(0, at))}<mark>${escapeHtml(highlight)}</mark>${escapeHtml(lead.slice(at + highlight.length))}`;
}

function statsHtml(stats: readonly GigReportStat[]): string {
  if (stats.length === 0) return "";
  const cards = stats
    .map((s) => `<div class="stat"><span class="n">${escapeHtml(s.n)}</span><span class="l">${escapeHtml(s.l)}</span><span class="c">${escapeHtml(s.c)}</span></div>`)
    .join("");
  return `<div class="stat-cards">${cards}</div>`;
}

function stagesHtml(stage: GigReportStage): string {
  const now = stageRank(stage);
  const items = GIG_REPORT_STAGE_ORDER.map((s, i) => {
    const cls = i < now ? "done" : i === now ? "now" : "next";
    return `<li class="${cls}"${i === now ? ' aria-current="step"' : ""}>${escapeHtml(GIG_REPORT_STAGE_LABEL[s])}</li>`;
  }).join("");
  return `<ol class="stages" aria-label="Where the gig is">${items}</ol>`;
}

/** The rail: sections numbered in page order, listed under their topic group (a group
 *  with no section is left out). Pure. */
export function railHtml(sections: readonly GigReportSection[]): string {
  const out: string[] = [];
  for (const group of GIG_REPORT_GROUPS) {
    const members = sections.map((s, i) => ({ s, n: i + 1 })).filter(({ s }) => groupOfKind(s.kind).id === group.id);
    if (members.length === 0) continue;
    out.push(`<h2>${escapeHtml(group.label)}</h2>`);
    for (const { s, n } of members) out.push(`<a href="#${escapeHtml(s.id)}"><b>${n}</b>${escapeHtml(s.title)}</a>`);
  }
  return out.join("");
}

function money(v: number): string {
  return v < 0.01 ? "<$0.01" : `$${v.toFixed(2)}`;
}

function provenanceHtml(p: GigReportProvenance): string {
  const who = p.source === "llm" ? `Written by <code>${escapeHtml(p.model ?? "a model")}</code> from kp's facts` : "Written by kp from its own facts, with no model";
  const why = p.source === "deterministic" && p.fallbackReason ? ` (<code>${escapeHtml(p.fallbackReason)}</code>)` : "";
  const cost = p.source === "llm" ? ` Cost: ${p.costUsd === null ? "not reported" : escapeHtml(money(p.costUsd))}.` : "";
  const filled = p.filled.length > 0 ? `<p>kp wrote these sections itself because the model's answer left them out: ${p.filled.map((k) => `<code>${escapeHtml(k)}</code>`).join(", ")}.</p>` : "";
  return [
    `<footer class="prov">`,
    `<p>${who}${why}, at ${escapeHtml(p.generatedAt)}; the facts are as of ${escapeHtml(p.factsAt)}.${cost}</p>`,
    filled,
    `<p>kp rewrites this file as the gig moves (researched, planned, accepted, drafted, sent, closed) and keeps the previous version beside it as <code>.prev.html</code>. Numbers come from kp's records; a figure it does not have is written as not reported, never as zero.</p>`,
    `</footer>`,
  ].join("");
}

/** The whole document. Pure. */
export function renderGigReportPage(page: GigReportPage): string {
  const href = page.listingUrl ? safeHttpsHref(page.listingUrl) : null;
  const meta = [...page.meta.map((m) => `<span>${escapeHtml(m)}</span>`), ...(href ? [`<span><a href="${escapeHtml(href)}" rel="noopener noreferrer nofollow">the listing</a></span>`] : [])];
  const sections = page.sections
    .map((s, i) => `<section id="${escapeHtml(s.id)}" aria-labelledby="${escapeHtml(s.id)}-h"><h2 id="${escapeHtml(s.id)}-h"><span class="num">${i + 1}</span>${escapeHtml(s.title)}</h2>${s.html}</section>`)
    .join("\n");
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    '<meta name="generator" content="kp gig report">',
    '<meta name="referrer" content="no-referrer">',
    `<title>${escapeHtml(page.title)} - gig report</title>`,
    `<style>${GIG_REPORT_CSS}</style>`,
    "</head>",
    "<body>",
    `<nav class="rail" aria-label="Sections"><p class="brand">${escapeHtml(page.railTitle)}<small>${escapeHtml(page.railSub)}</small></p>${stagesHtml(page.stage)}<div class="groups">${railHtml(page.sections)}</div></nav>`,
    '<main><div class="wrap">',
    '<header class="hero">',
    `<p class="kicker">${page.eyebrow.map(escapeHtml).join(" · ")}</p>`,
    `<h1>${escapeHtml(page.title)}</h1>`,
    `<p class="claim">${leadHtml(page.lead, page.highlight)}</p>`,
    meta.length > 0 ? `<p class="meta">${meta.join("")}</p>` : "",
    statsHtml(page.stats),
    "</header>",
    sections,
    provenanceHtml(page.provenance),
    "</div></main>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
