import { getJob } from "./db/jobs";
import { getEntryWorkspace, getPipelineEntry } from "./db/pipeline";
import { listDecisionRecords } from "./decision-record-store";
import { getOpenOfferForEntry, listOffersForEntry } from "./offers-store";
import { AtsRecordRefusedError, buildAtsRecord, type AtsCandidateRecord } from "./ats-record.ts";
import { getAtsConfig, getAtsSecret } from "./ats-config-store.ts";
import { assertDeliverableWebhookUrl } from "./ats-egress-guard.ts";
import {
  finalizeAtsDelivery,
  leaseAtsDelivery,
  listDueAtsDeliveries,
  openAtsDelivery,
  reclaimExpiredAtsLeases,
} from "./ats-delivery-store.ts";
import { positiveNumericEnv } from "./env.ts";
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
  const job = entry.jobId ? getJob(entry.jobId, entry.workspaceId) : null;
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
  | { delivered: false; reason: string; status?: number; terminal?: boolean };

// ---- Admission control on the outbound NETWORK phase (F-6) -------------------------
//
// The mirror's producer is a BULK one and it does not await: a committed screening wave
// fires one `void dispatchAtsEvent("candidate.rejected", …)` per applied reject
// (screen-wave.ts — deliberately fire-and-forget, because no mirror may abort a cohort
// whose rejections are already sealed and committed). Nothing counted them, so a
// 200-candidate cohort opened up to 200 simultaneous POSTs, each carrying candidate PII,
// against ONE customer endpoint, from a single approved click. The spacing that made this
// look bounded came from the comms relay's own round-trip per candidate — and keyless,
// the project's default, that relay is a local write, so the spacing is zero and the
// fan-out is effectively simultaneous.
//
// That is a problem on both sides of the wire: outbound it is kp holding 200 sockets and
// 200 pending DNS resolutions, inbound it is kp DoSing a customer's webhook with its own
// candidates' data and inviting a 429 that dead-letters a whole cohort.
//
// So the POST runs under ONE process-wide semaphore, the same shape as python-runner.ts's
// KP_PYTHON_MAX_CONCURRENT (positiveNumericEnv, floor at 1) — with one deliberate
// difference: a waiter here is QUEUED, never refused. python-runner refuses because its
// callers are HTTP requests whose client has its own deadline; these callers are
// background mirrors of an already-committed decision, each owning a durable ledger row,
// and a refusal would mean inventing a failure for a delivery that is merely waiting.
//
// WHAT IS NOT CAPPED, on purpose: the ledger row. `dispatchAtsEvent` opens it before it
// ever asks for a slot, so sixteen queued deliveries are sixteen `pending` rows an
// operator can see in GET /api/ats/deliveries — not an invisible pile of microtasks.
//
// SINGLE PROCESS, like rate-limit.ts and the spawn semaphore: the counter lives in this
// Node process. kp runs as one server; a horizontally-scaled deployment needs the same
// swap behind the same function shape.
//
// DOES THE QUEUE OUTLIVE THE LEASE? A delivery's ledger row is leased for
// ATS_DELIVERY_LEASE_MS = 5 min (300 s) at the instant it is OPENED, and a POST is
// aborted at 5 s (AbortSignal.timeout below). At the default ceiling of 4 a cohort of N
// drains in at most ceil(N / 4) × 5 s, so the LAST of a 200-entry cohort — opened at t0
// with the other 199 — is admitted at 49 × 5 s = 245 s and has answered by 250 s, which
// is 50 s inside its own lease. The cap therefore cannot turn a wave into reclaimed
// leases and duplicate POSTs. Two honest limits on that margin, neither of which is a
// reason to move the lease or the timeout:
//   • the 5 s bound is the FETCH; the SSRF re-vet's DNS resolve happens inside the slot
//     and no kp timeout bounds it, so the real figure is 250 s + total resolve time;
//   • the arithmetic breaks at ceil(N / 4) × 5 s ≥ 300 s, i.e. a cohort of ~240+. A wave
//     that large is beyond anything the screening config produces today; if one becomes
//     reachable, the fix is a larger ceiling or a longer lease, decided together.
export const ATS_DEFAULT_MAX_CONCURRENT = 4;

function maxConcurrentDeliveries(): number {
  return Math.max(1, Math.floor(positiveNumericEnv("KP_ATS_MAX_CONCURRENT", ATS_DEFAULT_MAX_CONCURRENT)));
}

let deliveriesInFlight = 0;
const deliveryWaiters: Array<() => void> = [];

/** Live admission state: for tests, and for an ops surface asking whether the mirror is
 *  saturated and how much of a wave is still queued behind it. */
export function atsEgressLoad(): { inFlight: number; queued: number; ceiling: number } {
  return { inFlight: deliveriesInFlight, queued: deliveryWaiters.length, ceiling: maxConcurrentDeliveries() };
}

