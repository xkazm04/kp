import { getJob } from "./db/jobs";
import { getPipelineEntry } from "./db/pipeline";
import { listDecisionRecords } from "./decision-record-store";
import { getOpenOfferForEntry, listOffersForEntry } from "./offers-store";
import { buildAtsRecord, type AtsCandidateRecord } from "./ats-record.ts";
import { getAtsConfig, getAtsSecret } from "./ats-config-store.ts";
import { assertDeliverableWebhookUrl } from "./ats-egress-guard.ts";
import {
  finalizeAtsDelivery,
  listDueAtsDeliveries,
  recordAtsDeliveryStart,
} from "./ats-delivery-store.ts";
import {
  type AtsEventType,
  buildEnvelope,
  EVENT_HEADER,
  SIGNATURE_HEADER,
  signWebhookBody,
} from "./ats-webhook.ts";

// P1-5 — the server-side egress: turn a pipeline entry into the normalized,
// vendor-neutral ATS record (the honest replacement for the whole-DB dump), and
// deliver lifecycle events to the configured webhook. The mapping itself is the
// pure buildAtsRecord; this module is the DB-fetch + HTTP delivery around it.

/** Build the portable record for one candidate, or null if the entry is gone.
 *  Pulls the latest SEALED decision (candidateRef = entry id) and the offer comp.
 *
 *  TENANCY: `workspaceId` is the caller's team. Both reads below were unscoped, so
 *  this only ever served the DEFAULT tenant — a non-default team's ATS connector
 *  got 404 for every one of its own candidates, and the decision chain it read was
 *  the wrong team's. The entry is fetched first precisely so the decision lookup
 *  can key off the tenant it proves. */
export function getAtsRecord(entryId: string, workspaceId?: string): AtsCandidateRecord | null {
  const entry = getPipelineEntry(entryId, workspaceId);
  if (!entry) return null;
  const job = entry.jobId ? getJob(entry.jobId) : null;
  const latest = listDecisionRecords({ candidateRef: entryId, limit: 1, workspaceId: entry.workspaceId })[0] ?? null;
  // Which offer's comp the record carries: the offer that actually caused the
  // hire, not the oldest on file. getOpenOfferForEntry only matches status
  // 'extended', so at candidate.hired time (offer already 'accepted') it returns
  // null and the old fallback listOffersForEntry(entryId)[0] shipped the OLDEST
  // offer (created_at ASC) — wrong salary AND a contradictory 'declined' status
  // inside a hired event on any re-extended entry. Prefer the most-recent accepted
  // offer, then any still-open one, then the most-recent offer overall.
  const offers = listOffersForEntry(entryId); // created_at ASC
  const offer =
    [...offers].reverse().find((o) => o.status === "accepted") ??
    getOpenOfferForEntry(entryId) ??
    offers.at(-1) ??
    null;
  return buildAtsRecord({
    entry,
    job: job ? { id: job.id, title: job.title ?? null, company: job.company ?? null } : null,
    decision: latest
      ? {
          kind: latest.kind,
          actor: latest.actor,
          reasonCode: latest.reasonCode,
          contentHash: latest.contentHash,
          policyVersion: latest.policyVersion,
          createdAt: latest.createdAt,
        }
      : null,
    offer: offer ? { currency: offer.currency, salary: offer.salary, status: offer.status } : null,
    exportedAt: new Date().toISOString(),
  });
}

export type DeliveryResult =
  | { delivered: true; status: number }
  | { delivered: false; reason: string; status?: number };

/** POST one envelope to the configured webhook, signed when a secret is set.
 *  5s timeout. Returns a structured result (never throws) so the test-ping route
 *  and the lifecycle dispatcher can both record it.
 *
 *  DELIVERED means the RECEIVER ACCEPTED it (HTTP 2xx). A non-2xx response
 *  (4xx/5xx), a timeout, a network error, or an unusable signing key is a
 *  FAILURE — previously ANY HTTP response counted as delivered, so a receiver
 *  returning 500/401 was silently treated as success and the event was lost. */
