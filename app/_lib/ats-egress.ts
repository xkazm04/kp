import { getJob } from "./db/jobs";
import { getEntryWorkspace, getPipelineEntry } from "./db/pipeline";
import { listDecisionRecords } from "./decision-record-store";
import { getOpenOfferForEntry, listOffersForEntry } from "./offers-store";
import { AtsRecordRefusedError, buildAtsRecord, type AtsCandidateRecord } from "./ats-record.ts";
import { getAtsConfig, getAtsSecret } from "./ats-config-store.ts";
import { assertDeliverableWebhookUrl } from "./ats-egress-guard.ts";
import {
  claimAtsDelivery,
  finalizeAtsDelivery,
  listDueAtsDeliveries,
  recordAtsDeliveryStart,
} from "./ats-delivery-store.ts";
import {
  type AtsEventType,
  buildEnvelope,
  EVENT_HEADER,
  IDEMPOTENCY_HEADER,
  SIGNATURE_HEADER,
  signWebhookBody,
  TIMESTAMP_HEADER,
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
  const result = getAtsRecordResult(entryId, workspaceId);
  return result.record;
}

/** What `getAtsRecord` collapses to null, kept apart: "the entry is not there" and "the
 *  mapper REFUSED it" are different facts, and the delivery ledger has to record which
 *  one it met (a refusal is terminal — retrying it forever would be a lie about a
 *  decision that will never change). The API route only needs the null. */
export type AtsRecordResult = {
  record: AtsCandidateRecord | null;
  /** Set only when a record existed but the consent gate refused to release it. */
  refusal: { reason: "anonymized"; message: string } | null;
};

export function getAtsRecordResult(
  entryId: string,
  workspaceId?: string,
  /** The snapshot stamp. A ledger-backed delivery passes its ROW's creation instant so
   *  every attempt of that delivery stamps the same value — otherwise `exportedAt` alone
   *  makes each retry a different byte string, and a receiver that would happily dedupe on
   *  the body cannot. Omitted (the pull door) it is now. */
  exportedAt: string = new Date().toISOString()
): AtsRecordResult {
  const entry = getPipelineEntry(entryId, workspaceId);
  if (!entry) return { record: null, refusal: null };
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
  try {
    const record = buildAtsRecord({
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
      exportedAt,
    });
    return { record, refusal: null };
  } catch (e) {
    // The mapper's consent gate is the ONE refusal shape that reaches here; anything
    // else is a genuine fault and must keep propagating to the caller's own handling.
    if (e instanceof AtsRecordRefusedError) return { record: null, refusal: { reason: e.reason, message: e.message } };
    throw e;
  }
}

export type DeliveryResult =
  | { delivered: true; status: number }
  | { delivered: false; reason: string; status?: number };

/** POST one envelope to the configured webhook, signed when a secret is set.
 *  5s timeout. Returns a structured result (never throws) so the test-ping route
 *  and the lifecycle dispatcher can both record it.
 *
 *  DELIVERED means the RECEIVER ACCEPTED it (HTTP 2xx). A non-2xx response
 *  (4xx/5xx), a REDIRECT (never followed — see below), a timeout, a network error,
 *  or an unusable signing key is a FAILURE — previously ANY HTTP response counted
 *  as delivered, so a receiver returning 500/401 was silently treated as success
 *  and the event was lost. */
