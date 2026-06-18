import { NextRequest, NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getServerLocale } from "@/i18n/server";
import { getJob } from "@/app/_lib/db";
import { applyKoSteps } from "@/app/_lib/apply";
import { APPLY_EMAIL_RE, failedKoStepIds } from "@/app/_lib/apply-intake";
import { getJobStatus, isJobOpenForApplications } from "@/app/_lib/job-ingest";
import { intakeLead } from "@/app/_lib/lead-intake";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// E2 (Erika gap) — the quick-apply LEAD form: the ≤30-second, ~3-field intake for
// ad/social traffic. Captures name + contact email + this job's own knockout
// questions; the shared lead-intake core (lead-intake.ts) files a passing lead at
// Accepted as an enrichable stub and fires the instant acknowledgement with the
// full-apply link. This route keeps what is surface-specific: input validation,
// the STRICT KO verdict (our own form asks every gate, so an ABSENT key is a
// fail — a scripted POST can't skip eligibility by omitting keys), and the
// localized candidate-facing response copy.
//
// Same trust-boundary discipline as the conversational POST: public,
// unauthenticated, side-effecting — body capped before buffering, fields bounded.

// The form carries three short fields and a few booleans — anything bigger is
// not a quick application. Fail closed well below the conversational cap.
const MAX_QUICK_BODY_BYTES = 16 * 1024;
const MAX_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 254; // RFC 5321 max address length
const MAX_ATTRIBUTION_LENGTH = 120; // E5 campaign/variant params from the ad link

// Abuse containment for this PUBLIC, side-effecting endpoint (each accept files a
// lead + fires an acknowledgement email). Per (job, client) fixed window; a touch
// higher than the conversational route since the lead form is lighter. Mirrors the
// inbound-channel route.
const QUICK_APPLY_RATE_LIMIT = { limit: 30, windowMs: 60_000 };

// POST → evaluate the lead form. KO pass → an Accepted, intake-degraded lead
// entry + instant ack with the enrichment link; KO fail → a polite decline,
// audited as an entry-less ko_declined event (never a silent discard).
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    // Throttle BEFORE any DB read so a flood is rejected cheaply.
    if (!rateLimit(`apply-quick:${id}:${clientIpFrom(request.headers)}`, QUICK_APPLY_RATE_LIMIT)) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }
    const job = getJob(id);
    if (!job) return NextResponse.json({ error: "Role not found." }, { status: 404 });

    const t = await getTranslations("apply");
    // The language the candidate applied in, persisted on the entry so every
    // downstream comm (ack/rejection/interview/offer) renders in it.
    const applicantLocale = await getServerLocale();

    // A closed/draft role refuses the submission too (same W8-1 gate as the
    // conversational POST — the page gate alone is the documented anti-pattern).
    if (!isJobOpenForApplications(getJobStatus(id))) {
      return NextResponse.json({ error: t("roleClosed") }, { status: 410 });
    }

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_QUICK_BODY_BYTES) {
      return NextResponse.json({ error: "Application payload too large." }, { status: 413 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      answers?: Record<string, unknown>;
      campaign?: unknown;
      variant?: unknown;
    };
    const answers = body.answers ?? {};
    const name = String(answers.name ?? "").trim();
    const email = String(answers.email ?? "").trim();
    // E5 — ad-link attribution forwarded by the form; bounded, never trusted further.
    const campaign = String(body.campaign ?? "").trim().slice(0, MAX_ATTRIBUTION_LENGTH);
    const variant = String(body.variant ?? "").trim().slice(0, MAX_ATTRIBUTION_LENGTH);

    // Unlike the conversational flow (where a contactless application still
    // files), the lead form's entire point is a REACHABLE candidate — without an
    // address the enrichment loop can never close, so both fields are required.
    if (!name) {
      return NextResponse.json({ error: "Please enter your name." }, { status: 400 });
    }
    if (name.length > MAX_NAME_LENGTH) {
      return NextResponse.json({ error: "Your name is too long." }, { status: 400 });
    }
    if (!email || email.length > MAX_EMAIL_LENGTH || !APPLY_EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
    }

    // ABSOLUTE link to the full conversational apply (the candidate opens it from
    // an email, outside the app), pinned to the language they applied in.
    // lead-intake appends the entry's opaque lead token (&lead=…) before the ack
    // goes out, so the link opens prefilled and merges back onto the lead's entry.
    const enrichLink = `${publicBaseUrl(new URL(request.url).origin)}/apply/${job.id}?lang=${applicantLocale}`;

    const expectedKoIds = applyKoSteps(job, t).map((s) => s.id);
    const outcome = await intakeLead({
      job,
      name,
      email,
      locale: applicantLocale,
      sourceChannel: "quick-apply",
      sourceCampaign: campaign || null,
      sourceVariant: variant || null,
      channelLabel: "quick apply",
      // STRICT verdict: every expected KO answer must be present AND true.
      failedKoIds: failedKoStepIds(expectedKoIds, answers),
      // …so an ACCEPT means every gate was explicitly answered true: record them
      // all, and the enrichment chat skips exactly these (a gate the job gains
      // later isn't in the record and gets asked).
      passedKoIds: expectedKoIds,
      enrichLink,
    });

    if (outcome.result === "declined") {
      return NextResponse.json({ result: "declined", message: t("declinedMessage") });
    }
    // `leadToken` lets the success screen's "complete your profile" CTA carry
    // the same identity as the emailed link (see QuickApplyForm).
    if (outcome.duplicate) {
      return NextResponse.json({
        result: "accepted",
        duplicate: true,
        message: t("alreadyMessage"),
        leadToken: outcome.leadToken,
      });
    }
    return NextResponse.json({ result: "accepted", message: t("quick.acceptedMessage"), leadToken: outcome.leadToken });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "apply failed" }, { status: 500 });
  }
}
