// Types + pure attribution helpers for the analytics decision log. Split out of
// DecisionLog.tsx (now AnalyticsDecisionLog.tsx) so the log's row/type plumbing
// has its own module — no JSX here, so it's a plain .ts file.
import { DECISION_META, type CohortProvenance, type SealedReason } from "@/app/_lib/decision-attribution";

export type Decision = {
  id: number;
  // The subject pipeline entry (ANA1 / Direction 2): present on entry-scoped
  // events, null on board-level ones (e.g. a role close). When present, the row
  // deep-links to the candidate on the board.
  entryId: string | null;
  candidateLabel: string | null;
  jobTitle: string | null;
  kind: string;
  fromStage: string | null;
  toStage: string | null;
  detail: string | null;
  createdAt: string;
  // log-tells-the-whole-story — the three sealed-record joins the route attaches per
  // page (each present only when a reliable match exists, never guessed):
  cohort?: CohortProvenance | null; // group-eval cohort provenance (advance rows)
  reason?: SealedReason | null; // sealed structured auto-reject reason (auto_rejected rows)
  counterpart?: { label: string } | null; // rematch counterpart, resolved to a live board label
};

export type DecisionPage = {
  decisions: Decision[];
  total: number;
  hasMore: boolean;
  nextOffset: number;
  error?: string;
  /** Present only when the route had to refine the trail in memory (a subject
   *  search, or an ordering SQLite's BINARY collation cannot express). See
   *  SUBJECT_REFINE_MAX in app/api/analytics/decisions/route.ts. */
  subjectScan?: SubjectScan;
};

/** How far the in-memory refinement actually reached. `capped` is the one field a
 *  surface may NOT hide: a search that scanned the newest 5,000 of 40,000 rows found
 *  what it found in that slice, and an audit screen that renders those hits without
 *  saying so has claimed a whole-trail search it did not run. */
export type SubjectScan = { capped: boolean; scanned: number; trailTotal: number; cap: number };


// The auto/human decode + tone per event kind now lives in the shared
// decision-attribution module (ANA3) — the analytics automation rollup folds the
// SAME map server-side, so the per-row badge and the aggregate can never drift.
// The readable label still comes from the `analytics.log.kinds.<kind>` catalog,
// resolved at the render site.

