"use client";

import { BarChart3, Check, Copy, Link2, Megaphone, Users, Zap } from "lucide-react";
import { buildUrl } from "@/app/features/shell/tabs";
import type { useJobPostingModalLogic } from "./jobsPostingModalLogic";

// The modal footer (close/reopen, publish notes, campaign-pack CTA, apply links,
// matrix + copy-markdown actions) — extracted verbatim from JobsPostingModal.tsx
// so that file stays under the 200-line split threshold.
export function JobsPostingModalFooter({
  jobId,
  logic,
}: {
  jobId: string;
  logic: ReturnType<typeof useJobPostingModalLogic>;
}) {
  const {
    t,
    td,
    router,
    search,
    setTab,
    copied,
    applyCopied,
    quickCopied,
    copyError,
    setConfirmingClose,
    closing,
    closed,
    closedCount,
    closeError,
    withdrawFailed,
    publishing,
    published,
    packExists,
    publishNote,
    goToBilling,
    isDraft,
    isClosed,
    publishRole,
    copyApplyLink,
    copyQuickApplyLink,
    copy,
  } = logic;
  return (
    <>
      {isClosed ? (
        // JOB #3 — close was a one-way trap (the only recovery was editing the DB).
        // Reopen re-publishes (idempotent + quota-gated, so the active-jobs cap is
        // re-checked) and clears the closed badge on success.
        <button
          type="button"
          onClick={publishRole}
          disabled={publishing}
          title={t("reopenTitle")}
          className="focus-ring mr-auto inline-flex h-9 items-center gap-1 rounded-md border border-coral/40 px-3 text-sm font-semibold text-coral hover:bg-coral/5 disabled:opacity-60"
        >
          {publishing ? td("sourcing") : t("reopenRole")}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmingClose(true)}
          disabled={closing}
          title={t("closeTitle")}
          className="focus-ring mr-auto inline-flex h-9 items-center gap-1 rounded-md border border-stone-200 px-3 text-sm font-semibold text-steel hover:border-coral/40 hover:text-coral disabled:opacity-60"
        >
          {closing ? t("closing") : t("closeRole")}
        </button>
      )}
      {closeError ? (
        <span role="alert" className="text-sm text-red-700">
          {closeError}
        </span>
      ) : null}
      {closed && withdrawFailed ? (
        // The role IS closed; its in-flight candidates are not. Amber, like publish's
        // sourcingWarning — a partial success the recruiter has to act on.
        <span aria-live="polite" className="min-w-0 text-sm text-amber-800">
          {t("withdrawFailed")}
        </span>
      ) : closed && closedCount !== null ? (
        // withdrawn:0 is a real outcome (nobody was in flight) and used to render
        // NOTHING — indistinguishable from a failed close. Confirm the close itself.
        <span aria-live="polite" className="text-sm text-steel">
          {closedCount > 0 ? t("withdrewCount", { count: closedCount }) : t("closedNow")}
        </span>
      ) : null}
      {publishNote ? (
        publishNote.tone === "quota" ? (
          <span aria-live="polite" className="inline-flex min-w-0 items-center gap-2 text-sm text-coral">
            <span className="truncate">{publishNote.text}</span>
            <button
              type="button"
              onClick={goToBilling}
              className="focus-ring shrink-0 rounded-md border border-coral/40 px-2 py-0.5 font-semibold text-coral hover:bg-coral/5"
            >
              {td("goToBilling")}
            </button>
          </span>
        ) : (
          <span
            aria-live="polite"
            className={`min-w-0 truncate text-sm ${publishNote.tone === "warn" ? "text-amber-800" : "text-steel"}`}
            title={publishNote.text}
          >
            {publishNote.text}
          </span>
        )
      ) : null}
      {published && packExists !== null ? (
        // pack-on-publish — the natural next step after going live: build (or
        // open) the campaign pack you'd post the role WITH. No auto-generation
        // — generating spends an LLM call, so it stays a human click on the tab.
        <button
          type="button"
          onClick={() => setTab("campaign")}
          className="focus-ring inline-flex h-9 items-center gap-1 rounded-md border border-coral/40 px-3 text-sm font-semibold text-coral hover:bg-coral/5"
        >
          <Megaphone size={14} /> {packExists ? t("viewCampaignPack") : t("createCampaignPack")}
        </button>
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
        onClick={() => router.push(buildUrl({ tab: "matrix", job: jobId }, search.toString()))}
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
      {copyError ? (
        <p role="alert" className="basis-full text-sm text-coral">
          {t("copyFailed")}
        </p>
      ) : null}
    </>
  );
}
