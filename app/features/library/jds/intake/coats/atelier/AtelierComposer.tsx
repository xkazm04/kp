"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { AudioLines, CircleDashed, Mic, MicOff, Paperclip, Play, Send, Square, Volume2, VolumeX } from "lucide-react";
import { micLevelPercent } from "@/app/_components/voice/useMicTest";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { useIntakeDictation } from "../../useIntakeDictation";
import { useIntakeSpeech } from "../../useIntakeSpeech";
import type { IntakeTurn } from "../../jdsIntakeLogic";
import { IconAction } from "@/app/_components/IconAction";

// ATELIER — the composer as ONE BARE FIELD ON THE PLANE.
//
// A hairline above it is the only boundary; there is no bordered input box, no
// captioned Send, no row of labelled voice buttons and no placeholder sentence
// telling the requestor how to answer. Every action is a glyph that carries its
// own name (IconAction → aria-label + tooltip + sr-only), so the row costs one
// line of chrome instead of four.
//
// AN ABSENT CAPABILITY IS DRAWN, NOT EXPLAINED. A machine with no speech-to-text
// gets a struck microphone with the reason in its tooltip — the classic coat
// printed a sentence there instead, which is a paragraph of layout spent saying
// that a feature is missing. Same for read-aloud.
//
// SENDING IS A GLYPH SWAP, not a spinner: the paper plane becomes a static
// dashed mark while a turn is in flight (animation austerity forbids
// `repeat: Infinity`), and the honest wait is drawn once, in the transcript.
//
// Everything the shared composer guaranteed still holds: Enter sends,
// Shift+Enter newlines, the draft clears optimistically and is HANDED BACK when
// `onSend` resolves false, and dictation APPENDS to whatever is typed and never
// sends on its own.

