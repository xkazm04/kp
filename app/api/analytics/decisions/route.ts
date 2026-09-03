import { NextResponse } from "next/server";
import {
  countPipelineEvents,
  isPipelineEventSortColumn,
  listPipelineEvents,
  listPipeline,
  hasEvent,
  type PipelineEvent,
} from "@/app/_lib/db/pipeline";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { listDecisionRecordsForRefs } from "@/app/_lib/decision-record-store";
import {
  GROUP_EVAL_EVENT_KIND,
  GROUP_EVAL_OUTCOME_KINDS,
  matchCohortProvenance,
  parseRematchCounterpartId,
  resolveDecisionKindFilter,
  sealedReasonOf,
  type CohortProvenance,
  type SealedReason,
} from "@/app/_lib/decision-attribution";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/locales";
import {
  compareDecisions,
  matchesSubject,
  type SubjectScan,
} from "@/app/features/insights/analytics/analyticsDecisionLogTypes";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";


// THROTTLE (2026-09-03). The `?q=` path abandons SQL paging and refines IN THIS
// HANDLER: it pulls up to MAX_SUBJECT_SCAN rows, folds diacritics on every one and
// collates with Intl - per request, per keystroke a client cares to send. 120/10min
// per IP is generous by design (the log pages 20 at a time on scroll, and a recruiter
// working a long trail legitimately chains pages) while pinning a scripted scan.
const DECISION_LOG_RATE_LIMIT = { limit: 120, windowMs: 10 * 60_000 };
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// UAT LUC-ANA-5 — the two orderings/lookups SQLite cannot give us, and the bound
// on doing them here instead.
//
// `candidate_label`/`job_title` sort under the BINARY collation, i.e. UTF-8 byte
// order, which files every Czech diacritic surname AFTER Z (Čermák, Řezníčková,
// Šimková, Žák all land past Zeman); and there is no name LOOKUP at all, so the
// only way to find a subject was to page. Both are fixed by refining IN THIS
// HANDLER with Intl collation and a diacritic-folded substring match — the store
// stays untouched, so no other reader inherits a new ORDER BY.
//
// G4 holds: this is a SCAN bound, not a date window. The unfiltered trail is still
// paged in full and never truncated; only a subject search or a text ordering
// reads ahead, and when the trail is longer than the bound the response SAYS so
// (`subjectScan.capped`) so the surface can refuse to claim a whole-trail search
// it did not run. The scan reads newest-first, so a capped scan is describable:
// "the most recent 5,000 decisions", not an arbitrary byte-ordered slice.
const SUBJECT_REFINE_MAX = 5_000;
const MAX_SUBJECT_QUERY = 80;

// Parse an offset/limit query param defensively: a missing, non-numeric, or
// out-of-range value falls back to a safe default rather than letting a bad
// client param page off the end or pull the whole table in one request.
function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

// ANA5 — ?kind= / ?attribution= are resolved to ONE kind set by
// resolveDecisionKindFilter (decision-attribution.ts, beside the map it reads and
// unit-pinned there). UAT LUC-ANA-12: the two filters INTERSECT. This handler used to
// read `if (kind) … else if (attribution)` inline, so a kind filter silently discarded
// the attribution filter while ColumnFilter kept that column's active dot lit — on an
// audit screen a filter that claims to filter and doesn't is worse than no filter.
// The attribution bucket is derived from DECISION_META (36 auto / 26 human today, both
// under the store's 64-value IN cap).

// The wire shape of one enriched log row — a PipelineEvent plus the three sealed-record
// joins (log-tells-the-whole-story). Each join is optional and only present when a
// reliable match exists, so a row the data can't back shows nothing (never guesses).
type EnrichedEvent = PipelineEvent & {
  cohort?: CohortProvenance | null; // group-eval cohort provenance (advance rows)
  reason?: SealedReason | null; // sealed structured reason (auto_rejected rows)
  counterpart?: { label: string } | null; // rematch counterpart, resolved to a live board entry
};

const REMATCH_KINDS: ReadonlySet<string> = new Set(["rematched", "rematched_from"]);

