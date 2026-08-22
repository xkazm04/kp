// The JSON-lead half of the inbound receiver, lifted out of the route so it has
// MORE THAN ONE DOOR without having more than one implementation.
//
// Until L0 (docs/concepts/local-first-edge.md) a lead could arrive exactly one way:
// a live POST to /api/channels/inbound/<token>, handled inline in that route. A
// local-first install is switched off most of the day, so two more arrival paths
// now exist — the clock PULLING a source that can be listed (pull-pass.ts) and the
// clock DRAINING an edge that answered for us while we were down (edge-drain.ts) —
// and all three must produce byte-identical outcomes: the same KO semantics, the
// same idempotency, the same receipt/accepted stamps, the same reply-halt.
//
// So the receiver's contract lives here and the route became a caller of it. The
// route keeps only what is genuinely HTTP: the rate limiter, the body-size reader,
// and the multipart/CV branch (a drained event carries no File).
//
// What the callers keep passing in, because it differs per door:
//   · `origin`  — the enrichment link must be built from a PUBLIC origin; a
//                 request knows its own, the clock does not (publicBaseUrl).
//   · `defer`   — a route defers the acknowledgement off the response path; the
//                 clock has no response to get off, so it omits it and the ack is
//                 awaited inline (lead-intake's documented default).

import { getTranslations } from "next-intl/server";
import { applyKoSteps, type ApplyTranslator } from "./apply";
import { namespaceTranslator } from "./catalog-translator";
import { getActiveChannelWebhook, recordChannelWebhookAccepted, recordChannelWebhookReceipt, type ChannelWebhookRecord } from "./db/channels";
import { getJob } from "./db/jobs";
import { recordAutomationEvent } from "./db/pipeline";
import type { JobRecord } from "./db/core";
import { getJobStatus, isJobOpenForApplications } from "./job-ingest";
import { intakeLead } from "./lead-intake";
import { extractLead } from "./lead-payload";
import { recordOutreachReply } from "./outreach-state-store";
import { publicBaseUrl } from "./public-base-url";
import { claimWebhookIdempotency, releaseWebhookIdempotency, webhookIdempotencyKey } from "./webhook-idempotency";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/locales";

/** Field caps — shared with the route's multipart branch, which imports them so a
 *  cap can't drift between the two branches of one endpoint. */
export const MAX_LEAD_NAME_LENGTH = 200;
export const MAX_LEAD_EMAIL_LENGTH = 254;
export const MAX_LEAD_ATTRIBUTION_LENGTH = 120;

/** An HTTP-shaped answer, because the receiver route returns it verbatim. The
 *  non-HTTP callers read `status` as a machine outcome (2xx = handled, and only a
 *  handled event may be acked/advanced past). */
export type InboundLeadResult = { status: number; body: Record<string, unknown> };

/** `true` when the event was fully handled and must not be re-delivered: a filed
 *  lead, a duplicate, a KO-decline, or a DETERMINISTIC rejection that a byte-
 *  identical retry would only reproduce (no email to map, role closed, unknown
 *  token). A 5xx is the only thing worth replaying, so it is the only thing that
 *  holds the cursor back. `failure-not-empty-success`: a held event stays held. */
export function inboundHandled(result: InboundLeadResult): boolean {
  return result.status < 500;
}

/**
 * Resolve the receiver's translator OFF a request when there is no request.
 *
 * The route path keeps next-intl's request-scoped `getTranslations` (unchanged
 * behaviour, and it is already inside a request); the clock paths cannot use it —
 * there is no request store to read — so they load the pinned catalog directly
 * through the shared non-request translator. Only KO **ids** are consumed from
 * the result (prompts belong to the conversational apply, which the lead never
 * sees), so the cast is safe by construction: no key this call touches renders.
 */
async function applyTranslatorFor(locale: Locale, requestScoped: boolean): Promise<ApplyTranslator> {
  if (requestScoped) return (await getTranslations({ locale, namespace: "apply" })) as ApplyTranslator;
  return (await namespaceTranslator(locale, "apply")) as unknown as ApplyTranslator;
}

