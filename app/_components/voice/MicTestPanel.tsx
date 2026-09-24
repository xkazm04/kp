"use client";

import { useTranslations } from "next-intl";
import { CheckCircle2, Mic, Volume2 } from "lucide-react";
import { BTN_SECONDARY } from "@/app/_components/ui/recipes";
import { micLevelPercent, type MicTestState } from "./useMicTest";
import type { SpeakerTestState } from "./useSpeakerTest";

/** H5 follow-up: pre-call mic test — reassurance + early catch of a muted/dead mic.
 *
 *  Both directions now (spark ai-interview-parity): a candidate who cannot HEAR the
 *  interviewer fails the screen exactly as completely as one we cannot hear, and used
 *  to find out by sitting in silence after Start. The speaker half is advisory — no
 *  browser API can confirm a sound was heard, so the verdict is the candidate's own
 *  answer and nothing here can block Start. */
export function MicTestPanel({
  micTest,
  micLevel,
  onTest,
  speakerTest,
  onSpeakerTest,
  onSpeakerHeard,
}: {
  micTest: MicTestState;
  micLevel: number;
  onTest: () => void;
  speakerTest: SpeakerTestState;
  onSpeakerTest: () => void;
  onSpeakerHeard: (heard: boolean) => void;
}) {
  const t = useTranslations("interview.voice");
  return (
    <div className="space-y-3 rounded-lg border border-stone-200 bg-paper/50 px-4 py-3">
    <div className="flex flex-wrap items-center gap-3">
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
          // The level bar is a continuously-animating element and was the one
          // motion cue on this surface with NO reduced-motion gate (its siblings
          // .voice-eq-bar / .voice-listen are gated in app/globals.css). Under
          // prefers-reduced-motion the bar is hidden and the SAME number is read
          // out as static text, so the information survives the accommodation
          // instead of the motion surviving it. CSS-only: no JS fork where a
          // variant holds it.
          <>
            <div
              className="h-2 w-32 overflow-hidden rounded-full bg-stone-200 motion-reduce:hidden"
              role="progressbar"
              aria-label={t("micTestListening")}
              aria-valuenow={micLevelPercent(micLevel)}
            >
              <div
                className="h-full rounded-full bg-moss transition-[width] duration-100 motion-reduce:transition-none"
                style={{ width: `${micLevelPercent(micLevel)}%` }}
              />
            </div>
            <span className="hidden text-base tabular-nums text-steel motion-reduce:inline">
              {t("micTestLevel", { level: micLevelPercent(micLevel) })}
            </span>
          </>
        ) : null}
        {micTest === "heard" ? (
          <span className="inline-flex items-center gap-1.5 text-base text-moss">
            <CheckCircle2 size={16} aria-hidden /> {t("micTestHeard")}
          </span>
        ) : null}
        {micTest === "silent" ? <span className="text-base text-coral">{t("micTestSilent")}</span> : null}
        {/* Three failure verdicts, three different fixes. The hook used to answer
            "denied" to all of them, so a candidate with an unplugged headset was
            told to grant a permission they had already granted. */}
        {micTest === "denied" ? <span className="text-base text-coral">{t("errMicDenied")}</span> : null}
        {micTest === "not-found" ? <span className="text-base text-coral">{t("errMicNotFound")}</span> : null}
        {micTest === "busy" ? <span className="text-base text-coral">{t("errMicBusy")}</span> : null}
      </div>
    </div>

      {/* The speaker half. Same shape as the mic row above — a button, then a
          PERSISTENT live region that carries the verdict, so a screen-reader
          candidate is told the outcome instead of being handed a node that appeared
          silently. */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onSpeakerTest}
          disabled={speakerTest === "playing"}
          className={`${BTN_SECONDARY} h-10 justify-center gap-2 bg-white px-4 text-base`}
        >
          <Volume2 size={16} />
          {speakerTest === "playing" ? t("speakerCheck.playing") : t("speakerCheck.btn")}
        </button>
        <div aria-live="polite" className="flex flex-wrap items-center gap-3">
          {speakerTest === "asking" ? (
            <>
              <span className="text-base text-ink">{t("speakerCheck.ask")}</span>
              <button
                type="button"
                onClick={() => onSpeakerHeard(true)}
                className={`${BTN_SECONDARY} h-9 justify-center gap-1.5 bg-white px-3 text-base`}
              >
                <CheckCircle2 size={15} aria-hidden />
                {t("speakerCheck.yes")}
              </button>
              <button
                type="button"
                onClick={() => onSpeakerHeard(false)}
                className={`${BTN_SECONDARY} h-9 justify-center bg-white px-3 text-base`}
              >
                {t("speakerCheck.no")}
              </button>
            </>
          ) : null}
          {speakerTest === "heard" ? (
            <span className="inline-flex items-center gap-1.5 text-base text-moss">
              <CheckCircle2 size={16} aria-hidden /> {t("speakerCheck.heard")}
            </span>
          ) : null}
          {/* Advisory, never blocking: it names what to check and leaves Start alone. */}
          {speakerTest === "unheard" ? <span className="text-base text-coral">{t("speakerCheck.unheard")}</span> : null}
          {speakerTest === "unsupported" ? (
            <span className="text-base text-steel">{t("speakerCheck.unsupported")}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
