import { NextRequest, NextResponse } from "next/server";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { withWorkspace } from "@/app/_lib/auth/workspace-context";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireOrgCapability } from "@/app/_lib/auth/current-user";
import { jsonRefusal, requireCapabilityCoded } from "@/app/_lib/api-response";
import { BODY_TOO_LARGE, readJsonWithLimit } from "@/app/_lib/request-body";
import { ensureCalendarSecretKey } from "@/app/_lib/calendar/calendar-key";
import { GOOGLE_CALENDAR_SCOPES, GOOGLE_OAUTH_CALLBACK_PATH, googleOAuthConfig } from "@/app/_lib/calendar/google-oauth";
import {
  GoogleClientInputError,
  GoogleClientKeyError,
  getStoredGoogleClient,
  getStoredGoogleClientStatus,
  saveGoogleClient,
} from "@/app/_lib/calendar/google-client-store";

// T8 — the guided Google Calendar setup's door: read whether an OAuth client is configured,
// and save one the owner created in the Google Cloud console, with no env edit and no
// restart. The secret is WRITE-ONLY: no response, log line or error ever carries it. The
// GET answers configured yes/no, where the client comes from, and the client id (which is
// public by design: Google puts it in every consent URL).

// One client id and one secret. 4 KB is far more than any real body.
const MAX_BODY_BYTES = 4 * 1024;

type ClientSource = "stored" | "env" | null;

function statusFor(ws: string) {
  const base = publicBaseUrl(null);
  const saved = getStoredGoogleClientStatus(ws);
  const stored = getStoredGoogleClient(ws);
  const config = googleOAuthConfig(base, process.env, stored);
  const source: ClientSource = !config ? null : stored ? "stored" : "env";
  return {
    configured: !!config,
    source,
    clientId: config?.clientId ?? saved.clientId,
    /** The saved secret no longer opens under the current key: the owner re-enters it. */
    savedUnreadable: saved.unreadable,
    redirectUriToRegister: `${base.replace(/\/+$/, "")}${GOOGLE_OAUTH_CALLBACK_PATH}`,
    scopes: [...GOOGLE_CALENDAR_SCOPES],
  };
}

export const GET = withWorkspace(async (ws: string) => {
  const denied = await requireOperator();
  if (denied) return denied;
  return NextResponse.json(statusFor(ws));
});

export const POST = withWorkspace(async (ws: string, request: NextRequest) => {
  const denied = await requireOperator();
  if (denied) return denied;
  // AUTHORIZATION (write-routes-check-a-capability). This stores the credential every
  // calendar call of the workspace runs on, like the ATS credential doors: `org:manage`.
  const under = await requireCapabilityCoded("org:manage", requireOrgCapability);
  if (under) return under;

  const body = await readJsonWithLimit<{ clientId?: unknown; clientSecret?: unknown }>(request, MAX_BODY_BYTES, {});
  if (body === BODY_TOO_LARGE) return jsonRefusal("PAYLOAD_TOO_LARGE", 413, { maxBytes: MAX_BODY_BYTES });

  // A keyless install gets a generated KP_CALENDAR_SECRET_KEY in .env.local and in this
  // process (calendar-key.ts), once the input is valid and before anything is sealed.
  // KP_SECRET and the auth posture are never touched.
  let keyGenerated = false;
  const ensureKey = (): boolean => {
    const key = ensureCalendarSecretKey();
    keyGenerated = key.ok && key.source === "generated";
    return key.ok;
  };
  try {
    saveGoogleClient({ clientId: body?.clientId, clientSecret: body?.clientSecret }, ws, ensureKey);
  } catch (err) {
    if (err instanceof GoogleClientInputError) {
      return NextResponse.json({ ok: false, reason: err.reason }, { status: 400 });
    }
    if (err instanceof GoogleClientKeyError) {
      return NextResponse.json({ ok: false, reason: "key_unavailable" }, { status: 503 });
    }
    // Only the error's kind reaches the log: the request body held the secret, and no
    // detail of this failure may risk carrying it.
    console.error("[api/calendar/google/client] saving the OAuth client failed:", err instanceof Error ? err.name : "unknown");
    return NextResponse.json({ ok: false, reason: "save_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, keyGenerated, ...statusFor(ws) });
});
