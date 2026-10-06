import { NextResponse } from "next/server";
import { pairEdge } from "@/app/_lib/edge-drain";
import { assertEdgeWritableBy, EdgeOwnershipError, getEdgeConfig } from "@/app/_lib/edge-config";
import { jsonRefusal, requireCapabilityCoded } from "@/app/_lib/api-response";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { currentSession, requireOrgCapability } from "@/app/_lib/auth/current-user";
import { currentOrgId } from "@/app/_lib/auth/session";
import { DEFAULT_ORG_ID } from "@/app/_lib/db/organizations";

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
  // F-3 — and it is an org-administration act on ONE organization's pairing. `org:manage`
  // is held per org, so without this any org's owner could re-key the install another org
  // paired. Checked BEFORE pairEdge, which mints this install's sealing keypair (never
  // rotated) and fetches the edge: the caller's org is read from the session, and open mode
  // (no operator password, no session) is the single default org by definition.
  try {
    assertEdgeWritableBy(currentOrgId(await currentSession()) ?? DEFAULT_ORG_ID);
  } catch (error) {
    if (error instanceof EdgeOwnershipError) {
      console.error("[api:edge:pair] EDGE_OWNED_BY_OTHER_ORG", error.message);
      return jsonRefusal("EDGE_OWNED_BY_OTHER_ORG", 403);
    }
    throw error;
  }
  const result = await pairEdge();
  // `result.error` is a diagnostic ("HTTP 502", "no edge configured"), not a sentence:
  // it goes to the log and the reader gets the code, resolved in their language.
  if (!result.ok) {
    console.error("[api:edge:pair] EDGE_PAIR_REFUSED", result.error);
    return jsonRefusal("EDGE_PAIR_REFUSED", 400);
  }
  return NextResponse.json({ ok: true, config: getEdgeConfig() });
}