export async function deliver(event: AtsEventType, data: AtsCandidateRecord | { ping: true }): Promise<DeliveryResult> {
  const cfg = getAtsConfig();
  if (!cfg.webhookUrl) return { delivered: false, reason: "No webhook URL configured." };
  // Re-vet AND resolve the host immediately before the fetch (not just at write
  // time): https-only, no IP literals / internal names, and reject if the host
  // resolves to a loopback/link-local/RFC-1918/metadata address (DNS-rebind guard).
  // A rejection returns a validation reason — the target is never contacted, so no
  // status/body of an internal probe can leak back through the test route.
  let target: string;
  try {
    target = await assertDeliverableWebhookUrl(cfg.webhookUrl);
  } catch (e) {
    return { delivered: false, reason: e instanceof Error ? e.message : "webhook URL rejected." };
  }
  const body = JSON.stringify(buildEnvelope(event, data, new Date().toISOString()));
  const headers: Record<string, string> = { "Content-Type": "application/json", [EVENT_HEADER]: event };
  // Decrypt the signing secret to sign. Keep deliver() total: a missing/rotated
  // at-rest key surfaces as a delivery failure (→ recorded for retry) rather than a
  // throw, so it never sends the body UNSIGNED behind the operator's back.
  let secret: string | null;
  try {
    secret = getAtsSecret();
  } catch (e) {
    return { delivered: false, reason: `signing secret unavailable: ${e instanceof Error ? e.message : "decrypt failed"}` };
  }
  if (secret) headers[SIGNATURE_HEADER] = signWebhookBody(secret, body);
  try {
    const r = await fetch(target, { method: "POST", headers, body, signal: AbortSignal.timeout(5000) });
    if (r.ok) return { delivered: true, status: r.status };
    return { delivered: false, status: r.status, reason: `webhook endpoint responded ${r.status}` };
  } catch (e) {
    return { delivered: false, reason: e instanceof Error ? e.message : "delivery failed" };
  }
}

/** Fold a DeliveryResult into the ledger-store outcome shape. */
function toOutcome(result: DeliveryResult): { delivered: boolean; status?: number; reason?: string } {
  return result.delivered
    ? { delivered: true, status: result.status }
    : { delivered: false, status: result.status, reason: result.reason };
}

/** Fire a lifecycle event for an entry to the webhook. Non-blocking for the caller's
 *  outcome (the hire/reject already committed), but NOT fire-and-forget: every attempt
 *  is written to the durable delivery ledger, so a non-2xx / timeout / network failure
 *  becomes a `failed`, operator-visible, RETRYABLE record instead of a silent loss.
 *  Skips (records nothing) when the webhook is unconfigured or the event isn't
 *  subscribed. Never throws. Call as `void dispatchAtsEvent(...)`. */
export async function dispatchAtsEvent(event: AtsEventType, entryId: string): Promise<void> {
  try {
    const cfg = getAtsConfig();
    if (!cfg.webhookUrl || !cfg.events.includes(event)) return;
    const record = getAtsRecord(entryId);
    if (!record) return;
    const deliveryId = recordAtsDeliveryStart(event, entryId);
    const result = await deliver(event, record);
    finalizeAtsDelivery(deliveryId, toOutcome(result));
    if (!result.delivered) {
      console.error(`[ats] ${event} webhook not delivered for ${entryId} (recorded #${deliveryId} for retry): ${result.reason}`);
    }
  } catch (e) {
    console.error(`[ats] dispatch ${event} failed for ${entryId}:`, e instanceof Error ? e.message : e);
  }
}

/** Retry every failed delivery whose backoff window has elapsed (and that still has
 *  retry budget). Called by an operator via POST /api/ats/deliveries or an external
 *  cron on a timer. Re-builds the record from CURRENT entry state (a mirror wants the
 *  latest), so a since-deleted entry is finalized off the queue. Never throws per row. */
export async function retryDueAtsDeliveries(now: Date = new Date()): Promise<{ due: number; delivered: number; failed: number }> {
  const due = listDueAtsDeliveries(now.toISOString());
  let delivered = 0;
  let failed = 0;
  for (const row of due) {
    try {
      const record = getAtsRecord(row.entryId);
      if (!record) {
        finalizeAtsDelivery(row.id, { delivered: false, reason: "pipeline entry no longer exists" });
        failed++;
        continue;
      }
      const result = await deliver(row.event, record);
      finalizeAtsDelivery(row.id, toOutcome(result));
      if (result.delivered) delivered++;
      else failed++;
    } catch (e) {
      finalizeAtsDelivery(row.id, { delivered: false, reason: e instanceof Error ? e.message : "retry failed" });
      failed++;
    }
  }
  return { due: due.length, delivered, failed };
}
