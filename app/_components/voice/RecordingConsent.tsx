"use client";

import { useTranslations } from "next-intl";
import { Checkbox } from "@/app/_components/Checkbox";
import {
  RECORDING_BACKSTOP_DAYS,
  RECORDING_RETENTION_AFTER_DECISION_DAYS,
} from "@/app/_lib/interview-recording-paths";

// The SEPARATE audio-recording consent on the interview portal (spark
// ai-interview-parity). Declining never blocks the call.
//
// WHY IT IS ITS OWN TICK. The main consent covers an AI-conducted, TRANSCRIBED
// interview. Keeping the audio is a different thing to agree to — a different artifact,
// a different retention window, a different way to withdraw — and bundling it into one
// checkbox would make the whole agreement unspecific, which is precisely what an opt-in
// has to avoid (registry: recruiting/candidate-consent-and-retention).
//
// WHAT THE COPY OWES, and each line below is one of them:
//   • what is captured — the candidate's microphone ONLY;
//   • why — so a recruiter can re-listen and correct a misheard technology name;
//   • how long — 30 days past the hiring decision, at most 180 days past the call;
//   • how to undo it — from their own status page, any time;
//   • that declining costs them nothing.
// The two day-counts are INTERPOLATED from the constants the server enforces
// (interview-recording-paths.ts), so the promise and the sweep cannot drift apart
// (registry: retention-ttl-and-derived-disclosure).

export type RecordingConsentProps = {
  /** The workspace offers recording; false renders nothing. */
  offered: boolean;
  checked: boolean;
  /** Locked once a call is in flight, like the main consent. */
  disabled: boolean;
  onChange: (value: boolean) => void;
};

/** The whole in-call surface recording is allowed to have: one quiet chip.
 *
 *  A candidate mid-interview must not be managing a second thing, so there is no
 *  pause/stop/level meter here and nothing moves. It says "recording" while audio is
 *  being kept and says NOTHING when the capture failed — a red banner about a broken
 *  observation aid would make the candidate believe their interview is broken, which is
 *  the exact failure mode this feature is not allowed to have. Optional by design: the
 *  call shell mounts it or does not. */
export function RecordingIndicator({ state }: { state: "off" | "recording" | "uploading" | "failed" | "done" }) {
  const t = useTranslations("interview.voice.recording");
  if (state !== "recording" && state !== "uploading") return null;
  return (
    <span
      role="status"
      aria-label={t("indicatorLabel")}
      className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-2 py-0.5 text-meta text-steel"
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-coral" />
      {t("indicator")}
    </span>
  );
}

export function RecordingConsent({ offered, checked, disabled, onChange }: RecordingConsentProps) {
  const t = useTranslations("interview.voice.recording");
  // Not offered = nothing to agree to. Rendering a disabled or explanatory box would
  // tell a candidate their audio is in play on a deployment where it never is.
  if (!offered) return null;
  return (
    <div className="rounded-lg border border-stone-200 bg-paper p-3">
      <Checkbox
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        label={t("optInLabel")}
        hint={
          <>
            <span className="block">{t("what")}</span>
            <span className="mt-1 block">{t("why")}</span>
            <span className="mt-1 block">
              {t("when", { decisionDays: RECORDING_RETENTION_AFTER_DECISION_DAYS, backstopDays: RECORDING_BACKSTOP_DAYS })}
            </span>
            <span className="mt-1 block">{t("control")}</span>
            <span className="mt-1 block font-medium text-ink">{t("optional")}</span>
          </>
        }
      />
    </div>
  );
}
