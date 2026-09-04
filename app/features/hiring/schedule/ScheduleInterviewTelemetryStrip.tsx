"use client";

// Compact strip of the per-interview telemetry the engine attaches to the AI
// scorecard (talk share, longest pause, spoken duration, scripted-hint
// response, language lock). These are DESCRIPTIVE conversation signals, not
// scores: neutral tokens only, no verdict coloring. Renders nothing when
// telemetry is absent (old sessions) or every field is null — no empty
// chrome. Split out of ScheduleInterviewTranscriptModal.tsx to keep the modal
// file under the 200-line cap.

import type { useTranslations } from "next-intl";
import type { InterviewTelemetry } from "@/app/_lib/interview-telemetry";
import { talkSharePercent, formatSpokenDuration } from "@/app/_lib/voice/telemetry-format";

const HINT_LABEL_KEY = {
  integrated: "hintIntegrated",
  acknowledged: "hintAcknowledged",
  missed: "hintMissed",
} as const;

const LANG_LABEL_KEY = {
  locked: "langLocked",
  drifted: "langDrifted",
  indeterminate: "langIndeterminate",
} as const;

export function InterviewTelemetryStrip({
  telemetry,
  t,
}: {
  telemetry: InterviewTelemetry;
  t: ReturnType<typeof useTranslations<"scheduleTab.transcript">>;
}) {
  const talk = talkSharePercent(telemetry);
  // Parts, not a formatted string: the unit letters live in the 4 catalogs.
  const pauseParts = formatSpokenDuration(telemetry.longestResponseGapSec);
  const durationParts = formatSpokenDuration(telemetry.durationSec);
  const pause = pauseParts ? t("duration", pauseParts) : null;
  const duration = durationParts ? t("duration", durationParts) : null;
  const hintKey =
    telemetry.hint.offered && telemetry.hint.uptake !== "not_offered"
      ? HINT_LABEL_KEY[telemetry.hint.uptake]
      : null;
  // Language-lock verdict — absent on telemetry persisted before the field existed
  // (legacy sessions render no chrome, same rule as every other field here).
  const langKey = telemetry.language ? LANG_LABEL_KEY[telemetry.language.verdict] : null;

  const items: { label: string; value: string }[] = [];
  if (talk !== null) items.push({ label: t("telemetryTalkShare"), value: t("telemetryTalkShareValue", { pct: talk }) });
  if (pause) items.push({ label: t("telemetryLongestPause"), value: pause });
  if (duration) items.push({ label: t("telemetryDuration"), value: duration });
  if (hintKey) items.push({ label: t("telemetryHint"), value: t(hintKey) });
  if (langKey) items.push({ label: t("telemetryLanguage"), value: t(langKey) });

  if (items.length === 0) return null;

  return (
    <div className="mt-3 rounded-md border border-stone-200 bg-stone-50 p-2.5">
      <p className="text-meta uppercase tracking-wide text-steel">{t("telemetryHeading")}</p>
      <dl className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1.5">
        {items.map((it, i) => (
          <div key={i} className="flex items-baseline gap-1.5">
            <dt className="text-meta text-steel">{it.label}</dt>
            <dd className="text-sm font-semibold text-ink nums">{it.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-1.5 text-meta text-steel">{t("telemetryNote")}</p>
    </div>
  );
}
