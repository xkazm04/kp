// L1 — draining the edge (docs/concepts/local-first-edge.md §3.2).
//
// The edge is an ANSWERING MACHINE: while this install was off it accepted webhooks,
// mail and delivery receipts into an append-only log, and it can neither read the
// bodies (they are sealed to this install's public key) nor decide anything about
// them. Everything that is a DECISION — is this lead eligible, does this candidate
// already exist, which team owns the role, what gets emailed back — happens here,
// on the machine that holds the database and the model keys.
//
// The loop, and why each step is where it is:
//
//   GET  /drain?since=<cursor>   signed   → events, in sequence order
//   apply each, in order, through the SAME cores a live request uses
//   POST /ack {upto}             signed   → the edge may now forget them
//   POST /heartbeat {at,cursor}  signed   → "I am awake", so the nudge stays quiet
//
// ACK AFTER APPLY, NEVER BEFORE. A crash between the two replays the tail on the
// next tick, which is harmless (the intake core dedupes by idempotency key and again
// by email); a crash between an ack and an apply would lose a candidate silently.
// The cursor is what the edge trusts, so `recordDrain` only ever moves it forward
// over events that were actually applied.
//
// ONE FAILURE STOPS THE PAGE. Events are ordered and an application can depend on an
// earlier one (a receipt for a message about a lead that arrived in the same page),
// so a 5xx-class failure holds the cursor at the last good sequence instead of
// skipping past it. Deterministic refusals — an unknown token, a closed role, a lead
// with no email — are HANDLED: they will never succeed on a retry, so they advance.

import { getEdgeConfig, recordDrain, recordHeartbeat, resolveEdge, type ResolvedEdge } from "./edge-config";
import { isSealedBody, signEdgePayload, unsealBody } from "./edge-crypto";
import { ingestInboundLeadByToken, inboundHandled } from "./inbound-lead";
import { recordDeliveryReceipt } from "./comms-receipt";
import { publicBaseUrl } from "./public-base-url";

/** Events applied per drain. Bounds one tick's work; the rest arrives next tick. */
const MAX_EVENTS_PER_DRAIN = 50;
const DRAIN_TIMEOUT_MS = 20_000;
const MAX_DRAIN_BYTES = 4 * 1024 * 1024;

/** The kinds the edge can hold. Anything else is IGNORED-but-acked: an edge running
 *  a newer Worker than this install must not wedge the queue on a kind we do not
 *  understand yet (and cannot act on anyway). */
export type EdgeEventKind = "lead" | "mail" | "receipt";

export type EdgeEvent = {
  seq: number;
  kind: EdgeEventKind | string;
  /** The receiver token the event was addressed to (lead/mail); absent for receipts. */
  token?: string | null;
  /** Cleartext body, when this install has published no sealing key. */
  body?: unknown;
  /** Sealed body — the normal case once a keypair exists. */
  sealed?: unknown;
  receivedAt?: string;
};

export type DrainSummary = {
  /** Null when no edge is configured — not an error, just the default install. */
  configured: boolean;
  fetched: number;
  applied: number;
  /** Handled but not filed: deterministic refusals and kinds we ignore. */
  skipped: number;
  cursor: number;
  /** Events still waiting at the edge after this drain, when the edge reports it. */
  pending: number | null;
  error: string | null;
};

