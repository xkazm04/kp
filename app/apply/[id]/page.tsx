import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { findEntryByLeadToken, getJob } from "@/app/_lib/db";
import { getJobStatus, isJobOpenForApplications } from "@/app/_lib/job-ingest";
import { buildApplyScript } from "@/app/_lib/apply";
import { coerceLeadTokenParam, seedLeadPrefillAnswers, trimSeededSteps } from "@/app/_lib/apply-intake";
import { LanguageSwitcher } from "@/app/_components/LanguageSwitcher";
import { ConversationalApply } from "./ConversationalApply";

export const dynamic = "force-dynamic";

// Public, formless conversational apply for a role. A short chat runs knockout
// questions, then drops a passing candidate into the pipeline as Accepted.
export default async function ApplyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) notFound();

  const t = await getTranslations("apply");

  // W8-1 (JOB1) — the apply surface follows the role's lifecycle. A closed
  // (filled/retired) role renders an honest card instead of collecting
  // applications nobody will process; a never-published draft isn't publicly
  // live at all. The POST API enforces the same gate.
  const status = getJobStatus(id);
  if (!isJobOpenForApplications(status)) {
    if (status === "draft") notFound();
    return (
      <main className="mx-auto max-w-xl px-4 py-12">
        <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
        <h1 className="mt-1 font-serif text-display text-ink">{job.title}</h1>
        <p className="mt-4 rounded-lg border border-stone-200 bg-paper/60 p-4 text-body text-steel">{t("roleClosed")}</p>
      </main>
    );
  }
  // Build the chat script here, server-side, from the getJob we already did and
  // hand it to the client as a prop — so the first prompt paints on hydration with
  // no initial /api/apply/[id] round-trip, no second getJob, and no Loading… flash.
  // The script is localized at build time (the candidate reads the prompts as-is).
  // The GET route still serves the same script for any standalone use.
  const steps = buildApplyScript(job, t);

  // Lead enrichment hand-off — the quick-apply/webhook acknowledgement's
  // "complete your profile" link carries ?lead=<opaque token>. Resolve it
  // server-side to the lead's own entry (shape-gated first, and the entry must
  // belong to THIS job) and open the chat already knowing them: name/email and
  // the KO gates they explicitly passed are seeded, the answered steps drop out
  // of the script, and the POST carries the token so the merge targets that
  // exact entry — an alternate or typo'd email no longer mints a duplicate row.
  // Anything invalid/mismatched degrades silently to the first-time flow: the
  // emailed link must never be WORSE than no token.
  const leadToken = coerceLeadTokenParam((await searchParams).lead);
  const target = leadToken ? findEntryByLeadToken(leadToken) : null;
  const lead = leadToken && target && target.entry.jobId === job.id ? target : null;
  const prefill =
    leadToken && lead
      ? (() => {
          const answers = seedLeadPrefillAnswers(
            { candidateLabel: lead.entry.candidateLabel, contact: lead.entry.contact, passedKoIds: lead.passedKoIds },
            steps
          );
          return {
            leadToken,
            answers,
            // The localized "we know you" opener — only when a real name is on file.
            greeting: typeof answers.name === "string" ? t("script.welcomeBack", { name: answers.name }) : null,
          };
        })()
      : null;

  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      {/* This server component is the single source of truth for the apply header
          (role title / company) AND the chat script passed to the client below. */}
      {/* APP4 — the candidate is the one user who couldn't reach the recruiter
          switcher; give the public apply page its own locale toggle (the cookie
          action re-renders the prompts in the chosen language). */}
      <div className="mb-4 flex justify-end">
        <LanguageSwitcher />
      </div>
      <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
      <h1 className="mt-1 font-serif text-display text-ink">{job.title}</h1>
      {job.company ? <p className="mt-1 text-body text-steel">{job.company}</p> : null}
      <p className="mt-2 text-body text-steel">{t("subtitle")}</p>
      <div className="mt-6 rounded-lg border border-stone-200 bg-paper/40 p-4">
        <ConversationalApply
          jobId={job.id}
          steps={prefill ? trimSeededSteps(steps, prefill.answers) : steps}
          prefill={prefill}
        />
      </div>
    </main>
  );
}
