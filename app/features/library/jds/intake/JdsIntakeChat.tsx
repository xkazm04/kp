"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { BTN_PRIMARY, FIELD } from "@/app/_components/ui/recipes";
import type { IntakeTurn } from "./jdsIntakeLogic";

// The conversation column: transcript bubbles + composer. The agent speaks
// left in a quiet surface; the requestor speaks right on the ink accent
// (text-white flips by design in Spark Dark). Register matches the persona —
// calm, roomy line-height, no avatars, no gamification.

export function JdsIntakeChat({
  transcript,
  sending,
  closed,
  onSend,
  voiceSlot,
}: {
  transcript: IntakeTurn[];
  sending: boolean;
  closed: boolean;
  onSend: (message: string) => void;
  /** Optional extra control rendered beside Send (the voice input mode). */
  voiceSlot?: React.ReactNode;
}) {
  const t = useTranslations("library.tab.intake");
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Keep the newest exchange in view as turns land.
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [transcript.length, sending]);

  const submit = () => {
    const message = draft.trim();
    if (!message || sending || closed) return;
    setDraft("");
    onSend(message);
  };

  return (
    <div className="flex h-[32rem] flex-col">
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto pr-1" aria-live="polite">
        {transcript.map((turn, i) =>
          turn.role === "system" ? null : (
            <div key={i} className={turn.role === "candidate" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={
                  turn.role === "candidate"
                    ? "max-w-[85%] whitespace-pre-wrap rounded-lg bg-ink px-3.5 py-2.5 text-body text-white dark:rounded-2xl"
                    : "max-w-[85%] whitespace-pre-wrap rounded-lg bg-stone-100 px-3.5 py-2.5 text-body text-ink dark:rounded-2xl"
                }
              >
                {turn.text}
              </div>
            </div>
          )
        )}
        {sending ? (
          <div className="flex justify-start">
            <div className="rounded-lg bg-stone-100 px-3.5 py-2.5 text-body text-steel dark:rounded-2xl">
              {t("thinking")}
            </div>
          </div>
        ) : null}
      </div>
      <div className="mt-3 flex items-end gap-2">
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
              submit();
            }
          }}
        />
        <button
          type="button"
          className={`${BTN_PRIMARY} h-10 px-4 text-sm`}
          onClick={submit}
          disabled={closed || sending || !draft.trim()}
        >
          {t("composer.send")}
        </button>
        {voiceSlot}
      </div>
    </div>
  );
}
