import { NextRequest, NextResponse } from "next/server";
import { getAtsRecord } from "@/app/_lib/ats-egress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// P1-5 — the SCOPED, ATS-portable export for ONE candidate (the honest counterpart
// to the whole-DB dump). A connector / iPaaS pulls the normalized record by entry
// id and maps it into the customer's system of record. 404 when the entry is gone.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = getAtsRecord(id);
  if (!record) {
    return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
  }
  return NextResponse.json(record);
}
