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
      {/* aria-live: the arrows move the whole window's content, and a screen
          reader that only hears the new answer has no idea WHERE it landed. */}
      <span className="nums min-w-[4.5rem] text-center text-sm text-steel" aria-live="polite">
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

/**
 * The same position as a shape rather than a number — the information-dense
 * direction's mini-timeline.
 *
 * One dot per answer, the current one filled. It is a real jump control, not an
 * indicator: at seventeen answers a dot is a faster way back to "the third one"
 * than three presses. Capped at a window around the current position, because a
 * conversation of sixty answers would otherwise draw sixty dots across a strip
 * that has to stay one line tall — the counter beside it keeps the truth that
 * the dots stop being able to tell.
 */
export function VoiceDots({ history, span = 12 }: { history: VoiceHistory; span?: number }) {
  const t = useTranslations("companion");
  if (history.total === 0) return null;
  const half = Math.floor(span / 2);
  const start = Math.max(0, Math.min(history.index - half, history.total - span));
  const end = Math.min(history.total, Math.max(start + span, span));
  const shown = history.entries.slice(Math.max(0, start), end);
  return (
    <div role="group" aria-label={t("voiceMode.timeline")} className="flex items-center gap-1">
      {shown.map((entry, offset) => {
        const at = Math.max(0, start) + offset;
        const current = at === history.index;
        return (
          <button
            key={entry.id}
            type="button"
            onClick={() => history.goTo(at)}
            aria-current={current ? "true" : undefined}
            aria-label={t("voiceMode.position", { index: at + 1, total: history.total })}
            title={t("voiceMode.position", { index: at + 1, total: history.total })}
            className={`focus-ring h-2 w-2 rounded-full transition-colors ${
              current ? "bg-coral" : "bg-stone-300 hover:bg-steel"
            }`}
          />
        );
      })}
    </div>
  );
}
