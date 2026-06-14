import { NextResponse } from "next/server";
import { listDecisionRecords, verifyDecisionChain } from "@/app/_lib/decision-record-store";
import { jsonError } from "@/app/_lib/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Decision System of Record (moonshot D) — read the sealed, hash-chained decision
// records (today: the auto-rejections sealed by screen-wave) plus a tamper-evidence
// verdict. `?candidate=<entryId>` scopes the list to one subject (the "right to
// explanation" dossier); the chain verdict is ALWAYS computed over the whole chain,
// since integrity is global — a tamper anywhere invalidates the proof everywhere.
// Read-only.
export async function GET(request: Request) {
  try {
    const candidate = new URL(request.url).searchParams.get("candidate");
    const records = listDecisionRecords(candidate ? { candidateRef: candidate } : undefined);
    const chain = verifyDecisionChain();
    return NextResponse.json({ records, chain });
  } catch (error) {
    return jsonError(error, "Failed to load decision records.");
  }
}
