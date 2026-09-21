"use client";

// A voice interview's spend, resolved to the conversation it paid for.
//
// The `interview_realtime` ledger row carries the SESSION id as its request id
// (the completion route writes it that way) — it is not a background run, so the
// task lookup used to answer "run gone" for a transcript that was sitting in
// interview_sessions the whole time. This reads the session through the
// operator-gated by-id door and lays the conversation out turn by turn, with the
// verdict on top when a scorecard was produced.

import { useTranslations } from "next-intl";
import { Badge, interviewRecommendationToken } from "@/app/_components/Badge";
import { META_LABEL } from "@/app/_components/ui/recipes";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import type { InterviewRecommendation } from "@/app/_lib/interview-recommendation";
import type { VoiceTurn } from "@/app/_lib/voice/types";

type SessionWire = {
  candidateLabel: string | null;
  jobTitle: string | null;
  status: string;
  transcript: VoiceTurn[] | null;
  scorecard: { recommendation?: InterviewRecommendation; summary?: string } | null;
};

export function ActivityInterviewRun({ sessionId }: { sessionId: string }) {
  const t = useTranslations("activity");
  const enumLabel = useEnumLabel();
  const { data, error } = useJsonFetch<{ session: SessionWire }>(`/api/interview/sessions/${encodeURIComponent(sessionId)}`, "");
  if (error) return <p className="text-base text-steel">{t("interviewGone")}</p>;
  if (!data) return <div className="reveal-quiet min-h-[3rem]" aria-hidden />;
  const s = data.session;
  const turns = (s.transcript ?? []).filter((turn) => turn.role !== "system");
  const rec = s.scorecard?.recommendation;

  return (
    <div className="space-y-3">
      <p className="text-base text-ink">
        {t("interviewConversation", { name: s.candidateLabel ?? "—", role: s.jobTitle ?? "—" })}
      </p>
      {rec ? (
        <p className="flex items-center gap-2">
          <Badge {...interviewRecommendationToken(rec)} label={enumLabel("recommendation", rec)} />
          {s.scorecard?.summary ? <span className="text-sm text-steel">{s.scorecard.summary}</span> : null}
        </p>
      ) : null}
      {turns.length === 0 ? (
        <p className="text-sm text-steel">{t("interviewNoTranscript")}</p>
      ) : (
        <ol className="max-h-[50dvh] space-y-2 overflow-y-auto rounded-md border border-stone-200 bg-paper p-3">
          {turns.map((turn, i) => (
            <li key={i} className={turn.role === "candidate" ? "pl-6" : ""}>
              <p className={META_LABEL}>{t(turn.role === "candidate" ? "turnCandidate" : "turnInterviewer")}</p>
              <p className="text-sm text-ink">{turn.text}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
