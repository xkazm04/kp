import { NextResponse } from "next/server";
import { listDecisionRecords, verifyDecisionChain } from "@/app/_lib/decision-record-store";
import { listPipeline } from "@/app/_lib/db";
import { jsonError } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { createTtlCache, decisionRecordsCacheKey } from "@/app/_lib/analytics-cache";


// Short-TTL per-(workspace, candidate) memo. WITHOUT it every panel mount re-verifies
// the WHOLE HMAC chain (verifyDecisionChain) and rebuilds the live-board resolver map
// (listPipeline) from scratch. Module-scoped; keyed workspace-first so one team's
// records/verdict NEVER cross to another, and candidate-scoped so the ?candidate dossier
// never poisons the full-list view. Short TTL (see analytics-cache.ts) → no write-path
// invalidation. NOTE the security trade-off: the chain-verification verdict is cached
// within the same TTL, so a tamper introduced mid-TTL surfaces on the next read past the
// ttl (~20s) rather than instantly — an accepted lag (the sealed chain is immutable; only
// the freshness of the verdict is bounded).
const recordsCache = createTtlCache<Record<string, unknown>>();

// Decision System of Record (moonshot D) — read the sealed, hash-chained decision
// records (today: the auto-rejections sealed by screen-wave) plus a tamper-evidence
// verdict. `?candidate=<entryId>` scopes the list to one subject (the "right to
// explanation" dossier). Tenant (P1): integrity is PER-TENANT — each team has its own
// independent chain (org plan §6), so the list, the verify verdict, and the live-board
// resolver are all scoped to the caller's workspace; a tamper in one team's chain
// invalidates only that team's proof, and one team never sees another's records.
// Read-only.
//
// OPERATOR-GATED (backlog #30 / SD-L1-010): the sealed chain carries real
// candidate refs and adverse-action rationales, so the handler re-verifies the
// operator session like /api/automation/* — proxy.ts already keeps this path off
// the public allow-list, and requireOperator additionally rejects the anonymous
// demo-workspace session the proxy would wave through. Candidates never call
// this route: their flows run on their own public token surfaces
// (/api/status/[token], /api/data/[token], /api/offer/[token]).
export async function GET(request: Request) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const ws = await currentWorkspace();
    const candidate = new URL(request.url).searchParams.get("candidate");
    const payload = recordsCache.get(decisionRecordsCacheKey(ws, candidate), () => {
      const records = listDecisionRecords(candidate ? { candidateRef: candidate, workspaceId: ws } : { workspaceId: ws });
      const chain = verifyDecisionChain(ws);
      // Direction 2 — resolve each record's candidateRef (a pipeline entry id) to a
      // live board entry so the panel can deep-link it. A record OUTLIVES its entry
      // (records are permanent, entries are archived/deleted) and some refs are
      // policy-level, so a ref that no longer resolves stays plain text. The sealed
      // record shape is untouched — this is a parallel view map only, so the
      // hash-verified `records` are byte-for-byte what they were sealed as.
      const live = new Map(listPipeline(ws).map((e) => [e.id, e.candidateLabel]));
      const resolved: Record<string, { label: string; live: boolean }> = {};
      for (const r of records) {
        if (resolved[r.candidateRef]) continue;
        const label = live.get(r.candidateRef);
        if (label != null) resolved[r.candidateRef] = { label, live: true };
      }
      return { records, chain, resolved };
    });
    return NextResponse.json(payload);
  } catch (error) {
    return jsonError(error, "Failed to load decision records.");
  }
}
