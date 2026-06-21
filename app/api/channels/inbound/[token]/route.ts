import { NextRequest, NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getActiveChannelWebhook, getJob, recordChannelWebhookAccepted, recordChannelWebhookReceipt } from "@/app/_lib/db";
import { applyKoSteps } from "@/app/_lib/apply";
import { getJobStatus, isJobOpenForApplications } from "@/app/_lib/job-ingest";
import { intakeLead } from "@/app/_lib/lead-intake";
import { extractLead } from "@/app/_lib/lead-payload";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";
import { readTextWithLimit } from "@/app/_lib/request-body";
import { claimWebhookIdempotency, releaseWebhookIdempotency, webhookIdempotencyKey } from "@/app/_lib/webhook-idempotency";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/locales";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// E3 (Erika gap) — the PUBLIC inbound lead receiver: external lead sources (ad
// platform integrations, job boards, plain HTML forms) POST JSON here and the
// lead lands in the pipeline through the same lead-intake core as the
// quick-apply form. The CSPRNG token is the only auth (it binds one channel +
// job + language); responses are machine-facing English JSON with honest
// statuses, so an integrator's logs say exactly what happened:
//   200 {result: accepted|declined}  ·  400 not JSON  ·  404 unknown/revoked
//   token  ·  410 role closed  ·  413 too large  ·  422 no email mappable
//   ·  429 rate-limited
//
// KO semantics differ from our own form on purpose: a third-party form that
// never asked an eligibility question must not silently discard a candidate —
// only an explicit "no" declines; unasked gates land the lead as visibly
// unverified (see lead-payload.ts / lead-intake.ts).

// Bigger than the quick form's cap (integrations pad payloads with metadata),
// still small enough to fail closed on junk before buffering it.
const MAX_INBOUND_BODY_BYTES = 64 * 1024;
const MAX_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 254;
const MAX_ATTRIBUTION_LENGTH = 120;