// Attribution is three-state on purpose. In an auditable log, defaulting an
// unrecognized kind to AUTO would misattribute accountability to the machine —
// the most damaging default. An unmapped kind renders a neutral UNKNOWN badge
// and warns in dev, so adding a backend event kind forces a conscious entry in
// DECISION_META above (the kinds here must track recordAutomationEvent callers).
// `known` gates whether a catalog label exists; unknown falls back to the raw kind.
export function decisionMeta(kind: string): { known: boolean; attribution: "auto" | "human" | "unknown"; tone: string } {
  const meta = DECISION_META[kind];
  if (meta) return { known: true, attribution: meta.auto ? "auto" : "human", tone: meta.tone };
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[analytics] unmapped decision kind "${kind}" — add it to DECISION_META (rendering as UNKNOWN, not AUTO).`);
  }
  return { known: false, attribution: "unknown", tone: "text-steel" };
}

export const ATTRIBUTION_BADGE = {
  auto: "bg-moss/10 text-moss",
  human: "bg-coral/10 text-coral",
  unknown: "bg-stone-100 text-steel",
} as const;

// (UAT LUC-ANA-15) `PAGE_SIZE = 20` and `timeAgo()` were deleted here with the
// table rewrite that superseded them: paging is `TABLE_PAGE_SIZE`, and the audit
// surface renders an ABSOLUTE timestamp in a named zone (formatAuditTime) because
// "3 hours ago" is not a thing an auditor can reconcile against anything. Two
// dead exports on an audit module are not harmless: they leave a reader unsure
// which page size and which timestamp rendering are authoritative.

// ---------------------------------------------------------------------------
// The auditor's row (UAT §2.6) — the pure half, shared by BOTH audit tables and
// by the decision-log route. No JSX and no "use client" here on purpose: the
// route imports the same comparator and the same search fold the client renders
// with, so a name search and a name ordering cannot mean two different things on
// the two sides of the wire.
// ---------------------------------------------------------------------------

/** Strip NFD combining marks and case-fold. UAT LUC-ANA-5: an auditor typing
 *  "cermak" is looking for Čermák — a Czech search that is diacritic-exact is a
 *  search a Czech user cannot spell their way into on a foreign keyboard. */
export function foldForSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Does this subject label satisfy the free-text subject search? An empty query
 *  matches everything (a search box is not a filter until something is typed). */
export function matchesSubject(label: string | null | undefined, query: string): boolean {
  const needle = foldForSearch(query.trim());
  if (!needle) return true;
  return foldForSearch(String(label ?? "")).includes(needle);
}

// One collator per locale. Constructing an Intl.Collator is the expensive part;
// the comparator itself is called O(n log n) times per sort.
const collators = new Map<string, Intl.Collator>();

/** The app-locale collator for person/role names.
 *
 *  UAT LUC-ANA-5 — the ordering this replaces was SQLite's BINARY collation, i.e.
 *  UTF-8 byte order, which files every Czech diacritic surname AFTER Z: Čech,
 *  Škoda and Žák land past Zeman, so "sort by candidate" hid a third of a Czech
 *  workspace's names below the last page an auditor thought to look at. Intl
 *  collation puts Č after C, Ř after R, Š after S and Ž last, which is the order
 *  a Czech reader is looking for the name in. */
export function nameCollator(locale: string): Intl.Collator {
  let c = collators.get(locale);
  if (!c) {
    // `numeric` so "Role 2" precedes "Role 10" (the rule useTableSort already keeps);
    // an unsupported tag makes the Intl constructor fall back, never throw.
    c = new Intl.Collator(locale, { numeric: true });
    collators.set(locale, c);
  }
  return c;
}

/** Compare two nullable text cells with the app-locale collator, missing LAST in
 *  both directions (the rule useTableSort documents: a missing value is not a
 *  small value — a board-level row with no candidate must not float to the top of
 *  a descending name sort). */
export function compareNames(a: string | null | undefined, b: string | null | undefined, locale: string, dir: "asc" | "desc"): number {
  const aMissing = a == null || a === "";
  const bMissing = b == null || b === "";
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  const cmp = nameCollator(locale).compare(a, b);
  return dir === "desc" ? -cmp : cmp;
}

/** The decision log's server-side ordering, expressed in JS for the rows the
 *  route has to refine in memory (a subject search, or a text column whose SQL
 *  ordering is byte order). `createdAt` stays a plain string compare — the column
 *  is a UTC ISO-8601 instant, so lexical order IS chronological order. */
export function compareDecisions(
  a: { candidateLabel: string | null; jobTitle: string | null; kind: string; createdAt: string; id: number },
  b: { candidateLabel: string | null; jobTitle: string | null; kind: string; createdAt: string; id: number },
  col: "createdAt" | "candidateLabel" | "jobTitle" | "kind",
  dir: "asc" | "desc",
  locale: string
): number {
  const primary =
    col === "candidateLabel"
      ? compareNames(a.candidateLabel, b.candidateLabel, locale, dir)
      : col === "jobTitle"
        ? compareNames(a.jobTitle, b.jobTitle, locale, dir)
        : col === "kind"
          ? compareNames(a.kind, b.kind, locale, dir)
          : compareNames(a.createdAt, b.createdAt, locale, dir);
  // Ties break on the event id, newest first — the same `id DESC` tiebreak the
  // store's ORDER BY carries, so a refined page and a SQL page agree on order.
  return primary !== 0 ? primary : b.id - a.id;
}

/** The IANA zone this browser (or, during SSR, this host) will render audit
 *  timestamps in. UAT LUC-ANA-7: both tables used to print `iso.slice(0,16)`, a
 *  UTC instant with no zone marker, which a Prague reader read as local and the
 *  CSV contradicted by two hours. Naming the zone is not decoration — it is what
 *  makes the screen and the export the same claim. */
export function resolveAuditTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** One audit timestamp, rendered in `timeZone` and in the reader's locale.
 *  Returns "" for a blank or unparseable stamp (the caller renders its own dash),
 *  never a fabricated date. */
export function formatAuditTime(iso: string | null | undefined, locale: string, timeZone: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  } catch {
    // An unknown zone id must not blank an audit column: fall back to the ISO
    // instant, which is unambiguous even though it is not localized.
    return iso.slice(0, 16).replace("T", " ") + "Z";
  }
}

/** UAT LUC-ANA-11 — every export leads with a provenance block and a blank
 *  separator row, then the table. An audit artifact that does not say who
 *  exported what, when, in which zone and under which filters cannot be attached
 *  to a filing: the recipient has no way to reproduce it. The blank row is what
 *  keeps the block from being read as data by a spreadsheet import. */
export function withExportProvenance(
  provenance: [string, string | number][],
  header: (string | number | null)[],
  body: (string | number | null)[][]
): (string | number | null)[][] {
  return [...provenance.map(([label, value]) => [label, value] as (string | number | null)[]), [], header, ...body];
}

/** Sealed-record kinds with NO pipeline-event twin, so `analytics.log.kinds.*`
 *  (which mirrors DECISION_META one-for-one, retired kinds included) cannot label
 *  them and `kindLabel` would fall back to the de-snaked raw token.
 *
 *  UAT LUC-ANA-9 — the records table rendered the English-only `labelize()` for
 *  both the column and its filter menu, so "Auto Rejected" sat under a Czech
 *  header. Every kind reachable by a seal call site is now either in DECISION_META
 *  (localized by the log's catalog) or here (localized by the records catalog);
 *  auditRow.test.ts walks the seal call sites and fails when a new one is neither. */
export const RECORD_ONLY_KINDS = [
  "group_eval_lead",
  "group_eval_advisory",
  "offer_terms",
  "ai_scorecard",
  "human_scorecard",
  "interview_cancelled",
  "interview_no_show",
  "interview_proposal_declined",
  "screening_threshold_adjusted",
] as const;

export type RecordOnlyKind = (typeof RECORD_ONLY_KINDS)[number];

const RECORD_ONLY_SET: ReadonlySet<string> = new Set(RECORD_ONLY_KINDS);

export function isRecordOnlyKind(kind: string): kind is RecordOnlyKind {
  return RECORD_ONLY_SET.has(kind);
}

/** The per-row fingerprint an auditor uses to tie a line on screen to a line in
 *  the export (Lucie: „Bez per-row fingerprintu nemám jak spojit řádek na
 *  obrazovce s řádkem v exportu."). Truncated for the row; the full hash stays in
 *  the cell's `title` and in every export. The idiom is the threshold strip's
 *  (AnalyticsThresholdHistoryStrip.tsx) — same length, same ellipsis. */
export function shortHash(hash: string): string {
  return `${hash.slice(0, 8)}…`;
}
