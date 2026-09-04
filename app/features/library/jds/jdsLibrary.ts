// Shared, side-effect-free logic for the JD library's two-level surface (the
// filterable table + detail modal prototyped in LibrarySavedJds*). Kept pure so
// the categorization + filter/sort rules live in one testable place and the
// three styling variants can never drift on WHAT the table shows — only on how.

import type { LucideIcon } from "lucide-react";
import { AlertTriangle, CircleDot, Crown, FileText, Loader2, Lock, PencilRuler, Radio, Sprout, Star, TrendingUp } from "lucide-react";
import { lintJd, type JdLintFinding } from "@/app/_lib/jd-lint";
import { normalizeMarketSalary } from "@/app/_lib/salary-band";
import type { BadgeTone } from "@/app/_components/Badge";

// Whether the JD's stored build artifacts GROUND a market-salary figure — the
// ONE rule that feeds the lint's `salaryAvailable` suppression seam on every
// POST-BUILD surface (the ledger modal, the ledger read-view, AND the public
// page's editor). Kept here (pure, artifact-shaped) so those surfaces can't
// disagree on when a role "has a salary".
//
// Only a USABLE normalized band counts. A ticked `options.marketResearch` used to
// count as well, and that was the defect: the tick is the recruiter's pre-build
// INTENT, recorded before the step ran, and runMarketSalary legitimately resolves
// to `available: false` (the CLI's 0–0 taxonomy miss, or a keyless deterministic
// run that yields no band — degrading without keys is a product property here).
// composeMarkdown then OMITS the salary line entirely and marketSalaryLabel
// renders "" into a template's {{salary}} slot, so the published body carries no
// pay figure ANYWHERE — while the lint, trusting the tick, suppressed its
// missing-salary finding and the panel rendered its all-clear. On the public JD
// page's editor there isn't even a SalaryCard to contradict it. After the build
// the artifacts are the evidence; the tick is a promise we can now check.
// Pinned by jdsLintWiring.test.ts.
export function jdMarketResearchAvailable(
  artifacts: { options?: { marketResearch?: boolean }; salary?: unknown } | null | undefined
): boolean {
  if (!artifacts) return false;
  return normalizeMarketSalary(artifacts.salary).available;
}

// Below this many characters the "describe the need" body is too thin to lint
// usefully — every short draft would trip missing-salary/place, which reads as
// nagging rather than advice. So the builder holds the advisory panel until the
// draft is substantive, then engages. Named here so the wiring test pins it.
export const LINT_MIN_BODY_CHARS = 40;

// The builder's advisory specificity/inclusivity lint over its rich-editor body —
// the SAME finished jd-lint engine that already backs the public-page panel, wired
// (finally) to the authoring surface. Findings are ADVISORY; the panel hides at
// zero (below the threshold this returns none). `marketResearch` feeds the
// engine's `salaryAvailable` seam — "a grounded figure exists outside the prose,
// so don't nag about pay". It is resolved per surface: PRE-build (JdBuilder) it's
// the ticked "market research" checkbox, an intent whose result isn't knowable
// yet; POST-build (the ledger read-view/editor, the public page's editor) it MUST
// come from jdMarketResearchAvailable above, which checks the band the build
// actually produced rather than re-trusting the tick. The engine itself is
// bilingual by content (EN+CS regexes) — no lang argument to thread.
export function builderLintFindings(
  body: string,
  opts: { marketResearch: boolean; mustHaveCount?: number }
): JdLintFinding[] {
  if ((body ?? "").trim().length < LINT_MIN_BODY_CHARS) return [];
  return lintJd({ body, salaryAvailable: opts.marketResearch, mustHaveCount: opts.mustHaveCount });
}

/** The structured must-have count from a build's artifacts, for the lint's
 *  manyMustHaves rule. Only the artifact-bearing surfaces can supply it — the
 *  builder lints the recruiter's PROMPT and has no RoleSpec yet, so it passes
 *  nothing and the rule falls back to counting marker words in prose. */
export function jdMustHaveCount(
  artifacts: { role?: { mustHaves?: unknown[] } } | null | undefined
): number | undefined {
  const n = artifacts?.role?.mustHaves?.length;
  return typeof n === "number" && n > 0 ? n : undefined;
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
  // Live pipeline state of the linked jd-<slug> job: how many candidates it holds,
  // how many cleared screening, how many were hired. `null` when no job is linked
  // (an analysis-only JD) — distinct from a linked job whose pipeline is empty,
  // which is `{ total: 0, … }`. Threshold matches analytics' byJob exactly
  // (hasAdvancedPastScreening), so the two surfaces cannot report different
  // numbers for the same role.
  pipeline?: JdPipelineStats | null;
};