/** Hand free slots to the oldest waiters. FIFO, so a wave is mirrored in the order its
 *  rejections were applied and nobody at the back of a cohort starves. */
function admitDeliveryWaiters(): void {
  while (deliveriesInFlight < maxConcurrentDeliveries() && deliveryWaiters.length > 0) {
    const next = deliveryWaiters.shift()!;
    deliveriesInFlight += 1;
    next();
  }
}

function acquireDeliverySlot(): Promise<void> {
  if (deliveriesInFlight < maxConcurrentDeliveries()) {
    deliveriesInFlight += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => deliveryWaiters.push(resolve));
}

function releaseDeliverySlot(): void {
  deliveriesInFlight = Math.max(0, deliveriesInFlight - 1);
  admitDeliveryWaiters();
}

/** {@link deliver} under the process-wide ceiling. The wait is the ONLY thing added: the
 *  record was already built and the ledger row already opened by the caller, and the
 *  freshness re-read still runs inside `deliver`, i.e. AFTER this wait — so a candidate
 *  reinstated or erased while their delivery sat in the queue is refused at send time
 *  exactly as one reinstated during the DNS resolve is.
 *
 *  The slot is released in a `finally` on every path, including a throw from `deliver`
 *  (which contracts not to, but a leaked slot would wedge the mirror for the life of the
 *  process, so the contract is not what this relies on). The caller's `finalize` runs
 *  after the release and therefore cannot hold a slot either. */
async function deliverUnderCap(...args: Parameters<typeof deliver>): Promise<DeliveryResult> {
  await acquireDeliverySlot();
  try {
    return await deliver(...args);
  } finally {
    releaseDeliverySlot();
  }
}

/** A re-read of the authoritative state, run by `deliver` immediately before the POST —
 *  after every awaited preparation step, because the preparation IS the staleness window
 *  (the SSRF re-vet resolves DNS; the signing secret is decrypted). It may only REFUSE:
 *  the body and the idempotency key are already promised to the receiver, so a check that
 *  swapped the content would make attempt N+1 a different delivery under the same key. */
export type FreshnessCheck = () => { ok: true } | { ok: false; reason: string; terminal?: boolean };

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
  delivery?: { id: number; createdAt: string },
  /** Re-read of the state the record's gates were decided against. Checked LAST, with no
   *  await between it and the fetch. Omitted (the operator's test ping) there is no record
   *  and nothing to go stale. */
  freshness?: FreshnessCheck
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
  //     is byte-identical to attempt 1 and a receiver can dedupe on the body alone —
  //     FOR AS LONG AS THE ROW STILL HAS A DELIVERY TO MAKE. The body is rebuilt from
  //     current entry state each attempt (`retryDueAtsDeliveries`), so byte-identity is
  //     not an unconditional promise about the bytes: it holds while the TRANSITION the
  //     event names still holds. When that transition is reverted — a reinstated reject,
  //     a reopened decline — the freshness check below ends the row terminally instead
  //     of sending a re-stated body under the first attempt's key (see
  //     EVENT_REQUIRES_STATUS; ADR 0013). So a receiver sees either the same bytes again
  //     or nothing again, never a contradicting third version of the same delivery.
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
  // THE LAST STATEMENT BEFORE THE IRREVERSIBLE STEP. Everything above this line was
  // preparation, and two steps of it awaited: the DNS resolve inside the SSRF re-vet and
  // the dynamic import it does. The consent gate that admitted this record ran before all
  // of it, so an erasure committed in between would otherwise be mirrored to a third party
  // with the gate's stale blessing. No await may be added between here and the fetch.
  if (freshness) {
    const verdict = freshness();
    if (!verdict.ok) {
      return { delivered: false, reason: verdict.reason, ...(verdict.terminal ? { terminal: true } : {}) };
    }
  }
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
function toOutcome(result: DeliveryResult): { delivered: boolean; status?: number; reason?: string; terminal?: boolean } {
  return result.delivered
    ? { delivered: true, status: result.status }
    : { delivered: false, status: result.status, reason: result.reason, ...(result.terminal ? { terminal: true } : {}) };
}