// Join one page of log rows to the sealed decision-record store, PER PAGE (never a
// workspace scan): at most one records read per distinct candidate on the page (≤ page
// size) and, only when the page has a rematch row, one board read to resolve
// counterparts to a linkable label. All three joins are additive views over the sealed
// chain — the hash-verified records themselves are never touched.
function enrichPage(rows: PipelineEvent[], workspaceId: string): EnrichedEvent[] {
  // Refs whose records we actually need: a group_eval event (the DIRECT anchor), a
  // group-eval advance outcome (the fallback join), or an auto-reject.
  const needsRecords = new Set<string>();
  // Advance-outcome refs — the subset we must check for a direct group_eval anchor.
  const advanceRefs = new Set<string>();
  let hasRematch = false;
  for (const r of rows) {
    if (r.entryId && (r.kind === GROUP_EVAL_EVENT_KIND || GROUP_EVAL_OUTCOME_KINDS.has(r.kind) || r.kind === "auto_rejected")) {
      needsRecords.add(r.entryId);
    }
    if (r.entryId && GROUP_EVAL_OUTCOME_KINDS.has(r.kind)) advanceRefs.add(r.entryId);
    if (r.entryId && REMATCH_KINDS.has(r.kind)) hasRematch = true;
  }
  // decision-io-diet: one chunked read for every ref the page needs, replacing the
  // per-ref SELECT loop (≤ page size queries per load). Per-ref semantics unchanged.
  const recordsByRef = listDecisionRecordsForRefs([...needsRecords], { workspaceId, limit: 20 });
  // group-eval-event-anchor precedence: an advance row whose entry HAS a group_eval event
  // is directly anchored (the group_eval row carries the chip), so the advance row must NOT
  // window-join. hasEvent is an indexed existence probe, bounded by the advance-refs on this
  // page. Refs without a group_eval event (pre-existing data) still fall back to the window.
  const directAnchored = new Set<string>();
  for (const ref of advanceRefs) {
    if (hasEvent(ref, GROUP_EVAL_EVENT_KIND, workspaceId)) directAnchored.add(ref);
  }
  // Counterpart resolution reuses the records-panel idiom: entry id → live board label,
  // so the deep-link uses the board's ?q=<label> search (which matches on label, not id).
  // A counterpart that no longer resolves (records outlive entries) stays plain text.
  const liveLabels = hasRematch ? new Map(listPipeline(workspaceId).map((e) => [e.id, e.candidateLabel])) : null;

  return rows.map((r): EnrichedEvent => {
    if (!r.entryId) return r;
    const records = recordsByRef.get(r.entryId);
    // The DIRECT anchor: the group_eval event's own seal moment resolves the cohort at a
    // ~0-delta match — no time-window guessing. Covers advisory/committee runs (no advance).
    if (r.kind === GROUP_EVAL_EVENT_KIND && records) {
      const cohort = matchCohortProvenance(r.createdAt, records);
      if (cohort) return { ...r, cohort };
    }
    // The FALLBACK join for an advance outcome — ONLY when the entry has no direct group_eval
    // event anchoring it (pre-existing data). See the precedence note in decision-attribution.
    if (GROUP_EVAL_OUTCOME_KINDS.has(r.kind) && records && !directAnchored.has(r.entryId)) {
      const cohort = matchCohortProvenance(r.createdAt, records);
      if (cohort) return { ...r, cohort };
    }
    if (r.kind === "auto_rejected" && records) {
      const reason = sealedReasonOf(records, "auto_rejected");
      if (reason) return { ...r, reason };
    }
    if (REMATCH_KINDS.has(r.kind) && liveLabels) {
      const counterpartId = parseRematchCounterpartId(r.kind, r.detail);
      const label = counterpartId ? liveLabels.get(counterpartId) : undefined;
      if (label != null) return { ...r, counterpart: { label } };
    }
    return r;
  });
}

