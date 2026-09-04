import { randomToken } from "../random-id";
import { decryptAtsSecret, encryptAtsSecret, isEncryptedAtsSecret } from "../ats-secret";
import { assertPublicHttpsEndpoint } from "../safe-url";
import { ensureDb } from "./core";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";

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
  // Raw AUTHENTICATED POSTs received — the connection LIVENESS signal (includes probes,
  // pings, malformed bodies, rejected payloads and retries, so NOT a lead count). See
  // recordChannelWebhookReceipt for the full contract.
  receivedCount: number;
  lastReceivedAt: string | null;
  firstReceivedAt: string | null;
  // E5 — ACCEPTED leads only (intake actually filed a candidate). This is the real
  // lead count; firstAcceptedAt anchors time-to-first-lead (= this minus createdAt).
  acceptedCount: number;
  firstAcceptedAt: string | null;
  // The team that minted the webhook — leads it accepts are filed into this workspace.
  workspaceId: string;
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
  accepted_count: number;
  first_accepted_at: string | null;
  workspace_id: string;
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
    acceptedCount: r.accepted_count ?? 0,
    firstAcceptedAt: r.first_accepted_at,
    workspaceId: r.workspace_id,
  };
}

const WEBHOOK_SELECT = `
  SELECT w.token, w.channel, w.job_id, j.title AS job_title, w.lang,
         w.created_at, w.received_count, w.last_received_at, w.first_received_at,
         w.accepted_count, w.first_accepted_at, w.workspace_id
  FROM channel_webhooks w LEFT JOIN jobs j ON j.id = w.job_id`;

/** Mint a webhook binding. The token is the ONLY gate on this public,
 *  side-effecting endpoint, so it comes from randomToken (CSPRNG), never randomId. */
export function createChannelWebhook(
  input: { channel: WebhookChannelId; jobId: string; lang?: string | null },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): ChannelWebhookRecord {
  const db = ensureDb();
  const token = randomToken("hook");
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO channel_webhooks (token, channel, job_id, lang, created_at, workspace_id) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(token, input.channel, input.jobId, input.lang ?? null, now, workspaceId);
  // Re-read by the freshly-minted token (globally unique) — no workspace filter needed.
  const row = db.prepare(`${WEBHOOK_SELECT} WHERE w.token = ?`).get(token) as ChannelWebhookRow;
  return rowToWebhook(row);
}

/** Active (non-revoked) webhooks, newest first — the Channels tab's list AND
 *  what flips a stub channel's badge to "Listening". */
