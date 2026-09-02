"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowRight, Check, Copy, Loader2, Sparkles } from "lucide-react";
import { useLocale } from "next-intl";
import { buildUrl } from "@/app/features/shell/tabs";
import { LOCALES } from "@/i18n/locales";
import { WARN_KEY } from "./jobsCampaignTabTypes";
import { useCampaignTabLogic } from "./jobsCampaignTabLogic";
import { JobsCampaignTabVariantCard } from "./JobsCampaignTabVariantCard";
import { TaskFlightNote } from "@/app/features/shell/tasks/TaskFlightNote";

// E1 (Erika gap) — the Campaign tab of the job posting modal: feed-ready ad-copy
// variants + 15-second video scripts per candidate language, every CTA pointing
// at the role's quick-apply lead form. Generation is honest about provenance
// (AI vs rule-based fallback) and about the facts it had to do without
// (warning CODES from the wire, localized here).
// jobTitle is only ever spent on the background task's label (tasks.kind.campaign
// = "Campaign pack · {job}") — the runner re-reads the job from the DB. Without
// it `detail(p.jobTitle, p.jobId)` fell through to the raw id, so the tasks dock
// named the run "Campaign pack · jd-senior-backend-engineer".
export function CampaignTab({ jobId, jobTitle }: { jobId: string; jobTitle?: string }) {
  const appLocale = useLocale();
  const router = useRouter();
  const search = useSearchParams();
  const { t, lang, setLang, record, loading, generating, error, copied, generate, copyText, pack, variants, warnings, unknownWarnings, packMarkdown, watch } =
    useCampaignTabLogic(jobId, appLocale, jobTitle);

  return (
    <div>
      <p className="text-sm text-steel">{t("intro")}</p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="text-meta uppercase text-steel">{t("language")}</span>
        {LOCALES.map((loc) => (
          <button
            key={loc}
            type="button"
            onClick={() => setLang(loc)}
            aria-pressed={lang === loc}
            className={`focus-ring rounded-full border px-2.5 py-0.5 text-sm font-semibold uppercase transition-colors ${
              lang === loc ? "border-coral bg-coral/10 text-coral" : "border-stone-200 text-steel hover:border-coral/40"
            }`}
          >
            {loc}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {variants.length ? (
            <button
              type="button"
              onClick={() => copyText("all", packMarkdown())}
              className="focus-ring inline-flex h-9 items-center gap-1 rounded-md border border-stone-200 px-3 text-sm font-semibold text-ink hover:border-coral/40"
            >
              {copied === "all" ? <Check size={14} /> : <Copy size={14} />} {copied === "all" ? t("copied") : t("copyAll")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={generate}
            disabled={generating || loading}
            className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md bg-ink px-3 text-sm font-semibold text-white hover:bg-steel disabled:opacity-50"
          >
            {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {generating ? t("generating") : variants.length ? t("regenerate") : t("generate")}
          </button>
        </div>
      </div>

      {/* Wait-or-leave: generation runs as a background task — the note says the
          run survives navigation and lands in Background tasks. */}
      <TaskFlightNote watch={watch} className="mt-3" />

      {error ? (
        <p role="alert" className="mt-3 rounded-md bg-red-50 p-2.5 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {loading ? (
        // This is the tab's own entry fetch (does a stored pack already exist
        // for this job/lang?) — not the LLM generate action, so no spinner: it
        // just holds the variant cards' shape quietly until the check settles.
        <div className="reveal-quiet mt-4 min-h-[10rem]" aria-hidden />
      ) : !variants.length ? (
        <p className="mt-4 rounded-lg border border-dashed border-stone-300 bg-paper/40 p-4 text-sm text-steel">
          {t("empty")}
        </p>
      ) : (
        <>
          <p className="mt-3 text-sm text-steel">
            {/* Stamped in the APP's locale, not the browser's — a bare
                toLocaleString() follows the OS, so a Czech workspace opened in an
                en-US browser printed a US date inside its Czech pack (the same
                fix groupEvalHelpers' `ranWhen` carries). */}
            {t("generatedAt", { when: new Date(record!.createdAt).toLocaleString(appLocale) })} ·{" "}
            <span className={record!.source === "llm" ? "text-moss" : "text-amber-600"}>
              {record!.source === "llm" ? t("sourceLlm") : t("sourceDeterministic")}
            </span>
          </p>

          {warnings.length || unknownWarnings.length ? (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-amber-800">
              <p className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle size={14} /> {t("warnTitle")}
              </p>
              <ul className="mt-1 list-inside list-disc">
                {warnings.map((w) => (
                  <li key={w}>{t(WARN_KEY[w])}</li>
                ))}
                {unknownWarnings.map((w) => (
                  <li key={w}>{t("warnUnknown", { code: w })}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-3 space-y-3">
            {variants.map((v, i) => (
              <JobsCampaignTabVariantCard key={i} v={v} i={i} copied={copied} copyText={copyText} t={t} />
            ))}
          </div>

          {/* Forward the recruiter to the per-variant performance table (the
              analytics tab owns byVariant; ?tab=analytics is the closest the URL
              grammar lands). Only offered once any variant carries a tracked link. */}
          {variants.some((v) => v.applyUrl) ? (
            <button
              type="button"
              onClick={() => router.push(buildUrl({ tab: "analytics" }, search.toString()))}
              className="focus-ring mt-3 inline-flex items-center gap-1 text-sm font-semibold text-coral hover:underline"
            >
              {t("analyticsCue")} <ArrowRight size={13} />
            </button>
          ) : null}

          {pack?.applyUrl ? (
            <p className="mt-3 text-sm text-steel">
              {t("applyUrlNote")} <span className="font-mono text-coral">{pack.applyUrl}</span>
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
