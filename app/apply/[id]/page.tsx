import { notFound } from "next/navigation";
import { getJob } from "@/app/_lib/db";
import { ConversationalApply } from "./ConversationalApply";

export const dynamic = "force-dynamic";

// Public, formless conversational apply for a role. A short chat runs knockout
// questions, then drops a passing candidate into the pipeline as Accepted.
export default async function ApplyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) notFound();

  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <p className="text-meta uppercase text-coral">Apply</p>
      <h1 className="mt-1 font-serif text-display text-ink">{job.title}</h1>
      {job.company ? <p className="mt-1 text-body text-steel">{job.company}</p> : null}
      <p className="mt-2 text-body text-steel">A quick chat — no forms, no logins. A few questions and you&apos;re done.</p>
      <div className="mt-6 rounded-lg border border-stone-200 bg-paper/40 p-4">
        <ConversationalApply jobId={job.id} />
      </div>
    </main>
  );
}