async function edgeFetch(
  edge: ResolvedEdge,
  path: string,
  init: { method: "GET" | "POST"; body?: string }
): Promise<Response> {
  const timestamp = String(Date.now());
  // A GET has no body, so the PATH+QUERY is what gets signed — otherwise every GET
  // would carry the same signature and a captured one would fetch any window.
  const signed = init.method === "GET" ? path : (init.body ?? "");
  const signature = signEdgePayload(edge.secret, timestamp, signed);
  return fetch(`${edge.url}${path}`, {
    method: init.method,
    headers: {
      accept: "application/json",
      "x-kp-timestamp": timestamp,
      "x-kp-signature": signature,
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    body: init.body,
    signal: AbortSignal.timeout(DRAIN_TIMEOUT_MS),
  });
}

/** Read an event's body, unsealing it when it is sealed. Throws when a sealed body
 *  cannot be opened — the caller must then HOLD the event rather than ack it, since
 *  a key problem is operator-fixable and the payload is otherwise lost forever. */
async function bodyOf(event: EdgeEvent, privateJwk: string | null): Promise<unknown> {
  if (event.sealed !== undefined && event.sealed !== null) {
    if (!isSealedBody(event.sealed)) throw new Error(`event ${event.seq}: unrecognized sealed envelope`);
    if (!privateJwk) throw new Error(`event ${event.seq}: sealed to a key this install no longer holds`);
    return JSON.parse(await unsealBody(privateJwk, event.sealed)) as unknown;
  }
  return event.body ?? null;
}

/** A mail event carries only what the edge could read off the envelope HEADERS: who
 *  wrote, and about what. That is deliberately all it stores — see the Worker's
 *  email() handler — so a forwarded application becomes a LEAD here, filed through
 *  the ordinary lead contract with the sender as the reachable address.
 *
 *  What it is NOT: a CV. Attachments are not carried, so an emailed CV arrives as a
 *  lead with a subject line, and the enrichment link in its acknowledgement is what
 *  turns it into a real candidate. Extracting attachments needs the body, which the
 *  edge deliberately does not keep. */
export function mailToLead(body: unknown): Record<string, unknown> {
  const m = (body ?? {}) as { from?: unknown; name?: unknown; subject?: unknown };
  return {
    email: typeof m.from === "string" ? m.from : "",
    name: typeof m.name === "string" ? m.name : "",
    message: typeof m.subject === "string" ? m.subject : "",
  };
}

type ApplyOutcome = "applied" | "skipped" | "hold";

async function applyEvent(event: EdgeEvent, privateJwk: string | null, origin: string): Promise<ApplyOutcome> {
  const body = await bodyOf(event, privateJwk);
  if (event.kind === "receipt") {
    const r = (body ?? {}) as { ref?: unknown; kind?: unknown; outcome?: unknown; detail?: unknown; recipient?: unknown };
    const ref = typeof r.ref === "string" ? r.ref.trim() : "";
    const kind = typeof r.kind === "string" ? r.kind.trim() : "";
    const outcome = typeof r.outcome === "string" ? r.outcome.trim() : "";
    // A malformed receipt is not retryable — the edge would hand back the same
    // bytes forever. Skip it (it is recorded in the drain summary either way).
    if (!ref || !kind || !outcome) return "skipped";
    const applied = recordDeliveryReceipt({
      ref,
      kind,
      outcome,
      detail: typeof r.detail === "string" ? r.detail : null,
      recipient: typeof r.recipient === "string" ? r.recipient : null,
    });
    return applied.recorded ? "applied" : "skipped";
  }

  if (event.kind === "lead" || event.kind === "mail") {
    if (!event.token) return "skipped"; // nothing to authenticate against
    const payload = event.kind === "mail" ? mailToLead(body) : body;
    const result = await ingestInboundLeadByToken({
      token: event.token,
      rawBody: JSON.stringify(payload ?? null),
      origin,
      // The edge's sequence number IS the delivery's identity, so a replayed page
      // collides on it and files nothing twice.
      idempotencyKey: `edge:${event.seq}`,
    });
    if (!inboundHandled(result)) return "hold";
    return result.status === 200 && result.body.result === "accepted" ? "applied" : "skipped";
  }

  // An unknown kind from a newer Worker: acknowledge it rather than wedging the
  // queue behind something this version cannot act on.
  return "skipped";
}

/**
 * One drain pass. Never throws: an unreachable or misbehaving edge is recorded on
 * the config row (surfaced on the Channels tab) and retried next tick.
 */
export async function drainEdge(): Promise<DrainSummary> {
  const edge = resolveEdge();
  const summary: DrainSummary = { configured: !!edge, fetched: 0, applied: 0, skipped: 0, cursor: 0, pending: null, error: null };
  if (!edge) return summary;
  summary.cursor = edge.cursor;

  let events: EdgeEvent[] = [];
  try {
    const res = await edgeFetch(edge, `/drain?since=${edge.cursor}&limit=${MAX_EVENTS_PER_DRAIN}`, { method: "GET" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > MAX_DRAIN_BYTES) throw new Error("Drain response too large.");
    const parsed = JSON.parse(text) as { events?: EdgeEvent[]; pending?: number };
    events = Array.isArray(parsed.events) ? parsed.events.slice(0, MAX_EVENTS_PER_DRAIN) : [];
    summary.pending = typeof parsed.pending === "number" ? parsed.pending : null;
  } catch (e) {
    summary.error = e instanceof Error ? e.message : "Drain failed.";
    recordDrain({ cursor: edge.cursor, error: summary.error });
    return summary;
  }

  summary.fetched = events.length;
  const origin = publicBaseUrl(""); // no request here — see pull-pass.ts
  let cursor = edge.cursor;
  for (const event of events.sort((a, b) => a.seq - b.seq)) {
    if (typeof event.seq !== "number" || event.seq <= cursor) continue; // already applied
    let outcome: ApplyOutcome;
    try {
      outcome = await applyEvent(event, edge.privateJwk, origin);
    } catch (e) {
      // Unsealing or a store write blew up: HOLD. The event stays at the edge and
      // the operator gets a reason instead of a silently missing candidate.
      summary.error = e instanceof Error ? e.message : "Event apply failed.";
      break;
    }
    if (outcome === "hold") {
      summary.error = `event ${event.seq} could not be applied yet`;
      break;
    }
    if (outcome === "applied") summary.applied += 1;
    else summary.skipped += 1;
    cursor = event.seq;
  }

  // Ack ONLY what was applied. A failed ack is not fatal — the edge re-serves those
  // events next tick and the idempotency key collides — so it is recorded, not raised.
  if (cursor > edge.cursor) {
    try {
      const body = JSON.stringify({ upto: cursor });
      const res = await edgeFetch(edge, `/ack`, { method: "POST", body });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      summary.error = summary.error ?? `ack failed: ${e instanceof Error ? e.message : "unknown"}`;
    }
  }
  summary.cursor = cursor;
  recordDrain({ cursor, error: summary.error });
  return summary;
}

/**
 * Publish this install's sealing key to the edge, minting one on first use.
 *
 * Idempotent and one-way: the keypair is never rotated (every event already sealed
 * to the old key would become unreadable), and the edge keeps serving the cleartext
 * events it stored before pairing — re-sealing those would be theatre, since they
 * have already been at rest unsealed.
 */
export async function pairEdge(): Promise<{ ok: boolean; error: string | null }> {
  const edge = resolveEdge();
  if (!edge) return { ok: false, error: "No edge configured." };
  try {
    const { ensureEdgeKeypair } = await import("./edge-config");
    const publicJwk = await ensureEdgeKeypair();
    const body = JSON.stringify({ publicJwk });
    const res = await edgeFetch(edge, `/pair`, { method: "POST", body });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Pairing failed." };
  }
}

/**
 * Tell the edge we are awake.
 *
 * This is the whole of the "notify me that the studio needs to run" feature from the
 * local side: presence is a POST, absence is its absence. The edge's own cron
 * compares `last_seen` against the unacked count and sends the nudge — so the
 * machine that is switched OFF is not the machine responsible for noticing that it
 * is switched off, which was the entire flaw in doing this locally.
 */
export async function sendEdgeHeartbeat(): Promise<boolean> {
  const edge = resolveEdge();
  if (!edge) return false;
  try {
    const cfg = getEdgeConfig();
    const body = JSON.stringify({
      at: new Date().toISOString(),
      cursor: edge.cursor,
      // Where to send a nudge, re-published on every beat so changing it locally is
      // enough — the edge holds no configuration of its own worth editing.
      nudgeTarget: cfg.nudgeTarget,
    });
    const res = await edgeFetch(edge, `/heartbeat`, { method: "POST", body });
    if (!res.ok) return false;
    recordHeartbeat();
    return true;
  } catch {
    return false;
  }
}
