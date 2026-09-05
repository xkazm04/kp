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

import {
  getEdgeConfig,
  recordDrain,
  recordHeartbeat,
  resolveEdge,
  resolveEdgeDetailed,
  type EdgeErrorKind,
  type ResolvedEdge,
} from "./edge-config";
import { isSealedBody, signEdgePayload, unsealBody } from "./edge-crypto";
import { ingestInboundLeadByToken, inboundHandled } from "./inbound-lead";
import { recordDeliveryReceipt } from "./comms-receipt";
import { publicBaseUrl } from "./public-base-url";
import { assertPublicHttpsEndpointResolved, type HostLookup } from "./ats-egress-guard";

/** Events applied per PAGE. The edge caps its own answer at 200; 50 keeps one HTTP
 *  round-trip small and the unseal/apply work per response bounded. */
const MAX_EVENTS_PER_DRAIN = 50;

/** Pages per tick. The drain used to fetch ONE page and stop, discarding the
 *  `pending` count the edge had just given it — so a 500-event backlog (a weekend of
 *  applications after a job ad went out) needed TEN clock ticks to clear, and the
 *  card showed a cursor creeping while nothing said how much was left. It now keeps
 *  going while the edge says there is more.
 *
 *  Bounded at 5 (=250 events) and not unbounded, deliberately: the drain runs on the
 *  clock beside every other tick job, each applied event is a real intake write plus
 *  possibly an acknowledgement email, and an edge that reports a `pending` which
 *  never falls would otherwise spin this loop forever. What is left after the bound
 *  is not lost — `pending` is now PERSISTED, the card says so, and the next tick
 *  continues from the cursor. Pinned in edge-drain.test.ts. */
const MAX_PAGES_PER_DRAIN = 5;
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
  /** Pages fetched this tick. `pages === MAX_PAGES_PER_DRAIN` with `pending > 0` is
   *  the honest "there is more, and we stopped on purpose" state. */
  pages: number;
  /** The diagnostic, for the server log. NEVER rendered to a reader — see errorKind. */
  error: string | null;
  /** The CLASS of the failure, which is what the card can say in four languages. */
  errorKind: EdgeErrorKind | null;
};

// SSRF at the EDGE boundary. The edge URL is operator-supplied and stored;
// `setEdgeConfig` vets it with the string-level `assertPublicHttpsEndpoint`, which
// vets the literal NAME. This is the moment the name becomes an address, and every
// call carries the edge HMAC (and, on /ack, the sequence numbers of a candidate's
// events) — so a stored `https://rebind.attacker.com` that passed the write and now
// answers 169.254.169.254 walked straight in. The drain runs off a clock, so the gap
// between the write and this fetch is unbounded: the write-time check is the
// operator's fast feedback, the resolve here is the gate. Same shared guard the ATS
// delivery boundary, the pull pass and llm-config use.
//
// It THROWS on refusal, which is deliberate: every caller of `edgeFetch` already sits
// in a try/catch that records the outcome (`runEdgeDrain` files it as `unreachable`
// with the reason on the drain ledger; pair and heartbeat answer their own error), so
// a refusal is reported through the path an unreachable edge already uses rather than
// through a new one nobody renders.
let edgeHostLookup: HostLookup | undefined;

/** Test seam: override (or, with `undefined`, restore) the resolver the edge egress
 *  guard uses. Never called by production code. */
export function setEdgeHostLookupForTests(fn: HostLookup | undefined): void {
  edgeHostLookup = fn;
}

