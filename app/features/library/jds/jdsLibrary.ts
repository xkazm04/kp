// Shared, side-effect-free logic for the JD library's two-level surface (the
// filterable table + detail modal prototyped in LibrarySavedJds*). Kept pure so
// the categorization + filter/sort rules live in one testable place and the
// three styling variants can never drift on WHAT the table shows — only on how.

import type { LucideIcon } from "lucide-react";
import { AlertTriangle, CircleDot, Crown, FileText, Loader2, Lock, PencilRuler, Radio, Sprout, Star, TrendingUp } from "lucide-react";
import { lintJd, type JdLintFinding } from "@/app/_lib/jd-lint";
import { normalizeMarketSalary } from "@/app/_lib/salary-band";
import type { BadgeTone } from "@/app/_components/Badge";

// Whether the JD's stored build artifacts ground a market-salary figure — the
// ONE rule that feeds the lint's `salaryAvailable` suppression seam on every
// surface (the ledger modal, the ledger read-view, AND the public page's
// editor). A ticked "market research" build option OR a usable normalized band
// counts. Kept here (pure, artifact-shaped) so those surfaces can't disagree on
// when a role "has a salary".
export function jdMarketResearchAvailable(
  artifacts: { options?: { marketResearch?: boolean }; salary?: unknown } | null | undefined
): boolean {
  if (!artifacts) return false;
  return Boolean(artifacts.options?.marketResearch) || normalizeMarketSalary(artifacts.salary).available;
}

// Below this many characters the "describe the need" body is too thin to lint
// usefully — every short draft would trip missing-salary/place, which reads as
// nagging rather than advice. So the builder holds the advisory panel until the
// draft is substantive, then engages. Named here so the wiring test pins it.
export const LINT_MIN_BODY_CHARS = 40;

// The builder's advisory specificity/inclusivity lint over its rich-editor body —
// the SAME finished jd-lint engine that already backs the public-page panel, wired
// (finally) to the authoring surface. Findings are ADVISORY; the panel hides at
// zero (below the threshold this returns none). `marketResearch` is the ticked
// "market research" step: the published artifacts will then carry a grounded
// salary figure even if the prose doesn't spell one out, so it feeds the engine's
// `salaryAvailable` to suppress the missing-salary finding (its documented
// contract). The engine itself is bilingual by content (EN+CS regexes) — no lang
// argument to thread.
export function builderLintFindings(body: string, opts: { marketResearch: boolean }): JdLintFinding[] {
  if ((body ?? "").trim().length < LINT_MIN_BODY_CHARS) return [];
  return lintJd({ body, salaryAvailable: opts.marketResearch });
}

// Mirrors the JdRow the /api/jds list endpoint returns (identity + a
// server-truncated preview), enriched with the linked-job status and the
// analyzed-candidate count the route computes for every row in one pass.
export type JdRow = {
  slug: string;
  title: string;
  preview: string;
  created_at: string;
  // The linked jd-<slug> job's lifecycle status; null = no job exists yet
  // (an analysis-only pasted JD that can't be matched or applied to).
  jobStatus?: string | null;
  // How many candidates have been analyzed against this JD.
  analysisCount?: number;
  // The linked job's role family + seniority (the Field and Seniority columns) and
  // company (prefills the Generate form on Duplicate); null for an analysis-only JD
  // with no job behind it.
  roleFamily?: string | null;
  seniority?: string | null;
  company?: string | null;
  // Backgrounded AI generation state: 'analyzing' while the jd_build task runs,
  // 'failed' if it errored, null/'ready' otherwise. Takes precedence over jobStatus
  // in statusCategory so an in-flight build reads as "Analyzing", not "Analysis-only".
  analysis_status?: "analyzing" | "ready" | "failed" | null;
  // The owning jd_build task — lets the row show live progress from TasksProvider.
  analysis_task_id?: string | null;
};

// Prefill for the Generate form when Duplicating a role: the fields we can
// reconstruct from a saved JD + its linked job. The original free-text prompt
// isn't stored, so `need` carries the saved JD BODY (markdown) into the "Describe
// the need" editor as the starting content to adapt. Every field optional — an
// analysis-only JD carries only a title.
export type GeneratePrefill = {
  title?: string;
  company?: string;
  seniority?: string;
  roleFamily?: string;
  need?: string;
};

