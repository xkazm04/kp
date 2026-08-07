import { NextResponse } from "next/server";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { listAtsDeliveries, listDueAtsDeliveries } from "@/app/_lib/ats-delivery-store";
import { retryDueAtsDeliveries } from "@/app/_lib/ats-egress";

// P1-5 (reliability) — operator visibility + replay for the outbound-webhook
// delivery ledger. GET lists recent deliveries and the count currently due for
// retry (the dead-letter view); POST flushes every due retry now. Both OPERATOR-only
// (same gate as the rest of the ATS admin surface). An external cron can POST here on
// a timer to drain the queue between operator visits.
export async function GET() {
  const denied = await requireOperator();
  if (denied) return denied;
  return NextResponse.json({ deliveries: listAtsDeliveries(), due: listDueAtsDeliveries().length });
}

export async function POST() {
  const denied = await requireOperator();
  if (denied) return denied;
  const result = await retryDueAtsDeliveries();
  return NextResponse.json({ ok: true, ...result });
}
