import { egressSealed } from "@/app/_lib/egress-seal";
import { relayHealth } from "@/app/_lib/comms-relay";
import { getRelayConfig } from "@/app/_lib/comms-relay-store";
import { getAtsConfig } from "@/app/_lib/ats-config-store";
import { ATS_PROVIDERS, getAtsConnection, type AtsProvider } from "@/app/_lib/ats/connections-store";
import { getCalendarConnection } from "@/app/_lib/calendar/token-store";
import { isCalendarConnected } from "@/app/_lib/calendar/google-calendar";
import { probeAtsInbound, probeAtsWebhook, probeCalendar, probeRelay, type ProbeResult } from "./probes";

// THE CONNECTOR CATALOG — what kp can talk to, as DATA. One row per connector, one
// vocabulary for how it is doing (docs/features/connect/README.md). The catalog owns no
// credentials and no state of its own beyond a bounded in-process probe cache: every
// field is read from the store that already keeps it, and a secret is write-only here
// exactly as it is in those stores — `hasSecret`, never the value.

/** The only words a row's `health` may take. `sealed` outranks the rest: under
 *  KP_NO_COMMS_EGRESS=1 nothing may speak to an outside party, so nothing can be called
 *  connected (or failing) on a claim the process is forbidden to check. */
export const HEALTH_WORDS = ["connected", "not_configured", "failing", "unverified", "sealed"] as const;
export type ConnectorHealth = (typeof HEALTH_WORDS)[number];

/** What a connector's traffic is about — the question a seal or a consent review asks. */
export const EGRESS_CLASSES = ["candidate_message", "candidate_record", "schedule_read", "credentialed_read"] as const;
export type EgressClass = (typeof EGRESS_CLASSES)[number];

export type ConnectorId = "comms_relay" | "ats_webhook" | "calendar" | `ats_inbound:${AtsProvider}`;

export const CONNECTOR_IDS: readonly ConnectorId[] = [
  "comms_relay",
  "ats_webhook",
  "calendar",
  ...ATS_PROVIDERS.map((p): ConnectorId => `ats_inbound:${p}`),
];

export type ConnectorField = {
  key: string;
  secret: boolean;
  /** Secret fields only: whether a value is stored. The value itself never leaves. */
  hasSecret?: boolean;
  /** Non-secret fields only; null when unset. */
  value?: string | null;
};

export type ConnectorFailure = { at: string | null; reason: string };

export type ConnectorRow = {
  id: ConnectorId;
  label: string;
  egress: EgressClass;
  fields: ConnectorField[];
  health: ConnectorHealth;
  lastOkAt: string | null;
  lastFailure: ConnectorFailure | null;
};

/** What a definition reads from its store, with no network. */
type Snapshot = {
  configured: boolean;
  /** Changes whenever the saved configuration changes: a probe verdict is only valid for
   *  the version it ran against, so a re-saved row falls back to `unverified`. */
  version: string;
  fields: ConnectorField[];
  /** A failure the store itself already knows (a revoked calendar grant), so the row can
   *  read `failing` without a probe having run. */
  known?: ConnectorFailure;
};

type ConnectorDef = {
  id: ConnectorId;
  label: string;
  egress: EgressClass;
  snapshot(workspaceId: string): Snapshot;
  probe(workspaceId: string): Promise<ProbeResult>;
};

const secretField = (key: string, has: boolean): ConnectorField => ({ key, secret: true, hasSecret: has });
const textField = (key: string, value: string | null): ConnectorField => ({ key, secret: false, value });

