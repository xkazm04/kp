import { NextResponse } from "next/server";
import { countPipelineEvents, listPipelineEvents, listPipeline, type PipelineEvent } from "@/app/_lib/db";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { listDecisionRecordsForRefs } from "@/app/_lib/decision-record-store";
import {
  DECISION_META,
  GROUP_EVAL_OUTCOME_KINDS,
  matchCohortProvenance,
  parseRematchCounterpartId,
  sealedReasonOf,
  type CohortProvenance,
  type SealedReason,
} from "@/app/_lib/decision-attribution";


const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// Parse an offset/limit query param defensively: a missing, non-numeric, or
// out-of-range value falls back to a safe default rather than letting a bad
// client param page off the end or pull the whole table in one request.
function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

// ANA5 — resolve the optional ?kind=/?attribution= params to a kind set, both
// allow-listed against the shared decision-attribution map (an invalid value
// falls back to unfiltered, never an error). A specific kind wins over the
// broader attribution bucket when both are sent.
function resolveKindFilter(kindRaw: string | null, attributionRaw: string | null): string[] | undefined {
  if (kindRaw && kindRaw in DECISION_META) return [kindRaw];
  if (attributionRaw === "auto" || attributionRaw === "human") {
    return Object.entries(DECISION_META)
      .filter(([, meta]) => meta.auto === (attributionRaw === "auto"))
      .map(([kind]) => kind);
  }
  return undefined;
}

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
  // Refs whose records we actually need: a group-eval advance outcome, or an auto-reject.
  const needsRecords = new Set<string>();
  let hasRematch = false;
  for (const r of rows) {
    if (r.entryId && (GROUP_EVAL_OUTCOME_KINDS.has(r.kind) || r.kind === "auto_rejected")) needsRecords.add(r.entryId);
    if (r.entryId && REMATCH_KINDS.has(r.kind)) hasRematch = true;
  }
  // decision-io-diet: one chunked read for every ref the page needs, replacing the
  // per-ref SELECT loop (≤ page size queries per load). Per-ref semantics unchanged.
  const recordsByRef = listDecisionRecordsForRefs([...needsRecords], { workspaceId, limit: 20 });
  // Counterpart resolution reuses the records-panel idiom: entry id → live board label,
  // so the deep-link uses the board's ?q=<label> search (which matches on label, not id).
  // A counterpart that no longer resolves (records outlive entries) stays plain text.
  const liveLabels = hasRematch ? new Map(listPipeline(workspaceId).map((e) => [e.id, e.candidateLabel])) : null;

  return rows.map((r): EnrichedEvent => {
    if (!r.entryId) return r;
    const records = recordsByRef.get(r.entryId);
    if (GROUP_EVAL_OUTCOME_KINDS.has(r.kind) && records) {
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
    const kinds = resolveKindFilter(searchParams.get("kind"), searchParams.get("attribution"));
    // P1 — the decision log is a per-team audit trail; scope both the count and
    // the page to the caller's workspace (previously unscoped → every team saw
    // the default workspace's trail).
    const ws = await currentWorkspace();
    const total = countPipelineEvents(kinds, ws);
    // log-tells-the-whole-story: enrich the page with the sealed-record joins (cohort
    // provenance, auto-reject reason, rematch counterpart link) before returning it.
    const decisions = enrichPage(listPipelineEvents(limit, offset, kinds, ws), ws);
    const nextOffset = offset + decisions.length;
    return NextResponse.json({ decisions, total, hasMore: nextOffset < total, nextOffset });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load the decision log.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
