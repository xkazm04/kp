import { NextRequest, NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getActiveChannelWebhook, getJob, recordChannelWebhookReceipt } from "@/app/_lib/db";
import { applyKoSteps } from "@/app/_lib/apply";
import { getJobStatus, isJobOpenForApplications } from "@/app/_lib/job-ingest";
import { intakeLead } from "@/app/_lib/lead-intake";
import { extractLead } from "@/app/_lib/lead-payload";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";
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

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_INBOUND_BODY_BYTES) {
      return NextResponse.json({ error: "Payload too large." }, { status: 413 });
    }
    const payload = (await request.json().catch(() => null)) as unknown;
    if (payload === null) {
      return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
    }

    // Every received payload counts as a receipt — accepted or not — so the
    // Channels tab's liveness signal reflects what the integration actually sends.
    recordChannelWebhookReceipt(token);

    // The webhook's pinned candidate language drives KO-step derivation (ids
    // only — prompts are unused here), the entry locale, and the ack language.
    const storedLang = webhook.lang ?? "";
    const locale: Locale = isLocale(storedLang) ? storedLang : DEFAULT_LOCALE;
    const t = await getTranslations({ locale, namespace: "apply" });
    const expectedKoIds = applyKoSteps(job, t).map((s) => s.id);

    const lead = extractLead(payload, expectedKoIds);
    if (!lead.email || lead.email.length > MAX_EMAIL_LENGTH) {
      // An unreachable lead defeats the channel's purpose (no enrichment loop,
      // undeliverable comms) — tell the integrator instead of filing junk.
      return NextResponse.json(
        { error: "No email field could be mapped from the payload.", code: "missing_email" },
        { status: 422 }
      );
    }

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
      ungatedKoIds: lead.ungatedKoIds,
      enrichLink: `${publicBaseUrl(new URL(request.url).origin)}/apply/${job.id}?lang=${locale}`,
    });

    if (outcome.result === "declined") {
      return NextResponse.json({ result: "declined", code: "knockout_failed", failed: lead.failedKoIds });
    }
    return NextResponse.json({ result: "accepted", duplicate: outcome.duplicate, entryId: outcome.entryId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Lead intake failed." },
      { status: 500 }
    );
  }
}
