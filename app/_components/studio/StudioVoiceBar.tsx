"use client";

import { createPortal } from "react-dom";
import { AudioLines, Mic, MicOff, Play, Square, Volume2, VolumeX } from "lucide-react";
import { IconAction } from "@/app/_components/IconAction";
import { micLevelPercent } from "@/app/_components/voice/useMicTest";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { useStudioComposerSlot } from "./StudioComposer";
import { useStudioDictation } from "./useStudioDictation";
import { useStudioSpeech } from "./useStudioSpeech";
import { useStudioTranslations } from "./useStudioTranslations";

// THE VOICE PAIR, as glyphs in the composer's left cluster.
//
// TWO PIPELINES IN ONE ROW, and that is all they share. The registry's voice-io
// subject is emphatic that "add voice" is not one feature: capture → transcript
// and text → synthesis have different latency, privacy and failure physics, and
// designing them as mirror images is the ancestral mistake. So this bar holds
// two hooks that never speak to each other (useStudioDictation, useStudioSpeech),
// and every state below is decided per pipeline. A machine with whisper.cpp and
// no Piper dictates and does not read aloud; a machine with neither leaves the
// session entirely reachable by typing.
//
// AN ABSENT CAPABILITY IS DRAWN, NOT EXPLAINED. A machine with no speech-to-text
// gets a struck microphone with the reason in its tooltip — a paragraph of
// layout spent saying that a feature is missing is the placeholder problem in a
// costume. Same for read-aloud.
//
// WHAT THE MIC PROMISES. `aria-pressed` while listening, a stop glyph rather
// than a second button, and — the rule that makes a microphone honest — a
// continuously visible indicator for as long as it is open: a live level meter
// says whether we can actually hear you. A flat bar during speech is a diagnosis
// no post-hoc error message can match, so the bar is only painted when the
// level is genuinely being measured (`metered`).
//
// NOTHING AUTO-SENDS. The transcript lands through `onDictation` (an APPEND on
// the consumer's side — `useStudioComposerDraft().append`), where a mis-heard
// word is fixed before the agent sees it.
//
// A REFUSAL IS RENDERED FROM ITS CODE, never from the route's English `error`
// string — `useErrorMessage` resolves it in the reader's language — and it lands
// on the composer's footer line (portal), under the row, never squeezed into it.
//
// Strings: `<ns>.glyph.dictate|dictateOff|speak|speakOff|autoSpeak`,
// `<ns>.voiceIo.dictating|speaking`, `<ns>.error`.

export type StudioVoiceBarProps = {
  /** Appends dictated text to the composer draft; never sends. */
  onDictation(text: string): void;
  disabled: boolean;
  ns: string;
  /** localStorage key for the auto-speak preference (per consumer). */
  autoSpeakStorageKey: string;
  lang: string;
  /** The agent's newest line, for the read-aloud control and auto-speak; null
   *  hides the speak glyph (nothing to read yet, or a turn in flight). */
  speakText?: string | null;
  /** The session the text belongs to — a switch re-primes auto-speak and stops audio. */
  sessionKey?: string | null;
};

export function StudioVoiceBar({
  onDictation,
  disabled,
  ns,
  autoSpeakStorageKey,
  lang,
  speakText = null,
  sessionKey = null,
}: StudioVoiceBarProps) {
  const t = useStudioTranslations(ns);
  const resolveError = useErrorMessage();
  const slot = useStudioComposerSlot();

  const dictation = useStudioDictation({ lang, onDictated: onDictation });
  const speech = useStudioSpeech({ speakText, lang, sessionKey, autoSpeakStorageKey });

  const micError = dictation.phase === "error" ? resolveError({ code: dictation.errorCode }, t("error")) : null;
  const speakError = speech.playback === "error" ? resolveError({ code: speech.errorCode }, t("error")) : null;
  const readable = speakText?.trim() ? speakText : null;

  const notices =
    micError || speakError ? (
      <>
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
      </>
    ) : null;

  return (
    <>
      {dictation.unavailable ? (
        <IconAction icon={MicOff} label={t("glyph.dictateOff")} tone="muted" />
      ) : (
        <IconAction
          icon={dictation.listening ? Square : Mic}
          label={dictation.listening ? t("voiceIo.dictating") : t("glyph.dictate")}
          toggle
          on={dictation.listening}
          disabled={disabled || dictation.busy}
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
            aria-label={t("voiceIo.dictating")}
            aria-valuenow={micLevelPercent(dictation.level)}
          >
            <span
              className="block h-full rounded-full bg-moss transition-[width] duration-100 motion-reduce:transition-none"
              style={{ width: `${micLevelPercent(dictation.level)}%` }}
            />
          </span>
          <span className="hidden text-sm text-steel tabular-nums motion-reduce:inline">{micLevelPercent(dictation.level)}%</span>
        </>
      ) : null}
      {speech.unavailable ? (
        <IconAction icon={VolumeX} label={t("glyph.speakOff")} tone="muted" />
      ) : (
        <>
          {readable ? (
            <IconAction
              icon={speech.blocked ? Play : speech.speaking ? Square : Volume2}
              label={speech.speaking ? t("voiceIo.speaking") : t("glyph.speak")}
              toggle
              on={speech.speaking}
              onClick={() => {
                if (speech.blocked) speech.resume();
                else if (speech.speaking) speech.stop();
                else speech.speak(readable);
              }}
            />
          ) : null}
          {/* The standing opt-in, offered even with nothing to read yet: it is a
              preference about the NEXT answer, not about this one. */}
          <IconAction
            icon={AudioLines}
            label={t("glyph.autoSpeak")}
            toggle
            on={speech.autoSpeak}
            onClick={() => speech.setAutoSpeak(!speech.autoSpeak)}
          />
        </>
      )}
      {notices ? (slot?.footer ? createPortal(notices, slot.footer) : notices) : null}
    </>
  );
}
