// State + handlers for JobsPostingModal.tsx — extracted verbatim (no behaviour
// change) so the modal file stays under the 200-line split threshold. Owns: the
// tab selector, the close/reopen/publish lifecycle actions, the copy-to-clipboard
// actions (posting markdown, apply link, quick-apply link), and the posting
// language toggle.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { namespaceTranslator } from "@/app/_lib/catalog-translator";
import { buildUrl } from "@/app/features/shell/tabs";
import { isLocale, DEFAULT_LOCALE } from "@/i18n/locales";
import { derivePostingLifecycle } from "./jobsPostingLifecycle";
import {
  lastPublishResult,
  publishNoteSentences,
  rememberPublishResult,
  type PublishNote,
  type PublishResponse,
} from "./jobsPublishResult";
import type { PostingTabId } from "./jobsPostingModalTabs";
import {
  buildJobMarkdownStrings,
  jobToMarkdown,
  type JobMarkdownStrings,
  type PostingLocale,
} from "./jobsMarkdown";
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
  // call, same "Source into Pipeline" verb. See docs/features/jobs/README.md.
  const td = useTranslations("jobs.drafts");
  // Resolve API failures from the machine `code`, never from the server's
  // English `error` — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  const router = useRouter();
  const search = useSearchParams();
  const [tab, setTab] = useState<PostingTabId>("posting");
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
  // The close committed but reconciling the pipeline threw (route: withdrawalFailed) —
  // an amber note, mirroring publish's "published, but sourcing failed" tone. Distinct
  // from withdrawn:0, which is the honest "nobody was in flight" success.
  const [withdrawFailed, setWithdrawFailed] = useState(false);
  const closeRole = async () => {
    if (closing || closed) return;
    setClosing(true);
    setCloseError(null);
    setWithdrawFailed(false);
    try {
      const r = await fetch(`/api/jobs/${encodeURIComponent(job.id)}/close`, { method: "POST" });
      const p = (await r.json().catch(() => null)) as { withdrawn?: number; withdrawalFailed?: boolean } | null;
      if (!r.ok) throw new Error();
      setClosed(true);
      setClosedCount(typeof p?.withdrawn === "number" ? p.withdrawn : null);
      setWithdrawFailed(p?.withdrawalFailed === true);
      // Tell the Jobs table the row is now closed so its badge/openOnly filter update.
      onChanged?.("closed");
      setLifecycleToken((n) => n + 1);
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
  // This state now carries FAILURES only — a successful publish is a list of
  // sentences (publishOutcome below), not one interpolated string.
  const [publishNote, setPublishNote] = useState<{ text: string; tone: "warn" | "quota" } | null>(null);
  // The result of the last publish for THIS role, seeded from the module-scope
  // memory in jobsPublishResult.ts: closing the modal mid-publish (or after it)
  // used to throw the answer away, and reopening the role showed nothing — so a
  // three-minute sourcing run could end with the recruiter never learning what it
  // did. A restored result is flagged `stale` and labelled as the LAST publish.
  const [publishOutcome, setPublishOutcome] = useState<{ note: PublishNote; stale: boolean } | null>(() => {
    const last = lastPublishResult(job.id);
    return last ? { note: publishNoteSentences(last), stale: true } : null;
  });
  // Abandoning the wait. The route threads the request's AbortSignal into the
  // sourcing child, so aborting genuinely stops the sweep rather than orphaning
  // it — but the go-live transaction commits BEFORE sourcing starts, so the role
  // is probably live. The copy says exactly that instead of guessing either way.
  const publishAbort = useRef<AbortController | null>(null);
  const cancelPublish = () => publishAbort.current?.abort();
  // Bumped after every lifecycle transition so JobLifecycleStrip re-reads its
  // counts: its effect keyed on [jobId] alone, so the strip a recruiter had just
  // watched go live still showed the pre-publish funnel until the modal remounted.
  const [lifecycleToken, setLifecycleToken] = useState(0);
  const goToBilling = () => router.push(buildUrl({ tab: "billing" }, search.toString()));
  // The three-input state machine lives in jobsPostingLifecycle.ts (pinned by
  // jobsPostingLifecycle.test.ts) — the footer hands out apply links from its
  // answer, and a draft's pages 404 while a closed role's serve 410.
  const { isDraft, isClosed } = derivePostingLifecycle(job.status ?? null, closed, published);
  // Same call DraftsPanel makes, surfaced where the draft actually opens: take
  // the JD live and source matching candidates into the pipeline. tone "warn" =
  // published but sourcing errored — not to be mistaken for a clean "sourced 0".
  const publishRole = async () => {
    if (publishing) return;
    setPublishing(true);
    setPublishNote(null);
    const controller = new AbortController();
    publishAbort.current = controller;
    try {
      const r = await fetch(`/api/jobs/${encodeURIComponent(job.id)}/publish`, {
        method: "POST",
        signal: controller.signal,
      });
      const p = (await r.json().catch(() => null)) as (PublishResponse & { code?: string }) | null;
      if (!r.ok || !p) {
        // The plan's active-job cap (402): the highest-intent upsell moment — show a
        // distinct quota state with a Billing link, not a generic sourcing-failed warn.
        if (p?.code === "quota_exceeded") {
          setPublishNote({ text: td("quotaNote"), tone: "quota" });
          return;
        }
        throw new Error(errMsg(p, td("sourcingFailed")));
      }
      // Re-publish doubles as Reopen for a closed role; clear the local closed flag so
      // the footer/links flip back to live (the cap is re-checked above on reopen).
      setClosed(false);
      setClosedCount(null);
      setWithdrawFailed(false);
      setPublished(true);
      // Publish AND reopen both land the role at 'published' — refresh the table row.
      onChanged?.("published");
      setLifecycleToken((n) => n + 1);
      // Settle the pack-on-publish CTA: does a campaign pack already exist for
      // the language the Campaign tab opens on? Fire-and-forget — a failed/slow
      // check just leaves the CTA hidden, never blocks the publish result.
      void fetch(`/api/jobs/${encodeURIComponent(job.id)}/campaign?lang=${appLocale}`)
        .then((cr) => cr.json())
        .then((cd: { pack?: unknown }) => setPackExists(Boolean(cd?.pack)))
        .catch(() => setPackExists(null));
      // Every fact the route answered, as its own sentence — and remembered, so
      // closing the modal no longer loses it.
      rememberPublishResult(job.id, p);
      setPublishOutcome({ note: publishNoteSentences(p), stale: false });
    } catch (e) {
      if (controller.signal.aborted) {
        // Not a failure: the recruiter stopped waiting. Say what that did and did
        // not do rather than reporting a sourcing error that never happened.
        setPublishNote({ text: td("publishAbandoned"), tone: "warn" });
      } else {
        setPublishNote({ text: e instanceof Error ? e.message : td("sourcingFailed"), tone: "warn" });
      }
    } finally {
      publishAbort.current = null;
      setPublishing(false);
    }
  };
  // JOB3 — the posting can be copied in a language different from the app
  // (recruiter runs the studio in EN, posts to a Czech board). Default to the
  // active locale; the toggle swaps the strings table for the render + copy.
  const rawLocale = useLocale();
  const appLocale: PostingLocale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  // F5 — every app locale is now a posting language. The de/fr recruiter used to be
  // pinned back to "en" here because the strings table only had two columns.
  const [postingLang, setPostingLang] = useState<PostingLocale>(appLocale);
  // The strings for the ACTIVE locale come straight off the loaded catalog, so the
  // common case (posting language == app language, the default) renders on first
  // paint with nothing to await.
  const tRoot = useTranslations();
  const localStrings = useMemo(
    () =>
      buildJobMarkdownStrings(appLocale, Object.assign((key: string, values?: Record<string, string | number>) => tRoot(key as never, values as never), {
        has: (key: string) => tRoot.has(key as never),
      })),
    [appLocale, tRoot]
  );
  // A DIFFERENT posting language needs that language's catalog, which the page has
  // not loaded — fetch it lazily (a separate chunk per locale, so the modal never
  // bundles four catalogs up front). Until it lands we keep rendering the active
  // locale's scaffolding rather than flashing an empty document.
  const [foreignStrings, setForeignStrings] = useState<{ lang: PostingLocale; strings: JobMarkdownStrings } | null>(null);
  useEffect(() => {
    if (postingLang === appLocale) return;
    let alive = true;
    void namespaceTranslator(postingLang).then((t) => {
      if (alive) setForeignStrings({ lang: postingLang, strings: buildJobMarkdownStrings(postingLang, t) });
    });
    return () => {
      alive = false;
    };
  }, [postingLang, appLocale]);
  const strings = postingLang === appLocale ? localStrings : foreignStrings?.lang === postingLang ? foreignStrings.strings : localStrings;
  const markdown = useMemo(() => jobToMarkdown(job, strings), [job, strings]);

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
    withdrawFailed,
    closeRole,
    publishing,
    published,
    packExists,
    publishNote,
    publishOutcome,
    cancelPublish,
    lifecycleToken,
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
