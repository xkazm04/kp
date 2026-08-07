"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { BTN_PRIMARY, FIELD } from "@/app/_components/ui/recipes";
import type { IntakeTurn } from "./jdsIntakeLogic";

// The conversation column: transcript bubbles + composer. The agent speaks
// left in a quiet surface; the requestor speaks right on the ink accent
// (text-white flips by design in Spark Dark). Register matches the persona —
// calm, roomy line-height, no avatars, no gamification.
//
// Defensibility (UAT drain §2.2): a source-turn chip in the brief panel jumps
// here — `highlightTurn` scrolls the cited bubble into view and flashes it.
// System turns (e.g. the re-open note) render as a quiet centered line so the
// transcript honestly shows its own seams.

export function JdsIntakeChat({
  transcript,
  sending,
  closed,
  onSend,
  voiceSlot,
  highlightTurn,
  onHighlightDone,
}: {
  transcript: IntakeTurn[];
  sending: boolean;
  closed: boolean;
  onSend: (message: string) => void;
  /** Optional extra control rendered beside Send (the voice input mode). */
  voiceSlot?: React.ReactNode;
  /** Transcript index to scroll to + flash (a brief citation was clicked). */
  highlightTurn?: number | null;
  onHighlightDone?: () => void;
}) {
  const t = useTranslations("library.tab.intake");
  const [draft, setDraft] = useState("");
  // Latency honesty (UAT drain 2.4 — 31–40 s measured per live exchange): after
  // ~8 s the thinking bubble gains a quiet second line naming the real wait, so
  // a long generation reads as "working, and this is normal" rather than hung —
  // exactly for the evaluation-anxious requestor the register is designed for.
  // Static copy, no animation (reduced-motion safe by construction).
  const [slowHint, setSlowHint] = useState(false);
  const [flash, setFlash] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const turnRefs = useRef(new Map<number, HTMLDivElement>());

  useEffect(() => {
    // Keep the newest exchange in view as turns land.
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [transcript.length, sending]);

  useEffect(() => {
    if (!sending) return;
    const show = window.setTimeout(() => setSlowHint(true), 8000);
    return () => {
      window.clearTimeout(show);
      // Deferred a tick (the jdsHooks.ts pattern): no synchronous setState
      // inside an effect/teardown.
      window.setTimeout(() => setSlowHint(false), 0);
    };
  }, [sending]);

  useEffect(() => {
    if (highlightTurn == null) return;
    // Deferred a tick (the jdsHooks.ts pattern) — no synchronous setState in
    // the effect; the scroll rides the same tick.
    const start = window.setTimeout(() => {
      turnRefs.current.get(highlightTurn)?.scrollIntoView({ block: "center", behavior: "smooth" });
      setFlash(highlightTurn);
    }, 0);
    const end = window.setTimeout(() => {
      setFlash(null);
      onHighlightDone?.();
    }, 1600);
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(end);
    };
  }, [highlightTurn, onHighlightDone]);

  const submit = () => {
    const message = draft.trim();
    if (!message || sending || closed) return;
    setDraft("");
    onSend(message);
  };

  return (
    <div className="flex h-[32rem] flex-col">
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto pr-1" aria-live="polite">
        {transcript.map((turn, i) => {
          const setRef = (el: HTMLDivElement | null) => {
            if (el) turnRefs.current.set(i, el);
            else turnRefs.current.delete(i);
          };
          if (turn.role === "system") {
            return (
              <div key={i} ref={setRef} className="flex justify-center">
                <span className="text-meta text-steel">— {turn.text} —</span>
              </div>
            );
          }
          const flashing = flash === i ? " ring-2 ring-coral" : "";
          return (
            <div key={i} ref={setRef} className={turn.role === "candidate" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={
                  (turn.role === "candidate"
                    ? "max-w-[85%] whitespace-pre-wrap rounded-lg bg-ink px-3.5 py-2.5 text-body text-white dark:rounded-2xl"
                    : "max-w-[85%] whitespace-pre-wrap rounded-lg bg-stone-100 px-3.5 py-2.5 text-body text-ink dark:rounded-2xl") +
                  " transition-shadow" +
                  flashing
                }
              >
                {turn.text}
              </div>
            </div>
          );
        })}
        {sending ? (
          <div className="flex justify-start">
            <div className="rounded-lg bg-stone-100 px-3.5 py-2.5 text-body text-steel dark:rounded-2xl">
              {t("thinking")}
              {slowHint ? <div className="mt-1 text-meta text-steel">{t("thinkingSlow")}</div> : null}
            </div>
          </div>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <textarea
          className={`${FIELD} min-h-[3.25rem] flex-1 resize-y`}
          rows={2}
          value={draft}
          placeholder={closed ? t("composer.closed") : t("composer.placeholder")}
          disabled={closed || sending}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submitDraft();
            }
          }}
        />
        <button
          type="button"
          className={`${BTN_PRIMARY} h-10 px-4 text-sm`}
          onClick={() => submitDraft()}
          disabled={closed || sending || !draft.trim()}
        >
          {t("composer.send")}
        </button>
        {voiceSlot}
      </div>
    </div>
  );

  function submitDraft() {
    const message = draft.trim();
    if (!message || sending || closed) return;
    setDraft("");
    onSend(message);
  }
}