export function listChannelWebhooks(workspaceId: string = DEFAULT_WORKSPACE_ID): ChannelWebhookRecord[] {
  const db = ensureDb();
  const rows = db
    .prepare(`${WEBHOOK_SELECT} WHERE w.revoked_at IS NULL AND w.workspace_id = ? ORDER BY w.created_at DESC`)
    .all(workspaceId) as ChannelWebhookRow[];
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
export function revokeChannelWebhook(token: string, workspaceId: string = DEFAULT_WORKSPACE_ID): boolean {
  const db = ensureDb();
  // Recruiter management action (not the public receiver): scope to the owning team so a
  // session can't revoke another team's webhook even if it learned the token.
  const res = db
    .prepare(`UPDATE channel_webhooks SET revoked_at = ? WHERE token = ? AND revoked_at IS NULL AND workspace_id = ?`)
    .run(new Date().toISOString(), token, workspaceId);
  return res.changes > 0;
}

/** Stamp one RECEIVED payload (count + timestamps) — the tab's connection LIVENESS
 *  signal. ONE contract, implemented at exactly one call site (the receiver, right after
 *  the token resolves): stamped for EVERY AUTHENTICATED POST, whatever becomes of its
 *  payload — a probe, a malformed body, a closed-role hit, a 413/422 field-mapping
 *  failure, a rate-limited-after-auth call, a duplicate delivery. It is NOT stamped when
 *  no caller has authenticated: an unknown or revoked token (nothing to attribute the
 *  receipt to) or a flood shed by the rate limiter before the token is read.
 *
 *  The doc used to say exactly this while the receiver stamped only after a TERMINAL
 *  intake outcome, so a mis-mapped integration 422-ing on every lead looked identical to
 *  a receiver nobody ever connected. Presence of a receipt now means "something is wired
 *  and talking to this endpoint" and nothing more.
 *
 *  NOT a lead count — use recordChannelWebhookAccepted for that. The two counters answer
 *  different questions ("is it connected?" vs "did it deliver candidates?") and the
 *  Channels tab shows both. */
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

/** Stamp one ACCEPTED lead — called ONLY when intake actually files a candidate (not
 *  on a probe / no-email / closed-role / KO-decline). This is the honest lead count;
 *  first_accepted_at is FILL-ONLY and anchors the true time-to-first-lead. */
export function recordChannelWebhookAccepted(token: string): void {
  const db = ensureDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE channel_webhooks
        SET accepted_count = accepted_count + 1,
            first_accepted_at = COALESCE(first_accepted_at, ?)
      WHERE token = ?`
  ).run(now, token);
}

// ---- Pull sources (L0, docs/concepts/local-first-edge.md §3.1) --------------

// A receiver row with `pull_url` set is BIDIRECTIONAL: the source still may POST to
// /api/channels/inbound/<token>, and the clock ALSO pulls it on each tick. That is
// the whole answer to the local-first problem for sources that can be listed — a
// delivery made while the studio was closed is not lost, it is simply collected
// late. The row's job/lang/workspace binding is unchanged, so a pulled lead files
// exactly where a pushed one would.

/** The pull half of a receiver row. `hasSecret` follows the write-only credential
 *  doctrine (ats-config-store): a reader learns THAT a token is set, never its value. */
export type ChannelPullConfig = {
  url: string | null;
  hasSecret: boolean;
  cursor: string | null;
  lastPullAt: string | null;
  lastPullError: string | null;
};

type PullRow = {
  pull_url: string | null;
  pull_secret: string | null;
  pull_cursor: string | null;
  last_pull_at: string | null;
  last_pull_error: string | null;
};

/** One pull source as the CLOCK needs it — including the decrypted bearer token,
 *  which is why this is server-internal and never shaped into an API response. */
export type PullSource = {
  token: string;
  channel: WebhookChannelId;
  jobId: string;
  lang: string | null;
  workspaceId: string;
  url: string;
  secret: string | null;
  cursor: string | null;
};

/** The recruiter-side read, and therefore TENANT-SCOPED: unlike the receiver's own
 *  by-token lookup (where the CSPRNG token IS the capability), this answers a
 *  logged-in session, so it must not describe another team's receiver. */
export function getChannelPullConfig(token: string, workspaceId: string): ChannelPullConfig | null {
  const row = ensureDb()
    .prepare(
      `SELECT pull_url, pull_secret, pull_cursor, last_pull_at, last_pull_error
         FROM channel_webhooks WHERE token = ? AND workspace_id = ?`
    )
    .get(token, workspaceId) as PullRow | undefined;
  if (!row) return null;
  return {
    url: row.pull_url,
    hasSecret: !!row.pull_secret,
    cursor: row.pull_cursor,
    lastPullAt: row.last_pull_at,
    lastPullError: row.last_pull_error,
  };
}

/**
 * Configure (or disable) pulling for one receiver. Secret handling copies the
 * ats-config-store contract exactly:
 *   • `secret` omitted (undefined) → keep the stored token.
 *   • `secret` === ""              → clear it (pulls go unauthenticated).
 *   • any other string             → replace it (encrypted at rest).
 * `url` === null or "" disables pulling and CLEARS the cursor — re-enabling a
 * source later must not silently resume from a marker the source has forgotten.
 *
 * Scoped to the owning team (the revokeChannelWebhook precedent): this is a
 * recruiter management action, not the public receiver, so learning a token is
 * not enough to point another team's receiver at your server.
 */
export function setChannelPull(
  token: string,
  input: { url: string | null; secret?: string | undefined },
  workspaceId: string
): boolean {
  const db = ensureDb();
  // Validated HERE, at the write, as well as at every pull: an operator who pastes a
  // loopback or plain-http endpoint learns immediately instead of discovering it in
  // a `last_pull_error` fifteen minutes later. Same SSRF posture as the relay.
  //
  // STRING-LEVEL on purpose, and it is NOT the security boundary. A store write is
  // synchronous (better-sqlite3), and a DNS resolution is not — but more to the
  // point, resolving here would prove nothing: the pull runs off a clock, so the
  // address that answers at fetch time is unrelated to the one that answered at save
  // time. `pullOneSource` (pull-pass.ts) therefore re-vets with
  // `assertPublicHttpsEndpointResolved` immediately before it fetches, which is what
  // closes the DNS-rebinding pivot. This check is the operator's fast feedback; that
  // one is the gate. Same split the ATS webhook boundary uses (ats-config-store.ts
  // writes, ats-egress.ts resolves).
  const url = input.url && input.url.trim() ? assertPublicHttpsEndpoint(input.url.trim(), "pullUrl") : null;
  const current = db
    .prepare(`SELECT pull_secret FROM channel_webhooks WHERE token = ? AND workspace_id = ?`)
    .get(token, workspaceId) as { pull_secret: string | null } | undefined;
  if (!current) return false;
  let stored: string | null = current.pull_secret;
  if (input.secret !== undefined) {
    stored = input.secret === "" ? null : encryptAtsSecret(input.secret);
  }
  const res = db
    .prepare(
      `UPDATE channel_webhooks
          SET pull_url = ?,
              pull_secret = ?,
              pull_cursor = CASE WHEN ? IS NULL THEN NULL ELSE pull_cursor END,
              last_pull_error = NULL
        WHERE token = ? AND workspace_id = ?`
    )
    .run(url, url ? stored : null, url, token, workspaceId);
  return res.changes > 0;
}

/** Every active pull source across the WHOLE installation, for the clock.
 *
 *  GLOBAL BY DESIGN — and deliberately without a defaulted workspace parameter, so
 *  it can never be mistaken for a tenant read (route-tenancy-coverage.test.ts pins
 *  that distinction). The clock is one per installation and must poll every team's
 *  sources; each row carries its own `workspaceId`, which the intake then files
 *  into, so the sweep stays correctly scoped per LEAD without being scoped per
 *  SWEEP. This is the same posture as the automation pass over
 *  listActiveEntriesForAutomation. */
export function listPullSources(): PullSource[] {
  const rows = ensureDb()
    .prepare(
      `SELECT token, channel, job_id, lang, workspace_id, pull_url, pull_secret, pull_cursor
         FROM channel_webhooks
        WHERE revoked_at IS NULL AND pull_url IS NOT NULL AND pull_url <> ''
        ORDER BY created_at ASC`
    )
    .all() as {
    token: string;
    channel: string;
    job_id: string;
    lang: string | null;
    workspace_id: string;
    pull_url: string;
    pull_secret: string | null;
    pull_cursor: string | null;
  }[];
  return rows.map((r) => ({
    token: r.token,
    channel: r.channel as WebhookChannelId,
    jobId: r.job_id,
    lang: r.lang,
    workspaceId: r.workspace_id,
    url: r.pull_url,
    // Legacy plaintext tolerated and re-encrypted on the next write (ats doctrine).
    secret: r.pull_secret === null ? null : isEncryptedAtsSecret(r.pull_secret) ? decryptAtsSecret(r.pull_secret) : r.pull_secret,
    cursor: r.pull_cursor,
  }));
}

/** Record the outcome of one pull. The cursor advances ONLY on a clean pass — a
 *  partially-applied page must be re-fetched rather than skipped, since the source
 *  is the only thing that can replay it (the lead-intake core dedupes by email, so
 *  a re-fetch is cheap and safe; a skipped page is a lost candidate).
 *
 *  `error` is stored as the last-pull truth: null CLEARS a previous failure, so the
 *  UI never shows a stale red on a source that has since recovered. */
export function recordPullResult(token: string, result: { cursor?: string | null; error: string | null }): void {
  const db = ensureDb();
  const now = new Date().toISOString();
  if (result.error === null && result.cursor !== undefined) {
    db.prepare(`UPDATE channel_webhooks SET last_pull_at = ?, last_pull_error = NULL, pull_cursor = ? WHERE token = ?`).run(
      now,
      result.cursor,
      token
    );
    return;
  }
  db.prepare(`UPDATE channel_webhooks SET last_pull_at = ?, last_pull_error = ? WHERE token = ?`).run(now, result.error, token);
}

// ---- Channel spend (Erika gap E5) -------------------------------------------

// UAT KAT-ANA-2 — a stored spend figure is a HUMAN ENTRY, not a measurement, and it
// does not decay on its own. On the seeded host one row (linkedin = 5,000 CZK) written
// by a UAT run six weeks earlier was still dividing into the current hire count and
// rendering as `833 CZK / hire` — a current-looking metric nobody could see the age of,
// because the only surface that carried its own date was the row in SQLite. Every
// figure DERIVED from these rows now travels with the `updated_at` that produced it,
// so a stale entry identifies itself instead of passing as this month's number.
export type ChannelSpendEntry = {
  channel: string;
  amountCzk: number;
  /** When a person last entered this figure (ISO). The derived cost-per-applicant /
   *  cost-per-hire columns are exactly this current and no more. */
  updatedAt: string;
};

/** Recruiter-entered spend per source channel (CZK) — the denominator for
 *  cost-per-applicant / cost-per-hire. amountCzk null/≤0 clears the figure. */
export function setChannelSpend(channel: string, amountCzk: number | null, workspaceId: string = DEFAULT_WORKSPACE_ID): void {
  const db = ensureDb();
  if (amountCzk == null || !(amountCzk > 0)) {
    db.prepare(`DELETE FROM channel_spend WHERE channel = ? AND workspace_id = ?`).run(channel, workspaceId);
    return;
  }
  db.prepare(
    `INSERT INTO channel_spend (channel, amount_czk, updated_at, workspace_id) VALUES (?, ?, ?, ?)
     ON CONFLICT(channel, workspace_id) DO UPDATE SET amount_czk = excluded.amount_czk, updated_at = excluded.updated_at`
  ).run(channel, amountCzk, new Date().toISOString(), workspaceId);
}

/** Spend per channel WITH the date a human entered it — what any surface needs to
 *  render a derived money figure honestly. Prefer this over `listChannelSpend`;
 *  the bare-number form remains for callers that only compare amounts. */
export function listChannelSpendDetail(workspaceId: string = DEFAULT_WORKSPACE_ID): Map<string, ChannelSpendEntry> {
  const db = ensureDb();
  const rows = db
    .prepare(`SELECT channel, amount_czk, updated_at FROM channel_spend WHERE workspace_id = ?`)
    .all(workspaceId) as { channel: string; amount_czk: number; updated_at: string }[];
  return new Map(rows.map((r) => [r.channel, { channel: r.channel, amountCzk: r.amount_czk, updatedAt: r.updated_at }]));
}

export function listChannelSpend(workspaceId: string = DEFAULT_WORKSPACE_ID): Map<string, number> {
  return new Map([...listChannelSpendDetail(workspaceId).values()].map((s) => [s.channel, s.amountCzk]));
}
