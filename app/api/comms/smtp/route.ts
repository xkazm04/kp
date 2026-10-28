import { NextRequest, NextResponse } from "next/server";
import {
  CommsSmtpError,
  CommsSmtpStaleError,
  getSmtpConfig,
  setSmtpConfig,
  unsuppressSmtpAddress,
  type CommsSmtpPublic,
} from "@/app/_lib/comms-smtp-store";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { currentSession, requireOrgCapability } from "@/app/_lib/auth/current-user";
import { currentOrgId } from "@/app/_lib/auth/session";
import { DEFAULT_ORG_ID } from "@/app/_lib/db/organizations";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { relayHealth, smtpHealth } from "@/app/_lib/comms-relay";
import { linkBaseStatus } from "@/app/_lib/link-base-warning";
import { withSession } from "@/app/_lib/auth/workspace-context";

// T6 — the built-in SMTP sender (the SMTP card on the Channels tab, beside the relay).
// GET never returns the password, only `hasPassword` (the relay/ats doctrine). `active`
// says which transport a letter would actually leave through right now: the relay keeps
// precedence when both are configured (comms-relay.ts PRECEDENCE), and the card has to
// say so rather than let an owner think their mailbox is sending.
//
// OPERATOR-only like /api/comms/relay: this re-points candidate-facing egress and holds a
// mailbox password. The write is `org:manage` and throttled exactly like the relay door.
const SMTP_RATE_LIMIT = { limit: 30, windowMs: 10 * 60_000 };

/** The suppression list and the attempt log name candidate addresses: they are the
 *  OWNER org's to read. Another org's operator sees the sender's settings and nothing
 *  about whom it wrote to. */
function ownedBy(ownerOrgId: string | null, callerOrg: string): boolean {
  return (ownerOrgId ?? DEFAULT_ORG_ID) === callerOrg;
}

function projectFor(config: CommsSmtpPublic, callerOrg: string): CommsSmtpPublic {
  if (ownedBy(config.ownerOrgId, callerOrg)) return config;
  return { ...config, suppressed: [], attempts: [] };
}

export const GET = withSession(async (request: NextRequest) => {
  const denied = await requireOperator();
  if (denied) return denied;
  const callerOrg = currentOrgId(await currentSession()) ?? DEFAULT_ORG_ID;
  const relay = relayHealth();
  const smtp = smtpHealth();
  const relayActive = relay === "env" || relay === "configured";
  return NextResponse.json({
    config: projectFor(getSmtpConfig(), callerOrg),
    smtp,
    relay,
    active: relayActive ? "relay" : smtp === "configured" ? "smtp" : "none",
    // Only the verdict, never the origin: the page needs the word, not the address.
    linkBase: { problem: linkBaseStatus(new URL(request.url).origin).problem },
  });
});

export const POST = withSession(async (request: NextRequest) => {
  const denied = await requireOperator();
  if (denied) return denied;
  // AUTHORIZATION: this rewrites installation-level delivery configuration and stores a
  // credential, an org-administration act (`org:manage`), same as the relay door.
  const under = await requireCapabilityCoded("org:manage", requireOrgCapability);
  if (under) return under;
  if (!rateLimit(`comms-smtp:${clientIpFrom(request.headers)}`, SMTP_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  const ownerOrgId = currentOrgId(await currentSession()) ?? DEFAULT_ORG_ID;
  // Parsed apart from the store work and never logged: a JSON SyntaxError quotes a slice
  // of the body, and the body carries the mailbox password.
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonRefusal("COMMS_SMTP_INVALID", 400, { detail: "The request body must be a JSON object." });
  }
  try {
    // Taking an address off the suppression list is its own small act, not a save: it
    // touches no setting and needs no version. The owner org's act only: another org's
    // call removes nothing and answers like a miss (no edit, no membership oracle).
    if (typeof body.unsuppress === "string") {
      const removed = unsuppressSmtpAddress(body.unsuppress, (owner) => ownedBy(owner, ownerOrgId));
      return NextResponse.json({ ok: true, removed, config: projectFor(getSmtpConfig(), ownerOrgId) });
    }
    // The owner is stamped from the session, never taken from the body (F-2's rule).
    const config = setSmtpConfig({
      preset: body.preset,
      host: body.host,
      port: body.port,
      security: body.security,
      address: body.address,
      fromName: body.fromName,
      password: body.password,
      expectedVersion: body.expectedVersion,
      ownerOrgId,
    });
    return NextResponse.json({ ok: true, config: projectFor(config, ownerOrgId) });
  } catch (error) {
    // Checked FIRST: a stale write subclasses CommsSmtpError and is a 409 refusal.
    if (error instanceof CommsSmtpStaleError) {
      return jsonRefusal("COMMS_SMTP_STALE", 409, { config: projectFor(getSmtpConfig(), ownerOrgId) });
    }
    if (error instanceof CommsSmtpError) {
      // Which INPUT was refused rides as data (a fixed vocabulary: preset, address, host,
      // port, security, password, encryptionKey); the store's prose stays server-side.
      return jsonRefusal("COMMS_SMTP_INVALID", 400, { field: error.field });
    }
    return safeJsonError(error, "api:comms:smtp", "COMMS_SMTP_SAVE_FAILED");
  }
});
