import { NextResponse } from "next/server";
import { pairEdge } from "@/app/_lib/edge-drain";
import { getEdgeConfig } from "@/app/_lib/edge-config";
import { requireOperator } from "@/app/_lib/auth/require-operator";

// Publish this install's sealing key so the edge can hold event bodies it cannot
// read. One-way and idempotent (see pairEdge): the keypair is never rotated, because
// rotating it would orphan every event already sealed to the old key.
export async function POST() {
  const denied = await requireOperator();
  if (denied) return denied;
  const result = await pairEdge();
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, config: getEdgeConfig() });
}
