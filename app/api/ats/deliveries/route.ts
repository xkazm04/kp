import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { jsonRefusal } from "@/app/_lib/api-response";
import { BODY_TOO_LARGE, readJsonWithLimit } from "@/app/_lib/request-body";
import {
  countDeadAtsDeliveries,
  listAtsDeliveries,
  listDueAtsDeliveries,
  requeueAtsDelivery,
} from "@/app/_lib/ats-delivery-store";
import { retryDueAtsDeliveries } from "@/app/_lib/ats-egress";

// P1-5 (reliability) — operator visibility + replay for the outbound-webhook
// delivery ledger. GET lists recent deliveries, the count currently due for retry,
// and the dead-letter count (failed + no next attempt). POST with an omitted body
// flushes every due retry now; POST { replayId } force-requeues one terminal row
// then runs the same sweep, so a hire that exhausted the ladder is recoverable
// without editing SQLite. Both OPERATOR-only (same gate as the rest of the ATS
// admin surface). An external cron can POST here on a timer to drain the queue
// between operator visits.
const MAX_DELIVERIES_BODY_BYTES = 4 * 1024;

export async function GET() {
  const denied = await requireOperator();
  if (denied) return denied;
  return NextResponse.json({
    deliveries: listAtsDeliveries(),
    due: listDueAtsDeliveries().length,
    dead: countDeadAtsDeliveries(),
  });
}

export async function POST(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  const body = await readJsonWithLimit<{ replayId?: unknown }>(request, MAX_DELIVERIES_BODY_BYTES, {});
  if (body === BODY_TOO_LARGE) {
    return jsonRefusal("PAYLOAD_TOO_LARGE", 413, { maxBytes: MAX_DELIVERIES_BODY_BYTES });
  }
  if (body.replayId !== undefined) {
    const id = typeof body.replayId === "number" ? body.replayId : Number(body.replayId);
    if (!Number.isInteger(id) || id < 1) return jsonRefusal("ATS_DELIVERY_NOT_FOUND", 404);
    const outcome = requeueAtsDelivery(id);
    if (outcome === "not-found") return jsonRefusal("ATS_DELIVERY_NOT_FOUND", 404);
    if (outcome === "not-replayable") return jsonRefusal("ATS_DELIVERY_NOT_REPLAYABLE", 409);
  }
  const result = await retryDueAtsDeliveries();
  return NextResponse.json({ ok: true, ...result });
}
