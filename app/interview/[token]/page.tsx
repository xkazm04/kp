import { notFound } from "next/navigation";
import { Clock, ShieldCheck, Sparkles } from "lucide-react";
import { getInterviewSessionByToken } from "@/app/_lib/db";
import { durationLabel, GROUNDED_DEFAULT_MIN } from "@/app/_lib/interview-duration.mjs";
import { AiDisclosure } from "@/app/_components/AiDisclosure";
import { VoiceInterviewClient } from "@/app/_components/voice/VoiceInterviewClient";
import { InterviewSidebar } from "@/app/_components/voice/InterviewSidebar";

export const dynamic = "force-dynamic";

// Candidate-facing portal: a tokenized link runs the first-round voice screen
// with the provider fixed per session. Seed of the future candidate portal.
export default async function InterviewPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = getInterviewSessionByToken(token);
  if (!session) notFound();

  // Truthful length from the session's grounded run-of-show (idea-0ecbe5a5),
  // not a hardcoded "5 minutes" — older sessions without a stored duration fall
  // back to the documented grounded default.
  const durationMin = session.durationMin ?? GROUNDED_DEFAULT_MIN;

  if (session.status === "completed") {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="font-serif text-h2 text-ink">Thank you</h1>
        <p className="mt-2 text-body text-steel">
          This interview has already been completed. A human recruiter will review the conversation and follow up.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1380px] px-4 py-10">
      <header className="max-w-3xl">
        <p className="text-meta uppercase text-coral">First-round interview</p>
        <h1 className="mt-1 font-serif text-display text-ink">
          {session.jobTitle ? `Screen — ${session.jobTitle}` : "Voice screen"}
        </h1>
        <p className="mt-2 text-body text-steel">
          A short, AI-led first-round conversation. Talk through a few questions at your own pace — a human recruiter
          reviews the transcript afterward.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1 text-sm text-steel">
            <Clock size={13} className="text-steel" /> {durationLabel(durationMin)}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1 text-sm text-steel">
            <Sparkles size={13} className="text-moss" /> AI-led conversation
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1 text-sm text-steel">
            <ShieldCheck size={13} className="text-moss" /> Reviewed by a human
          </span>
        </div>
      </header>

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-[360px_minmax(0,1fr)]">
        <InterviewSidebar items={session.runOfShow ?? []} durationMin={durationMin} className="lg:sticky lg:top-10" />
        <div>
          <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel sm:p-6">
            <VoiceInterviewClient
              token={session.token}
              candidateLabel={session.candidateLabel ?? undefined}
              jobTitle={session.jobTitle ?? undefined}
            />
          </div>
          <AiDisclosure className="mt-6" />
        </div>
      </div>
    </main>
  );
}
