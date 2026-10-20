/*
 * The two delivery reads the Night Post draws from, in ONE place: GET /api/comms/relay (where
 * outbound mail goes) and GET /api/edge (who answers while the studio is off). They used to
 * live inside the editors (RelayConfigCard's private readConfig, ChannelsEdgeCard's exported
 * readEdgeConfig); the plumbing scene needs the same facts, so the parse moved here and the
 * editors import it. Pure parsers (tested in channelsNightReads.test.ts) + thin fetchers.
 *
 * Null always means "still unknown" (in flight, failed, operator-denied), never a fabricated
 * default: an unknown relay is not an unconfigured one.
 */
import type { EdgeErrorKind } from "@/app/_lib/edge-config.ts";

/* ------------------------------------------------------------------ relay */

/** The server's health word (comms-relay.ts RelayHealth). `unreadable` = an endpoint IS
 *  stored but its signing secret does not decrypt, so nothing is delivered. */
export type RelayHealthWord = "env" | "configured" | "unconfigured" | "unreadable";
export type RelayState = { url: string; hasSecret: boolean; envConfigured: boolean; version: number; relay: RelayHealthWord };

const HEALTH_WORDS: readonly string[] = ["env", "configured", "unconfigured", "unreadable"];
function isHealthWord(v: unknown): v is RelayHealthWord {
  return typeof v === "string" && HEALTH_WORDS.includes(v);
}

/** One GET /api/comms/relay body -> the relay state, or null when it carries no config. */
export function parseRelayBody(body: unknown): RelayState | null {
  const d = body as { config?: { url?: string | null; hasSecret?: boolean; version?: number }; envConfigured?: boolean; relay?: unknown } | null;
  if (!d?.config) return null;
  const url = d.config.url ?? "";
  return {
    url,
    hasSecret: Boolean(d.config.hasSecret),
    envConfigured: Boolean(d.envConfigured),
    version: d.config.version ?? 0,
    // An older server (or a shape we do not recognise) is not evidence of a fault: fall back
    // to the two states the url alone can justify.
    relay: isHealthWord(d.relay) ? d.relay : url ? "configured" : "unconfigured",
  };
}

export async function readRelayConfig(): Promise<RelayState | null> {
  try {
    const r = await fetch("/api/comms/relay");
    if (!r.ok) return null;
    return parseRelayBody(await r.json());
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ edge */

// The honesty the edge owes (docs/concepts/local-first-edge.md §3.2): NOT PAIRED is the
// local-first default; PAIRED needs a URL AND a secret; SECRET MISSING is its own state (it
// once read green while nothing drained); SEALED is shown only when true; OFFLINE wins over
// everything. The drain ledger (last drain, last beat, backlog) is what tells "caught up"
// from "500 behind".
export type EdgeState = {
  url: string;
  hasSecret: boolean;
  sealed: boolean;
  cursor: number;
  lastDrainAt: string | null;
  lastHeartbeatAt: string | null;
  pending: number | null;
  lastErrorKind: EdgeErrorKind | null;
  nudgeTarget: string | null;
  envConfigured: boolean;
  offline: boolean;
};

/** One GET /api/edge body -> the edge state, or null when it carries no config. */
export function parseEdgeBody(body: unknown): EdgeState | null {
  const d = body as { config?: Partial<EdgeState> } | null;
  if (!d?.config) return null;
  const c = d.config;
  return {
    url: c.url ?? "",
    hasSecret: Boolean(c.hasSecret),
    sealed: Boolean(c.sealed),
    cursor: c.cursor ?? 0,
    lastDrainAt: c.lastDrainAt ?? null,
    lastHeartbeatAt: c.lastHeartbeatAt ?? null,
    pending: typeof c.pending === "number" ? c.pending : null,
    lastErrorKind: c.lastErrorKind ?? null,
    nudgeTarget: c.nudgeTarget ?? null,
    envConfigured: Boolean(c.envConfigured),
    offline: Boolean(c.offline),
  };
}

/** GET /api/edge, parsed. Null = "still unknown", never a fabricated default. */
export async function readEdgeConfig(): Promise<EdgeState | null> {
  try {
    const r = await fetch("/api/edge");
    if (!r.ok) return null;
    return parseEdgeBody(await r.json());
  } catch {
    return null;
  }
}
