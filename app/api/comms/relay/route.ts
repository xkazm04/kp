import { NextRequest, NextResponse } from "next/server";
import { CommsRelayError, CommsRelayStaleError, getRelayConfig, setRelayConfig } from "@/app/_lib/comms-relay-store";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireOrgCapability } from "@/app/_lib/auth/current-user";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { relayHealth } from "@/app/_lib/comms-relay";

// The outbound comms relay config (RelayConfigCard on the Channels tab) — the
// UI-backed twin of COMMS_WEBHOOK_URL. GET never returns the signing secret
// (only `hasSecret`; ats/config doctrine). `envConfigured` tells the editor the
// env var is set and overriding whatever the form stores.
//
// OPERATOR-only (mirrors /api/ats/config): this re-points ALL candidate-facing
// message egress (PII) and holds an HMAC signing secret.

// Per-IP budget on the WRITE. This is the one secret-write door on the Channels
// tab: every accepted call replaces the endpoint every candidate-facing message is
// POSTed to and can store a new HMAC signing secret. It is operator-gated, and open
// mode (KP_OPERATOR_PASSWORD unset) makes that gate a documented no-op for the ENTIRE
// API — so the limiter is the real bound, and without it the door was also an
// unmetered oracle for probing the SSRF guard (validateUrl → assertPublicHttpsEndpoint)
// one candidate host at a time. 30/10min is far above an operator editing a form.
const RELAY_RATE_LIMIT = { limit: 30, windowMs: 10 * 60_000 };

export async function GET() {
  const denied = await requireOperator();
  if (denied) return denied;
  // `relay` is the resolver's own word for what actually delivers (comms-relay.ts).
  // The editor cannot derive it: a stored url with an UNDECRYPTABLE signing secret
  // looks identical here to a healthy one, and used to be painted "Not configured" —
  // the same pill an install with no relay at all shows.
  return NextResponse.json({
    config: getRelayConfig(),
    envConfigured: Boolean(process.env.COMMS_WEBHOOK_URL),
    relay: relayHealth(),
  });
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
  // AFTER the operator gate, so a rejected caller never spends the budget, and before
  // any parsing or store work.
  if (!rateLimit(`comms-relay:${clientIpFrom(request.headers)}`, RELAY_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const body = (await request.json()) as { url?: unknown; secret?: unknown; expectedVersion?: unknown };
    // `expectedVersion` is the version the editor READ. The write is a full replace, so
    // without it a second tab (or a second operator) silently overwrote the endpoint
    // the first had just saved; the store re-asserts it under the write lock.
    const config = setRelayConfig(body);
    return NextResponse.json({ ok: true, config });
  } catch (error) {
    // Checked FIRST: a stale write subclasses CommsRelayError, and it is a refusal
    // (409, nothing written), not a validation failure.
    if (error instanceof CommsRelayStaleError) {
      return jsonRefusal("COMMS_RELAY_STALE", 409, { config: getRelayConfig() });
    }
    if (error instanceof CommsRelayError) {
      // The validator's own sentence — which host was refused, which field — is
      // English prose written for the log and for API consumers. It rides beside the
      // code as DATA; the card paints the localized message.
      return jsonRefusal("COMMS_RELAY_INVALID", 400, { detail: error.message });
    }
    // A thrown better-sqlite3 / crypto error carries the db path and internal detail:
    // it goes to the server log, and the client gets the code.
    return safeJsonError(error, "api:comms:relay", "COMMS_RELAY_SAVE_FAILED");
  }
}