/** The subscribable events whose JUSTIFYING TRANSITION can be undone, mapped to the
 *  `pipeline_entries.status` the entry must still hold for the event to still be true.
 *
 *  F-3. Every attempt rebuilds the record from CURRENT entry state (a mirror wants the
 *  latest), and the freshness check gated consent and existence only — never the
 *  transition that produced the event. So a candidate REINSTATED between attempt 1 and
 *  attempt 2 (`reinstatePipelineEntry`, or a re-add that reopens a merit terminal —
 *  db/pipeline.ts) was still POSTed as `candidate.rejected`, under the first attempt's
 *  Idempotency-Key, carrying `pipeline.status: "active"`: the receiver is told to reject
 *  somebody kp has put back in the funnel, and its own dedupe cannot help because the key
 *  did not move. `offer.declined` is the same shape on the other merit terminal — a
 *  re-add may reopen a `declined` entry too.
 *
 *  THE TWO SUBSCRIBABLE EVENTS DELIBERATELY NOT LISTED:
 *    • `candidate.hired` — a hire is marked by the board's TERMINAL STAGE while the status
 *      stays `active` (pipeline-status.ts header), so there is no status to re-assert. Its
 *      reversal doors do exist in the code (`setEntryStage` off the terminal column, a
 *      reject on a hired row), but asserting a stage ROLE means resolving each workspace's
 *      stage axis at delivery time, and an axis that drops or renames its terminal column
 *      would then dead-letter legitimate hires. A stage-role assertion is a follow-up with
 *      its own decision to make, not part of this fix.
 *    • `offer.accepted` — an offer's response is immutable once written: every transition
 *      in offers-store CASes on `status = 'extended'` and nothing sets a responded offer
 *      back, so there is no undo to catch.
 *
 *  Keyed by the event so an event added to ATS_EVENT_TYPES has to be considered here
 *  rather than silently inheriting "irreversible". */
const EVENT_REQUIRES_STATUS: Partial<Record<AtsEventType, string>> = {
  "candidate.rejected": "rejected",
  "offer.declined": "declined",
};

/** The authoritative re-read for one PREPARED delivery, as a `FreshnessCheck`. It asks the
 *  same gate `getAtsRecordResult` asks — one validation door, not a second copy of the
 *  consent rules — and converts its answer into a refusal only:
 *    • anonymized in the window → terminal (an erasure will not become mirrorable);
 *    • entry gone in the window → retryable;
 *    • consent EXPIRED in the window → retryable, because the prepared body carries PII the
 *      gate would now withhold, and the retry rebuilds it masked. The body is never swapped
 *      here: the receiver was promised these bytes under this idempotency key;
 *    • the event's own TRANSITION reverted → terminal, because there is no longer anything
 *      to mirror and a later attempt would re-state a decision kp has withdrawn
 *      (EVENT_REQUIRES_STATUS, ADR 0013).
 *
 *  The order is load-bearing: a refusal and a vanished entry are answered first, so an
 *  erased or deleted candidate keeps the exact outcome they had before the transition
 *  re-assert existed. */
function deliveryStillJustified(
  event: AtsEventType,
  prepared: AtsCandidateRecord,
  entryId: string,
  workspaceId: string | undefined,
  exportedAt: string
): FreshnessCheck {
  return () => {
    const { record, refusal } = getAtsRecordResult(entryId, workspaceId, exportedAt);
    if (refusal) return { ok: false, reason: refusal.message, terminal: true };
    if (!record) return { ok: false, reason: `pipeline entry ${entryId} no longer exists — nothing to mirror` };
    if (record.candidate.piiWithheld && !prepared.candidate.piiWithheld) {
      return {
        ok: false,
        reason: `consent for pipeline entry ${entryId} expired while the delivery was being prepared — the prepared body over-discloses`,
      };
    }
    // TERMINAL, not retryable: a reinstatement is a human decision kp has already acted
    // on, so waiting cannot make this event true again. The reason names an entry id and
    // two values from a closed status vocabulary — no candidate PII (ats-egress ledger
    // reasons are operator-visible).
    const requiredStatus = EVENT_REQUIRES_STATUS[event];
    if (requiredStatus && record.pipeline.status !== requiredStatus) {
      return {
        ok: false,
        terminal: true,
        reason:
          `pipeline entry ${entryId} is no longer "${requiredStatus}" (now "${record.pipeline.status}") — ` +
          `the ${event} transition was reversed (reinstated or reopened), so it is not mirrored`,
      };
    }
    return { ok: true };
  };
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
  let lease = "";
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
    // path can exit silently. Every branch below finalizes it while this process lives; a
    // crash mid-deliver is healed by the LEASE (the sweep reclaims, and a late finalize
    // here holds a dead token and loses).
    const openedAt = new Date();
    const opened = openAtsDelivery(event, entryId, openedAt);
    deliveryId = opened.id;
    lease = opened.token;
    const { record, refusal } = getAtsRecordResult(entryId, tenant, openedAt.toISOString());
    if (!record) {
      // A hire that cannot be MIRRORED must never be INVISIBLE. Fail the row instead of
      // returning: it becomes operator-visible like any other failure. A REFUSAL is
      // dead-lettered on the spot — an anonymized candidate will not become mirrorable
      // by waiting, so the six-attempt ladder would only be noise on a settled answer.
      const reason = refusal
        ? refusal.message
        : `pipeline entry ${entryId} not found in workspace "${tenant}" — nothing to mirror`;
      finalizeAtsDelivery(deliveryId, { delivered: false, reason, terminal: !!refusal }, lease);
      console.error(
        `[ats] ${event} webhook not delivered for ${entryId} (recorded #${deliveryId}${refusal ? ", terminal" : " for retry"}): ${reason}`
      );
      return;
    }
    // Under the process-wide ceiling (see the semaphore header): the ledger row above is
    // already open, so a slot wait is a VISIBLE `pending` row rather than a hidden one.
    const result = await deliverUnderCap(
      event,
      record,
      { id: deliveryId, createdAt: openedAt.toISOString() },
      deliveryStillJustified(event, record, entryId, tenant, openedAt.toISOString())
    );
    if (!finalizeAtsDelivery(deliveryId, toOutcome(result), lease)) {
      console.error(`[ats] ${event} #${deliveryId}: outcome dropped, lease reclaimed`);
      return;
    }
    if (!result.delivered) {
      console.error(`[ats] ${event} webhook not delivered for ${entryId} (recorded #${deliveryId} for retry): ${result.reason}`);
    }
  } catch (e) {
    const reason = e instanceof Error ? e.message : "dispatch failed";
    console.error(`[ats] dispatch ${event} failed for ${entryId}:`, reason);
    try {
      if (deliveryId !== null) finalizeAtsDelivery(deliveryId, { delivered: false, reason }, lease);
    } catch {
      // The ledger itself is unavailable — the log line above is the record. Swallowing
      // keeps the "never throws" contract this is called as `void dispatchAtsEvent(...)` on.
    }
  }
}

