import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Clock, ShieldCheck, Sparkles } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getInterviewSessionByToken, isInterviewLinkExpired } from "@/app/_lib/db/interviews";
import { getOrCreateStatusLink } from "@/app/_lib/application-status-store";
import { GROUNDED_DEFAULT_MIN } from "@/app/_lib/interview-duration.mjs";
import { AiDisclosure } from "@/app/_components/AiDisclosure";
import { VoiceInterviewClient } from "@/app/_components/voice/VoiceInterviewClient";
import { InterviewSidebar } from "@/app/_components/voice/InterviewSidebar";


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

  // Truthful length from the session's grounded run-of-show (idea-0ecbe5a5),
  // not a hardcoded "5 minutes" — older sessions without a stored duration fall
  // back to the documented grounded default.
  const durationMin = session.durationMin ?? GROUNDED_DEFAULT_MIN;

  if (session.status === "completed") {
    // Not a cul-de-sac: hand the candidate the same durable /status link the
    // apply flows issue (idempotent mint keyed on the pipeline entry, so email
    // and this card share ONE token). The interview token they hold already
    // proves this entry is theirs. Best-effort — older sessions without an
    // entry link just keep the plain card.
    let statusHref: string | null = null;
    if (session.entryId) {
      try {
        statusHref = `/status/${getOrCreateStatusLink(session.entryId)}`;
      } catch {
        statusHref = null;
      }
    }
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
  if (session.status === "revoked" || isInterviewLinkExpired(session)) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="font-serif text-h2 text-ink">{t("inactiveTitle")}</h1>
        <p className="mt-2 text-body text-steel">{t("inactiveBody")}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1380px] px-4 py-10">
      <header className="max-w-3xl">
        <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
        <h1 className="mt-1 font-serif text-display text-ink">
          {session.jobTitle ? t("titleRole", { role: session.jobTitle }) : t("titleGeneric")}
        </h1>
        <p className="mt-2 text-body text-steel">{t("intro")}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1 text-sm text-steel">
            <Clock size={13} className="text-steel" /> {t("durationApprox", { min: durationMin })}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1 text-sm text-steel">
            <Sparkles size={13} className="text-moss" /> {t("chipAiLed")}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1 text-sm text-steel">
            <ShieldCheck size={13} className="text-moss" /> {t("chipHuman")}
          </span>
        </div>
      </header>

      {/* M1: on mobile the call card comes FIRST (order-1) so the candidate reaches Start without
          scrolling past the whole agenda; the agenda drops below (order-2). Desktop keeps the
          agenda on the left. M2: the AI/human-review disclosure sits ABOVE the call card so the
          reassurance is visible before the Start decision. */}
      <div className="mt-8 grid items-start gap-8 lg:grid-cols-[360px_minmax(0,1fr)]">
        <InterviewSidebar
          items={session.runOfShow ?? []}
          durationMin={durationMin}
          className="order-2 lg:order-1 lg:sticky lg:top-10"
        />
        <div className="order-1 lg:order-2">
          <AiDisclosure className="mb-6" />
          <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel sm:p-6">
            <VoiceInterviewClient
              token={session.token}
              candidateLabel={session.candidateLabel ?? undefined}
              jobTitle={session.jobTitle ?? undefined}
              provider={session.provider}
              lockSettings
            />
          </div>
        </div>
      </div>
    </main>
  );
}