export async function deliver(
  event: AtsEventType,
  data: AtsCandidateRecord | { ping: true },
  /** The ledger row this attempt belongs to. Given, every attempt of that row sends the
   *  SAME body (its creation instant as `sentAt`) under the same `Idempotency-Key`, so a
   *  receiver that already accepted attempt N can drop attempt N+1 instead of recording a
   *  second hire. Omitted (the operator's test ping) the instant is now and there is no
   *  key — a ping has no ledger row and nothing to deduplicate. */
  delivery?: { id: number; createdAt: string }
): Promise<DeliveryResult> {
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
  // TWO instants, and the split is the point (see TIMESTAMP_HEADER):
  //   • `sentAt` — when the DELIVERY was created. Stable across the ladder, so attempt 4
  //     is byte-identical to attempt 1 and a receiver can dedupe on the body alone.
  //   • `signedAt` — when THIS attempt left. It rides as X-Kp-Timestamp and is signed
  //     WITH the body, which is what makes a captured delivery unreplayable. Freezing it
  //     too would push every retry past the five-minute tolerance, i.e. sign deliveries
  //     no correct receiver could accept.
  // They are equal on the first attempt, which is why they used to be one value.
  const signedAt = new Date().toISOString();
  const sentAt = delivery?.createdAt ?? signedAt;
  const key = delivery ? String(delivery.id) : undefined;
  const body = JSON.stringify(buildEnvelope(event, data, sentAt, key));
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    [EVENT_HEADER]: event,
    [TIMESTAMP_HEADER]: signedAt,
    ...(key ? { [IDEMPOTENCY_HEADER]: key } : {}),
  };
  // Decrypt the signing secret to sign. Keep deliver() total: a missing/rotated
  // at-rest key surfaces as a delivery failure (→ recorded for retry) rather than a
  // throw, so it never sends the body UNSIGNED behind the operator's back.
  let secret: string | null;
  try {
    secret = getAtsSecret();
  } catch (e) {
    return { delivered: false, reason: `signing secret unavailable: ${e instanceof Error ? e.message : "decrypt failed"}` };
  }
  if (secret) headers[SIGNATURE_HEADER] = signWebhookBody(secret, body, signedAt);
  try {
    // `redirect: "manual"` is part of the SSRF boundary, not a nicety. The guard above
    // vets ONLY the URL we dial; with the default `follow`, a webhook host that passes
    // every check can answer `302 Location: http://169.254.169.254/…` (or a 307 to
    // 127.0.0.1, which replays method + the signed PII body) and undici would dial that
    // address with no re-vetting — turning the vetted endpoint into a redirector into the
    // internal network, and the returned status into a port-scan oracle via /api/ats/test.
    // Not following also matches what webhook senders do (GitHub/Stripe don't).
    const r = await fetch(target, { method: "POST", headers, body, redirect: "manual", signal: AbortSignal.timeout(5000) });
    if (r.ok) return { delivered: true, status: r.status };
    // A manual redirect surfaces as an opaque-redirect response (per the fetch spec:
    // status 0, ok false). `|| undefined` on purpose — 0 is not an HTTP status, so the
    // ledger records no last_status rather than a fake one.
    if (r.type === "opaqueredirect" || r.status === 0 || (r.status >= 300 && r.status < 400)) {
      return {
        delivered: false,
        status: r.status || undefined,
        reason: "webhook endpoint returned a redirect; redirects are not followed — configure the final https endpoint",
      };
    }
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
 *  Skips (records nothing) ONLY when the webhook is unconfigured or the event isn't
 *  subscribed — those are "no delivery was ever owed". Everything past that point owns a
 *  ledger row, including an entry that cannot be resolved. `workspaceId` is the caller's
 *  team; omitted, the entry's owning workspace is resolved by id (see below).
 *  Never throws. Call as `void dispatchAtsEvent(...)`. */
export async function dispatchAtsEvent(event: AtsEventType, entryId: string, workspaceId?: string): Promise<void> {
  let deliveryId: number | null = null;
  try {
    const cfg = getAtsConfig();
    if (!cfg.webhookUrl || !cfg.events.includes(event)) return;
    // TENANCY. The webhook + its ledger are deliberately ORG-level (one deployment-wide
    // mirror of every team — tenancy.ts), but the record BUILD is tenant-scoped
    // (getPipelineEntry). This read was unscoped, so it fell back to the DEFAULT
    // workspace and returned null for every non-default team's entry — and the function
    // returned BEFORE opening a ledger row, so a team-b hire reached neither the webhook
    // nor GET /api/ats/deliveries. Callers holding the tenant pass it; otherwise resolve
    // the entry's OWNING workspace by id (the same by-id point read a token-driven flow
    // with no session workspace uses).
    const tenant = workspaceId ?? getEntryWorkspace(entryId);
    // Open the ledger row BEFORE anything that can fail to produce a delivery, so no
    // path can exit silently. Every branch below finalizes it (the catch included), so a
    // row can never be stranded `pending`.
    const openedAt = new Date();
    deliveryId = recordAtsDeliveryStart(event, entryId, openedAt);
    const { record, refusal } = getAtsRecordResult(entryId, tenant, openedAt.toISOString());
    if (!record) {
      // A hire that cannot be MIRRORED must never be INVISIBLE. Fail the row instead of
      // returning: it becomes operator-visible like any other failure. A REFUSAL is
      // dead-lettered on the spot — an anonymized candidate will not become mirrorable
      // by waiting, so the six-attempt ladder would only be noise on a settled answer.
      const reason = refusal
        ? refusal.message
        : `pipeline entry ${entryId} not found in workspace "${tenant}" — nothing to mirror`;
      finalizeAtsDelivery(deliveryId, { delivered: false, reason, terminal: !!refusal });
      console.error(
        `[ats] ${event} webhook not delivered for ${entryId} (recorded #${deliveryId}${refusal ? ", terminal" : " for retry"}): ${reason}`
      );
      return;
    }
    const result = await deliver(event, record, { id: deliveryId, createdAt: openedAt.toISOString() });
    finalizeAtsDelivery(deliveryId, toOutcome(result));
    if (!result.delivered) {
      console.error(`[ats] ${event} webhook not delivered for ${entryId} (recorded #${deliveryId} for retry): ${result.reason}`);
    }
  } catch (e) {
    const reason = e instanceof Error ? e.message : "dispatch failed";
    console.error(`[ats] dispatch ${event} failed for ${entryId}:`, reason);
    try {
      if (deliveryId !== null) finalizeAtsDelivery(deliveryId, { delivered: false, reason });
    } catch {
      // The ledger itself is unavailable — the log line above is the record. Swallowing
      // keeps the "never throws" contract this is called as `void dispatchAtsEvent(...)` on.
    }
  }
}

/** Retry every failed delivery whose backoff window has elapsed (and that still has
 *  retry budget). Called by an operator via POST /api/ats/deliveries or an external
 *  cron on a timer. Re-builds the record from CURRENT entry state (a mirror wants the
 *  latest), so a since-deleted entry is finalized off the queue. Never throws per row.
 *
 *  Two sweeps can run at once (an operator pressing Retry while the cron fires), and both
 *  read the same due list. Each row is therefore CLAIMED before it is delivered — a
 *  compare-and-swap on (status, attempts) that exactly one caller wins — so a concurrent
 *  sweep skips it instead of POSTing the same hire a second time. `skipped` counts those.
 */
export async function retryDueAtsDeliveries(
  now: Date = new Date()
): Promise<{ due: number; delivered: number; failed: number; skipped: number }> {
  const due = listDueAtsDeliveries(now.toISOString());
  let delivered = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of due) {
    if (!claimAtsDelivery(row.id, row.attempts)) {
      // Another sweep owns this attempt. Not an error and not a failure — nothing to
      // record beyond not doing the work twice.
      skipped++;
      continue;
    }
    try {
      // `ats_delivery` carries no workspace column (org-level by design, tenancy.ts), so
      // the tenant is re-derived from the entry itself. Unscoped, this read defaulted to
      // the DEFAULT workspace and finalized every non-default team's LIVE entry with the
      // false terminal reason "pipeline entry no longer exists".
      const { record, refusal } = getAtsRecordResult(row.entryId, getEntryWorkspace(row.entryId), row.createdAt);
      if (!record) {
        // A candidate anonymized between the first attempt and this one: the retry is
        // dropped terminally rather than continuing to offer their data to the receiver.
        finalizeAtsDelivery(row.id, {
          delivered: false,
          reason: refusal ? refusal.message : "pipeline entry no longer exists",
          terminal: !!refusal,
        });
        failed++;
        continue;
      }
      // The SAME body and key the first attempt sent (the row's creation instant is the
      // envelope's sentAt), so a receiver that already accepted it can drop this one.
      const result = await deliver(row.event, record, { id: row.id, createdAt: row.createdAt });
      finalizeAtsDelivery(row.id, toOutcome(result));
      if (result.delivered) delivered++;
      else failed++;
    } catch (e) {
      finalizeAtsDelivery(row.id, { delivered: false, reason: e instanceof Error ? e.message : "retry failed" });
      failed++;
    }
  }
  return { due: due.length, delivered, failed, skipped };
}