// Abuse containment for a public, side-effecting endpoint (each accept can
// dispatch a candidate email). Per token+IP; ad-burst friendly, flood hostile.
const RATE_LIMIT = { limit: 60, windowMs: 60_000 };

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  // Released in the catch if processing fails, so a genuine retry can re-run.
  let claimedIdemKey: string | null = null;
  try {
    const { token } = await context.params;
    if (!rateLimit(`inbound:${token}:${clientIpFrom(request.headers)}`, RATE_LIMIT)) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }

    // Unknown and revoked tokens are deliberately indistinguishable (both 404).
    const webhook = getActiveChannelWebhook(token);
    if (!webhook) return NextResponse.json({ error: "Unknown webhook." }, { status: 404 });

    const job = getJob(webhook.jobId);
    if (!job) return NextResponse.json({ error: "The webhook's role no longer exists." }, { status: 404 });
    if (!isJobOpenForApplications(getJobStatus(job.id))) {
      return NextResponse.json({ error: "This role is closed to applications.", code: "role_closed" }, { status: 410 });
    }

    // content-length is ADVISORY (a caller can omit it via chunked transfer or lie),
    // so it's only a cheap fast-reject for an honest oversized body. The REAL cap is
    // enforced below on bytes actually read off the wire — request.text() would have
    // buffered an unbounded body into memory regardless of the header.
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_INBOUND_BODY_BYTES) {
      return NextResponse.json({ error: "Payload too large." }, { status: 413 });
    }
    // Read the raw body once (through a counting reader that aborts past the budget) so
    // we can both parse it and derive a body-hash idempotency key (when the source
    // sends no explicit Idempotency-Key header).
    const rawBody = await readTextWithLimit(request, MAX_INBOUND_BODY_BYTES);
    if (rawBody === null) {
      return NextResponse.json({ error: "Payload too large." }, { status: 413 });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
    }
    if (payload === null) {
      return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
    }

    // The webhook's pinned candidate language drives KO-step derivation (ids
    // only — prompts are unused here), the entry locale, and the ack language.
    const storedLang = webhook.lang ?? "";
    const locale: Locale = isLocale(storedLang) ? storedLang : DEFAULT_LOCALE;
    const t = await getTranslations({ locale, namespace: "apply" });
    const expectedKoIds = applyKoSteps(job, t).map((s) => s.id);

    const lead = extractLead(payload, expectedKoIds);
    if (!lead.email || lead.email.length > MAX_EMAIL_LENGTH) {
      // An unreachable lead defeats the channel's purpose (no enrichment loop,
      // undeliverable comms). This is a DETERMINISTIC rejection, returned BEFORE the
      // idempotency claim — so a byte-identical retry re-validates and gets the same
      // actionable 422 (the field-mapping diagnostic) instead of a misleading
      // "duplicate_ignored" 200 that would tell the integrator the lead was handled.
      return NextResponse.json(
        { error: "No email field could be mapped from the payload.", code: "missing_email" },
        { status: 422 }
      );
    }

    // Request-level idempotency: a provider retry or double-fire of the SAME valid
    // delivery must not record a second receipt (inflating the Channels liveness
    // signal), pile up another `re_applied`, or re-dispatch the acknowledgement. Claimed
    // ONLY now that the role is open + the payload is valid, so the claim brackets exactly
    // the real side-effects window (intakeLead + the receipt + the accepted stamp). A held
    // key short-circuits to an idempotent 200 (intakeLead also dedupes the entry by email);
    // released in the catch if intakeLead throws, so a genuine retry re-runs.
    const idemKey = `inbound:${token}:${webhookIdempotencyKey(
      rawBody,
      request.headers.get("idempotency-key") ?? request.headers.get("x-idempotency-key"),
    )}`;
    if (!claimWebhookIdempotency(idemKey)) {
      return NextResponse.json({ result: "duplicate_ignored", duplicate: true }, { status: 200 });
    }
    claimedIdemKey = idemKey;

    const outcome = await intakeLead({
      job,
      name: lead.name.slice(0, MAX_NAME_LENGTH),
      email: lead.email,
      locale,
      sourceChannel: webhook.channel,
      // E5 — campaign/creative attribution forwarded by the integration.
      sourceCampaign: lead.campaign.slice(0, MAX_ATTRIBUTION_LENGTH) || null,
      sourceVariant: lead.variant.slice(0, MAX_ATTRIBUTION_LENGTH) || null,
      channelLabel: `${webhook.channel} webhook`,
      failedKoIds: lead.failedKoIds,
      // Provided-only verdict: record as PASSED only the gates the source form
      // actually asked and answered affirmatively — ungated ids stay unrecorded,
      // so the enrichment chat asks them instead of assuming.
      passedKoIds: expectedKoIds.filter(
        (id) => !lead.failedKoIds.includes(id) && !lead.ungatedKoIds.includes(id)
      ),
      // The integrator's board shows "submitted"; only this comm tells the
      // candidate the eligibility outcome (the own form shows it live instead).
      notifyDecline: true,
      ungatedKoIds: lead.ungatedKoIds,
      // lead-intake appends the entry's opaque lead token before the ack goes out.
      enrichLink: `${publicBaseUrl(new URL(request.url).origin)}/apply/${job.id}?lang=${locale}`,
    });

    // Record the receipt only AFTER intake reaches a terminal outcome (accepted OR
    // declined), never before: a thrown intake (transient SQLite contention, a translator
    // import error, …) records no receipt and releases the claim, so the provider's retry
    // re-runs intake WITHOUT inflating received_count on every failed attempt. A true
    // duplicate never reaches here (the held claim 200s above), so it's counted once.
    recordChannelWebhookReceipt(token);

    if (outcome.result === "declined") {
      return NextResponse.json({ result: "declined", code: "knockout_failed", failed: lead.failedKoIds });
    }
    // Stamp an ACCEPTED lead only for a genuinely NEW candidate — not a probe (already
    // 422'd above), a KO-decline, or a duplicate re-apply — so the Channels "leads"
    // metric and time-to-first-lead count real candidates, not raw POSTs.
    if (!outcome.duplicate) recordChannelWebhookAccepted(token);
    return NextResponse.json({ result: "accepted", duplicate: outcome.duplicate, entryId: outcome.entryId });
  } catch (error) {
    // Processing failed → the provider will retry; release the claim so the retry
    // isn't wrongly treated as a duplicate of work that never completed.
    if (claimedIdemKey) releaseWebhookIdempotency(claimedIdemKey);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Lead intake failed." },
      { status: 500 }
    );
  }
}
