"use client";

import { useState, type ReactNode } from "react";
import { BTN_PRIMARY, FIELD } from "@/app/_components/ui/recipes";
import type { ChatLabels } from "./ChatTranscript";

/*
 * The composer half of ChatTranscript, split out so both files stay well under
 * the ~200-line cap. Behaviour lifted verbatim from JdsIntakeChat:
 *   - Enter sends, Shift+Enter newlines;
 *   - the draft is cleared optimistically and RESTORED when onSend resolves
 *     false (a refused exchange — 429/409/offline — otherwise leaves the typed
 *     paragraph existing nowhere);
 *   - never clobbers whatever was typed while the request was in flight.
 */
export function ChatComposer({
  labels,
  busy,
  closed,
  onSend,
  slot,
  dense = false,
  tall = false,
}: {
  labels: ChatLabels;
  busy: boolean;
  closed: boolean;
  onSend: (message: string) => void | Promise<boolean>;
  slot?: ReactNode;
  dense?: boolean;
  /** Doubled input area for surfaces where the operator writes longer prompts (companion dock). */
  tall?: boolean;
}) {
  const [draft, setDraft] = useState("");

  async function submitDraft() {
    const message = draft.trim();
    if (!message || busy || closed) return;
    setDraft("");
    const ok = await onSend(message);
    if (ok === false) setDraft((d) => (d.trim() ? d : message));
  }

  return (
    <div className={`flex flex-wrap items-end gap-2 ${dense ? "mt-2" : "mt-3"}`}>
      <textarea
        className={`${FIELD} flex-1 resize-y ${dense ? "min-h-[2.5rem]" : tall ? "min-h-[6.5rem]" : "min-h-[3.25rem]"}`}
        rows={dense ? 1 : tall ? 4 : 2}
        value={draft}
        placeholder={closed && labels.closed ? labels.closed : labels.placeholder}
        disabled={closed || busy}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submitDraft();
          }
        }}
      />
      <button
        type="button"
        className={`${BTN_PRIMARY} ${dense ? "h-9 px-3" : "h-10 px-4"} text-sm`}
        onClick={() => void submitDraft()}
        disabled={closed || busy || !draft.trim()}
      >
        {labels.send}
      </button>
      {slot}
    </div>
  );
}
