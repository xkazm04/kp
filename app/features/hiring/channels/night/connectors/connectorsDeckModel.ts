/*
 * The connectors deck, as facts (pure; pinned by connectorsDeckModel.test.ts).
 *
 * The deck draws the connector catalog (GET /api/connect, docs/features/connect/README.md) as
 * cards grouped by what the studio talks to: delivery (the relay, the SMTP mailbox), the ATS
 * (the outbound webhook, the inbound imports) and the calendar. It keeps the catalog's ONE
 * health vocabulary and never flattens it: `sealed` (the process may not speak to anybody) and
 * `not_configured` (nothing saved) are different words, and an absent read is `unknown`.
 *
 * THE SMTP RULE (operator, 2026-10-28): a probe of smtp is a real letter, so the deck never
 * offers one. Its door is the sender level, where the owner-pressed Send test lives; nothing
 * here or in the reads polls, probes on load or refreshes health in the background.
 * Words live in the catalog (`channelsNight.connectors.*`); this module returns keys and numbers.
 */
import type { Condition } from "@/app/_components/kit/scene/conditions.ts";
import type { ConnectorHealth, ConnectorId } from "@/app/_lib/connect/catalog.ts";

/** One row of GET /api/connect, as far as the deck reads it (never a field value). */
export type ConnectorWire = {
  id: ConnectorId;
  health: ConnectorHealth;
  lastOkAt: string | null;
  lastFailure: { at: string | null; reason: string } | null;
  /** A fix only a person can make (a revoked calendar grant: Reconnect); null otherwise. */
  repair: "reconnect" | null;
};

const HEALTH: readonly string[] = ["connected", "not_configured", "failing", "unverified", "sealed"];
const KNOWN_ID = /^(comms_relay|smtp|ats_webhook|calendar|ats_inbound:[a-z]+)$/;

/** One GET /api/connect body -> the rows, or null when it carries none (an older server, a
 *  refusal). A row with an id or a health word we do not know is dropped, never guessed. */
