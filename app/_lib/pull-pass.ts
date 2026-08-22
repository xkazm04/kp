// L0 — "pull on wake" (docs/concepts/local-first-edge.md §3.1).
//
// THE PROBLEM, stated honestly: a local-first install is switched off most of the
// day. Every inbound channel kp has is PUSH — a source POSTs to the receiver — so a
// lead delivered at 22:00 to a laptop that closed at 18:00 is not late, it is LOST.
// The source retried a few times into a dead socket and gave up.
//
// The cheapest complete fix for any source that can be LISTED is to stop relying on
// the push at all: on every clock tick, ask each configured source what has arrived
// since the last cursor and file it. Nothing is lost; it simply lands when the
// studio opens. That is the whole of L0, and it needs no cloud, no account and no
// new dependency — which is why it ships before the edge (L1) rather than after.
//
// WHAT A PULL SOURCE MUST ANSWER (the contract an integrator implements):
//
//   GET <pull_url>[?since=<cursor>]        Authorization: Bearer <pull_secret>
//   200 { "events": [ { "id": "...", "payload": { …lead… } } ], "cursor": "..." }
//
// `payload` is exactly the JSON body that source would have POSTed to the receiver,
// so an integrator who already speaks the push contract speaks this one for free.
// `cursor` is opaque and source-owned: kp stores it and echoes it back, never parses
// it. `events` may be empty; `cursor` may be omitted (the cursor then holds).
//
// WHY NOT IMAP: an inbox is the obvious pull source and is deliberately NOT here.
// It needs a mail dependency and a MIME parser, which is a dependency decision
// (CONTRIBUTING.md) rather than a code decision — and the edge's Email Routing
// handler (L1) answers the same need with no dependency at all. A mail-to-JSON
// bridge that speaks the contract above works today.

import { listPullSources, recordPullResult, type PullSource } from "./db/channels";
import { ingestInboundLeadByToken, inboundHandled } from "./inbound-lead";
import { publicBaseUrl } from "./public-base-url";
import { assertPublicHttpsEndpoint } from "./safe-url";

/** Hard bound on one pull's response body. A source that answers with more than
 *  this is misconfigured (or hostile); we refuse it rather than buffering it. */
const MAX_PULL_BYTES = 1024 * 1024;
/** Events applied per source per tick. The cursor advances only over what was
 *  actually applied, so the rest arrives on the next tick — a backlog drains at a
 *  bounded rate instead of blocking the clock (and every other sweep behind it)
 *  on a source that returns ten thousand rows. */
const MAX_EVENTS_PER_PULL = 50;
/** One source must not be able to hold the whole clock. */
const PULL_TIMEOUT_MS = 15_000;

/** The bounds, exported so the test can pin them: a cap nothing asserts is a cap
 *  that quietly disappears in a refactor. */
export const PULL_LIMITS = { maxBytes: MAX_PULL_BYTES, maxEvents: MAX_EVENTS_PER_PULL, timeoutMs: PULL_TIMEOUT_MS } as const;

export type PullSourceOutcome = {
  token: string;
  channel: string;
  fetched: number;
  applied: number;
  /** Deliveries the intake refused deterministically (no email, role closed, …) —
   *  handled, counted, and NOT retried. Reported so a mis-mapped source is visible
   *  as "arriving and being rejected", never as "quiet". */
  rejected: number;
  error: string | null;
};

export type PullPassSummary = {
  sources: number;
  applied: number;
  rejected: number;
  failed: number;
  outcomes: PullSourceOutcome[];
};

export type PullEnvelope = { events?: unknown; cursor?: unknown };

export function parsePullEvents(body: PullEnvelope): { id: string | null; payload: unknown }[] {
  if (!Array.isArray(body.events)) return [];
  return body.events.slice(0, MAX_EVENTS_PER_PULL).map((e) => {
    const row = (e ?? {}) as { id?: unknown; payload?: unknown };
    return {
      // The source's own id, when it sends one, becomes the idempotency key — it
      // owns its uniqueness, exactly as an Idempotency-Key header would. Without
      // one the core hashes the payload bytes instead.
      id: typeof row.id === "string" && row.id ? row.id.slice(0, 200) : null,
      // A bare lead (no {id,payload} envelope) is accepted as itself: sources that
      // simply return a list of leads are the common case and shouldn't need a wrapper.
      payload: "payload" in row ? row.payload : e,
    };
  });
}