export type JdPipelineStats = {
  total: number;
  reachedInterview: number;
  hired: number;
  hireRatePct: number;
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
  // The BUILD choices the source JD was generated with (jds.build_input_json), so a
  // duplicate is rebuilt the same way rather than under the app's defaults. A copy
  // of a Czech JD rendered through the company template used to come back English
  // and AI-formatted — the recruiter's two most consequential choices, silently
  // dropped by the one action whose whole purpose is "again, like that one".
  // Absent for a draft save or a pre-migration row; each is applied only when the
  // value is still valid at seed time (the template may since have been deleted).
  templateId?: string;
  lang?: string;
  repoUrl?: string;
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

// The ledger has ONE sort axis: the columns a reader re-ranks by from the header.
//
// There used to be a second, `SORTS = ["recent", "candidates", "title"]`, from
// before the shared table kit landed. Its only consumer, filterAndSortJds, was
// always called with "recent" - the comment below already recorded that - so the
// other two branches had been unreachable since the column sort took over, and
// nothing imported the vocabulary itself. A dead sort key is not inert: the next
// reader wiring up "sort by title" would have found a comparator that collates
// Czech titles under the runtime default locale, which is the bug the shared kit
// exists to prevent. Removed rather than fixed - there is no caller to fix it for.
//
// Kept alongside the accessor map below so the map and the header cells can never
// name a column the other doesn't have.
export const JD_SORT_COLS = ["pipeline", "analyzed", "saved"] as const;
export type JdSortCol = (typeof JD_SORT_COLS)[number];

/** What each sortable column contributes to the ordering. Null means "no value"
 *  and sorts LAST in both directions (see useTableSort/compareCells) — which is
 *  the point for `pipeline`: an analysis-only JD has no linked job, so it has no
 *  pipeline at all. Ranking it as a zero would bury real but quiet roles beneath
 *  JDs that were never even ingested. */
export const JD_SORT_ACCESSORS: Record<JdSortCol, (r: JdRow) => string | number | null> = {
  pipeline: (r) => r.pipeline?.total ?? null,
  analyzed: (r) => r.analysisCount ?? 0,
  saved: (r) => r.created_at,
};

/** Filter the ledger, newest-first. The ORDERING half is deliberately fixed: this
 *  supplies the default the reader sees before touching a header, and useTableSort
 *  re-ranks the result from there (see jdsLedgerLogic's two-stage comment). */
export function filterAndSortJds(
  rows: JdRow[],
  opts: { query: string; status: StatusFilter; field?: string | null; seniority?: string | null }
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
  // Copy before sort — never mutate the caller's array in place. `created_at` is an
  // ISO string, so a bare localeCompare is byte order on a fixed-width numeric
  // format, which is the correct chronological order and locale-independent.
  return [...filtered].sort((a, b) => b.created_at.localeCompare(a.created_at));
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

/** The Ledger's "saved on" stamp, formatted in the APP's locale — not the OS's.
 *  A `toLocaleDateString(undefined, …)` follows the browser/OS locale, so a Czech
 *  workspace opened in an en-US browser stamped its localized table with a US
 *  date. Same fix, same shape as `ranWhen` in the group-eval helpers: the module
 *  stays locale-dumb and each client consumer threads next-intl's `useLocale()`. */
export function shortDate(iso: string, locale?: string): string {
  return new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
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
// ---- What the ledger footer may claim about the library's size --------------
// The footer printed `entryCount` over `visible.length` while GET /api/jds answered
// a 200-row page: a workspace holding 240 non-archived JDs read "200 entries" — a
// page's size presented as the library — and the Role search silently could not
// reach the other 40. The route now carries `total` (the unbounded jdLibraryStats
// count) beside `truncated`, and this fold is where the two become one line.
export type JdLedgerFooter =
  | { key: "entryCount"; count: number }
  | { key: "entryCountOfTotal"; count: number; total: number };

export function jdLibraryFooter(visible: number, total: number | null, truncated: boolean): JdLedgerFooter {
  // No total means no M to state. "N of ?" is not a line, and inventing an M is
  // exactly the claim this fold exists to prevent — so an older route, a failed
  // load or a payload without the field falls back to the bare count it always had.
  if (typeof total !== "number" || !Number.isFinite(total)) return { key: "entryCount", count: visible };
  // "N of M" whenever M is a bigger claim than N: the filters narrowed the table,
  // or the route cut the page. `truncated` is asserted INDEPENDENTLY of the
  // arithmetic — the route said rows were dropped, so a total that happens to equal
  // the visible count (a stale count, a delete between the two reads) must not
  // silently read as a complete library. `Math.max` keeps the pair coherent: an M
  // below the N beside it is never stated.
  if (total > visible || truncated) return { key: "entryCountOfTotal", count: visible, total: Math.max(total, visible) };
  return { key: "entryCount", count: visible };
}
