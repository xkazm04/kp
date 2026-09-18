import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Clock, ShieldCheck, Sparkles } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getInterviewSessionByToken, LIVE_INTERVIEW_RECENCY_MIN } from "@/app/_lib/db/interviews";
import { getOrCreateStatusLink } from "@/app/_lib/application-status-store";
import { GROUNDED_DEFAULT_MIN } from "@/app/_lib/interview-duration.mjs";
import { CHIP, NOTICE } from "@/app/_components/ui/recipes";
import { disclosureComplianceFor } from "@/app/_lib/compliance-disclosure";
import { isInterviewRecordingOffered } from "@/app/_lib/interview-recording";
import { isKitRehearsal } from "@/app/_lib/interview-rehearsal";
import { InterviewPortalClient } from "@/app/_components/voice/InterviewPortalClient";
import { interviewInactiveCopyKeys, interviewPortalOffers, interviewPortalView } from "./portal-state";


// Candidate-facing portal: a tokenized link runs the first-round voice screen
// with the provider fixed per session. Seed of the future candidate portal.
// Blocked under Cache Components: dynamic per-request route (previously
// force-dynamic) with no useful static shell to prerender.
export const instant = false;

export default async function InterviewPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = getInterviewSessionByToken(token);
  if (!session) notFound();

  const t = await getTranslations("interview");
  const view = interviewPortalView(session);

  // Truthful length from the session's grounded run-of-show (idea-0ecbe5a5),
  // not a hardcoded "5 minutes" — older sessions without a stored duration fall
  // back to the documented grounded default.
  const durationMin = session.durationMin ?? GROUNDED_DEFAULT_MIN;

  const compliance = disclosureComplianceFor(session.workspaceId);

  // The candidate's durable /status link, minted idempotently from the pipeline
  // entry (the interview token they hold already proves this entry is theirs). It
  // used to be computed ONLY for the already-completed reload, so the ending a
  // candidate actually experiences — the live one — was the one with no next step.
  // Best-effort: a session with no entry keeps the plain card. A candidate interview
  // only (interviewPortalOffers): a recruiter's kit rehearsal is a test-mode session and
  // never links to — or mints — a candidate's status page.
  const offers = interviewPortalOffers(session);
  const statusHref = offers.statusLink && session.entryId ? safeStatusHref(session.entryId) : null;

  if (view === "completed") {
    // Not a cul-de-sac: hand the candidate the same durable /status link the
    // apply flows issue (idempotent mint keyed on the pipeline entry, so email
    // and this card share ONE token).
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="font-serif text-h2 text-ink">{t("completedTitle")}</h1>
        <p className="mt-2 text-body text-steel">{t("completedBody")}</p>
        {statusHref ? (
          <Link
            href={statusHref}
            className="focus-ring mt-4 inline-flex items-center gap-1 text-sm font-semibold text-coral hover:underline"
          >
            {t("completedStatusCta")} <ArrowRight size={13} aria-hidden />
          </Link>
        ) : null}
      </main>
    );
  }

  // W6-4 (VOX1) — a revoked or expired link renders an honest closed card
  // (the /connect API refuses it regardless; this just spares the candidate a
  // dead Start button). Expiry comes from the shared authority in db.ts so the
  // page and the credential gate can never disagree.
  if (view === "inactive") {
    const copy = interviewInactiveCopyKeys(session);
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="font-serif text-h2 text-ink">{t(copy.title)}</h1>
        <p className="mt-2 text-body text-steel">{t(copy.body)}</p>
      </main>
    );
  }

  // A live in_progress session is the same lifecycle family as completed /
  // revoked / expired: the second tab (or a forwarded link) must not paint
  // Start, mint a second paid provider session, and then show a generic
  // connect failure. /connect refuses INTERVIEW_ALREADY_LIVE on the same
  // isInterviewSessionLive window.
  if (view === "live") {
    const tErr = await getTranslations("errors");
    const tVoice = await getTranslations("interview.voice");
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="font-serif text-h2 text-ink">{tErr("INTERVIEW_ALREADY_LIVE")}</h1>
        <p role="status" className="mt-2 text-body text-steel">
          {tVoice("retryAfterMinutes", { minutes: LIVE_INTERVIEW_RECENCY_MIN })}
        </p>
      </main>
    );
  }

  // A recruiter REHEARSING a job's kit reaches this same portal. It must not read the
  // candidate's promises as if they applied: nothing here is scored, no human reviews
  // it, and no candidate's record is touched (/api/interview/complete refuses every
  // candidate side effect for a test session). Say so above everything else.
  const rehearsal = isKitRehearsal(session);

  return (
    <main className="mx-auto max-w-[1380px] px-4 py-10">
      {rehearsal ? (
        <div role="status" className={`${NOTICE("info")} mb-6 max-w-3xl px-4 py-3`}>
          <p className="text-base font-semibold">{t("rehearsalTitle")}</p>
          <p className="mt-1 text-sm">{t("rehearsalBody")}</p>
        </div>
      ) : null}
      <header className="max-w-3xl">
        <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
        <h1 className="mt-1 font-serif text-display text-ink">
          {session.jobTitle ? t("titleRole", { role: session.jobTitle }) : t("titleGeneric")}
        </h1>
        <p className="mt-2 text-body text-steel">{t("intro")}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className={CHIP}>
            <Clock size={13} className="text-steel" /> {t("durationApprox", { min: durationMin })}
          </span>
          <span className={CHIP}>
            <Sparkles size={13} className="text-moss" /> {t("chipAiLed")}
          </span>
          {rehearsal ? null : (
            <span className={CHIP}>
              <ShieldCheck size={13} className="text-moss" /> {t("chipHuman")}
            </span>
          )}
        </div>
      </header>

      {/* The rail and the call card are ONE client island now (spark
          ai-interview-parity): the director's agenda state has to reach the rail,
          and a server-rendered sibling cannot receive it. The rail still shows the
          server's run-of-show until /connect answers, so nothing about the
          pre-connect page changed.

          The regime the candidate is assessed under is the one belonging to the
          workspace that owns THIS session — resolved here, where the token has
          already been redeemed, because AiDisclosure is a client component on a
          session-less page and cannot ask (see its header). The recording OFFER is
          resolved the same way, and for the same reason. */}
      <InterviewPortalClient
        token={session.token}
        candidateLabel={session.candidateLabel ?? undefined}
        jobTitle={session.jobTitle ?? undefined}
        durationMin={durationMin}
        provider={session.provider}
        runOfShow={session.runOfShow ?? []}
        regimeId={compliance.regimeId}
        retentionMonths={compliance.retentionMonths}
        recordingOffered={offers.recording && recordingOffer(session.workspaceId)}
        statusHref={statusHref}
      />
    </main>
  );
}

/** The candidate's /status link, or null. Best-effort by design: a status link is a
 *  convenience on this page, and failing to mint one must never stop the interview
 *  it is offered beside. */
function safeStatusHref(entryId: string): string | null {
  try {
    return `/status/${getOrCreateStatusLink(entryId)}`;
  } catch (error) {
    console.error(`[interview:portal] could not mint a status link for entry ${entryId}:`, error);
    return null;
  }
}

/** Whether this workspace offers an audio recording. Unreadable ⇒ NOT offered: no
 *  audio is ever kept on an unknown answer, the same stance /api/interview/connect
 *  takes when it reads the same setting. */
function recordingOffer(workspaceId: string): boolean {
  try {
    return isInterviewRecordingOffered(workspaceId);
  } catch (error) {
    console.error(`[interview:portal] recording offer unreadable for workspace ${workspaceId}:`, error);
    return false;
  }
}