// The single JD detail record GET /api/jds/[slug] serves (full body + analysis state
// so the detail view can render the analyzing/failed placeholders and the rich
// artifacts once ready).
export type JdDetail = {
  slug: string;
  title: string;
  body: string;
  created_at: string;
  archived_at?: string | null;
  analysis_status?: "analyzing" | "ready" | "failed" | null;
  analysis_task_id?: string | null;
  analysis_error?: string | null;
  analysis_json?: string | null;
  // The recruiter's original build intent (prompt + options), when this JD was
  // Generated — lets Duplicate re-seed the prompt rather than the rendered body.
  // NULL on legacy rows + plain draft saves.
  build_input_json?: string | null;
};

// The status categories the table filters on. "analyzing"/"failed" reflect a
// backgrounded AI build; "unlinked" is the analysis-only JD with no matchable job
// behind it; the rest reflect the linked job's lifecycle.
export type JdStatusCategory = "analyzing" | "failed" | "live" | "draft" | "closed" | "linked" | "unlinked";

export function statusCategory(row: JdRow): JdStatusCategory {
  // A backgrounded build wins over the linked-job status: while analyzing (or if it
  // failed) that IS the JD's state, regardless of any half-ingested job row.
  if (row.analysis_status === "analyzing") return "analyzing";
  if (row.analysis_status === "failed") return "failed";
  const s = row.jobStatus;
  if (s == null || s.trim() === "") return "unlinked";
  const v = s.trim().toLowerCase();
  if (v === "published" || v === "open" || v === "live") return "live";
  if (v === "draft") return "draft";
  if (v === "closed" || v === "archived" || v === "filled") return "closed";
  return "linked";
}

// The tone + icon for a JD status — the display-neutral half of the chip. The
// LABEL and ariaLabel are NOT baked in here: they're localized in the component
// (LibrarySavedJdsLedger's StatusBadge) via the `library.tab.chip*` keys, keyed
// on `category`, so the chip reads in the recruiter's locale instead of the old
// hardcoded English. `category` is the same statusCategory the filters use, so
// the chip and the filter can never disagree.
export type StatusChip = { tone: BadgeTone; icon: LucideIcon; category: JdStatusCategory };

// One tone/icon mapping for a JD's status, shared by every variant so a "Live"
// role reads identically whether it's a ledger cell, a catalog byline, or a
// sticker chip. Uses the Badge tone vocabulary (already dark-mapped).
export function jdStatusChip(row: JdRow): StatusChip {
  const category = statusCategory(row);
  switch (category) {
    case "analyzing":
      // Loader2 is the spinner icon; surfaces that can animate (the Ledger row) spin it.
      return { tone: "info", icon: Loader2, category };
    case "failed":
      return { tone: "critical", icon: AlertTriangle, category };
    case "live":
      return { tone: "positive", icon: Radio, category };
    case "draft":
      return { tone: "caution", icon: PencilRuler, category };
    case "closed":
      return { tone: "neutral", icon: Lock, category };
    case "linked":
      return { tone: "info", icon: CircleDot, category };
    default:
      return { tone: "neutral", icon: FileText, category };
  }
}

// True when the row has no matchable job yet, so the "Ingest as job" action is
// offered. Kept here so every variant's action column gates identically.
export function isUnlinked(row: JdRow): boolean {
  return statusCategory(row) === "unlinked";
}

// Seniority rendered as a single lucide glyph (icon-only column) with a rank
// metaphor: a sprout (entry) → rising trend (mid) → star (established) → crown
// (leadership). The label is the accessible name / tooltip. Canonical vocabulary
// matches the JD builder (junior|medior|senior|lead); an unknown value → null
// so the cell degrades to "—".
const SENIORITY_META: Record<string, { icon: LucideIcon; label: string }> = {
  junior: { icon: Sprout, label: "Junior" },
  medior: { icon: TrendingUp, label: "Medior" },
  senior: { icon: Star, label: "Senior" },
  lead: { icon: Crown, label: "Lead" },
};

