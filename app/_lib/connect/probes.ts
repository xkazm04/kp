import { resolveRelay } from "@/app/_lib/comms-relay";
import { egressSealed } from "@/app/_lib/egress-seal";
import { buildCommEnvelope } from "@/app/_lib/comms-envelope";
import { SIGNATURE_HEADER, signWebhookBody, TIMESTAMP_HEADER } from "@/app/_lib/ats-webhook";
import { assertRelayEndpointResolved, COMMS_PROBE_TIMEOUT_MS, relayTimeoutMs } from "@/app/_lib/comms";
import { deliver } from "@/app/_lib/ats-egress";
import { getAtsConfig } from "@/app/_lib/ats-config-store";
import { getAtsConnection, getAtsToken, type AtsProvider } from "@/app/_lib/ats/connections-store";
import { assertPublicHttpsEndpointResolved, type HostLookup } from "@/app/_lib/ats-egress-guard";
import { calendarNeedsReconnect, fetchBusy, isCalendarConnected } from "@/app/_lib/calendar/google-calendar";

// THE PROBE CONTRACT (docs/features/connect/README.md). A probe answers one question —
// "does this connector work right now?" — as exactly one of four shapes, and never
// throws. Every probe checks the egress seal FIRST, before it resolves a secret, vets a
// host or opens a socket, so a sealed process makes 0 network calls. The relay and ATS
// webhook probes are the logic the two operator "Send test" routes used to hold inline;
// those routes now call these and map the result to their historical responses.
export type ProbeResult =
  | { kind: "sealed" }
  | { kind: "not_configured"; reason: string }
  /** The endpoint answered: `ok` is its own 2xx verdict, `status` the HTTP code. */
  | { kind: "http"; ok: boolean; status: number }
  /** No answer worth a status: refused host, timeout, network error, unreadable secret. */
  | { kind: "failed"; reason: string };

const SEALED_RESULT: ProbeResult = { kind: "sealed" };

/** A signed `relay.test` envelope to the ACTIVE relay (env → stored config). Single
 *  attempt, no retry: a probe should answer fast, not back off. */
