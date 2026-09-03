"use client";

import { useTranslations } from "next-intl";
import { CheckCircle2, Mic } from "lucide-react";
import { BTN_SECONDARY } from "@/app/_components/ui/recipes";
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
        className={`${BTN_SECONDARY} h-10 justify-center gap-2 bg-white px-4 text-base`}
      >
        <Mic size={16} />
        {micTest === "testing" ? t("micTestListening") : t("micTestBtn")}
      </button>
      {/* The verdict is the whole point of the test, and it was rendered as a
          plain span that simply appeared 4s after the click — a screen-reader
          candidate got NO feedback that the test had finished, let alone whether
          we heard them, and would walk into the call with a dead mic. This
          wrapper is a PERSISTENT live region (mounted for every state, so the
          announcement doesn't depend on a freshly-inserted node being picked up)
          and it deliberately excludes the button, whose own label change the AT
          already reports for the focused element. Empty it collapses to zero
          width; the parent's trailing gap is invisible in a full-width row. */}
      <div aria-live="polite" className="flex flex-wrap items-center gap-3">
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
    </div>
  );
}
