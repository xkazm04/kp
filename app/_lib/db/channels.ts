import { randomToken } from "../random-id";
import { ensureDb } from "./core";

// ---- Inbound channel webhooks (Erika gap E3) --------------------------------

// The channel ids that accept inbound webhooks — exactly the two stub channels
// the Channels tab shows as "not configured" until a webhook exists. The
// registry-facing ids; a webhook's leads are attributed to this id on the entry.
export const WEBHOOK_CHANNELS = ["email", "boards"] as const;
export type WebhookChannelId = (typeof WEBHOOK_CHANNELS)[number];

export function isWebhookChannel(value: string): value is WebhookChannelId {
  return (WEBHOOK_CHANNELS as readonly string[]).includes(value);
}

export type ChannelWebhookRecord = {
  token: string;
  channel: WebhookChannelId;
  jobId: string;
  // Joined for display; null when the job row has vanished (the webhook then
  // 404s at receive time anyway).
  jobTitle: string | null;
  lang: string | null;
  createdAt: string;
  receivedCount: number;
  lastReceivedAt: string | null;
  // E5 — the webhook's first lead (time-to-first-lead = this minus createdAt).
  firstReceivedAt: string | null;
};

type ChannelWebhookRow = {
  token: string;
  channel: string;
  job_id: string;
  job_title: string | null;
  lang: string | null;
  created_at: string;
  received_count: number;
  last_received_at: string | null;
  first_received_at: string | null;
};

function rowToWebhook(r: ChannelWebhookRow): ChannelWebhookRecord {
  return {
    token: r.token,
    channel: r.channel as WebhookChannelId,
    jobId: r.job_id,
    jobTitle: r.job_title,
    lang: r.lang,
    createdAt: r.created_at,
    receivedCount: r.received_count,
    lastReceivedAt: r.last_received_at,
    firstReceivedAt: r.first_received_at,
  };
}

const WEBHOOK_SELECT = `
  SELECT w.token, w.channel, w.job_id, j.title AS job_title, w.lang,
         w.created_at, w.received_count, w.last_received_at, w.first_received_at
  FROM channel_webhooks w LEFT JOIN jobs j ON j.id = w.job_id`;

/** Mint a webhook binding. The token is the ONLY gate on this public,
 *  side-effecting endpoint, so it comes from randomToken (CSPRNG), never randomId. */
export function createChannelWebhook(input: { channel: WebhookChannelId; jobId: string; lang?: string | null }): ChannelWebhookRecord {
  const db = ensureDb();
  const token = randomToken("hook");
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO channel_webhooks (token, channel, job_id, lang, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(token, input.channel, input.jobId, input.lang ?? null, now);
  const row = db.prepare(`${WEBHOOK_SELECT} WHERE w.token = ?`).get(token) as ChannelWebhookRow;
  return rowToWebhook(row);
}

/** Active (non-revoked) webhooks, newest first — the Channels tab's list AND
 *  what flips a stub channel's badge to "Listening". */
export function listChannelWebhooks(): ChannelWebhookRecord[] {
  const db = ensureDb();
  const rows = db
    .prepare(`${WEBHOOK_SELECT} WHERE w.revoked_at IS NULL ORDER BY w.created_at DESC`)
    .all() as ChannelWebhookRow[];
  return rows.map(rowToWebhook);
}

/** The receive-time lookup: an unknown OR revoked token both resolve to null —
 *  the receiver answers 404 either way, so a revoked token is indistinguishable
 *  from one that never existed. */
export function getActiveChannelWebhook(token: string): ChannelWebhookRecord | null {
  const db = ensureDb();
  const row = db
    .prepare(`${WEBHOOK_SELECT} WHERE w.token = ? AND w.revoked_at IS NULL`)
    .get(token) as ChannelWebhookRow | undefined;
  return row ? rowToWebhook(row) : null;
}

/** Revoke (idempotent). The row is kept — its receipt history stays auditable. */
export function revokeChannelWebhook(token: string): boolean {
  const db = ensureDb();
  const res = db
    .prepare(`UPDATE channel_webhooks SET revoked_at = ? WHERE token = ? AND revoked_at IS NULL`)
    .run(new Date().toISOString(), token);
  return res.changes > 0;
}

/** Stamp one received payload (count + timestamps) — the tab's liveness signal.
 *  first_received_at is FILL-ONLY: the first receipt sets it, later ones never
 *  move it (it anchors the time-to-first-lead metric). */
export function recordChannelWebhookReceipt(token: string): void {
  const db = ensureDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE channel_webhooks
        SET received_count = received_count + 1,
            last_received_at = ?,
            first_received_at = COALESCE(first_received_at, ?)
      WHERE token = ?`
  ).run(now, now, token);
}

// ---- Channel spend (Erika gap E5) -------------------------------------------

/** Recruiter-entered spend per source channel (CZK) — the denominator for
 *  cost-per-applicant / cost-per-hire. amountCzk null/≤0 clears the figure. */
export function setChannelSpend(channel: string, amountCzk: number | null): void {
  const db = ensureDb();
  if (amountCzk == null || !(amountCzk > 0)) {
    db.prepare(`DELETE FROM channel_spend WHERE channel = ?`).run(channel);
    return;
  }
  db.prepare(
    `INSERT INTO channel_spend (channel, amount_czk, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(channel) DO UPDATE SET amount_czk = excluded.amount_czk, updated_at = excluded.updated_at`
  ).run(channel, amountCzk, new Date().toISOString());
}

export function listChannelSpend(): Map<string, number> {
  const db = ensureDb();
  const rows = db.prepare(`SELECT channel, amount_czk FROM channel_spend`).all() as {
    channel: string;
    amount_czk: number;
  }[];
  return new Map(rows.map((r) => [r.channel, r.amount_czk]));
}
