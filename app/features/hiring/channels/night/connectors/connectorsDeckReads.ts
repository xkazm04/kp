/*
 * The connectors deck's wire, in ONE place: the reads (GET /api/connect, GET /api/ats/deliveries)
 * and the two presses (POST /api/connect/<id>/probe, and Replay: POST /api/ats/deliveries
 * { replayId }, the route's own contract). Thin fetchers over the pure parsers in
 * connectorsDeckModel.ts and atsDeliveriesModel.ts, each taking its `fetch` so
 * connectorsDeckReads.test.ts can prove what is and is not called.
 *
 * `loadDeck` is everything the deck reads on mount, on a live refresh and on a return to the
 * plumbing, and it never probes: health on load is config-only (not_configured / unverified /
 * sealed, or a verdict an owner's press already left). A probe runs only from `pressProbe`, and
 * `pressProbe("smtp")` makes no request at all (its probe is a real letter; the owner sends it
 * from the sender level's Send test). Null always means "still unknown", never a default.
 */
import type { ConnectorId } from "@/app/_lib/connect/catalog.ts";
import { parseConnectBody, probeUrl, type ConnectorWire } from "./connectorsDeckModel.ts";
import { parseDeliveriesBody, replayRequest, type AtsDeliveries } from "./atsDeliveriesModel.ts";

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const browserFetch: Fetcher = (url, init) => fetch(url, init);

async function getJson(f: Fetcher, url: string): Promise<unknown> {
  try {
    const r = await f(url);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export type DeckReads = { connectors: ConnectorWire[] | null; ats: AtsDeliveries | null };

/** Every read the deck draws from. GETs only: no probe, no letter, no outside call. */
export async function loadDeck(f: Fetcher = browserFetch): Promise<DeckReads> {
  const [connect, deliveries] = await Promise.all([getJson(f, "/api/connect"), getJson(f, "/api/ats/deliveries")]);
  return { connectors: parseConnectBody(connect), ats: parseDeliveriesBody(deliveries) };
}

/** What Replay answered: requeued (and swept), or the route's refusal code / HTTP status. */
export type ReplayOutcome = { ok: true } | { ok: false; code: string | null; status: number };

/** Replay ONE dead-lettered delivery through the route's POST { replayId }, on a press. */
export async function replayDelivery(id: number, f: Fetcher = browserFetch): Promise<ReplayOutcome> {
  const { url, init } = replayRequest(id);
  try {
    const r = await f(url, init);
    if (r.ok) return { ok: true };
    const body = (await r.json().catch(() => null)) as { code?: unknown } | null;
    return { ok: false, code: typeof body?.code === "string" ? body.code : null, status: r.status };
  } catch {
    return { ok: false, code: null, status: 0 };
  }
}

export type ProbeOutcome =
  /** The probe ran (or the seal / an empty config answered for it): the row it left. */
  | { kind: "row"; row: ConnectorWire }
  /** Not probed here: the owner tests it on the sender level (smtp). */
  | { kind: "sender" }
  /** No answer worth a row: refused, throttled, network. `status` 0 = no response. */
  | { kind: "failed"; status: number };

/** ONE probe, because an owner pressed Probe. smtp never reaches the network from here. */
export async function pressProbe(id: ConnectorId, f: Fetcher = browserFetch): Promise<ProbeOutcome> {
  const url = probeUrl(id);
  if (url === null) return { kind: "sender" };
  try {
    const r = await f(url, { method: "POST" });
    if (!r.ok) return { kind: "failed", status: r.status };
    const body = (await r.json()) as { connector?: unknown };
    const row = parseConnectBody({ connectors: [body.connector] })?.[0];
    return row ? { kind: "row", row } : { kind: "failed", status: r.status };
  } catch {
    return { kind: "failed", status: 0 };
  }
}
