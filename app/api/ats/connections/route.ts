import { NextRequest, NextResponse } from "next/server";
import {
  ATS_PROVIDERS,
  AtsConnectionError,
  deleteAtsConnection,
  listAtsConnections,
  setAtsConnection,
} from "@/app/_lib/ats/connections-store";
import { AtsFieldMapError } from "@/app/_lib/ats/field-map";
import { deleteAtsLinksForProvider } from "@/app/_lib/ats/links-store";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";

// W1.1 — read / update / remove an INBOUND ATS connection (base URL, API token, field map).
// The GET never returns the token, only `hasToken` — see the secret doctrine in
// connections-store.ts.
//
// AUTHORIZATION — OPERATOR-only, for the same reason as its egress sibling
// (/api/ats/config) and then some: this endpoint holds a credential that can read EVERY
// candidate in the customer's ATS account, and the field map decides which of their fields
// become kp records. Authentication alone is not authorization here. Open mode (no
// KP_OPERATOR_PASSWORD) stays open for local dev.

export async function GET() {
  const denied = await requireOperator();
  if (denied) return denied;
  return NextResponse.json({ providers: ATS_PROVIDERS, connections: listAtsConnections() });
}

export async function POST(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    // Typed as the store's input rather than a bare Record so a renamed field is a
    // compile error here, not a silently-ignored key in the request body. Every value is
    // still `unknown` — the store validates, this route does not pre-trust.
    const body = (await request.json()) as {
      provider?: unknown;
      baseUrl?: unknown;
      apiToken?: unknown;
      fieldMap?: unknown;
      enabled?: unknown;
    };
    return NextResponse.json({ ok: true, connection: setAtsConnection({ ...body, provider: body.provider }) });
  } catch (error) {
    // Both validation errors are write-boundary refusals (a bad provider, an unsafe base
    // URL, a field map with no identity path) — 400, with the message, because every one
    // of them is something the operator can fix in the form.
    if (error instanceof AtsConnectionError || error instanceof AtsFieldMapError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[api/ats/connections] failed to save the connection", error);
    return NextResponse.json({ error: "Failed to save the connection." }, { status: 500 });
  }
}

/**
 * Remove a connection. `?forgetLinks=1` ALSO drops its external-id links.
 *
 * Deliberately opt-in and deliberately loud: forgetting the links means the next connect
 * re-imports every application as new, duplicating the pipeline. Keeping them means a
 * re-connect silently adopts bindings to entries that may since have been erased. Neither
 * is a safe default, so the caller states which one they want and the response reports how
 * many links were dropped.
 */
export async function DELETE(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  const { searchParams } = new URL(request.url);
  const provider = searchParams.get("provider") ?? "";
  if (!provider) return NextResponse.json({ error: "provider is required." }, { status: 400 });
  try {
    const removed = deleteAtsConnection(provider);
    if (!removed) return NextResponse.json({ error: "no such connection." }, { status: 404 });
    const forget = searchParams.get("forgetLinks") === "1";
    const linksDropped = forget ? deleteAtsLinksForProvider(provider, await currentWorkspace()) : 0;
    return NextResponse.json({ ok: true, linksDropped, linksKept: !forget });
  } catch (error) {
    console.error("[api/ats/connections] failed to remove the connection", error);
    return NextResponse.json({ error: "Failed to remove the connection." }, { status: 500 });
  }
}
