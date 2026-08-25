"use client";

import { useState } from "react";
import { ArrowUp, Mic } from "lucide-react";
import { useTranslations } from "next-intl";
import { BTN_PRIMARY } from "@/app/_components/ui/recipes";

/*
 * The slim bottom bar — the half of the pair the operator types into.
 *
 * ONE LINE, and that is the whole point of the mode. The dock's composer is a
 * four-row textarea because a conversation column is already spending the
 * screen; here the deal is the opposite — the operator gave up the column to
 * keep the page visible, so the input cannot claim it back. Hence an `<input>`
 * rather than a `<textarea>`: a single line cannot grow, Enter has exactly one
 * meaning, and there is no Shift+Enter to explain.
 *
 * The draft contract is `ChatComposer`'s, deliberately reproduced rather than
 * shared: cleared optimistically on send, RESTORED when the exchange resolves
 * false, and never clobbering what was typed while the request was in flight. A
 * refused message (429, offline, a thread that moved) otherwise leaves the
 * sentence existing nowhere. This is the one duplication in the round and it is
 * ~8 lines; the alternative was a `compact` prop on a component V1 owns and this
 * round may not touch.
 *
 * THE MIC IS A PLACEHOLDER AND SAYS SO. It is drawn disabled with a title naming
 * what it is waiting for. A voice mode with no microphone icon at all reads as
 * an oversight; one with a live-looking icon that does nothing is worse. The
 * honest third option is a control that is visibly not ready yet.
 */
export function VoiceInputBar({
  onSend,
  busy,
  /** The bar is the pair's anchor: it is the one part of the mode that is always
   *  the same, so its class is a constant here rather than something a variant
   *  can reshape. Only its width is left to the host's geometry. */
  className = "",
}: {
  onSend: (message: string) => Promise<boolean>;
  busy: boolean;
  className?: string;
}) {
  const t = useTranslations("companion");
  const [draft, setDraft] = useState("");

  async function submit() {
    const message = draft.trim();
    if (!message || busy) return;
    setDraft("");
    const ok = await onSend(message);
    if (!ok) setDraft((current) => (current.trim() ? current : message));
  }

  return (
    <div
      className={`flex items-center gap-1.5 rounded-full border border-stone-200 bg-paper py-1.5 pl-4 pr-1.5 shadow-overlay ${className}`}
    >
      <input
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          void submit();
        }}
        placeholder={t("voiceMode.placeholder")}
        aria-label={t("voiceMode.placeholder")}
        disabled={busy}
        // No FIELD recipe: that one carries the rounded-md bordered box, and the
        // bar itself IS the box here. The field inside it must be invisible.
        className="min-w-0 flex-1 bg-transparent text-base text-ink caret-coral outline-none placeholder:text-steel disabled:opacity-60"
      />
      <button
        type="button"
        disabled
        aria-label={t("voiceMode.mic")}
        title={t("voiceMode.mic")}
        className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-steel opacity-40"
      >
        <Mic size={17} aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy || !draft.trim()}
        aria-label={t("chat.send")}
        title={t("chat.send")}
        className={`${BTN_PRIMARY} h-9 w-9 shrink-0 justify-center rounded-full p-0 dark:rounded-full`}
      >
        <ArrowUp size={17} aria-hidden />
      </button>
    </div>
  );
}
