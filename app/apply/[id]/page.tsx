import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getJob, getJobWorkspace } from "@/app/_lib/db/jobs";
import { disclosureComplianceFor } from "@/app/_lib/compliance-disclosure";
import { findEntryByLeadToken } from "@/app/_lib/db/pipeline";
import { getJobStatus, isJobOpenForApplications } from "@/app/_lib/job-ingest";
import { buildApplyScript } from "@/app/_lib/apply";
import { coerceLeadTokenParam, seedLeadPrefillAnswers, trimSeededSteps } from "@/app/_lib/apply-intake";
import { LanguageSwitcher } from "@/app/_components/LanguageSwitcher";
import { ConversationalApply } from "./ConversationalApply";


// Public, formless conversational apply for a role. A short chat runs knockout
// questions, then drops a passing candidate into the pipeline as Accepted.
// Blocked under Cache Components: dynamic per-request route (previously
// force-dynamic) with no useful static shell to prerender.
export const instant = false;

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

  const sp = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
  const campaign = (first(sp.c) || first(sp.utm_campaign)).slice(0, 120);
  const variant = (first(sp.v) || first(sp.utm_content)).slice(0, 120);

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
        {/* Same locale toggle as the open path: a filled/retired link is still a
            public candidate door, and a Czech reader of an English filled-role
            ad has no other chrome. Drafts 404 above and stay switcher-less. */}
        <div className="mb-4 flex justify-end">
          <LanguageSwitcher />
        </div>
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
  // Keep the public introduction brief even when the imported JD contains a
  // full posting. React renders this as text, so source markup cannot execute.
  const description = job.description?.replace(/\s+/g, " ").trim();
  const roleSummary = description && description.length > 280
    ? `${description.slice(0, 280).replace(/\s+\S*$/, "") || description.slice(0, 280)}…`
    : description;

  // Lead enrichment hand-off — the quick-apply/webhook acknowledgement's
  // "complete your profile" link carries ?lead=<opaque token>. Resolve it
  // server-side to the lead's own entry (shape-gated first, and the entry must
  // belong to THIS job) and open the chat already knowing them: name/email and
  // the KO gates they explicitly passed are seeded, the answered steps drop out
  // of the script, and the POST carries the token so the merge targets that
  // exact entry — an alternate or typo'd email no longer mints a duplicate row.
  // Anything invalid/mismatched degrades silently to the first-time flow: the
  // emailed link must never be WORSE than no token.
  const leadToken = coerceLeadTokenParam(sp.lead);
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
      {roleSummary || job.location ? (
        <section className="mt-5 rounded-lg border border-stone-200 bg-paper/60 p-4" aria-labelledby="apply-role-summary">
          <h2 id="apply-role-summary" className="font-serif text-lg font-semibold text-ink">{t("roleSummary")}</h2>
          {job.location ? <p className="mt-1 text-sm text-steel">{job.location}</p> : null}
          {roleSummary ? <p className="mt-2 text-body text-steel">{roleSummary}</p> : null}
        </section>
      ) : null}
      <div className="mt-6 rounded-lg border border-stone-200 bg-paper/40 p-4">
        <ConversationalApply
          jobId={job.id}
          campaign={campaign}
          variant={variant}
          steps={prefill ? trimSeededSteps(steps, prefill.answers) : steps}
          prefill={prefill}
          // Same tenant the POST files this applicant into (getJobWorkspace is the
          // public intake's existing "which team owns this opening?" authority), so
          // the law the candidate consents under and the law their record is held
          // under cannot disagree.
          compliance={disclosureComplianceFor(getJobWorkspace(job.id))}
        />
      </div>
    </main>
  );
}
