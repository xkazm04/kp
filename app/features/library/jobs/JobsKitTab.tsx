"use client";

// The Kit tab of the job posting modal (spark interview-kit-template, WP-C): the role's
// versioned interview kit — the spine of every AI interview for this job.
//
// What a recruiter does here, top to bottom: sees which version is LIVE and whether a
// newer draft is being worked on; drafts one from the posting (a backgrounded model call
// with a keyless template fallback, followed to completion here); edits it; saves the
// edit as a new version; publishes; tries it. The one rule the surface must never let a
// recruiter miss is stated at the top, before any control: a publish changes what LATER
// interview links carry, and never what a link already sent asks.
import { ListChecks, Sparkles } from "lucide-react";
import { BTN_PRIMARY, BTN_SECONDARY, NOTICE, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { JobsKitEditor } from "./JobsKitEditor";
import { JobsKitVersions } from "./JobsKitVersions";
import { newerDraft } from "./jobsKitModel";
import { useJobKitLogic } from "./jobsKitLogic";

export function JobsKitTab({ jobId }: { jobId: string }) {
  const k = useJobKitLogic(jobId);
  const { t, state } = k;
  const published = state?.published ?? null;
  const pending = newerDraft(state);
  const hasKit = k.base !== null;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="flex items-center gap-2 font-serif text-h3 text-ink">
          <ListChecks size={16} className="text-coral" aria-hidden /> {t("heading")}
        </h3>
        <p className="mt-1 text-sm text-steel">{t("intro")}</p>
      </div>

      <p className={`${NOTICE("info")} px-3 py-2 text-sm`}>{t("appliesNote")}</p>

      {k.loading ? <LoadingGap className="min-h-[12rem]" /> : null}

      {k.loadError ? (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="text-base text-coral">
            {k.loadError}
          </p>
          <button type="button" onClick={k.reload} className={`${BTN_SECONDARY} h-8 px-3 text-sm`}>
            {t("retry")}
          </button>
        </div>
      ) : null}

      {state ? (
        <p className="text-sm text-ink">
          {published ? t("statusPublished", { version: published.version }) : t("statusNone")}
          {pending ? <span className="text-steel"> · {t("statusDraft", { version: pending.version })}</span> : null}
        </p>
      ) : null}

      {k.generating ? (
        <div role="status" className={`${PANEL_SUNKEN} p-4`}>
          <p className="flex items-center gap-2 text-base font-semibold text-ink">
            <Sparkles size={15} className="animate-pulse text-coral" aria-hidden /> {t("generating")}
          </p>
          <p className="mt-1 text-sm text-steel">{k.progressMsg ?? t("generatingHint")}</p>
        </div>
      ) : null}

      {k.engine === "deterministic" ? (
        <p role="status" className={`${NOTICE("amber")} px-3 py-2 text-sm`}>
          {t("engineDeterministic")}
        </p>
      ) : k.engine === "llm" ? (
        <p role="status" className="text-sm text-steel">
          {t("engineLlm")}
        </p>
      ) : null}

      {(k.startError || k.taskFailed) && !k.generating ? (
        <p role="alert" className="text-sm text-coral">
          {k.startError ?? t("generateRunFailed")}
        </p>
      ) : null}

      {state && !hasKit && !k.draft && !k.generating ? (
        <div className={`${PANEL_SUNKEN} p-6 text-center`}>
          <ListChecks className="mx-auto text-moss" size={28} aria-hidden />
          <p className="mt-2 text-base font-semibold text-ink">{t("emptyTitle")}</p>
          <p className="mx-auto mt-1 max-w-lg text-sm text-steel">{t("emptyBody")}</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={() => void k.generate()} className={`${BTN_PRIMARY} h-9 px-4 text-sm`}>
              <Sparkles size={14} aria-hidden /> {t("generateCta")}
            </button>
            <button type="button" onClick={k.startBlank} className={`${BTN_SECONDARY} h-9 px-3 text-sm`}>
              {t("writeBlank")}
            </button>
          </div>
          <p className="mx-auto mt-2 max-w-lg text-sm text-steel">{t("generateHint")}</p>
        </div>
      ) : null}

      {state && (hasKit || k.draft) && !k.generating ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void k.generate()} className={`${BTN_SECONDARY} h-8 px-3 text-sm`}>
            <Sparkles size={13} className="text-coral" aria-hidden /> {t("regenerateCta")}
          </button>
          <span className="text-sm text-steel">{t("generateHint")}</span>
        </div>
      ) : null}

      {k.draft ? <JobsKitEditor k={k} /> : null}

      {state ? <JobsKitVersions state={state} publishing={k.publishing} onPublish={(id) => void k.publish(id)} t={t} /> : null}
    </div>
  );
}
