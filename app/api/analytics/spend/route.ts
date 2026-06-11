import { NextRequest, NextResponse } from "next/server";
import { setChannelSpend } from "@/app/_lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// E5 — recruiter-entered spend per inbound source channel (CZK), the
// denominator for the cost-per-applicant / cost-per-hire columns. A null (or
// non-positive) amount clears the figure.
const MAX_CHANNEL_LENGTH = 40;
const MAX_AMOUNT_CZK = 100_000_000; // sanity ceiling, not a business rule

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { channel?: unknown; amountCzk?: unknown };
    const channel = String(body.channel ?? "").trim();
    if (!channel || channel.length > MAX_CHANNEL_LENGTH) {
      return NextResponse.json({ error: "Invalid channel." }, { status: 400 });
    }
    const raw = body.amountCzk;
    const amount = raw == null || raw === "" ? null : Number(raw);
    if (amount !== null && (!Number.isFinite(amount) || amount < 0 || amount > MAX_AMOUNT_CZK)) {
      return NextResponse.json({ error: "Invalid amount." }, { status: 400 });
    }
    setChannelSpend(channel, amount);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save the spend." },
      { status: 500 }
    );
  }
}