/** Pull ONE source. Never throws — a source that is down, slow, or answering
 *  nonsense is recorded on its own row and cannot take the sweep (or the tick) with
 *  it. `failure-not-empty-success`: a failed pull leaves the cursor exactly where it
 *  was, so the same window is re-asked next tick rather than skipped. */
export async function pullOneSource(source: PullSource, origin: string): Promise<PullSourceOutcome> {
  const outcome: PullSourceOutcome = { token: source.token, channel: source.channel, fetched: 0, applied: 0, rejected: 0, error: null };
  let url: string;
  try {
    // Same SSRF posture as the outbound relay: https, public host. A pull is an
    // outbound call made by the server on a stored, operator-supplied URL — the
    // trust boundary the ATS/relay endpoints already stand on.
    const validated = new URL(assertPublicHttpsEndpoint(source.url, "pull_url"));
    if (source.cursor) validated.searchParams.set("since", source.cursor);
    url = validated.toString();
  } catch (e) {
    outcome.error = e instanceof Error ? e.message : "Invalid pull URL.";
    recordPullResult(source.token, { error: outcome.error });
    return outcome;
  }

  let body: PullEnvelope;
  try {
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        ...(source.secret ? { authorization: `Bearer ${source.secret}` } : {}),
      },
      signal: AbortSignal.timeout(PULL_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > MAX_PULL_BYTES) throw new Error("Response too large.");
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object") throw new Error("Response is not a JSON object.");
    body = parsed as PullEnvelope;
  } catch (e) {
    // KP_OFFLINE's fetch guard lands here too, as a refusal with a clear message —
    // an air-gapped install reports "not pulling" instead of pretending to pull.
    outcome.error = e instanceof Error ? e.message : "Pull failed.";
    recordPullResult(source.token, { error: outcome.error });
    return outcome;
  }

  const events = parsePullEvents(body);
  outcome.fetched = events.length;
  for (const event of events) {
    const rawBody = JSON.stringify(event.payload ?? null);
    const result = await ingestInboundLeadByToken({
      token: source.token,
      rawBody,
      origin,
      idempotencyKey: event.id,
    });
    if (!inboundHandled(result)) {
      // A 5xx is the one outcome worth replaying, so we stop the page here and hold
      // the cursor: the un-applied tail is re-fetched next tick. Advancing past a
      // transient failure would drop real candidates silently.
      outcome.error = String(result.body.error ?? "Lead intake failed.");
      recordPullResult(source.token, { error: outcome.error });
      return outcome;
    }
    if (result.status === 200 && result.body.result === "accepted") outcome.applied += 1;
    else outcome.rejected += 1;
  }

  // Clean pass ⇒ adopt the source's new cursor. A source that returned a FULL page
  // may well have more; the next tick asks again from the new cursor.
  const nextCursor = typeof body.cursor === "string" && body.cursor ? body.cursor.slice(0, 512) : source.cursor;
  recordPullResult(source.token, { cursor: nextCursor, error: null });
  return outcome;
}

/**
 * One sweep over every configured pull source in the installation.
 *
 * Best-effort and serial: sources are few (one per receiver a team chose to make
 * bidirectional), each is bounded, and serial keeps the intake's SQLite writes off
 * each other's toes on the same tick that the automation pass is running.
 *
 * Returns a summary for the clock log; never throws.
 */
export async function runPullPass(): Promise<PullPassSummary> {
  const sources = listPullSources();
  const summary: PullPassSummary = { sources: sources.length, applied: 0, rejected: 0, failed: 0, outcomes: [] };
  if (sources.length === 0) return summary;
  // The clock has no request, so "" is the honest "no runtime origin here" input:
  // publicBaseUrl then resolves NEXT_PUBLIC_APP_BASE_URL / APP_BASE_URL and, failing
  // both, the canonical site origin — always ABSOLUTE, never a dead relative link in
  // a candidate's mailbox. Setting the app base URL is what makes it point at THIS
  // deploy (.env.example says so); a background-filed lead is exactly the case that
  // has no request Host to fall back on.
  const origin = publicBaseUrl("");
  for (const source of sources) {
    const outcome = await pullOneSource(source, origin);
    summary.outcomes.push(outcome);
    summary.applied += outcome.applied;
    summary.rejected += outcome.rejected;
    if (outcome.error) summary.failed += 1;
  }
  return summary;
}
