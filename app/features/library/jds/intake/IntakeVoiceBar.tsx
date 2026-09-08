"use client";

import { useTranslations } from "next-intl";
import { Mic, Play, Square, Volume2 } from "lucide-react";
import { CHIP_TOGGLE, railIconBtn } from "@/app/_components/ui/recipes";
import { micLevelPercent } from "@/app/_components/voice/useMicTest";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { useIntakeDictation } from "./useIntakeDictation";
import { useIntakeSpeech } from "./useIntakeSpeech";

// The keyless voice pair for the intake composer: push-to-talk dictation
// (/api/stt) and read-aloud of the agent's turn (/api/tts). This file is the
// WIRE between the studio (which mounts it in the composer slot) and the voice
// package (which fills it in): the props below are the contract, and a host
// may render it before the implementation lands — it draws nothing until then.
export type IntakeVoiceBarProps = {
  intakeId: string;
  lang: string;
  /** Dictated text APPENDS to the composer draft; it never sends. */
  onDictated: (text: string) => void;
  /** The agent text the speak control reads; null when there is nothing to read. */
  speakText: string | null;
  disabled?: boolean;
};

/*
 * TWO PIPELINES IN ONE ROW, and that is all they share.
 *
 * The registry's voice-io subject is emphatic that "add voice" is not one
 * feature: capture → transcript and text → synthesis have different latency,
 * privacy and failure physics, and designing them as mirror images is the
 * ancestral mistake. So this bar holds two hooks that never speak to each other
 * (useIntakeDictation, useIntakeSpeech), and every state below is decided per
 * pipeline. A machine with whisper.cpp and no Piper dictates and does not read
 * aloud; a machine with Piper and no whisper.cpp does the reverse; a machine
 * with neither leaves an intake session entirely reachable by typing, with two
 * one-sentence notes saying why the buttons are gone. That is rung 2 and rung 3
 * of the degradation ladder, and neither is a dead control.
 *
 * WHAT THE MIC PROMISES. `aria-pressed` while listening, a stop glyph rather
 * than a second button, and — the rule that makes a microphone honest — a
 * continuously visible indicator for as long as it is open: the label says
 * "Listening", and a live level meter says whether we can actually hear you. A
 * flat bar during speech is a diagnosis no post-hoc error message can match, so
 * the bar is only painted when the level is genuinely being measured
 * (`metered`); otherwise the word alone stands, rather than a zero that would
 * accuse a working microphone.
 *
 * NOTHING AUTO-SENDS. The transcript is an engine's guess; it lands in the
 * composer through `onDictated` (an APPEND on the host side) where a mis-heard
 * word is fixed before the agent sees it.
 *
 * STOP MEANS NOW on the output side, which is the package's guarantee, not a
 * promise made here: pressing stop aborts pending synthesis and releases the
 * audio element in the same tick, and so does unmounting the panel.
 *
 * A REFUSAL IS RENDERED FROM ITS CODE, never from the route's English `error`
 * string — `useErrorMessage` resolves it in the reader's language.
 */
export function IntakeVoiceBar({ intakeId, lang, onDictated, speakText, disabled = false }: IntakeVoiceBarProps) {
  const t = useTranslations("library.tab.intake.voiceIo");
  const tIntake = useTranslations("library.tab.intake");
  const resolveError = useErrorMessage();

  const dictation = useIntakeDictation({ lang, onDictated });
  const speech = useIntakeSpeech({ speakText, lang, sessionKey: intakeId });

  const listening = dictation.listening;
  const micLabel = listening ? t("dictating") : t("dictate");
  // One line per pipeline, and only ever one thing in it: a code the route named,
  // resolved in the reader's language. A browser-side denial carries no code, so
  // the generic sentence stands in rather than the browser's English
  // `NotAllowedError`.
  const micError = dictation.phase === "error" ? resolveError({ code: dictation.errorCode }, tIntake("error")) : null;
  const speakError = speech.playback === "error" ? resolveError({ code: speech.errorCode }, tIntake("error")) : null;

  const readable = speakText?.trim() ? speakText : null;
  const speakLabel = speech.blocked ? t("speak") : speech.speaking ? t("speaking") : t("speak");

  return (
    <div className="flex flex-wrap items-center gap-2">
      {dictation.unavailable ? (
        <p className="text-sm text-steel" role="status">
          {t("dictateUnavailable")}
        </p>
      ) : (
        <>
          <button
            type="button"
            onClick={dictation.toggle}
            disabled={disabled || dictation.busy}
            aria-pressed={listening}
            aria-label={micLabel}
            title={micLabel}
            className={`${railIconBtn(listening)} disabled:opacity-40`}
          >
            {listening ? <Square size={15} aria-hidden /> : <Mic size={17} aria-hidden />}
          </button>
          {listening ? (
            <span className="flex items-center gap-2" role="status">
              <span className="text-sm text-coral">{t("dictating")}</span>
              {/* The meter is the indicator's evidence, not decoration. Under
                  prefers-reduced-motion the animated bar is replaced by the same
                  number as text, so the information survives the accommodation
                  instead of the motion surviving it — CSS only, no JS fork. */}
              {dictation.metered ? (
                <>
                  <span
                    className="h-1.5 w-20 overflow-hidden rounded-full bg-stone-200 motion-reduce:hidden"
                    role="progressbar"
                    aria-label={t("dictating")}
                    aria-valuenow={micLevelPercent(dictation.level)}
                  >
                    <span
                      className="block h-full rounded-full bg-moss transition-[width] duration-100 motion-reduce:transition-none"
                      style={{ width: `${micLevelPercent(dictation.level)}%` }}
                    />
                  </span>
                  <span className="hidden text-sm tabular-nums text-steel motion-reduce:inline">
                    {micLevelPercent(dictation.level)}%
                  </span>
                </>
              ) : null}
            </span>
          ) : null}
          {micError ? (
            <span className="text-sm text-coral" role="status">
              {micError}
            </span>
          ) : null}
        </>
      )}

      {speech.unavailable ? (
        <p className="text-sm text-steel" role="status">
          {t("speakUnavailable")}
        </p>
      ) : (
        <>
          {readable ? (
            <button
              type="button"
              onClick={() => {
                if (speech.blocked) speech.resume();
                else if (speech.speaking) speech.stop();
                else speech.speak(readable);
              }}
              disabled={disabled}
              aria-pressed={speech.speaking}
              aria-label={speakLabel}
              title={speakLabel}
              className={`${railIconBtn(speech.speaking)} disabled:opacity-40`}
            >
              {speech.blocked ? (
                <Play size={16} aria-hidden />
              ) : speech.speaking ? (
                <Square size={15} aria-hidden />
              ) : (
                <Volume2 size={17} aria-hidden />
              )}
            </button>
          ) : null}
          {/* The standing opt-in, offered even with nothing to read yet: it is a
              preference about the NEXT answer, not about this one. */}
          <button
            type="button"
            onClick={() => speech.setAutoSpeak(!speech.autoSpeak)}
            aria-pressed={speech.autoSpeak}
            className={`${CHIP_TOGGLE(speech.autoSpeak)} py-0.5`}
          >
            {t("autoSpeak")}
          </button>
          {speakError ? (
            <span className="text-sm text-coral" role="status">
              {speakError}
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}
