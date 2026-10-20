"use client";

// Completed AI interviews, as a list the recruiter can open (WP4).
//
// WHY IT EXISTS: in a workspace whose hiring plan runs an AI round and no human one,
// `ScheduleTab` renders `ScheduleAiRound` INSTEAD of the calendar surface — and the
// prep and transcript modals hang off that surface's aside. The whole evidence view was
// therefore unreachable for exactly the plan that produces the most of it.
//
// It is added BESIDE the ledger, not inside it. The ledger's scope — the two states a
// recruiter can still act on, Awaiting link and Link out / live — is deliberate and
// documented there; a completed call is not an action, it is a record. So this is a
// second, quieter section under it, the shape `ScheduleTabInterviewedList` gives the
// human round.
//
// A session with no pipeline entry (a lab or simulation run) is not listed: the
// transcript modal is entry-keyed, and inventing an entry id to open it with would be
// a link to another candidate's row.

import { FileText } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge, interviewRecommendationToken } from "@/app/_components/Badge";
import { META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import type { InterviewSessionSummary } from "@/app/_lib/db/interviews";
import type { SchedEntry } from "./ScheduleTypes";

/** The minimal entry the evaluation modals read — id and labels only. The session row
 *  keeps its entry id after the pipeline entry advances, so this stays openable for the
 *  whole history. */
function asEntry(s: InterviewSessionSummary): SchedEntry {
  return {
    id: s.entryId as string,
    candidateId: null,
    candidateLabel: s.candidateLabel ?? "—",
    archetype: null,
    roleFamily: null,
    jobId: s.jobId,
    jobTitle: s.jobTitle,
    stage: "",
    matchScore: null,
    status: "",
    approvalKind: null,
    approvalDetail: null,
  };
}

export function ScheduleAiRoundCompleted({
  sessions,
  onTranscript,
}: {
  sessions: InterviewSessionSummary[];
  onTranscript: (e: SchedEntry) => void;
}) {
  const t = useTranslations("scheduleTab");
  const tAi = useTranslations("scheduleTab.aiRound");
  const format = useFormatter();
  const enumLabel = useEnumLabel();

  const done = sessions.filter((s) => s.status === "completed" && s.entryId);
  if (done.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className={META_LABEL}>
        {tAi("completedTitle")} <span className="text-moss">· {done.length}</span>
      </p>
      <ul className="space-y-2">
        {done.map((s) => (
          <li key={s.id} className={`${PANEL} flex flex-wrap items-center gap-x-3 gap-y-2 p-2.5`}>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-ink">{s.candidateLabel ?? "—"}</span>
              <span className="block truncate text-meta text-steel">
                {s.jobTitle ?? "—"}
                {s.endedAt ? ` · ${format.dateTime(new Date(s.endedAt), { day: "numeric", month: "short" })}` : ""}
                {s.attempts > 1 ? ` · ${tAi("attempts", { count: s.attempts })}` : ""}
              </span>
            </span>
            {s.recommendation ? (
              <Badge {...interviewRecommendationToken(s.recommendation)} label={enumLabel("recommendation", s.recommendation)} />
            ) : null}
            <button
              type="button"
              onClick={() => onTranscript(asEntry(s))}
              disabled={!s.hasTranscript}
              className="focus-ring inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-moss/40 bg-moss/5 px-3 text-sm font-semibold text-moss hover:bg-moss/10 disabled:cursor-not-allowed disabled:opacity-50"
              title={s.hasTranscript ? undefined : tAi("noTranscript")}
            >
              <FileText size={14} aria-hidden /> {t("viewTranscriptScorecard")}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
