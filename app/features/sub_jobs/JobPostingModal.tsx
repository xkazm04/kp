"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BarChart3, Check, Copy, FileText, Gauge, History, Link2, Megaphone, Scale, Zap } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { Markdown } from "@/app/_components/Markdown";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { buildUrl } from "@/app/features/tabs";
import { isLocale } from "@/i18n/locales";
import { JobLifecycleStrip } from "./JobLifecycleStrip";
import { RecruiterCandidates } from "./RecruiterCandidates";
import { RediscoverPanel } from "./RediscoverPanel";
import { CompareInterviews } from "./CompareInterviews";
import { CampaignTab } from "./CampaignTab";
import { CoachPanel } from "./CoachPanel";
import { jobToMarkdown, JOB_MARKDOWN_STRINGS, POSTING_LOCALES, type PostingLocale } from "./jobMarkdown";
import type { Job } from "./JobsTypes";

// Clicking a job opens this: a publish-ready posting (Markdown) with a copy
// action, plus the candidate ranking for the role in a second tab.
export function JobPostingModal({ job, onClose }: { job: Job; onClose: () => void }) {
  const t = useTranslations("jobs.posting");
  const router = useRouter();
  const search = useSearchParams();
  const [tab, setTab] = useState<"posting" | "coach" | "candidates" | "rediscover" | "compare" | "campaign">("posting");
  const [copied, setCopied] = useState(false);
  const [applyCopied, setApplyCopied] = useState(false);
  const [quickCopied, setQuickCopied] = useState(false);
  // W8-1 (JOB1) — retire the role from the surface that owns it. The lifecycle
  // had no terminal state: a filled role kept collecting applications forever.
  const [closing, setClosing] = useState(false);
  const [closed, setClosed] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const closeRole = async () => {
    if (closing || closed) return;
    if (typeof window !== "undefined" && !window.confirm(t("closeConfirm"))) return;
    setClosing(true);
    setCloseError(null);
    try {
      const r = await fetch(`/api/jobs/${encodeURIComponent(job.id)}/close`, { method: "POST" });
      if (!r.ok) throw new Error();
      setClosed(true);
    } catch {
      setCloseError(t("closeFailed"));
    } finally {
      setClosing(false);
    }
  };
  // JOB3 — the posting can be copied in a language different from the app
  // (recruiter runs the studio in EN, posts to a Czech board). Default to the
  // active locale; the toggle swaps the strings table for the render + copy.
  const appLocale = useLocale();
  const [postingLang, setPostingLang] = useState<PostingLocale>(isLocale(appLocale) ? appLocale : "en");
  const markdown = useMemo(() => jobToMarkdown(job, JOB_MARKDOWN_STRINGS[postingLang]), [job, postingLang]);

  const copyApplyLink = async () => {
    try {
      // Candidate-facing apply link — canonicalized through publicBaseUrl
      // (idea-e6c66bcd) so it carries the public host behind a proxy/localhost.
      // APP4 — pin the link's language via the ?lang override the proxy honours,
      // reusing the Posting-tab toggle: a recruiter posting to a Czech board
      // shares a link that opens in Czech regardless of the candidate's browser.
      const url =
        publicBaseUrl(typeof window !== "undefined" ? window.location.origin : "") +
        `/apply/${job.id}?lang=${postingLang}`;
      await navigator.clipboard.writeText(url);
      setApplyCopied(true);
      window.setTimeout(() => setApplyCopied(false), 1500);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  // E2 (Erika gap) — the ≤30s quick-apply lead form, the link meant for ad /
  // social placements where the conversational chat is too long. Same
  // publicBaseUrl + ?lang pinning as the apply link above.
  const copyQuickApplyLink = async () => {
    try {
      const url =
        publicBaseUrl(typeof window !== "undefined" ? window.location.origin : "") +
        `/apply/${job.id}/quick?lang=${postingLang}`;
      await navigator.clipboard.writeText(url);
      setQuickCopied(true);
      window.setTimeout(() => setQuickCopied(false), 1500);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  return (
    <Modal
      title={job.title}
      subtitle={[job.company, job.location].filter(Boolean).join(" · ") || undefined}
      onClose={onClose}
      size="4xl"
      footer={
        <>
          <button
            type="button"
            onClick={closeRole}
            disabled={closing || closed}
            title={t("closeTitle")}
            className="focus-ring mr-auto inline-flex h-9 items-center gap-1 rounded-md border border-stone-200 px-3 text-sm font-semibold text-steel hover:border-coral/40 hover:text-coral disabled:opacity-60"
          >
            {closed ? t("closedNow") : closing ? t("closing") : t("closeRole")}
          </button>
          {closeError ? (
            <span role="alert" className="text-sm text-red-700">
              {closeError}
            </span>
          ) : null}
          <button
            type="button"
            onClick={copyApplyLink}
            className="focus-ring inline-flex h-9 items-center gap-1 rounded-md border border-stone-200 px-3 text-sm font-semibold text-ink hover:border-coral/40"
          >
            {applyCopied ? <Check size={14} /> : <Link2 size={14} />} {applyCopied ? t("copied") : t("applyLink")}
          </button>
          <button
            type="button"
            onClick={copyQuickApplyLink}
            className="focus-ring inline-flex h-9 items-center gap-1 rounded-md border border-stone-200 px-3 text-sm font-semibold text-ink hover:border-coral/40"
          >
            {quickCopied ? <Check size={14} /> : <Zap size={14} />} {quickCopied ? t("copied") : t("quickApplyLink")}
          </button>
          <button
            type="button"
            onClick={() => router.push(buildUrl({ tab: "matrix", job: job.id }, search.toString()))}
            className="focus-ring inline-flex h-9 items-center gap-1 rounded-md border border-stone-200 px-3 text-sm font-semibold text-ink hover:border-coral/40"
          >
            <BarChart3 size={14} /> {t("rankInMatrix")}
          </button>
          <button
            type="button"
            onClick={copy}
            className="focus-ring inline-flex h-9 items-center gap-1 rounded-md bg-ink px-3 text-sm font-semibold text-white hover:bg-steel"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? t("copied") : t("copyMarkdown")}
          </button>
        </>
      }
    >
      {/* c91ec8b1 — the role's lifecycle at a glance, each segment linking to
          the tab that owns it (JD → channels → board → decisions → offers). */}
      <JobLifecycleStrip jobId={job.id} jobTitle={job.title} />

      <div role="tablist" aria-label={t("viewsAria")} className="mb-3 flex gap-1 border-b border-stone-200">
        {([
          ["posting", "tabPosting", FileText],
          ["coach", "tabCoach", Gauge],
          ["campaign", "tabCampaign", Megaphone],
          ["candidates", "tabCandidates", BarChart3],
          ["rediscover", "tabRediscover", History],
          ["compare", "tabCompare", Scale],
        ] as const).map(([id, labelKey, Icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`jobtab-${id}`}
            aria-selected={tab === id}
            aria-controls={`jobpanel-${id}`}
            onClick={() => setTab(id)}
            className={`focus-ring -mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold ${
              tab === id ? "border-coral text-coral" : "border-transparent text-steel hover:text-ink"
            }`}
          >
            <Icon size={14} /> {t(labelKey)}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`jobpanel-${tab}`}
        aria-labelledby={`jobtab-${tab}`}
        tabIndex={0}
        className="focus-ring rounded-lg"
      >
        {tab === "posting" ? (
          <>
            {/* JOB3 — choose the posting's language independently of the app. */}
            <div className="mb-2 flex items-center gap-1.5">
              <span className="text-meta uppercase text-steel">{t("postingLanguage")}</span>
              {POSTING_LOCALES.map((loc) => (
                <button
                  key={loc}
                  type="button"
                  onClick={() => setPostingLang(loc)}
                  aria-pressed={postingLang === loc}
                  className={`focus-ring rounded-full border px-2.5 py-0.5 text-sm font-semibold uppercase transition-colors ${
                    postingLang === loc ? "border-coral bg-coral/10 text-coral" : "border-stone-200 text-steel hover:border-coral/40"
                  }`}
                >
                  {loc}
                </button>
              ))}
            </div>
            <article className="rounded-lg border border-stone-200 bg-paper/40 p-4">
              <Markdown content={markdown} />
            </article>
          </>
        ) : tab === "coach" ? (
          <CoachPanel jobId={job.id} jobTitle={job.title} />
        ) : tab === "campaign" ? (
          <CampaignTab jobId={job.id} />
        ) : tab === "candidates" ? (
          <RecruiterCandidates jobId={job.id} jobTitle={job.title} roleFamily={job.roleFamily ?? null} autoLoad />
        ) : tab === "rediscover" ? (
          <RediscoverPanel jobId={job.id} jobTitle={job.title} />
        ) : (
          <CompareInterviews jobId={job.id} />
        )}
      </div>
    </Modal>
  );
}
