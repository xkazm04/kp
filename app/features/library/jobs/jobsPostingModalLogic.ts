// State + handlers for JobsPostingModal.tsx — extracted verbatim (no behaviour
// change) so the modal file stays under the 200-line split threshold. Owns: the
// tab selector, the close/reopen/publish lifecycle actions, the copy-to-clipboard
// actions (posting markdown, apply link, quick-apply link), and the posting
// language toggle.
"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { buildUrl } from "@/app/features/shell/tabs";
import { isLocale } from "@/i18n/locales";
import { jobToMarkdown, JOB_MARKDOWN_STRINGS, POSTING_LOCALES, type PostingLocale } from "./jobsMarkdown";
import type { Job } from "./JobsTypes";

export function useJobPostingModalLogic(
  job: Job,
  // Fired after a lifecycle transition (close / publish / reopen) succeeds so the
  // owning Jobs table can refresh the affected row's status badge/chips instead of
  // going stale until a manual reload (job-postings-lifecycle #2).
  onChanged?: (status: "published" | "closed") => void
) {
  const t = useTranslations("jobs.posting");
  // The in-modal publish action reuses DraftsPanel's strings — same /publish
  // call, same "Source into Pipeline" verb. See docs/JD_LIFECYCLE.md.
  const td = useTranslations("jobs.drafts");
  const router = useRouter();
  const search = useSearchParams();
  const [tab, setTab] = useState<"posting" | "coach" | "candidates" | "rediscover" | "compare" | "campaign">("posting");
  const [copied, setCopied] = useState(false);
  const [applyCopied, setApplyCopied] = useState(false);
  const [quickCopied, setQuickCopied] = useState(false);
  // A clipboard write can be blocked (permissions / insecure context) — surface that
  // instead of the prior silent catch, so the recruiter doesn't ship an empty link.
  const [copyError, setCopyError] = useState(false);
  // W8-1 (JOB1) — retire the role from the surface that owns it. The lifecycle
  // had no terminal state: a filled role kept collecting applications forever.
  // The confirmation is the shared stacked Modal (confirm-over-detail), not
  // window.confirm — the one dialog the theme system can't style.
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closed, setClosed] = useState(false);
  // How many in-flight candidates the close withdrew (JOB2) — shown so the recruiter
  // knows the pipeline was reconciled, not silently abandoned. null until a close runs.
  const [closedCount, setClosedCount] = useState<number | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  const closeRole = async () => {
    if (closing || closed) return;
    setClosing(true);
    setCloseError(null);
    try {
      const r = await fetch(`/api/jobs/${encodeURIComponent(job.id)}/close`, { method: "POST" });
      const p = (await r.json().catch(() => null)) as { withdrawn?: number } | null;
      if (!r.ok) throw new Error();
      setClosed(true);
      setClosedCount(typeof p?.withdrawn === "number" ? p.withdrawn : null);
      // Tell the Jobs table the row is now closed so its badge/openOnly filter update.
      onChanged?.("closed");
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
  // pack-on-publish — after a successful publish, point the recruiter at the
  // campaign pack (the thing they'd post the role WITH). null = not checked yet
  // (no CTA), false = no pack for this job/lang (→ "Create"), true = one exists
  // (→ "View"). The publish response carries no pack info, so we settle it with
  // one lightweight GET on success — the cheapest honest existence check.
  const [packExists, setPackExists] = useState<boolean | null>(null);
  // tone "quota" = hit the plan's active-job cap (402 quota_exceeded): a monetization
  // moment, rendered as an upgrade path, NOT the amber "sourcing broke" warning.
  const [publishNote, setPublishNote] = useState<{ text: string; tone: "ok" | "warn" | "quota" } | null>(null);
  const goToBilling = () => router.push(buildUrl({ tab: "billing" }, search.toString()));
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
      if (!r.ok) {
        // The plan's active-job cap (402): the highest-intent upsell moment — show a
        // distinct quota state with a Billing link, not a generic sourcing-failed warn.
        if (p.code === "quota_exceeded") {
          setPublishNote({ text: td("quotaNote"), tone: "quota" });
          return;
        }
        throw new Error(p.error ?? td("sourcingFailed"));
      }
      // Re-publish doubles as Reopen for a closed role; clear the local closed flag so
      // the footer/links flip back to live (the cap is re-checked above on reopen).
      setClosed(false);
      setClosedCount(null);
      setPublished(true);
      // Publish AND reopen both land the role at 'published' — refresh the table row.
      onChanged?.("published");
      // Settle the pack-on-publish CTA: does a campaign pack already exist for
      // the language the Campaign tab opens on? Fire-and-forget — a failed/slow
      // check just leaves the CTA hidden, never blocks the publish result.
      const campaignLang = isLocale(appLocale) ? appLocale : "en";
      void fetch(`/api/jobs/${encodeURIComponent(job.id)}/campaign?lang=${campaignLang}`)
        .then((cr) => cr.json())
        .then((cd: { pack?: unknown }) => setPackExists(Boolean(cd?.pack)))
        .catch(() => setPackExists(null));
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
  // Postings support only the POSTING_LOCALES subset (en/cs); a wider UI locale
  // (de/fr) falls back to en for the copy-to-board strings.
  const [postingLang, setPostingLang] = useState<PostingLocale>(
    isLocale(appLocale) && (POSTING_LOCALES as readonly string[]).includes(appLocale) ? (appLocale as PostingLocale) : "en"
  );
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
      setCopyError(false);
      setApplyCopied(true);
      window.setTimeout(() => setApplyCopied(false), 1500);
    } catch {
      setCopyError(true);
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
      setCopyError(false);
      setQuickCopied(true);
      window.setTimeout(() => setQuickCopied(false), 1500);
    } catch {
      setCopyError(true);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopyError(false);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopyError(true);
    }
  };

  // Status in the subtitle, where the role's identity reads: a draft or closed
  // role no longer looks pixel-identical to a live one.
  const statusSuffix = isDraft ? t("subtitleDraft") : isClosed ? t("subtitleClosed") : null;

  return {
    t,
    td,
    router,
    search,
    tab,
    setTab,
    copied,
    applyCopied,
    quickCopied,
    copyError,
    confirmingClose,
    setConfirmingClose,
    closing,
    closed,
    closedCount,
    closeError,
    closeRole,
    publishing,
    published,
    packExists,
    publishNote,
    goToBilling,
    isDraft,
    isClosed,
    publishRole,
    postingLang,
    setPostingLang,
    markdown,
    copyApplyLink,
    copyQuickApplyLink,
    copy,
    statusSuffix,
  };
}
