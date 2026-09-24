"use client";

// The recruiter's audio player for an opt-in interview recording (WP4).
//
// It exists for ONE job: re-hearing a passage to repair a speech-recognition error on a
// technology or product name (registry: recruiting/voice-interview-fidelity). Nothing
// scores it and no verdict is derived from it, which is why the note under the players
// says so rather than leaving the affordance to imply otherwise.
//
// A recording that is NOT playable never renders a control. The evidence door already
// resolved what the playback door will do — deleted, past its retention window, or
// available — so this component states the outcome in words instead of offering a
// player that would answer 404. An `partial` recording says it is partial: the
// recruiter must know the silence at the end is an upload that failed, not an answer
// the candidate did not give.
//
// Nothing renders at all when the session holds no recording: a workspace that never
// turned the offer on sees no chrome (docs/features/interviews/README.md, "Opt-in
// audio recording").

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { BTN_GHOST, META_LABEL } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { EvidenceRecording } from "@/app/_lib/interview-evidence";

const REASON_KEY = {
  retention: "evidence.audioReasonRetention",
  candidate_request: "evidence.audioReasonCandidate",
  recruiter: "evidence.audioReasonRecruiter",
  erasure: "evidence.audioReasonErasure",
} as const;

export function InterviewRecordings({
  sessionId,
  recordings,
  onDeleted,
}: {
  sessionId: string;
  recordings: EvidenceRecording[];
  /** Re-read the evidence so the row flips to its deletion record. */
  onDeleted: () => void;
}) {
  const t = useTranslations("scheduleTab.transcript");
  const format = useFormatter();
  const errMsg = useErrorMessage();
  // Per-attempt, because deleting one attempt's audio must never arm another's button.
  // `idle` → `confirm` → `deleting`; a failure names itself and returns to `confirm`,
  // since a recruiter told nothing would believe audio is gone when it is not.
  const [step, setStep] = useState<Record<number, "confirm" | "deleting">>({});
  const [failed, setFailed] = useState<string | null>(null);
  const at = (attempt: number, state: "confirm" | "deleting" | null) =>
    setStep((s) => {
      const next = { ...s };
      if (state === null) delete next[attempt];
      else next[attempt] = state;
      return next;
    });

  const remove = async (attempt: number) => {
    at(attempt, "deleting");
    setFailed(null);
    try {
      const r = await fetch(`/api/interview/sessions/${encodeURIComponent(sessionId)}/recording?attempt=${attempt}`, {
        method: "DELETE",
      });
      const d = (await r.json().catch(() => ({}))) as { code?: string };
      if (!r.ok) throw new Error(errMsg(d, t("evidence.audioDeleteFailed")));
      at(attempt, null);
      onDeleted();
    } catch (err) {
      setFailed(err instanceof Error ? err.message : t("evidence.audioDeleteFailed"));
      at(attempt, "confirm");
    }
  };

  if (recordings.length === 0) return null;
  const when = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { day: "numeric", month: "short", year: "numeric" }) : "";

  return (
    <section className="rounded-md border border-stone-200 bg-paper p-3">
      <p className={`${META_LABEL} tracking-wide`}>{t("evidence.audioHeading")}</p>
      <ul className="mt-2 space-y-2.5">
        {recordings.map((r) => (
          <li key={r.attempt}>
            {/* One player per attempt: a link that dropped and was retried has two
                recordings, and "the recording" would silently mean the last of them. */}
            <p className="text-sm font-semibold text-ink">{t("evidence.audioAttempt", { n: r.attempt })}</p>
            {r.state === "available" ? (
              <>
                {/* No caption track: the interview's own transcript is on this same
                    screen, verbatim and searchable, which is the text alternative.
                    `preload="none"` so opening the modal never pulls megabytes of a
                    candidate's voice the recruiter did not ask to hear. */}
                <audio
                  controls
                  preload="none"
                  className="mt-1 w-full"
                  aria-label={t("evidence.audioAttempt", { n: r.attempt })}
                  src={`/api/interview/recording/${encodeURIComponent(sessionId)}?attempt=${r.attempt}`}
                />
                {r.partial ? <p className="mt-1 text-sm text-dial-amber">{t("evidence.audioPartial")}</p> : null}
                {/* Confirm-guarded, because this is irreversible and the file is the
                    candidate's own voice. The row keeps its deletion record afterwards:
                    the deletion IS the record, so the attempt does not disappear. */}
                {step[r.attempt] ? (
                  <span className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="text-sm text-ink">{t("evidence.audioDeleteConfirm")}</span>
                    <button
                      type="button"
                      disabled={step[r.attempt] === "deleting"}
                      onClick={() => void remove(r.attempt)}
                      className={`${BTN_GHOST} h-8 px-2.5 text-sm font-semibold text-coral`}
                    >
                      {step[r.attempt] === "deleting" ? t("evidence.audioDeleting") : t("evidence.audioDeleteYes")}
                    </button>
                    <button
                      type="button"
                      disabled={step[r.attempt] === "deleting"}
                      onClick={() => at(r.attempt, null)}
                      className={`${BTN_GHOST} h-8 px-2.5 text-sm font-semibold`}
                    >
                      {t("evidence.audioDeleteNo")}
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => at(r.attempt, "confirm")}
                    className={`${BTN_GHOST} mt-1 h-8 px-2.5 text-sm font-semibold`}
                  >
                    {t("evidence.audioDelete")}
                  </button>
                )}
              </>
            ) : r.state === "deleted" ? (
              <p className="mt-1 text-sm text-steel">
                {t("evidence.audioDeleted", { date: when(r.deletedAt) })}
                {r.deleteReason ? ` · ${t(REASON_KEY[r.deleteReason])}` : ""}
              </p>
            ) : (
              <p className="mt-1 text-sm text-steel">{t("evidence.audioExpired")}</p>
            )}
          </li>
        ))}
      </ul>
      {failed ? (
        <p role="alert" className="mt-2 text-sm font-semibold text-coral">
          {failed}
        </p>
      ) : null}
      <p className="mt-2 text-meta text-steel">{t("evidence.audioNote")}</p>
    </section>
  );
}
