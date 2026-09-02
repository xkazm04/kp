import { NextResponse } from "next/server";
import { pairEdge } from "@/app/_lib/edge-drain";
import { getEdgeConfig } from "@/app/_lib/edge-config";
import { jsonRefusal } from "@/app/_lib/api-response";
import { requireOperator } from "@/app/_lib/auth/require-operator";

// Publish this install's sealing key so the edge can hold event bodies it cannot
// read. One-way and idempotent (see pairEdge): the keypair is never rotated, because
// rotating it would orphan every event already sealed to the old key.
export async function POST() {
  const denied = await requireOperator();
  if (denied) return denied;
  const result = await pairEdge();
  // `result.error` is a diagnostic ("HTTP 502", "no edge configured"), not a sentence:
  // it goes to the log and the reader gets the code, resolved in their language.
  if (!result.ok) {
    console.error("[api:edge:pair] EDGE_PAIR_REFUSED", result.error);
    return jsonRefusal("EDGE_PAIR_REFUSED", 400);
  }
  return NextResponse.json({ ok: true, config: getEdgeConfig() });
}
