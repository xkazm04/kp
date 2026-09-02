"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { railIconBtn } from "@/app/_components/ui/recipes";
import type { VoiceHistory } from "./useVoiceHistory";

/*
 * Walking back through what she has said.
 *
 * This is the affordance the whole mode is FOR. A conversation column answers
 * "what did she say earlier" with a scrollbar, and a scrollbar over a thread of
 * seventeen answers is a search, not a step. Two arrows and a counter turn the
 * same question into a countable one: you are on 14 of 17, three presses gets
 * you to the one you remember.
 *
 * LEFT IS OLDER, and it is left because the transcript it replaces reads
 * downward-newest: the operator's mental model is a tape, and the tape runs
 * backwards to the left. The same two keys do it from the keyboard when the
 * header window has focus (`history.onKeyDown`, bound by the host on the region
 * rather than on the document — see the hook).
 *
 * The counter is not decoration: without it "older" has no floor and an operator
 * pressing left has no idea whether they are near the start of the conversation
 * or nine presses from it. It carries `nums` so the digits do not wobble as they
 * change width.
 */
export function VoiceNav({ history, className = "" }: { history: VoiceHistory; className?: string }) {
  const t = useTranslations("companion");
  if (history.total === 0) return null;
  return (
    <div className={`flex items-center gap-0.5 ${className}`}>
      <button
        type="button"
        onClick={history.older}
        disabled={!history.canOlder}
        aria-label={t("voiceMode.older")}
        title={t("voiceMode.older")}
        className={`${railIconBtn(false)} disabled:opacity-30`}
      >
        <ChevronLeft size={18} aria-hidden />
      </button>
      {/* NOT a live region. It was one, and with the prose region and the busy
          note that made THREE announcements fire on a single arrow press, which
          is how a screen reader user ends up hearing none of them properly. The
          strip keeps one live region for the answer (VoiceProse) and one status
          region for busy; the position stays readable, right beside the arrows
          that changed it, for anyone who goes looking. */}
      <span className="nums min-w-[4.5rem] text-center text-sm text-steel">
        {t("voiceMode.position", { index: history.position, total: history.total })}
      </span>
      <button
        type="button"
        onClick={history.newer}
        disabled={!history.canNewer}
        aria-label={t("voiceMode.newer")}
        title={t("voiceMode.newer")}
        className={`${railIconBtn(false)} disabled:opacity-30`}
      >
        <ChevronRight size={18} aria-hidden />
      </button>
    </div>
  );
}