// Cursor-by-offset page of the decision log. The analytics tab loads this 20 at
// a time on scroll so the full audit trail is never pulled into the client at
// once. `hasMore`/`nextOffset` let the client chain pages without re-deriving
// the math, and `total` powers the "showing X of Y" footer.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = clampInt(searchParams.get("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT);
    const offset = clampInt(searchParams.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
    const filter = resolveDecisionKindFilter(searchParams.get("kind"), searchParams.get("attribution"));
    // Sorting is SERVER-side because the log is server-paged: a client comparator
    // would reorder only the 20 rows already on screen while looking like it had
    // ranked the whole trail. Unknown/absent column → the default newest-first,
    // and the column itself is allowlisted in the store (it lands in ORDER BY,
    // where a binding cannot stand in for an identifier).
    const sortParam = searchParams.get("sort");
    const sort = isPipelineEventSortColumn(sortParam)
      ? ({ col: sortParam, dir: searchParams.get("dir") === "asc" ? "asc" : "desc" } as const)
      : undefined;
    // P1 — the decision log is a per-team audit trail; scope both the count and
    // the page to the caller's workspace (previously unscoped → every team saw
    // the default workspace's trail).
    const ws = await currentWorkspace();
    // A contradictory kind × attribution pair selects nothing. Answering it here keeps
    // the store's "empty list = unfiltered" convention from turning "no rows match" into
    // "here is the whole trail" (UAT LUC-ANA-12).
    if (filter.matchesNothing) {
      return NextResponse.json({ decisions: [], total: 0, hasMore: false, nextOffset: offset });
    }
    // After the cheap refusal above: a contradictory filter selects nothing and costs
    // no budget. Everything past this line reads the trail.
    if (!rateLimit(`decision-log:${clientIpFrom(request.headers)}`, DECISION_LOG_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    const trailTotal = countPipelineEvents(filter.kinds, ws);

    // UAT LUC-ANA-5 — the refined path: a subject search, or an ordering by a text
    // column whose SQL collation is byte order. Everything else stays SQL-paged.
    const query = (searchParams.get("q") ?? "").trim().slice(0, MAX_SUBJECT_QUERY);
    const localeParam = searchParams.get("locale");
    const locale = isLocale(localeParam) ? localeParam : DEFAULT_LOCALE;
    if (query || sort?.col === "candidateLabel" || sort?.col === "jobTitle") {
      const scanned = Math.min(trailTotal, SUBJECT_REFINE_MAX);
      // Read newest-first (NOT in the requested order): a capped scan is then the
      // most recent N decisions, a scope that can be printed. Scanning in the
      // requested order would cap on the byte-ordered head, which is the exact
      // ordering this path exists to distrust.
      const scan = listPipelineEvents(scanned, 0, filter.kinds, ws);
      const matched = query ? scan.filter((e) => matchesSubject(e.candidateLabel, query)) : scan;
      if (sort) matched.sort((a, b) => compareDecisions(a, b, sort.col, sort.dir, locale));
      const subjectScan: SubjectScan = { capped: trailTotal > SUBJECT_REFINE_MAX, scanned, trailTotal, cap: SUBJECT_REFINE_MAX };
      const page = enrichPage(matched.slice(offset, offset + limit), ws);
      const nextOffset = offset + page.length;
      // `total` is the size of the REFINED result set — what the pager pages and
      // what the header counts. `subjectScan.trailTotal` keeps the whole trail's
      // size beside it, so neither number has to stand in for the other.
      return NextResponse.json({ decisions: page, total: matched.length, hasMore: nextOffset < matched.length, nextOffset, subjectScan });
    }

    // log-tells-the-whole-story: enrich the page with the sealed-record joins (cohort
    // provenance, auto-reject reason, rematch counterpart link) before returning it.
    const decisions = enrichPage(listPipelineEvents(limit, offset, filter.kinds, ws, sort), ws);
    const nextOffset = offset + decisions.length;
    return NextResponse.json({ decisions, total: trailTotal, hasMore: nextOffset < trailTotal, nextOffset });
  } catch (error) {
    // Two full-table reads plus the sealed-record joins, all over the store's own
    // connection: a constraint string or the db path was reaching the analytics tab.
    return safeJsonError(error, "api:analytics/decisions", "DECISION_LOG_LOAD_FAILED");
  }
}