export function parseConnectBody(body: unknown): ConnectorWire[] | null {
  const list = (body as { connectors?: unknown } | null)?.connectors;
  if (!Array.isArray(list)) return null;
  const out: ConnectorWire[] = [];
  for (const raw of list) {
    const r = raw as Partial<ConnectorWire> | null;
    if (!r || typeof r.id !== "string" || !KNOWN_ID.test(r.id) || typeof r.health !== "string" || !HEALTH.includes(r.health)) continue;
    const f = r.lastFailure;
    out.push({
      id: r.id as ConnectorId,
      health: r.health as ConnectorHealth,
      lastOkAt: typeof r.lastOkAt === "string" ? r.lastOkAt : null,
      lastFailure: f && typeof f.reason === "string" ? { at: typeof f.at === "string" ? f.at : null, reason: f.reason } : null,
      repair: r.repair === "reconnect" ? "reconnect" : null,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ the words */

/** Health word -> the condition its card wears. `sealed` is `unknown` (nobody was allowed to
 *  check), `not_configured` is `off` (nothing to check): two marks, two label keys. */
export const HEALTH_CONDITION: Record<ConnectorHealth, Condition> = {
  connected: "live",
  unverified: "wait",
  failing: "fail",
  not_configured: "off",
  sealed: "unknown",
};

export const HEALTH_LABEL = {
  connected: "channelsNight.connectors.health.connected",
  unverified: "channelsNight.connectors.health.unverified",
  failing: "channelsNight.connectors.health.failing",
  not_configured: "channelsNight.connectors.health.notConfigured",
  sealed: "channelsNight.connectors.health.sealed",
} as const satisfies Record<ConnectorHealth, string>;

/* ------------------------------------------------------------------ the cards */

export type DeckGroup = "delivery" | "ats" | "calendar";
export const DECK_GROUPS: readonly DeckGroup[] = ["delivery", "ats", "calendar"];

/** What a card's one button does:
 *  probe   POST /api/connect/<id>/probe, on a press
 *  sender  open the sender level (the relay and SMTP setup, where Send test lives)
 *  reconnect  run the OAuth connect again (a revoked calendar grant: another probe cannot fix it)
 *  null    nothing to press here (sealed, or set up in the panel under the cards) */
export type DeckDoor = "probe" | "sender" | "reconnect" | null;

/** Does the calendar's free/busy count as read? Only a probe that proved it: anything else is
 *  `unknown`, never "free". */
export type BusyRead = "read" | "unknown";

export type DeckCard = {
  id: ConnectorId;
  group: DeckGroup;
  /** The inbound ATS provider an `ats_inbound:<provider>` row names. */
  provider: string | null;
  health: ConnectorHealth;
  condition: Condition;
  label: (typeof HEALTH_LABEL)[ConnectorHealth];
  door: DeckDoor;
  /** The calendar card only. */
  busy?: BusyRead;
  lastOkAt: string | null;
  failure: string | null;
};

export function groupOf(id: ConnectorId): DeckGroup {
  if (id === "comms_relay" || id === "smtp") return "delivery";
  if (id === "calendar") return "calendar";
  return "ats";
}

/** The door a card offers. smtp NEVER gets `probe`: its probe is a letter (the rule above). */
export function doorOf(row: Pick<ConnectorWire, "id" | "health"> & { repair?: ConnectorWire["repair"] }): DeckDoor {
  if (row.id === "smtp") return "sender";
  if (row.repair === "reconnect") return "reconnect";
  if (row.health === "sealed") return null;
  if (row.health === "not_configured") return row.id === "comms_relay" ? "sender" : null;
  return "probe";
}

/** The probe URL a press may call, or null for a connector the hub never probes (smtp). */
export function probeUrl(id: ConnectorId): string | null {
  if (id === "smtp") return null;
  return `/api/connect/${encodeURIComponent(id)}/probe`;
}

export function deckCard(row: ConnectorWire): DeckCard {
  const card: DeckCard = {
    id: row.id,
    group: groupOf(row.id),
    provider: row.id.startsWith("ats_inbound:") ? row.id.slice("ats_inbound:".length) : null,
    health: row.health,
    condition: HEALTH_CONDITION[row.health],
    label: HEALTH_LABEL[row.health],
    door: doorOf(row),
    lastOkAt: row.lastOkAt,
    failure: row.lastFailure?.reason ?? null,
  };
  if (row.id === "calendar") card.busy = row.health === "connected" ? "read" : "unknown";
  return card;
}

/** Every card, grouped in the deck's order; rows keep the catalog's order inside a group. */
export function deckCards(rows: readonly ConnectorWire[]): Record<DeckGroup, DeckCard[]> {
  const out: Record<DeckGroup, DeckCard[]> = { delivery: [], ats: [], calendar: [] };
  for (const row of rows) out[groupOf(row.id)].push(deckCard(row));
  return out;
}

/** A calendar grant only Reconnect can fix (revoked at Google, or a token that no longer
 *  decrypts): the plumbing lists it as a need. null = the catalog was not read. */
export function calendarNeedsReconnect(rows: readonly ConnectorWire[] | null): boolean | null {
  if (rows === null) return null;
  return rows.some((r) => r.id === "calendar" && r.repair === "reconnect");
}

/* ------------------------------------------------------------------ the door on level 0 */

export type DeckSummary = { total: number; connected: number; failing: number; sealed: boolean };

/** The one line the plumbing's door into the deck says; null = the catalog was not read. */
export function deckSummary(rows: readonly ConnectorWire[] | null): DeckSummary | null {
  if (rows === null) return null;
  return {
    total: rows.length,
    connected: rows.filter((r) => r.health === "connected").length,
    failing: rows.filter((r) => r.health === "failing").length,
    sealed: rows.length > 0 && rows.every((r) => r.health === "sealed"),
  };
}