export function seniorityMeta(value: string | null | undefined): { icon: LucideIcon; label: string } | null {
  return SENIORITY_META[(value ?? "").trim().toLowerCase()] ?? null;
}

// Distinct present values of a row facet (Field / Seniority) with their counts,
// for the column-header filter dropdowns. Empty/null values are skipped; the
// caller resolves display labels and sorts by name. Case-normalized so "Senior"
// and "senior" fold together, returning the lower-cased canonical value.
export function facetCounts(rows: JdRow[], pick: (r: JdRow) => string | null | undefined): { value: string; count: number }[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const v = (pick(r) ?? "").trim();
    if (!v) continue;
    map.set(v, (map.get(v) ?? 0) + 1);
  }
  return [...map.entries()].map(([value, count]) => ({ value, count }));
}

export const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "analyzing", label: "Analyzing" },
  { value: "live", label: "Live" },
  { value: "draft", label: "Draft" },
  { value: "unlinked", label: "Analysis-only" },
] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];

export const SORTS = [
  { value: "recent", label: "Newest" },
  { value: "candidates", label: "Most analyzed" },
  { value: "title", label: "A–Z" },
] as const;
export type SortKey = (typeof SORTS)[number]["value"];

export function filterAndSortJds(
  rows: JdRow[],
  opts: { query: string; status: StatusFilter; field?: string | null; seniority?: string | null; sort: SortKey }
): JdRow[] {
  const q = opts.query.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (opts.status !== "all" && statusCategory(r) !== opts.status) return false;
    if (opts.field && (r.roleFamily ?? "") !== opts.field) return false;
    if (opts.seniority && (r.seniority ?? "").trim().toLowerCase() !== opts.seniority.toLowerCase()) return false;
    if (!q) return true;
    return (
      r.title.toLowerCase().includes(q) ||
      r.slug.toLowerCase().includes(q) ||
      r.preview.toLowerCase().includes(q)
    );
  });
  // Copy before sort — never mutate the caller's array in place.
  return [...filtered].sort((a, b) => {
    if (opts.sort === "title") return a.title.localeCompare(b.title);
    if (opts.sort === "candidates") return (b.analysisCount ?? 0) - (a.analysisCount ?? 0);
    return b.created_at.localeCompare(a.created_at);
  });
}

// Per-status counts for the facet rail / filter badges — computed once per render
// from the full row set (not the filtered view) so the facet totals stay stable.
export function statusCounts(rows: JdRow[]): Record<StatusFilter, number> {
  const counts: Record<StatusFilter, number> = { all: rows.length, analyzing: 0, live: 0, draft: 0, unlinked: 0 };
  for (const r of rows) {
    const c = statusCategory(r);
    if (c === "analyzing") counts.analyzing += 1;
    else if (c === "live") counts.live += 1;
    else if (c === "draft") counts.draft += 1;
    else if (c === "unlinked") counts.unlinked += 1;
  }
  return counts;
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// winnability-apply — why a captured coach handoff (?coachEdit=<…slug…>) can't be
// staged into the editor right now, so the ledger renders an HONEST, dismissible
// trace note instead of dropping the suggestion silently (the param is one-shot and
// already spent by the time we get here). Given the target slug and the loaded rows:
//   - null        → nothing to trace: no handoff, still loading, OR the target is
//                   editable and the modal auto-opens with the staged suggestion
//   - "notFound"  → no JD row matches the slug (e.g. a corpus job with no saved JD)
//   - "analyzing" → the target's backgrounded build is still running (edit blocked)
//   - "failed"    → the target's build failed (edit stays blocked)
// Pure + derived so it re-evaluates every render: the moment the analyzing poll flips
// the row to ready this returns null, the auto-open path takes over, and the note is
// replaced by the editor's own staged banner (arm-late, at zero extra machinery).
export type CoachHandoffBlock = "notFound" | "analyzing" | "failed";
export function coachHandoffBlock(slug: string | null | undefined, rows: JdRow[] | null): CoachHandoffBlock | null {
  if (!slug || !rows) return null;
  const row = rows.find((r) => r.slug === slug);
  if (!row) return "notFound";
  if (row.analysis_status === "analyzing") return "analyzing";
  if (row.analysis_status === "failed") return "failed";
  return null;
}
