"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BarChart3, Check, Copy, FileText, History, Link2, Megaphone, Scale, Users, Zap } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { Markdown } from "@/app/_components/Markdown";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { buildUrl } from "@/app/features/tabs";
import { isLocale } from "@/i18n/locales";
import { RecruiterCandidates } from "./RecruiterCandidates";
import { RediscoverPanel } from "./RediscoverPanel";
import { CompareInterviews } from "./CompareInterviews";
import { CampaignTab } from "./CampaignTab";
import { jobToMarkdown, JOB_MARKDOWN_STRINGS, POSTING_LOCALES, type PostingLocale } from "./jobMarkdown";
import type { Job } from "./JobsTypes";

// Clicking a job opens this: a publish-ready posting (Markdown) with a copy
// action, plus the candidate ranking for the role in a second tab.
export function JobPostingModal({ job, onClose }: { job: Job; onClose: () => void }) {
  const t = useTranslations("jobs.posting");
  // The in-modal publish action reuses DraftsPanel's strings — same /publish
  // call, same "Source into Pipeline" verb. See docs/JD_LIFECYCLE.md.
  const td = useTranslations("jobs.drafts");
  const router = useRouter();
  const search = useSearchParams();
  const [tab, setTab] = useState<"posting" | "candidates" | "rediscover" | "compare" | "campaign">("posting");
  const [copied, setCopied] = useState(false);
  const [applyCopied, setApplyCopied] = useState(false);
  const [quickCopied, setQuickCopied] = useState(false);
  // W8-1 (JOB1) — retire the role from the surface that owns it. The lifecycle
  // had no terminal state: a filled role kept collecting applications forever.
  // The confirmation is the shared stacked Modal (confirm-over-detail), not
  // window.confirm — the one dialog the theme system can't style.
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closed, setClosed] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const closeRole = async () => {
    if (closing || closed) return;
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

  // Lifecycle state where the links are minted: a DRAFT's apply pages 404 and a
  // CLOSED role's serve 410, so the footer must not hand out those links as if
  // the role were live. Local closed/published flips layer the in-session
  // transitions on top of the server-decorated job.status.
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [publishNote, setPublishNote] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);
  const status = closed ? "closed" : published ? "published" : job.status ?? null;
  const isDraft = status === "draft";
  const isClosed = status === "closed";
  // Same call DraftsPanel makes, surfaced where the draft actually opens: take
  // the JD live and source matching candidates into the pipeline. tone "warn" =
  // published but sourcing errored — not to be mistaken for a clean "sourced 0".
  const publishRole = async () => {
    if (publishing) return;
    setPublishing(true);
    setPublishNote(null);
    try {
      const r = await fetch(`/api/jobs/${encodeURIComponent(job.id)}/publish`, { method: "POST" });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error ?? td("sourcingFailed"));
      setPublished(true);
      setPublishNote(
        p.sourcingWarning
          ? { text: td("publishedButFailed", { warning: p.sourcingWarning }), tone: "warn" }
          : { text: td("sourced", { count: p.sourced ?? 0 }), tone: "ok" }
      );
    } catch (e) {
      setPublishNote({ text: e instanceof Error ? e.message : td("sourcingFailed"), tone: "warn" });
    } finally {
      setPublishing(false);
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

  // Status in the subtitle, where the role's identity reads: a draft or closed
  // role no longer looks pixel-identical to a live one.
  const statusSuffix = isDraft ? t("subtitleDraft") : isClosed ? t("subtitleClosed") : null;
  return (
    <Modal
      title={job.title}
      subtitle={[job.company, job.location, statusSuffix].filter(Boolean).join(" · ") || undefined}
      onClose={onClose}
      size="4xl"
      footer={
        <>
          <button
            type="button"
            onClick={() => setConfirmingClose(true)}
            disabled={closing || isClosed}
            title={t("closeTitle")}
            className="focus-ring mr-auto inline-flex h-9 items-center gap-1 rounded-md border border-stone-200 px-3 text-sm font-semibold text-steel hover:border-coral/40 hover:text-coral disabled:opacity-60"
          >
            {isClosed ? t("closedNow") : closing ? t("closing") : t("closeRole")}
          </button>
          {closeError ? (
            <span role="alert" className="text-sm text-red-700">
              {closeError}
            </span>
          ) : null}
          {publishNote ? (
            <span
              aria-live="polite"
              className={`min-w-0 truncate text-sm ${publishNote.tone === "warn" ? "text-amber-800" : "text-steel"}`}
              title={publishNote.text}
            >
              {publishNote.text}
            </span>
          ) : null}
          {isDraft ? (
            // A draft's apply pages 404 — offering its links ships a campaign
            // pointing at nothing. Offer the go-live action instead (DraftsPanel's
            // /publish call); the links appear once the role is actually live.
            <button
              type="button"
              onClick={publishRole}
              disabled={publishing}
              title={td("sourceTitle")}
              className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md bg-coral px-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              <Users size={14} /> {publishing ? td("sourcing") : td("sourceIntoPipeline")}
            </button>
          ) : (
            <>
              {/* On a closed role the links stay visible but inert — they now serve 410. */}
              <button
                type="button"
                onClick={copyApplyLink}
                disabled={isClosed}
                title={isClosed ? t("linksClosedTitle") : undefined}
                className="focus-ring inline-flex h-9 items-center gap-1 rounded-md border border-stone-200 px-3 text-sm font-semibold text-ink hover:border-coral/40 disabled:opacity-60 disabled:hover:border-stone-200"
              >
                {applyCopied ? <Check size={14} /> : <Link2 size={14} />} {applyCopied ? t("copied") : t("applyLink")}
              </button>
              <button
                type="button"
                onClick={copyQuickApplyLink}
                disabled={isClosed}
                title={isClosed ? t("linksClosedTitle") : undefined}
                className="focus-ring inline-flex h-9 items-center gap-1 rounded-md border border-stone-200 px-3 text-sm font-semibold text-ink hover:border-coral/40 disabled:opacity-60 disabled:hover:border-stone-200"
              >
                {quickCopied ? <Check size={14} /> : <Zap size={14} />} {quickCopied ? t("copied") : t("quickApplyLink")}
              </button>
            </>
          )}
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
      <div role="tablist" aria-label={t("viewsAria")} className="mb-3 flex gap-1 border-b border-stone-200">
        {([
          ["posting", "tabPosting", FileText],
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

      {/* Close confirmation — a themed confirm stacked over the detail modal
          (the Modal stack handles Escape/Tab per-dialog), replacing the native
          window.confirm the design tokens couldn't reach. */}
      {confirmingClose ? (
        <Modal
          title={t("closeRole")}
          onClose={() => setConfirmingClose(false)}
          size="md"
          footer={
            <>
              <button
                type="button"
                onClick={() => setConfirmingClose(false)}
                className="focus-ring inline-flex h-9 items-center rounded-md border border-stone-200 bg-white px-3 text-sm font-semibold text-steel hover:text-ink"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingClose(false);
                  void closeRole();
                }}
                className="focus-ring inline-flex h-9 items-center rounded-md bg-coral px-3 text-sm font-semibold text-white hover:opacity-90"
              >
                {t("closeRole")}
              </button>
            </>
          }
        >
          <p className="text-base text-steel">{t("closeConfirm")}</p>
        </Modal>
      ) : null}
    </Modal>
  );
}
