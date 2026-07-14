import { NextResponse } from "next/server";
import { listDecisionRecords, verifyDecisionChain } from "@/app/_lib/decision-record-store";
import { listPipeline } from "@/app/_lib/db";
import { jsonError } from "@/app/_lib/api-response";
import { requireOperator } from "@/app/_lib/auth/require-operator";


// Decision System of Record (moonshot D) — read the sealed, hash-chained decision
// records (today: the auto-rejections sealed by screen-wave) plus a tamper-evidence
// verdict. `?candidate=<entryId>` scopes the list to one subject (the "right to
// explanation" dossier); the chain verdict is ALWAYS computed over the whole chain,
// since integrity is global — a tamper anywhere invalidates the proof everywhere.
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
    const candidate = new URL(request.url).searchParams.get("candidate");
    const records = listDecisionRecords(candidate ? { candidateRef: candidate } : undefined);
    const chain = verifyDecisionChain();
    // Direction 2 — resolve each record's candidateRef (a pipeline entry id) to a
    // live board entry so the panel can deep-link it. A record OUTLIVES its entry
    // (records are permanent, entries are archived/deleted) and some refs are
    // policy-level, so a ref that no longer resolves stays plain text. The sealed
    // record shape is untouched — this is a parallel view map only, so the
    // hash-verified `records` are byte-for-byte what they were sealed as.
    const live = new Map(listPipeline().map((e) => [e.id, e.candidateLabel]));
    const resolved: Record<string, { label: string; live: boolean }> = {};
    for (const r of records) {
      if (resolved[r.candidateRef]) continue;
      const label = live.get(r.candidateRef);
      if (label != null) resolved[r.candidateRef] = { label, live: true };
    }
    return NextResponse.json({ records, chain, resolved });
  } catch (error) {
    return jsonError(error, "Failed to load decision records.");
  }
}
