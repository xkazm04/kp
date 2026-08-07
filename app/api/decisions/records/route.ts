import { NextResponse } from "next/server";
import { listDecisionRecords, verifyDecisionChain } from "@/app/_lib/decision-record-store";
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
    return NextResponse.json({ records, chain });
  } catch (error) {
    return jsonError(error, "Failed to load decision records.");
  }
}
