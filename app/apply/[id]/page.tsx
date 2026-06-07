import { notFound } from "next/navigation";
import { getJob } from "@/app/_lib/db";
import { buildApplyScript } from "@/app/_lib/apply";
import { ConversationalApply } from "./ConversationalApply";

export const dynamic = "force-dynamic";

// Public, formless conversational apply for a role. A short chat runs knockout
// questions, then drops a passing candidate into the pipeline as Accepted.
export default async function ApplyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) notFound();

  // Build the chat script here, server-side, from the getJob we already did and
  // hand it to the client as a prop — so the first prompt paints on hydration with
  // no initial /api/apply/[id] round-trip, no second getJob, and no Loading… flash.
  // The GET route still serves the same script for any standalone use.
  const steps = buildApplyScript(job);

  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      {/* This server component is the single source of truth for the apply header
          (role title / company) AND the chat script passed to the client below. */}
      <p className="text-meta uppercase text-coral">Apply</p>
      <h1 className="mt-1 font-serif text-display text-ink">{job.title}</h1>
      {job.company ? <p className="mt-1 text-body text-steel">{job.company}</p> : null}
      <p className="mt-2 text-body text-steel">A quick chat — no forms, no logins. A few questions and you&apos;re done.</p>
      <div className="mt-6 rounded-lg border border-stone-200 bg-paper/40 p-4">
        <ConversationalApply jobId={job.id} steps={steps} />
      </div>
    </main>
  );
}