export type InboundLeadJsonInput = {
  webhook: ChannelWebhookRecord;
  job: JobRecord;
  /** The exact bytes received — the idempotency key hashes THIS, so a retry of the
   *  same delivery collides even when the source sends no Idempotency-Key. */
  rawBody: string;
  payload: unknown;
  /** The source's own Idempotency-Key, when it sent one; it owns its uniqueness. */
  idempotencyKey?: string | null;
  /** Absolute origin the candidate-facing enrichment link is built from. */
  origin: string;
  /** Off-response acknowledgement scheduling; omitted ⇒ the ack is awaited inline. */
  defer?: (task: () => Promise<void>) => void;
  /** True only on the live HTTP path, where next-intl's request scope exists. */
  requestScoped?: boolean;
};

/**
 * File one JSON lead against an already-authenticated receiver. Lifted verbatim
 * from the route (statuses, codes and comments included) so integrators' logs and
 * the receiver-contract test keep reading exactly as before.
 */
export async function ingestInboundLeadJson(input: InboundLeadJsonInput): Promise<InboundLeadResult> {
  const { webhook, job, rawBody, payload } = input;
  let claimedIdemKey: string | null = null;
  try {
    // The webhook's pinned candidate language drives KO-step derivation (ids only —
    // prompts are unused here), the entry locale, and the ack language.
    const storedLang = webhook.lang ?? "";
    const locale: Locale = isLocale(storedLang) ? storedLang : DEFAULT_LOCALE;
    const t = await applyTranslatorFor(locale, input.requestScoped === true);
    const expectedKoIds = applyKoSteps(job, t).map((s) => s.id);

    const lead = extractLead(payload, expectedKoIds);
    if (!lead.email || lead.email.length > MAX_LEAD_EMAIL_LENGTH) {
      // An unreachable lead defeats the channel's purpose (no enrichment loop,
      // undeliverable comms). DETERMINISTIC, and returned BEFORE the idempotency
      // claim — so a byte-identical retry re-validates and gets the same actionable
      // 422 instead of a misleading "duplicate_ignored" 200.
      return { status: 422, body: { error: "No email field could be mapped from the payload.", code: "missing_email" } };
    }

    // Request-level idempotency: a provider retry or double-fire of the SAME valid
    // delivery must not pile up another `re_applied`, re-dispatch the acknowledgement,
    // or double-count the ACCEPTED lead. Claimed ONLY now that the role is open + the
    // payload is valid, so the claim brackets exactly the real side-effects window.
    const idemKey = `inbound:${webhook.token}:${webhookIdempotencyKey(rawBody, input.idempotencyKey)}`;
    if (!claimWebhookIdempotency(idemKey)) {
      return { status: 200, body: { result: "duplicate_ignored", duplicate: true } };
    }
    claimedIdemKey = idemKey;

    const outcome = await intakeLead({
      job,
      // Filed into the webhook-owning team (not the job's owner, which is usually the
      // same but authoritative here for a corpus-bound hook).
      workspaceId: webhook.workspaceId,
      name: lead.name.slice(0, MAX_LEAD_NAME_LENGTH),
      email: lead.email,
      locale,
      sourceChannel: webhook.channel,
      // E5 — campaign/creative attribution forwarded by the integration.
      sourceCampaign: lead.campaign.slice(0, MAX_LEAD_ATTRIBUTION_LENGTH) || null,
      sourceVariant: lead.variant.slice(0, MAX_LEAD_ATTRIBUTION_LENGTH) || null,
      channelLabel: `${webhook.channel} webhook`,
      failedKoIds: lead.failedKoIds,
      // Provided-only verdict: record as PASSED only the gates the source form
      // actually asked and answered affirmatively — ungated ids stay unrecorded, so
      // the enrichment chat asks them instead of assuming.
      passedKoIds: expectedKoIds.filter((id) => !lead.failedKoIds.includes(id) && !lead.ungatedKoIds.includes(id)),
      // The integrator's board shows "submitted"; only this comm tells the candidate
      // the eligibility outcome (the own form shows it live instead).
      notifyDecline: true,
      ungatedKoIds: lead.ungatedKoIds,
      defer: input.defer,
      // lead-intake appends the entry's opaque lead token before the ack goes out.
      enrichLink: `${publicBaseUrl(input.origin)}/apply/${job.id}?lang=${locale}`,
    });

    if (outcome.result === "declined") {
      return { status: 200, body: { result: "declined", code: "knockout_failed", failed: lead.failedKoIds } };
    }
    // Stamp an ACCEPTED lead only for a genuinely NEW candidate — not a probe
    // (already 422'd above), a KO-decline, or a duplicate re-apply — so the Channels
    // "leads" metric and time-to-first-lead count real candidates, not raw POSTs.
    if (!outcome.duplicate) recordChannelWebhookAccepted(webhook.token);
    // W2.3 — a message from someone we already reached out to is a REPLY, and the
    // sequence stops. Guarded on `duplicate` (a brand-new lead cannot be answering
    // anything) and, inside the store, on having actually sent outreach first.
    // Best-effort: failing to halt must not fail the delivery.
    if (outcome.duplicate) {
      try {
        if (recordOutreachReply(outcome.entryId, webhook.workspaceId)) {
          recordAutomationEvent(outcome.entryId, "outreach_halted", "candidate replied", webhook.workspaceId);
        }
      } catch (err) {
        console.error(`[channels:inbound] could not record a reply for entry "${outcome.entryId}":`, err);
      }
    }
    return { status: 200, body: { result: "accepted", duplicate: outcome.duplicate, entryId: outcome.entryId } };
  } catch (error) {
    // Processing failed → the source (or the drain) will retry; release the claim so
    // the retry isn't wrongly treated as a duplicate of work that never completed.
    if (claimedIdemKey) releaseWebhookIdempotency(claimedIdemKey);
    return { status: 500, body: { error: error instanceof Error ? error.message : "Lead intake failed." } };
  }
}