const DEFINITIONS: readonly ConnectorDef[] = [
  {
    id: "comms_relay",
    label: "Delivery relay",
    egress: "candidate_message",
    snapshot() {
      const cfg = getRelayConfig();
      const health = relayHealth();
      return {
        configured: health !== "unconfigured",
        version: `${health}:${cfg.version}`,
        fields: [textField("url", cfg.url), secretField("secret", cfg.hasSecret)],
        known:
          health === "unreadable"
            ? { at: null, reason: "The stored signing secret cannot be decrypted." }
            : undefined,
      };
    },
    probe: () => probeRelay(),
  },
  {
    id: "ats_webhook",
    label: "ATS webhook",
    egress: "candidate_record",
    snapshot() {
      const cfg = getAtsConfig();
      return {
        configured: !!cfg.webhookUrl,
        version: String(cfg.version),
        fields: [textField("webhookUrl", cfg.webhookUrl), secretField("secret", cfg.hasSecret)],
      };
    },
    probe: () => probeAtsWebhook(),
  },
  {
    id: "calendar",
    label: "Google Calendar",
    egress: "schedule_read",
    snapshot(workspaceId) {
      const conn = getCalendarConnection(workspaceId);
      const configured = isCalendarConnected(workspaceId);
      return {
        configured,
        version: conn?.connectedAt ?? "none",
        fields: [
          textField("accountEmail", conn?.accountEmail ?? null),
          textField("calendarId", conn?.calendarId ?? null),
          secretField("refreshToken", !!conn?.connected),
        ],
        // The grant's own recorded health: Google withdrew it, or the at-rest key moved.
        known:
          configured && conn && conn.health !== "ok"
            ? { at: conn.healthAt, reason: conn.health === "revoked" ? "Calendar grant revoked." : "Stored calendar token is unreadable." }
            : undefined,
      };
    },
    probe: (workspaceId) => probeCalendar(workspaceId),
  },
  ...ATS_PROVIDERS.map(
    (provider): ConnectorDef => ({
      id: `ats_inbound:${provider}`,
      label: `ATS import: ${provider}`,
      egress: "credentialed_read",
      snapshot() {
        const conn = getAtsConnection(provider);
        return {
          configured: !!conn?.baseUrl && !!conn.hasToken,
          version: String(conn?.version ?? 0),
          fields: [textField("baseUrl", conn?.baseUrl ?? null), secretField("apiToken", !!conn?.hasToken)],
        };
      },
      probe: () => probeAtsInbound(provider),
    })
  ),
];

// ---- Probe memory -----------------------------------------------------------------
// No schema: a verdict lives in this process and dies with it, after which every
// configured row honestly reads `unverified` until someone probes again. Bounded, so a
// long-lived server cannot grow it past workspaces x connectors.
const MAX_ENTRIES = 512;
const MAX_REASON_CHARS = 200;

type Memory = { version: string; verdict: "ok" | "failed"; lastOkAt: string | null; lastFailure: ConnectorFailure | null };
const memory = new Map<string, Memory>();

const keyOf = (workspaceId: string, id: ConnectorId) => `${workspaceId}\u0000${id}`;

export function resetConnectMemoryForTests(): void {
  memory.clear();
}

function remember(workspaceId: string, id: ConnectorId, version: string, ok: boolean, reason: string, now: string): void {
  const key = keyOf(workspaceId, id);
  const prev = memory.get(key);
  memory.delete(key); // re-insert so Map order is recency order
  memory.set(key, {
    version,
    verdict: ok ? "ok" : "failed",
    lastOkAt: ok ? now : (prev?.lastOkAt ?? null),
    lastFailure: ok ? (prev?.lastFailure ?? null) : { at: now, reason: reason.slice(0, MAX_REASON_CHARS) },
  });
  while (memory.size > MAX_ENTRIES) memory.delete(memory.keys().next().value as string);
}

function healthOf(snap: Snapshot, mem: Memory | undefined): ConnectorHealth {
  if (egressSealed()) return "sealed";
  if (!snap.configured) return "not_configured";
  if (snap.known) return "failing";
  if (!mem || mem.version !== snap.version) return "unverified";
  return mem.verdict === "ok" ? "connected" : "failing";
}

function rowOf(def: ConnectorDef, workspaceId: string): ConnectorRow {
  const snap = def.snapshot(workspaceId);
  const mem = memory.get(keyOf(workspaceId, def.id));
  return {
    id: def.id,
    label: def.label,
    egress: def.egress,
    fields: snap.fields,
    health: healthOf(snap, mem),
    lastOkAt: mem?.lastOkAt ?? null,
    lastFailure: snap.known ?? mem?.lastFailure ?? null,
  };
}

/** Every connector, as the API serves it. Reads stores only: 0 network calls, sealed or not. */
export function listConnectors(workspaceId: string): ConnectorRow[] {
  return DEFINITIONS.map((def) => rowOf(def, workspaceId));
}

export function isConnectorId(v: unknown): v is ConnectorId {
  return typeof v === "string" && (CONNECTOR_IDS as readonly string[]).includes(v);
}

/** Run one connector's probe and record the verdict. Sealed or unconfigured: nothing is
 *  recorded (there was no check), and the row reads `sealed` / `not_configured`. */
export async function probeConnector(id: ConnectorId, workspaceId: string, now: Date = new Date()): Promise<ConnectorRow> {
  const def = DEFINITIONS.find((d) => d.id === id);
  if (!def) throw new Error(`unknown connector: ${id}`);
  const snap = def.snapshot(workspaceId);
  if (egressSealed() || !snap.configured) return rowOf(def, workspaceId);
  const result = await def.probe(workspaceId);
  const at = now.toISOString();
  if (result.kind === "http") {
    remember(workspaceId, id, snap.version, result.ok, `HTTP ${result.status}`, at);
  } else if (result.kind === "failed") {
    remember(workspaceId, id, snap.version, false, result.reason, at);
  }
  return rowOf(def, workspaceId);
}
