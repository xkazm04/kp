// The decision trail as a file — ONE artifact, however many surfaces offer it.
//
// This lived privately inside sections/DecisionLogTable.tsx, which was correct
// while the Analytics tab was the only place that could export. It is not: the
// Decisions tab is where a recruiter actually works the queue, and "send me the
// trail of AI-assisted decisions" is a request that arrives there. A second
// builder written into that header would have produced a SECOND audit artifact
// for ONE regulated record — its own columns, its own clock, its own idea of
// what "everything" means — and two files that disagree about one decision
// trail are worse than one file in the wrong tab.
//
// Everything here is pure: no React, no next-intl, no fetch, no DOM. Labels and
// the per-row renderings arrive already resolved (the idiom analyticsFunnelCsv.ts
// uses for the funnel/roles files), so the file's shape — the provenance block,
// the column order, the two time columns — is pinned by a plain unit test rather
// than by whichever surface happened to render it last.
import { decisionMeta, withExportProvenance, type Decision, type DecisionPage } from "./analyticsDecisionLogTypes";
import type { CohortProvenance } from "@/app/_lib/decision-attribution";

/** Provenance + column labels, resolved by the caller from `analytics.log.*`. */
export type DecisionCsvLabels = {
  /** The artifact's own name, written into the provenance block. */
  title: string;
  provExport: string;
  provGenerated: string;
  provZone: string;
  provLocale: string;
  provScope: string;
  provFilters: string;
  timeLocal: string;
  timeIso: string;
  attribution: string;
  actor: string;
  kind: string;
  candidate: string;
  role: string;
  cohort: string;
  detail: string;
};

/** The per-cell renderings the builder deliberately does not own: each needs a
 *  translator, a locale or a time zone, and threading those through here is how a
 *  pure module stops being pure. `detail` returns null for a row that has none —
 *  an empty cell, never an invented one. */
export type DecisionCsvRender = {
  time: (iso: string) => string;
  attribution: (bucket: "auto" | "human" | "unknown") => string;
  actor: (actor: string | null | undefined) => string;
  kind: (kind: string) => string;
  cohort: (cohort: CohortProvenance) => string;
  detail: (decision: Decision) => string | null;
};

/** What this particular file covers — the block that makes it reproducible. */
export type DecisionCsvScope = {
  /** Already rendered in `zone`: the provenance block is the human's line, and
   *  the machine instant is on every row's second column anyway. */
  generatedAt: string;
  zone: string;
  locale: string;
  /** "Page 3 of 9 · 20 of 174 rows", "Whole trail · 174 of 174 rows", … */
  scope: string;
  /** The narrowing that was active, or the caller's "no filters" phrase. */
  filters: string;
};

/**
 * Provenance block, a blank separator, the header, then one row per decision.
 *
 * The two time columns are not redundant (UAT LUC-ANA-7): the first matches what
 * the reader saw on screen in the named zone, the second is the unambiguous UTC
 * instant. Dropping either is what once made a Prague screen and its own export
 * disagree by two hours on an audit artifact.
 */
export function decisionCsvRows(
  list: Decision[],
  labels: DecisionCsvLabels,
  render: DecisionCsvRender,
  scope: DecisionCsvScope
): (string | number | null)[][] {
  return withExportProvenance(
    [
      [labels.provExport, labels.title],
      [labels.provGenerated, scope.generatedAt],
      [labels.provZone, scope.zone],
      [labels.provLocale, scope.locale],
      [labels.provScope, scope.scope],
      [labels.provFilters, scope.filters],
    ],
    [
      labels.timeLocal,
      labels.timeIso,
      labels.attribution,
      labels.actor,
      labels.kind,
      labels.candidate,
      labels.role,
      labels.cohort,
      labels.detail,
    ],
    list.map((d) => [
      render.time(d.createdAt),
      d.createdAt,
      render.attribution(decisionMeta(d.kind).attribution),
      render.actor(d.actor),
      render.kind(d.kind),
      d.candidateLabel,
      d.jobTitle,
      d.cohort ? render.cohort(d.cohort) : null,
      render.detail(d),
    ])
  );
}

/** Page size for the whole-trail export's chained reads. The route caps `limit`
 *  at 50 (MAX_LIMIT), so this is the largest page it will honour. */
export const TRAIL_FETCH_LIMIT = 50;
/** Hard stop on the export loop, so a paging bug can never spin forever. */
export const TRAIL_MAX_PAGES = 400;

/** Everything `/api/analytics/decisions` accepts, in one shape. Built here rather
 *  than string-concatenated per surface: the export must page the SAME endpoint
 *  under the SAME narrowing the screen is showing, and a second hand-rolled query
 *  string is how an export quietly stops matching the table above it. */
export type DecisionLogQuery = {
  offset: number;
  limit: number;
  sort: "createdAt" | "candidateLabel" | "jobTitle" | "kind";
  dir: "asc" | "desc";
  locale: string;
  kind?: string;
  attribution?: "auto" | "human" | null;
  /** Subject search. Sent only when non-empty — a blank `q` is not a filter. */
  q?: string;
};

export function decisionLogUrl(query: DecisionLogQuery): string {
  const params = new URLSearchParams({
    offset: String(query.offset),
    limit: String(query.limit),
    sort: query.sort,
    dir: query.dir,
    locale: query.locale,
  });
  // UAT LUC-ANA-12 — kind and attribution are sent TOGETHER and intersected by the
  // route. Choosing a winner between them is what made a lit filter dot lie.
  if (query.kind) params.set("kind", query.kind);
  if (query.attribution) params.set("attribution", query.attribution);
  if (query.q) params.set("q", query.q);
  return `/api/analytics/decisions?${params.toString()}`;
}

/**
 * Chain the route's offset pages into one list (UAT LUC-ANA-11 — 174 rows at 20
 * per click was nine downloads, so "export the audit trail" was in practice not
 * offered).
 *
 * `fetchPage` is injected so the loop's stop conditions are testable without a
 * server: the route said there is no more, the route returned nothing, or the
 * page ceiling was hit. It follows `nextOffset` rather than recomputing the
 * arithmetic, so the client can never disagree with the server about where it is.
 *
 * A throw propagates on purpose — a partial file named "whole trail" is exactly
 * the artifact an auditor must never be handed, so the caller downloads nothing
 * and says why.
 */
export async function collectDecisionTrail(
  fetchPage: (offset: number, limit: number) => Promise<DecisionPage>,
  opts?: { limit?: number; maxPages?: number }
): Promise<{ rows: Decision[]; total: number; complete: boolean }> {
  const limit = opts?.limit ?? TRAIL_FETCH_LIMIT;
  const maxPages = opts?.maxPages ?? TRAIL_MAX_PAGES;
  const rows: Decision[] = [];
  let offset = 0;
  let total = 0;
  let complete = false;
  for (let i = 0; i < maxPages; i++) {
    const page = await fetchPage(offset, limit);
    rows.push(...page.decisions);
    // The trail's size as the SERVER most recently reported it — what the scope
    // line counts against, so a file can say "174 of 174" or admit "50 of 174".
    total = page.total;
    if (!page.hasMore || page.decisions.length === 0) {
      complete = true;
      break;
    }
    offset = page.nextOffset;
  }
  return { rows, total, complete };
}
