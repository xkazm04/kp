"use client";

// The Schedule tab's AI round: fully AI-conducted first-round interviews as a
// link-out → interview loop, no calendar at all. Rendered as a LEDGER
// (ScheduleAiLedger) of the two states a recruiter can act on — Awaiting link and
// Link out / live. Completed interviews leave this surface: their verdict is a
// scorecard review in Decisions, and the conversation is logged in Insights →
// Activity under the voice-interview use case. Data: GET /api/interview/sessions
// (workspace history) + the pending calendar-gated entries the tab already holds.
// Link generation reuses POST /api/interview/create (mints + emails the tokenized
// /interview/<token> link; the URL is also copied to the clipboard here).
import dynamic from "next/dynamic";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "@/app/_components/toast-store";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { InterviewSessionSummary } from "@/app/_lib/db/interviews";
import type { SchedEntry } from "./ScheduleTypes";
import type { IvStatus } from "./useScheduleTab";
import { ScheduleAiLedger } from "./ScheduleAiLedger";
import { ScheduleAiRoundCompleted } from "./ScheduleAiRoundCompleted";

// Mounted here as well as on the human round: in an AI-only hiring plan ScheduleTab
// renders THIS component instead of the calendar surface, and the transcript modal hung
// off that surface alone — so the whole interview record was unreachable for the plan
// that produces it. Code-split like its sibling: it only loads on the click.
const InterviewTranscriptModal = dynamic(() =>
  import("./ScheduleInterviewTranscriptModal").then((m) => ({ default: m.InterviewTranscriptModal }))
);

export function ScheduleAiRound({ calendarEntries, interviews }: { calendarEntries: SchedEntry[]; interviews: Record<string, IvStatus> }) {
  const t = useTranslations("scheduleTab");
  const tAi = useTranslations("scheduleTab.aiRound");
  const errMsg = useErrorMessage();
  const [generating, setGenerating] = useState<string | null>(null);
  const [transcriptEntry, setTranscriptEntry] = useState<SchedEntry | null>(null);
  const { data, error, reload } = useJsonFetch<{ sessions?: InterviewSessionSummary[] }>("/api/interview/sessions", t("loadFailed"));
  const sessions = data?.sessions ?? [];

  // A session is a DEAD END when it can no longer produce an interview: `revoked`,
  // or `failed` — /api/interview/complete downgrades a silent-mic call to "failed"
  // so it is never scored. Neither may keep a candidate out of the Awaiting state:
  // the recruiter needs a row to reissue a link from.
  const deadSession = (status: string | undefined) => status === "revoked" || status === "failed";
  const sessionEntryIds = new Set(sessions.filter((s) => !deadSession(s.status)).map((s) => s.entryId).filter(Boolean));
  // Candidates still awaiting an AI-interview link: pending calendar-gated entries
  // with no live/completed session yet. A failed call's interviewer-only transcript
  // is not an interview either, so it must not mask the entry here.
  const awaiting = calendarEntries.filter((e) => {
    if (sessionEntryIds.has(e.id)) return false;
    const iv = interviews[e.id];
    return !iv?.hasTranscript || deadSession(iv.status);
  });

  // Mint + dispatch the tokenized interview link, and put the URL on the
  // recruiter's clipboard for manual channels. Reuses the create route's guards
  // (409 while a call is live; billing meter; link TTL + revoke).
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

  if (error) return <p role="alert" className="rounded-md bg-red-50 p-3 text-base text-red-700">{error}</p>;
  if (data === null) return <div className="reveal-quiet min-h-[16rem]" aria-hidden />;
  return (
    <div className="space-y-5">
      <ScheduleAiLedger sessions={sessions} awaiting={awaiting} interviews={interviews} generating={generating} onGenerate={generateLink} />
      <ScheduleAiRoundCompleted sessions={sessions} onTranscript={setTranscriptEntry} />
      {transcriptEntry ? <InterviewTranscriptModal entry={transcriptEntry} onClose={() => setTranscriptEntry(null)} /> : null}
    </div>
  );
}
