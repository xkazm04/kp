import { getJob, getPipelineEntry } from "./db";
import { listDecisionRecords } from "./decision-record-store";
import { getOpenOfferForEntry, listOffersForEntry } from "./offers-store";
import { buildAtsRecord, type AtsCandidateRecord } from "./ats-record.ts";
import { getAtsConfig, getAtsSecret } from "./ats-config-store.ts";
import { assertDeliverableWebhookUrl } from "./ats-egress-guard.ts";
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
 *  Pulls the latest SEALED decision (candidateRef = entry id) and the offer comp. */
export function getAtsRecord(entryId: string): AtsCandidateRecord | null {
  const entry = getPipelineEntry(entryId);
  if (!entry) return null;
  const job = entry.jobId ? getJob(entry.jobId) : null;
  const latest = listDecisionRecords({ candidateRef: entryId, limit: 1 })[0] ?? null;
  const offer = getOpenOfferForEntry(entryId) ?? listOffersForEntry(entryId)[0] ?? null;
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
  | { delivered: false; reason: string };

/** POST one envelope to the configured webhook, signed when a secret is set.
 *  5s timeout. Returns a structured result (never throws) so the test-ping route
 *  can report it; the lifecycle dispatcher ignores it. */
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
  const secret = getAtsSecret();
  if (secret) headers[SIGNATURE_HEADER] = signWebhookBody(secret, body);
  try {
    const r = await fetch(target, { method: "POST", headers, body, signal: AbortSignal.timeout(5000) });
    return { delivered: true, status: r.status };
  } catch (e) {
    return { delivered: false, reason: e instanceof Error ? e.message : "delivery failed" };
  }
}

/** Fire a lifecycle event for an entry to the webhook — BEST EFFORT. Skips when the
 *  webhook is unconfigured or the event isn't subscribed. Never throws and never
 *  blocks the caller's outcome (the hire/reject already committed); a failure is
 *  logged only. Call as `void dispatchAtsEvent(...)`. */
export async function dispatchAtsEvent(event: AtsEventType, entryId: string): Promise<void> {
  try {
    const cfg = getAtsConfig();
    if (!cfg.webhookUrl || !cfg.events.includes(event)) return;
    const record = getAtsRecord(entryId);
    if (!record) return;
    const result = await deliver(event, record);
    if (!result.delivered) {
      console.error(`[ats] ${event} webhook not delivered for ${entryId}: ${result.reason}`);
    }
  } catch (e) {
    console.error(`[ats] dispatch ${event} failed for ${entryId}:`, e instanceof Error ? e.message : e);
  }
}
