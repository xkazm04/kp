"use client";

import { useTranslations } from "next-intl";
import { CheckCircle2, Mic } from "lucide-react";
import type { MicTestState } from "./useMicTest";

/** H5 follow-up: pre-call mic test — reassurance + early catch of a muted/dead mic. */
export function MicTestPanel({
  micTest,
  micLevel,
  onTest,
}: {
  micTest: MicTestState;
  micLevel: number;
  onTest: () => void;
}) {
  const t = useTranslations("interview.voice");
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 bg-paper/50 px-4 py-3">
      <button
        type="button"
        onClick={onTest}
        disabled={micTest === "testing"}
        className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-4 text-base font-medium text-ink transition-colors hover:bg-paper disabled:opacity-50"
      >
        <Mic size={16} />
        {micTest === "testing" ? t("micTestListening") : t("micTestBtn")}
      </button>
      {micTest === "testing" ? (
        <div
          className="h-2 w-32 overflow-hidden rounded-full bg-stone-200"
          role="progressbar"
          aria-label={t("micTestListening")}
          aria-valuenow={Math.round(micLevel * 100)}
        >
          <div
            className="h-full rounded-full bg-moss transition-[width] duration-100"
            style={{ width: `${Math.round(micLevel * 100)}%` }}
          />
        </div>
      ) : null}
      {micTest === "heard" ? (
        <span className="inline-flex items-center gap-1.5 text-base text-moss">
          <CheckCircle2 size={16} aria-hidden /> {t("micTestHeard")}
        </span>
      ) : null}
      {micTest === "silent" ? <span className="text-base text-coral">{t("micTestSilent")}</span> : null}
      {micTest === "denied" ? <span className="text-base text-coral">{t("errMicDenied")}</span> : null}
    </div>
  );
}