async function edgeFetch(
  edge: ResolvedEdge,
  path: string,
  init: { method: "GET" | "POST"; body?: string }
): Promise<Response> {
  await assertPublicHttpsEndpointResolved(edge.url, "edge url", edgeHostLookup);
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
  const resolution = resolveEdgeDetailed();
  const edge = resolution.ok ? resolution.edge : null;
  const summary: DrainSummary = {
    configured: !!edge,
    fetched: 0,
    applied: 0,
    skipped: 0,
    cursor: 0,
    pending: null,
    pages: 0,
    error: null,
    errorKind: null,
  };
  if (!resolution.ok) {
    // A stored pairing this install can no longer open (KP_SECRET rotated ahead of
    // `secrets:rotate`, or the retired key dropped). Decrypt used to run outside the
    // resolver's try, so this threw straight out of a function documented "never
    // throws" and "Drain now" answered an unhandled 500. It is a LEDGER error like
    // any other: recorded through recordDrain, so the card names the class and the
    // clock's next tick is unaffected. `configured` stays false because there is
    // nothing this install can talk to, and the cursor is left where it was.
    // The ledger carries the CODE, not the decipher message: `lastError` is on the
    // public config and a key-material-adjacent sentence has no business there. The
    // raw diagnostic goes to this install's server log, where the operator is.
    console.error("[edge:drain] EDGE_SECRET_UNREADABLE", resolution.error);
    summary.error = "EDGE_SECRET_UNREADABLE";
    summary.errorKind = resolution.kind;
    recordDrain({ cursor: 0, error: summary.error, errorKind: summary.errorKind });
    return summary;
  }
  if (!edge) return summary;
  summary.cursor = edge.cursor;
  let cursor = edge.cursor;
  const origin = publicBaseUrl(""); // no request here — see pull-pass.ts

  // CATCH UP, page by page, while the edge says there is more. Every page is applied
  // and acked before the next is asked for, so the invariants below still hold one
  // page at a time; the loop only removes the "one page per tick" ceiling.
  for (let page = 0; page < MAX_PAGES_PER_DRAIN; page++) {
    let events: EdgeEvent[] = [];
    try {
      const res = await edgeFetch(edge, `/drain?since=${cursor}&limit=${MAX_EVENTS_PER_DRAIN}`, { method: "GET" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text.length > MAX_DRAIN_BYTES) throw new Error("Drain response too large.");
      const parsed = JSON.parse(text) as { events?: EdgeEvent[]; pending?: number };
      events = Array.isArray(parsed.events) ? parsed.events.slice(0, MAX_EVENTS_PER_DRAIN) : [];
      summary.pending = typeof parsed.pending === "number" ? parsed.pending : null;
      summary.pages = page + 1;
    } catch (e) {
      summary.error = e instanceof Error ? e.message : "Drain failed.";
      summary.errorKind = "unreachable";
      break;
    }
    if (events.length === 0) break;

    summary.fetched += events.length;
    const pageStart = cursor;
    let held = false;
    for (const event of events.sort((a, b) => a.seq - b.seq)) {
      if (typeof event.seq !== "number" || event.seq <= cursor) continue; // already applied
      let outcome: ApplyOutcome;
      try {
        outcome = await applyEvent(event, edge.privateJwk, origin);
      } catch (e) {
        // Unsealing or a store write blew up: HOLD. The event stays at the edge and
        // the operator gets a reason instead of a silently missing candidate.
        summary.error = e instanceof Error ? e.message : "Event apply failed.";
        summary.errorKind = "held";
        held = true;
        break;
      }
      if (outcome === "hold") {
        summary.error = `event ${event.seq} could not be applied yet`;
        summary.errorKind = "held";
        held = true;
        break;
      }
      if (outcome === "applied") summary.applied += 1;
      else summary.skipped += 1;
      cursor = event.seq;
    }

    // Ack ONLY what was applied. A failed ack is not fatal — the edge re-serves those
    // events next tick and the idempotency key collides — so it is recorded, not raised.
    if (cursor > pageStart) {
      try {
        const body = JSON.stringify({ upto: cursor });
        const res = await edgeFetch(edge, `/ack`, { method: "POST", body });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // The page we just acked is no longer waiting, whatever the last `pending`
        // said — that number was measured BEFORE these events were applied.
        if (typeof summary.pending === "number") summary.pending = Math.max(0, summary.pending - (cursor - pageStart));
      } catch (e) {
        summary.error = summary.error ?? `ack failed: ${e instanceof Error ? e.message : "unknown"}`;
        summary.errorKind = summary.errorKind ?? "ack";
        // An un-acked page would be re-served forever, so stop asking for more.
        held = true;
      }
    }
    // A hold means the queue is blocked at this sequence; another page cannot help.
    if (held) break;
    if (summary.pending !== null && summary.pending <= 0) break;
    if (events.length < MAX_EVENTS_PER_DRAIN) break; // a short page IS the end
  }

  summary.cursor = cursor;
  recordDrain({ cursor, error: summary.error, errorKind: summary.errorKind, pending: summary.pending });
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
  const resolution = resolveEdgeDetailed();
  // Same refusal, said plainly: publishing a key over a link we cannot sign is not a
  // thing that can succeed, and the route answers EDGE_PAIR_REFUSED for it.
  if (!resolution.ok) return { ok: false, error: resolution.error };
  const edge = resolution.edge;
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