/** Retry every failed delivery whose backoff window has elapsed (and that still has
 *  retry budget). Called by the process clock each tick (instrumentation-node.ts,
 *  under the autonomy pause), by an operator via POST /api/ats/deliveries, or by an
 *  external cron on a timer. Re-builds the record from CURRENT entry state (a mirror
 *  wants the latest), so a since-deleted entry is finalized off the queue — and so a
 *  since-REVERSED transition is too: the freshness check re-asserts the status the event
 *  names, and a reinstated reject is dead-lettered rather than re-stated to the receiver
 *  (EVENT_REQUIRES_STATUS, ADR 0013). Never throws per row.
 *
 *  Two sweeps can run at once (an operator pressing Retry while the cron fires), and both
 *  read the same due list. Each row is therefore CLAIMED before it is delivered — a
 *  compare-and-swap on (status, attempts) that exactly one caller wins — so a concurrent
 *  sweep skips it instead of POSTing the same hire a second time. `skipped` counts those.
 *  It first reclaims expired leases, so a stranded row is redelivered in this same sweep
 *  under the lost attempt's Idempotency-Key.
 */
export async function retryDueAtsDeliveries(
  now: Date = new Date()
): Promise<{ due: number; delivered: number; failed: number; skipped: number; reclaimed: number }> {
  const reclaimed = reclaimExpiredAtsLeases(now);
  const due = listDueAtsDeliveries(now.toISOString());
  let delivered = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of due) {
    const lease = leaseAtsDelivery(row.id, row.attempts, now);
    if (!lease) {
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
      const tenant = getEntryWorkspace(row.entryId);
      const { record, refusal } = getAtsRecordResult(row.entryId, tenant, row.createdAt);
      if (!record) {
        // A candidate anonymized between the first attempt and this one: the retry is
        // dropped terminally rather than continuing to offer their data to the receiver.
        finalizeAtsDelivery(row.id, {
          delivered: false,
          reason: refusal ? refusal.message : "pipeline entry no longer exists",
          terminal: !!refusal,
        }, lease);
        failed++;
        continue;
      }
      // The SAME body and key the first attempt sent (the row's creation instant is the
      // envelope's sentAt), so a receiver that already accepted it can drop this one.
      // One slot at a time, taken and released per row. The sweep is already serial, so
      // the ceiling costs it nothing — but it must COUNT against the same ceiling, or an
      // operator pressing Retry during a wave adds an uncounted POST on top of the cap.
      // It cannot deadlock against the dispatch path: every holder releases in a finally,
      // the ceiling is at least 1, and this loop holds no slot while it waits for one.
      const result = await deliverUnderCap(
        row.event,
        record,
        { id: row.id, createdAt: row.createdAt },
        deliveryStillJustified(row.event, record, row.entryId, tenant, row.createdAt)
      );
      finalizeAtsDelivery(row.id, toOutcome(result), lease);
      if (result.delivered) delivered++;
      else failed++;
    } catch (e) {
      finalizeAtsDelivery(row.id, { delivered: false, reason: e instanceof Error ? e.message : "retry failed" }, lease);
      failed++;
    }
  }
  return { due: due.length, delivered, failed, skipped, reclaimed };
}
