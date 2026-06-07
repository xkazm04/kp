import Link from "next/link";
import { VoiceInterviewClient } from "@/app/_components/voice/VoiceInterviewClient";
import { isInterviewLabEnabled } from "@/app/_lib/interview-lab";

export const metadata = { title: "Voice interview lab" };

// The lab gate reads INTERVIEW_LAB_ENABLED at request time; without this the
// page would be statically prerendered and bake the BUILD-time flag value in,
// drifting from the /connect route's runtime decision.
export const dynamic = "force-dynamic";

// Internal A/B harness: switch OpenAI ↔ ElevenLabs and run a short screen to
// compare Czech/English quality, latency, turn-taking, and transcript fidelity.
export default function InterviewLabPage() {
  // The lab exercises the tokenless credential-minting path, which is gated in
  // production (idea-6236b597; see interview-lab.ts). Say so instead of
  // rendering a client whose Start would 403.
  if (!isInterviewLabEnabled()) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-meta uppercase text-coral">Internal · voice MVP</p>
        <h1 className="mt-1 font-serif text-display text-ink">Voice interview lab</h1>
        <p className="mt-2 max-w-2xl text-body text-steel">
          The lab is disabled in production — it mints live provider credentials without a session token. Set{" "}
          <code className="rounded bg-stone-100 px-1 py-0.5 text-[0.9em]">INTERVIEW_LAB_ENABLED=1</code> to opt in, or
          use the recruiter simulation, which runs through a tokenized session.
        </p>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <p className="text-meta uppercase text-coral">Internal · voice MVP</p>
      <h1 className="mt-1 font-serif text-display text-ink">Voice interview lab</h1>
      <p className="mt-2 max-w-2xl text-body text-steel">
        A/B the realtime providers on a short first-round screen. Pick a provider and language, consent, then talk —
        the live transcript is captured and stored. Set <code className="rounded bg-stone-100 px-1 py-0.5 text-[0.9em]">OPENAI_API_KEY</code>{" "}
        and <code className="rounded bg-stone-100 px-1 py-0.5 text-[0.9em]">ELEVENLABS_API_KEY</code> +{" "}
        <code className="rounded bg-stone-100 px-1 py-0.5 text-[0.9em]">ELEVENLABS_AGENT_ID</code> in{" "}
        <code className="rounded bg-stone-100 px-1 py-0.5 text-[0.9em]">.env.local</code> to enable each, then restart the
        dev server.
      </p>

      <div className="mt-6 rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
        <VoiceInterviewClient />
      </div>

      <p className="mt-4 text-meta text-steel">
        The candidate-facing version lives at <code className="rounded bg-stone-100 px-1 py-0.5">/interview/&lt;token&gt;</code>{" "}
        with the provider fixed per session.{" "}
        <Link href="/diagrams" className="text-coral hover:underline">
          See the pipeline diagrams
        </Link>
        .
      </p>
    </main>
  );
}