/**
 * Authenticate a receiver token and file one JSON lead against it — the whole
 * receiver contract behind a single call, for callers that hold bytes and a token
 * but no HTTP request (the pull pass, the edge drain).
 *
 * The route does NOT use this: it needs the resolved webhook before this point for
 * its multipart branch, so it performs the same four steps itself and calls
 * `ingestInboundLeadJson` directly. Both orders are identical and pinned by
 * channels-receiver-contract.test.ts.
 */
export async function ingestInboundLeadByToken(input: {
  token: string;
  rawBody: string;
  origin: string;
  idempotencyKey?: string | null;
}): Promise<InboundLeadResult> {
  // Unknown and revoked tokens are deliberately indistinguishable (both 404).
  const webhook = getActiveChannelWebhook(input.token);
  if (!webhook) return { status: 404, body: { error: "Unknown webhook." } };
  // LIVENESS, stamped at AUTHENTICATION exactly as the route stamps it: something
  // is wired and talking to this receiver, whatever happens to the payload next.
  // A pulled/drained delivery proves that just as well as a live POST does.
  recordChannelWebhookReceipt(input.token);

  const job = getJob(webhook.jobId);
  if (!job) return { status: 404, body: { error: "The webhook's role no longer exists." } };
  if (!isJobOpenForApplications(getJobStatus(job.id))) {
    return { status: 410, body: { error: "This role is closed to applications.", code: "role_closed" } };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody);
  } catch {
    return { status: 400, body: { error: "Body must be JSON." } };
  }
  if (payload === null) return { status: 400, body: { error: "Body must be JSON." } };

  return ingestInboundLeadJson({
    webhook,
    job,
    rawBody: input.rawBody,
    payload,
    origin: input.origin,
    idempotencyKey: input.idempotencyKey,
  });
}