export function AtelierComposer({
  intakeId,
  lang,
  transcript,
  sending,
  onSend,
  onOpenMaterials,
  materialsHint,
  voiceSlot,
  focusRef,
}: {
  intakeId: string;
  lang: string;
  transcript: IntakeTurn[];
  sending: boolean;
  onSend: (message: string) => void | Promise<boolean>;
  onOpenMaterials: () => void;
  /** What the materials glyph is holding, for its tooltip. */
  materialsHint: string;
  /** The full-call relay control (JdsIntakeVoice) — a different job from
   *  dictation: one is "type by speaking", the other is "have the conversation
   *  aloud". */
  voiceSlot?: ReactNode;
  focusRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const t = useTranslations("library.tab.intake.glyph");
  const tIntake = useTranslations("library.tab.intake");
  const tVoice = useTranslations("library.tab.intake.voiceIo");
  const resolveError = useErrorMessage();
  const [draft, setDraft] = useState("");
  const ownRef = useRef<HTMLTextAreaElement | null>(null);
  const inputRef = focusRef ?? ownRef;

  // Dictation writes THROUGH this component's own state — no native-setter
  // bridge is needed here, because the draft is not hidden inside a shared
  // primitive any more. It appends and never sends: a transcription is a first
  // draft, and a mis-heard word must be fixable before it becomes a turn.
  const dictation = useIntakeDictation({
    lang,
    onDictated: (text: string) => {
      const words = text.trim();
      if (!words) return;
      setDraft((current) => (current.trim() ? `${current.replace(/\s+$/, "")} ${words}` : words));
      inputRef.current?.focus();
    },
  });

  // The agent's newest line. Null while a turn is in flight — the reply on
  // screen is the PREVIOUS one, and speaking it while the next is being written
  // would read the conversation back out of order.
  const speakText = useMemo(() => {
    if (sending) return null;
    for (let i = transcript.length - 1; i >= 0; i -= 1) {
      const turn = transcript[i];
      if (turn?.role === "interviewer" && turn.text.trim()) return turn.text;
    }
    return null;
  }, [transcript, sending]);
  const speech = useIntakeSpeech({ speakText, lang, sessionKey: intakeId });

  const micError = dictation.phase === "error" ? resolveError({ code: dictation.errorCode }, tIntake("error")) : null;
  const speakError = speech.playback === "error" ? resolveError({ code: speech.errorCode }, tIntake("error")) : null;
  const readable = speakText?.trim() ? speakText : null;

  async function submit() {
    const message = draft.trim();
    if (!message || sending) return;
    setDraft("");
    const ok = await onSend(message);
    if (ok === false) setDraft((d) => (d.trim() ? d : message));
  }

  return (
    <div className="shrink-0 border-t border-stone-200 pt-2">
      <textarea
        ref={inputRef}
        rows={2}
        value={draft}
        aria-label={t("compose")}
        disabled={sending}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
        className="focus-ring w-full resize-none rounded-md bg-transparent px-0.5 py-1 text-body leading-7 text-ink outline-none disabled:opacity-50"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-0.5">
          <IconAction icon={Paperclip} label={t("materials")} hint={materialsHint} onClick={onOpenMaterials} />
          {dictation.unavailable ? (
            <IconAction icon={MicOff} label={t("dictateOff")} tone="muted" />
          ) : (
            <IconAction
              icon={dictation.listening ? Square : Mic}
              label={dictation.listening ? tVoice("dictating") : t("dictate")}
              toggle
              on={dictation.listening}
              disabled={sending || dictation.busy}
              onClick={dictation.toggle}
            />
          )}
          {/* A microphone that is open owes a continuously visible indicator, and
              the meter is that indicator's evidence — a flat bar during speech is
              a diagnosis no post-hoc error can match. Under reduced motion the
              animated bar is replaced by the same number as text. */}
          {dictation.listening && dictation.metered ? (
            <>
              <span
                className="h-1 w-12 overflow-hidden rounded-full bg-stone-200 motion-reduce:hidden"
                role="progressbar"
                aria-label={tVoice("dictating")}
                aria-valuenow={micLevelPercent(dictation.level)}
              >
                <span
                  className="block h-full rounded-full bg-moss transition-[width] duration-100 motion-reduce:transition-none"
                  style={{ width: `${micLevelPercent(dictation.level)}%` }}
                />
              </span>
              <span className="hidden text-sm text-steel tabular-nums motion-reduce:inline">
                {micLevelPercent(dictation.level)}%
              </span>
            </>
          ) : null}
          {speech.unavailable ? (
            <IconAction icon={VolumeX} label={t("speakOff")} tone="muted" />
          ) : (
            <>
              {readable ? (
                <IconAction
                  icon={speech.blocked ? Play : speech.speaking ? Square : Volume2}
                  label={speech.speaking ? tVoice("speaking") : t("speak")}
                  toggle
                  on={speech.speaking}
                  onClick={() => {
                    if (speech.blocked) speech.resume();
                    else if (speech.speaking) speech.stop();
                    else speech.speak(readable);
                  }}
                />
              ) : null}
              <IconAction
                icon={AudioLines}
                label={t("autoSpeak")}
                toggle
                on={speech.autoSpeak}
                onClick={() => speech.setAutoSpeak(!speech.autoSpeak)}
              />
            </>
          )}
        </span>
        <span className="flex items-center gap-2">
          {voiceSlot}
          <IconAction
            icon={sending ? CircleDashed : Send}
            label={t("send")}
            hint={sending ? tIntake("thinking") : undefined}
            disabled={sending || !draft.trim()}
            tone={sending ? "muted" : "default"}
            onClick={() => void submit()}
          />
        </span>
      </div>
      {/* A refusal the requestor must act on is never chrome — it stays. */}
      {micError ? (
        <p className="mt-1 text-sm text-coral" role="status">
          {micError}
        </p>
      ) : null}
      {speakError ? (
        <p className="mt-1 text-sm text-coral" role="status">
          {speakError}
        </p>
      ) : null}
    </div>
  );
}
