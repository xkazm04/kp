"use client";

// Compact strip of the per-interview telemetry projected onto the bundle — the SAME
// descriptive signals (talk share, longest pause, spoken duration, scripted-hint
// uptake) the InterviewTranscriptModal shows, formatted through the shared
// telemetry-format projections so the numbers never fork. Neutral tokens only (a
// descriptive signal, never a score); renders nothing when every field is null.
// Split out of PipelineCandidateDrawer.tsx.

import { useTranslations } from "next-intl";
import type { InterviewTelemetry } from "@/app/_lib/interview-telemetry";
import { talkSharePercent, formatSpokenDuration } from "@/app/_lib/voice/telemetry-format";

// The scripted-hint uptake → localized label key (shared scheduleTab.transcript
// catalog; mirrors InterviewTranscriptModal so the wording never forks).
const HINT_LABEL_KEY = {
  integrated: "hintIntegrated",
  acknowledged: "hintAcknowledged",
  missed: "hintMissed",
} as const;

// The language-lock verdict → localized label key (same shared catalog / wording
// as InterviewTranscriptModal).
const LANG_LABEL_KEY = {
  locked: "langLocked",
  drifted: "langDrifted",
  indeterminate: "langIndeterminate",
} as const;

export function PipelineInterviewTelemetryStrip({
  telemetry,
  t,
}: {
  telemetry: InterviewTelemetry;
  t: ReturnType<typeof useTranslations<"scheduleTab.transcript">>;
}) {
  const talk = talkSharePercent(telemetry);
  const pause = formatSpokenDuration(telemetry.longestResponseGapSec);
  const duration = formatSpokenDuration(telemetry.durationSec);
  const hintKey =
    telemetry.hint.offered && telemetry.hint.uptake !== "not_offered" ? HINT_LABEL_KEY[telemetry.hint.uptake] : null;
  const langKey = telemetry.language ? LANG_LABEL_KEY[telemetry.language.verdict] : null;

  const items: { label: string; value: string }[] = [];
  if (talk !== null) items.push({ label: t("telemetryTalkShare"), value: t("telemetryTalkShareValue", { pct: talk }) });
  if (pause) items.push({ label: t("telemetryLongestPause"), value: pause });
  if (duration) items.push({ label: t("telemetryDuration"), value: duration });
  if (hintKey) items.push({ label: t("telemetryHint"), value: t(hintKey) });
  if (langKey) items.push({ label: t("telemetryLanguage"), value: t(langKey) });

  if (items.length === 0) return null;

  return (
    <div className="mt-2 rounded-md border border-stone-200 bg-stone-50 p-2">
      <p className="text-meta uppercase tracking-wide text-steel">{t("telemetryHeading")}</p>
      <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {items.map((it, i) => (
          <div key={i} className="flex items-baseline gap-1.5">
            <dt className="text-meta text-steel">{it.label}</dt>
            <dd className="text-sm font-semibold text-ink nums">{it.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-1 text-meta text-steel">{t("telemetryNote")}</p>
    </div>
  );
}
