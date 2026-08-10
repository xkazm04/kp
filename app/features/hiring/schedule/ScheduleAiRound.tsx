"use client";

// The Schedule tab's AI round (the "Docket" layout — winner of the /prototype
// round, 2026-08-10): fully AI-conducted first-round interviews as a link-out
// → interview → evaluation loop, no calendar at all. Three stations mirror the
// funnel (Awaiting link → Out / live → Completed); a completed card opens the
// compact evaluation preview (ScheduleAiEvalPreview) with the full transcript
// one click deeper. Data: GET /api/interview/sessions (workspace history) +
// the pending calendar-gated entries the tab already holds. Link generation
// reuses POST /api/interview/create (mints + emails the tokenized
// /interview/<token> link; the URL is also copied to the clipboard here).
import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "@/app/_components/toast-store";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { InterviewSessionSummary } from "@/app/_lib/db/interviews";
import type { SchedEntry } from "./ScheduleTypes";
import type { IvStatus } from "./useScheduleTab";
import { ScheduleAiDocket } from "./ScheduleAiDocket";
import { ScheduleAiEvalPreview } from "./ScheduleAiEvalPreview";

/** A row's target for the evaluation modals — the minimal entry shape the
 *  existing transcript modal reads (id + labels). Sessions keep their entry id
 *  even after the pipeline entry advances, so history stays reviewable. */
export type EvalTarget = { id: string; candidateLabel: string; jobTitle: string | null };

export function ScheduleAiRound({
  calendarEntries,
  interviews,
  onOpenTranscript,
}: {
  calendarEntries: SchedEntry[];
  interviews: Record<string, IvStatus>;
  onOpenTranscript: (target: EvalTarget) => void;
}) {
  const t = useTranslations("scheduleTab");
  const tAi = useTranslations("scheduleTab.aiRound");
  const errMsg = useErrorMessage();
  const [generating, setGenerating] = useState<string | null>(null);
  const [preview, setPreview] = useState<EvalTarget | null>(null);
  const { data, error, reload } = useJsonFetch<{ sessions?: InterviewSessionSummary[] }>(
    "/api/interview/sessions",
    t("loadFailed")
  );
  const sessions = data?.sessions ?? [];

  // Candidates still awaiting an AI-interview link: pending calendar-gated
  // entries with no live/completed session yet.
  const sessionEntryIds = new Set(sessions.filter((s) => s.status !== "revoked").map((s) => s.entryId).filter(Boolean));
  const awaiting = calendarEntries.filter((e) => !sessionEntryIds.has(e.id) && !interviews[e.id]?.hasTranscript);

  // Mint + dispatch the tokenized interview link, and put the URL on the
  // recruiter's clipboard for manual channels. Reuses the create route's
  // guards (409 while a call is live; billing meter; link TTL + revoke).
  const generateLink = async (e: SchedEntry) => {
    setGenerating(e.id);
    try {
      const r = await fetch("/api/interview/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId: e.id }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 409) throw new Error(t("interviewLiveRefused"));
      if (!r.ok) throw new Error(errMsg(d, t("startFailed")));
      if (typeof d.url === "string") {
        await navigator.clipboard?.writeText(d.url).catch(() => undefined);
        toast.success(tAi("linkCopied"));
      }
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("startFailed"));
    } finally {
      setGenerating(null);
    }
  };

  return (
    <div className="space-y-4">
      {error ? (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-base text-red-700">{error}</p>
      ) : data === null ? (
        <div className="reveal-quiet min-h-[16rem]" aria-hidden />
      ) : (
        <ScheduleAiDocket
          sessions={sessions}
          awaiting={awaiting}
          interviews={interviews}
          generating={generating}
          onGenerate={generateLink}
          onPreview={setPreview}
        />
      )}

      {preview ? (
        <ScheduleAiEvalPreview
          target={preview}
          onClose={() => setPreview(null)}
          onOpenFull={() => {
            const p = preview;
            setPreview(null);
            onOpenTranscript(p);
          }}
        />
      ) : null}
    </div>
  );
}
