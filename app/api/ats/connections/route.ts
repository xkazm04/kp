import { NextRequest, NextResponse } from "next/server";
import {
  ATS_PROVIDERS,
  AtsConnectionError,
  AtsConnectionStaleError,
  deleteAtsConnection,
  getAtsConnection,
  listAtsConnections,
  setAtsConnection,
} from "@/app/_lib/ats/connections-store";
import { AtsFieldMapError } from "@/app/_lib/ats/field-map";
import { deleteAtsLinksForProviderEverywhere } from "@/app/_lib/ats/links-store";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireOrgCapability } from "@/app/_lib/auth/current-user";
import { jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { BODY_TOO_LARGE, readJsonWithLimit } from "@/app/_lib/request-body";

// A connection body is a provider name, two short strings and a field map. The map is the
// only part that can grow - one dot path per mappable field plus a stage map - and 32 KB
// is orders of magnitude more than any real one, while still refusing a body sent purely
// to make the server hold it. Measured on the bytes read, not on content-length.
const MAX_CONNECTION_BODY_BYTES = 32 * 1024;

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
  // AUTHORIZATION (write-routes-check-a-capability). requireOperator above proves a
  // session, not authority. This door rewrites INSTALLATION-level configuration,
  // so it is an org-administration act: `org:manage`, resolved org-wide, which
  // recruiters and viewers do not hold.
  const under = await requireCapabilityCoded("org:manage", requireOrgCapability);
  if (under) return under;
  // Typed as the store's input rather than a bare Record so a renamed field is a compile
  // error here, not a silently-ignored key in the request body. Every value is still
  // `unknown` — the store validates, this route does not pre-trust.
  const body = await readJsonWithLimit<{
    provider?: unknown;
    baseUrl?: unknown;
    apiToken?: unknown;
    fieldMap?: unknown;
    enabled?: unknown;
    expectedVersion?: unknown;
  }>(request, MAX_CONNECTION_BODY_BYTES, {});
  if (body === BODY_TOO_LARGE) return jsonRefusal("PAYLOAD_TOO_LARGE", 413, { maxBytes: MAX_CONNECTION_BODY_BYTES });
  try {
    return NextResponse.json({ ok: true, connection: setAtsConnection({ ...body, provider: body.provider }) });
  } catch (error) {
    // Checked FIRST: a stale write subclasses AtsConnectionError, and it is a refusal
    // (409, nothing written), not a validation failure. The CURRENT connection rides along
    // so the panel can offer "reload and re-apply" against what is actually stored — the
    // same shape /api/ats/config answers with next door.
    if (error instanceof AtsConnectionStaleError) {
      return jsonRefusal("ATS_CONNECTION_STALE", 409, {
        connection: typeof body.provider === "string" ? getAtsConnection(body.provider) : null,
      });
    }
    // The validation refusals (a bad provider, an unsafe base URL, an unstorable token, a
    // field map with no identity path) are 400s the operator can fix in the form — but
    // this used to forward the thrown MESSAGE, canonical English into a four-locale panel.
    // The store and the field-map parser carry the code now; the message stays in the log.
    if (error instanceof AtsConnectionError || error instanceof AtsFieldMapError) {
      console.info(`[api/ats/connections] refused (${error.code}): ${error.message}`);
      return jsonRefusal(error.code, 400);
    }
    // A thrown better-sqlite3 / crypto error carries the db path and internal detail: it
    // goes to the server log, and the client gets the code it renders in its own language.
    return safeJsonError(error, "api:ats/connections", "ATS_CONNECTION_SAVE_FAILED");
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
 *
 * The drop is ORG-WIDE. `ats_connections` is keyed by provider alone — one installation,
 * one credential per ATS — while `ats_links` is per-tenant, so scoping the drop to the
 * caller's workspace (which this did) forgot their own links, left every OTHER workspace
 * bound to a provider whose credential no longer exists, and reported a count that only
 * covered one team. An installation-level delete owes an installation-level cleanup.
 */
export async function DELETE(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  // AUTHORIZATION (write-routes-check-a-capability). requireOperator above proves a
  // session, not authority. This door rewrites INSTALLATION-level configuration,
  // so it is an org-administration act: `org:manage`, resolved org-wide, which
  // recruiters and viewers do not hold.
  const under = await requireCapabilityCoded("org:manage", requireOrgCapability);
  if (under) return under;
  const { searchParams } = new URL(request.url);
  const provider = searchParams.get("provider") ?? "";
  // An absent provider and an unknown one are the same caller mistake with the same fix
  // ("pick a provider from the list"), so they share one code rather than answering an
  // English sentence each.
  if (!provider) return jsonRefusal("ATS_CONNECTION_PROVIDER_UNKNOWN", 400);
  try {
    const removed = deleteAtsConnection(provider);
    if (!removed) return jsonRefusal("ATS_CONNECTION_NOT_FOUND", 404);
    const forget = searchParams.get("forgetLinks") === "1";
    const linksDropped = forget ? deleteAtsLinksForProviderEverywhere(provider) : 0;
    return NextResponse.json({ ok: true, linksDropped, linksKept: !forget });
  } catch (error) {
    return safeJsonError(error, "api:ats/connections", "ATS_CONNECTION_REMOVE_FAILED");
  }
}
