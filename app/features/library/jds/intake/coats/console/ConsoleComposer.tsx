"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { SendHorizontal } from "lucide-react";
import { FIELD } from "@/app/_components/ui/recipes";
import type { RoleBrief } from "@/app/_lib/rolespec";
import { IconAction } from "../IconAction";
import { ConsoleCallGlyph, ConsoleDictateGlyph, ConsoleSpeakGlyphs } from "./ConsoleVoiceGlyphs";
import type { VoiceSweepPayload } from "../../JdsIntakeVoice";

// THE ANSWER FIELD — one field, under one question.
//
// It carries no placeholder. The shipped composer's ("Answer in your own words.
// Vague is fine.") is a sentence teaching the reader how to use a box they are
// already looking at, directly under a question that just asked them something;
// the field's accessible name says what it is for readers who need it named, and
// the layout says the rest. That is the coat's whole content rule applied to its
// most-used control.
//
// Behaviour is the shipped composer's, unchanged: Enter sends, Shift+Enter is a
// newline, and a refused send HANDS THE DRAFT BACK instead of losing it with the
// rolled-back optimistic turn — the typed words are the only copy of what the
// requestor decided to say.

export function ConsoleComposer({
  intakeId,
  lang,
  sending,
  onSend,
  speakText,
  transcript,
  onExchange,
  onSweep,
  textareaRef,
}: {
  intakeId: string;
  lang: string;
  sending: boolean;
  /** Resolves false when the exchange did not land (429/409/offline). */
  onSend: (message: string) => void | Promise<boolean>;
  /** The agent's newest line, or null while a turn is in flight. */
  speakText: string | null;
  transcript: { role: string; text: string }[];
  onExchange: (intakeId: string, payload: { userText: string; reply: string; done: boolean; brief?: RoleBrief }) => void;
  onSweep: (intakeId: string, payload: VoiceSweepPayload) => void;
  /** The desk's handle on the field: "none of these" under a decision card set
   *  hands the turn back here, which is what makes declining a real answer
   *  rather than an absence of one. */
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const t = useTranslations("library.tab.intake.glyph");
  const tConsole = useTranslations("library.tab.intake.console");
  const [draft, setDraft] = useState("");

  const submit = async () => {
    const message = draft.trim();
    if (!message || sending) return;
    setDraft("");
    const ok = await onSend(message);
    // The send was refused: the words come back into the field, exactly where
    // they were typed, so a retry is one keystroke rather than a re-composition.
    if (ok === false) setDraft(message);
  };

  return (
    <div className="mt-4 flex flex-col gap-2">
      <textarea
        ref={textareaRef}
        className={`${FIELD} min-h-[4.5rem] w-full resize-y`}
        value={draft}
        aria-label={tConsole("answerLabel")}
        disabled={sending}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-1">
          <ConsoleDictateGlyph
            lang={lang}
            disabled={sending}
            // Dictation APPENDS into the draft and never sends: a transcription
            // is a first guess at a sentence, and a mis-heard word has to be
            // fixable before it becomes a turn.
            onDictated={(text) => setDraft((d) => (d.trim() ? `${d.replace(/\s+$/, "")} ${text.trim()}` : text.trim()))}
          />
          <ConsoleSpeakGlyphs intakeId={intakeId} lang={lang} speakText={speakText} disabled={sending} />
          <ConsoleCallGlyph
            intakeId={intakeId}
            disabled={sending}
            transcript={transcript}
            onExchange={onExchange}
            onSweep={onSweep}
          />
        </span>
        <IconAction
          icon={SendHorizontal}
          label={t("send")}
          disabled={sending || !draft.trim()}
          side="left"
          onClick={() => void submit()}
        />
      </div>
    </div>
  );
}
