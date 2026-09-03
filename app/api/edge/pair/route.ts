import { NextResponse } from "next/server";
import { pairEdge } from "@/app/_lib/edge-drain";
import { getEdgeConfig } from "@/app/_lib/edge-config";
import { jsonRefusal, requireCapabilityCoded } from "@/app/_lib/api-response";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireOrgCapability } from "@/app/_lib/auth/current-user";

// Publish this install's sealing key so the edge can hold event bodies it cannot
// read. One-way and idempotent (see pairEdge): the keypair is never rotated, because
// rotating it would orphan every event already sealed to the old key.
export async function POST() {
  const denied = await requireOperator();
  if (denied) return denied;
  // AUTHORIZATION (write-routes-check-a-capability). requireOperator above proves a
  // session, not authority. This door rewrites INSTALLATION-level configuration,
  // so it is an org-administration act: `org:manage`, resolved org-wide, which
  // recruiters and viewers do not hold.
  const under = await requireCapabilityCoded("org:manage", requireOrgCapability);
  if (under) return under;
  const result = await pairEdge();
  // `result.error` is a diagnostic ("HTTP 502", "no edge configured"), not a sentence:
  // it goes to the log and the reader gets the code, resolved in their language.
  if (!result.ok) {
    console.error("[api:edge:pair] EDGE_PAIR_REFUSED", result.error);
    return jsonRefusal("EDGE_PAIR_REFUSED", 400);
  }
  return NextResponse.json({ ok: true, config: getEdgeConfig() });
}
