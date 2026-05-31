import { notFound } from "next/navigation";
import { getInterviewSessionByToken } from "@/app/_lib/db";
import { VoiceInterviewClient } from "@/app/_components/voice/VoiceInterviewClient";

export const dynamic = "force-dynamic";

// Candidate-facing portal: a tokenized link runs the first-round voice screen
// with the provider fixed per session. Seed of the future candidate portal.
export default async function InterviewPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = getInterviewSessionByToken(token);
  if (!session) notFound();

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
    <main className="mx-auto max-w-3xl px-4 py-10">
      <p className="text-meta uppercase text-coral">First-round interview</p>
      <h1 className="mt-1 font-serif text-display text-ink">
        {session.jobTitle ? `Screen — ${session.jobTitle}` : "Voice screen"}
      </h1>
      <p className="mt-2 max-w-2xl text-body text-steel">
        A short, AI-led first-round conversation (about five minutes). Find a quiet spot, use headphones if you can, and
        allow microphone access when prompted. A human recruiter reviews the transcript afterward.
      </p>

      <div className="mt-6 rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <VoiceInterviewClient
          token={session.token}
          fixedProvider={session.provider}
          candidateLabel={session.candidateLabel ?? undefined}
          jobTitle={session.jobTitle ?? undefined}
        />
      </div>
    </main>
  );
}
