import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getJob } from "@/app/_lib/db";
import { getJobStatus, isJobOpenForApplications } from "@/app/_lib/job-ingest";
import { applyKoSteps } from "@/app/_lib/apply";
import { LanguageSwitcher } from "@/app/_components/LanguageSwitcher";
import { isRelayConfigured } from "@/app/_lib/comms-truth";
import { QuickApplyForm } from "./QuickApplyForm";


// E2 (Erika gap) — public quick-apply LEAD form: the ≤30-second, mobile-first
// intake for ad/social traffic. Three fields (name, email, this job's own
// knockout questions), one tap, done — the full conversational apply at
// /apply/[id] stays the rich path and doubles as this form's enrichment
// follow-up (linked from the acknowledgement email and the success screen).
// Blocked under Cache Components: dynamic per-request route (previously
// force-dynamic) with no useful static shell to prerender.
export const instant = false;

export default async function QuickApplyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) notFound();

  // E5 — campaign/creative attribution carried by the ad link (?c=&v=, with the
  // UTM names as aliases — campaign packs emit per-variant &v=vN links). Read
  // here and threaded through the form POST onto the pipeline entry.
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const campaign = (first(sp.c) || first(sp.utm_campaign)).slice(0, 120);
  const variant = (first(sp.v) || first(sp.utm_content)).slice(0, 120);

  const t = await getTranslations("apply");

  // Same W8-1 lifecycle gate as the conversational page: a closed role renders
  // an honest card, a never-published draft isn't publicly live at all. The
  // POST API enforces the same gate.
  const status = getJobStatus(id);
  if (!isJobOpenForApplications(status)) {
    if (status === "draft") notFound();
    return (
      <main className="mx-auto max-w-md px-4 py-12">
        <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
        <h1 className="mt-1 font-serif text-display text-ink">{job.title}</h1>
        <p className="mt-4 rounded-lg border border-stone-200 bg-paper/60 p-4 text-body text-steel">{t("roleClosed")}</p>
      </main>
    );
  }

  // The knockout prompts are server-built (localized for the candidate) from the
  // SAME script the conversational flow runs — one eligibility contract per job.
  const koSteps = applyKoSteps(job, t);

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <div className="mb-4 flex justify-end">
        <LanguageSwitcher />
      </div>
      <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
      <h1 className="mt-1 font-serif text-display text-ink">{job.title}</h1>
      {job.company ? <p className="mt-1 text-body text-steel">{job.company}</p> : null}
      <p className="mt-2 text-body text-steel">{t("quick.subtitle")}</p>
      <div className="mt-6 rounded-lg border border-stone-200 bg-paper/40 p-4">
        <QuickApplyForm jobId={job.id} koSteps={koSteps} campaign={campaign} variant={variant} relayConfigured={isRelayConfigured()} />
      </div>
    </main>
  );
}
