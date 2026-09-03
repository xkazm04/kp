import { NextRequest, NextResponse } from "next/server";
import { setChannelSpend } from "@/app/_lib/db/channels";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { can } from "@/app/_lib/auth/current-user";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";


// E5 — recruiter-entered spend per inbound source channel (CZK), the
// denominator for the cost-per-applicant / cost-per-hire columns. A null (or
// non-positive) amount clears the figure.
//
// UAT KAT-ANA-2 — this route is the ONLY door to `channel_spend`: one client
// (AnalyticsChannelSpendInput's SpendInput, rendered by the Economics board), one
// writer (setChannelSpend), no seeder. It is therefore load-bearing in a way its size
// hides — when its single client stopped being rendered, cost-per-hire silently became
// un-enterable and un-correctable everywhere while the stale figure kept displaying.
// The chain is pinned by app/features/insights/analytics/spend-write-path.test.ts;
// this route having no callers is a product outage, not dead code.
//
// AUTHORITY (2026-09-03). This route had NO gate at all — not even the session check
// its siblings carry — so on a gated deploy any valid cookie, at any role, could
// rewrite the denominator every cost-per-hire figure in the metric pack is divided by.
// Two gates now: `requireOperator` for "is there a real session" (401), then
// `pipeline:write` for "may this seat run recruiter operations" (403 with a code, so
// the board can say why in the reader's language). A `viewer` holds `read` only.
const MAX_CHANNEL_LENGTH = 40;
const MAX_AMOUNT_CZK = 100_000_000; // sanity ceiling, not a business rule

export async function POST(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  if (!(await can("pipeline:write"))) return jsonRefusal("ANALYTICS_POLICY_FORBIDDEN", 403);
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
    setChannelSpend(channel, amount, await currentWorkspace());
    return NextResponse.json({ ok: true });
  } catch (error) {
    // setChannelSpend writes straight through better-sqlite3; its thrown message
    // carries constraint text and the absolute db path.
    return safeJsonError(error, "api:analytics/spend", "ANALYTICS_SPEND_SAVE_FAILED");
  }
}