export async function probeRelay(): Promise<ProbeResult> {
  if (egressSealed()) return SEALED_RESULT;
  const relay = resolveRelay();
  if (!relay) return { kind: "not_configured", reason: "No relay configured." };
  // Re-vet at fetch time with the SAME resolved guard the delivery path uses
  // (comms.ts WebhookChannel.deliver), for env and stored relays alike: a string-only
  // check let a name that resolves into private space take a signed POST and report its
  // HTTP status back, a reachability oracle on the deployment's own network.
  try {
    await assertRelayEndpointResolved(relay.url);
  } catch (e) {
    return { kind: "failed", reason: e instanceof Error ? e.message : "Relay URL not allowed." };
  }
  const envelope = buildCommEnvelope(
    { to: "relay-test", subject: "kp relay test", body: "Test ping from the kp delivery relay configuration.", kind: "relay.test" },
    null,
    new Date().toISOString()
  );
  const body = JSON.stringify(envelope);
  // Same construction as a real relay delivery (comms.ts), so a receiver wired up
  // against this ping is wired up against production traffic.
  const headers: Record<string, string> = { "Content-Type": "application/json", [TIMESTAMP_HEADER]: envelope.sentAt };
  if (relay.secret) headers[SIGNATURE_HEADER] = signWebhookBody(relay.secret, body, envelope.sentAt);
  // Bounded like a real delivery (comms.ts), tighter: a human is watching a button, and
  // a relay that cannot answer a ping inside the window has failed the very question
  // the probe asks.
  const timeoutMs = relayTimeoutMs(COMMS_PROBE_TIMEOUT_MS);
  try {
    // `redirect: "manual"` is part of the SSRF boundary, as in ats-egress.ts: the guard
    // vetted only this URL, and a followed 307 replays the signed POST to wherever the
    // Location points (169.254.169.254, 127.0.0.1) and reports that host's status here.
    const r = await fetch(relay.url, { method: "POST", headers, body, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    await r.body?.cancel().catch(() => undefined);
    if (r.type === "opaqueredirect" || r.status === 0 || (r.status >= 300 && r.status < 400)) {
      return { kind: "failed", reason: "relay returned a redirect; redirects are not followed — configure the final https endpoint" };
    }
    return { kind: "http", ok: r.ok, status: r.status };
  } catch (error) {
    // `reason` is the probe's own diagnostic channel, rendered verbatim next to the
    // endpoint the operator just typed — that is the whole point of a test ping.
    const reason =
      error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
        ? `timeout after ${timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : "network error";
    return { kind: "failed", reason };
  }
}

/** A signed `ping` to the outbound ATS webhook. `data` is `{ ping: true }` or a real
 *  `kp.ats.v1` record (the test route's optional `entryId`). */
export async function probeAtsWebhook(data: Parameters<typeof deliver>[1] = { ping: true }): Promise<ProbeResult> {
  if (egressSealed()) return SEALED_RESULT;
  if (!getAtsConfig().webhookUrl) return { kind: "not_configured", reason: "No webhook URL configured." };
  const result = await deliver("ping", data);
  if (result.delivered) return { kind: "http", ok: true, status: result.status };
  if (result.sealed) return SEALED_RESULT;
  return { kind: "failed", reason: result.reason };
}

const ATS_PROBE_TIMEOUT_MS = 5_000;

let atsHostLookup: HostLookup | undefined;

/** Test seam: the resolver the inbound ATS probe vets hosts with. Never called by production code. */
export function setAtsHostLookupForTests(fn: HostLookup | undefined): void {
  atsHostLookup = fn;
}

/** An authenticated GET of an inbound ATS connection's base URL. Read-only; the token
 *  rides one Authorization header and redirects are never followed (a 3xx would carry
 *  the credential to a host nobody vetted). 401/403 read as a real answer: `ok:false`. */
export async function probeAtsInbound(provider: AtsProvider): Promise<ProbeResult> {
  if (egressSealed()) return SEALED_RESULT;
  const conn = getAtsConnection(provider);
  if (!conn?.baseUrl || !conn.hasToken) return { kind: "not_configured", reason: "No base URL and token saved." };
  try {
    const href = await assertPublicHttpsEndpointResolved(conn.baseUrl, "ATS base URL", atsHostLookup);
    const token = getAtsToken(provider);
    if (!token) return { kind: "not_configured", reason: "No base URL and token saved." };
    const r = await fetch(href, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(ATS_PROBE_TIMEOUT_MS),
    });
    // Only the status is read: the body (candidate data) is dropped unread.
    await r.body?.cancel().catch(() => undefined);
    return { kind: "http", ok: r.ok, status: r.status };
  } catch (e) {
    // A decrypt failure or a refused host: the message names the cause, never the token.
    return { kind: "failed", reason: e instanceof Error ? e.message : "network error" };
  }
}

const HOUR_MS = 60 * 60_000;

/** A 1-hour free/busy read of the workspace's connected calendar — the existing
 *  read-only edge. `fetchBusy` answers null for "we do not know"; a probe reads that as a
 *  failure, never as a free hour. */
export async function probeCalendar(workspaceId: string, now: Date = new Date()): Promise<ProbeResult> {
  if (egressSealed()) return SEALED_RESULT;
  if (!isCalendarConnected(workspaceId)) return { kind: "not_configured", reason: "No calendar connected." };
  if (calendarNeedsReconnect(workspaceId)) return { kind: "failed", reason: "Calendar grant needs a reconnect." };
  const busy = await fetchBusy({ timeMin: now.toISOString(), timeMax: new Date(now.getTime() + HOUR_MS).toISOString() }, workspaceId);
  if (busy === null) return { kind: "failed", reason: "Free/busy unavailable." };
  return { kind: "http", ok: true, status: 200 };
}
