"use client";

import { Play, RotateCcw, Square } from "lucide-react";
import { useTranslations } from "next-intl";
import { BTN_SECONDARY, railIconBtn } from "@/app/_components/ui/recipes";
import { voiceTextForTurn, type CompanionSpeech } from "../useCompanionSpeech";
import type { VoiceEntry } from "./voiceHistory";

/*
 * Playing the answer that is on screen.
 *
 * Same three meanings V1 fixed on one button and never a fourth — start this
 * reply, stop the one playing, unblock a playback the browser refused — with the
 * difference that the SHOWN answer is unambiguous here. The dock needed the
 * control under each bubble because "the last reply" stops meaning anything once
 * you scroll; voice mode shows exactly one answer at a time, which is the whole
 * reason a global transport row is honest on this surface and was not on that one.
 *
 * `blocked` is not an edge case here. Auto-speak fires with no gesture behind
 * it, so the browser refuses, and the ONLY way out is a real click — which is
 * why the same control that would have started it also resumes it, rather than
 * a banner appearing somewhere else.
 *
 * Nothing is drawn for an answer with nothing to say. `voiceTextForTurn` has
 * already run the one normalizer, so an empty result means an empty utterance,
 * and a transport row over silence would be a control that lies.
 */

type PlaybackState = {
  active: boolean;
  blocked: boolean;
  failed: boolean;
  /** Verb for what pressing the control does right now. */
  label: string;
  /** What playback is doing, in words. */
  stateText: string;
  press: () => void;
};

function usePlayback(entry: VoiceEntry | null, speech: CompanionSpeech): PlaybackState | null {
  const t = useTranslations("companion");
  const speakable = entry ? { id: entry.id, content: entry.content, meta: entry.meta } : null;
  const hasVoice = speakable ? voiceTextForTurn(speakable).length > 0 : false;
  const active = Boolean(entry && speech.speakingId === entry.id);
  const blocked = active && speech.playback === "blocked";
  const failed = active && speech.playback === "error";
  if (!speakable || !hasVoice) return null;
  return {
    active,
    blocked,
    failed,
    label: blocked ? t("voice.resume") : active && !failed ? t("voice.stop") : t("voice.speak"),
    stateText: blocked
      ? t("voiceMode.playbackBlocked")
      : failed
        ? t("voiceMode.playbackError")
        : active && speech.playback === "synthesizing"
          ? t("voiceMode.playbackPreparing")
          : active
            ? t("voiceMode.playbackPlaying")
            : t("voiceMode.playbackReady"),
    press: () => {
      if (blocked) speech.resume();
      else if (active && !failed) speech.stop();
      else speech.speak(speakable);
    },
  };
}

/** Icon-only transport — the strips, where every millimetre of height is screen
 *  the operator asked to keep. */
export function VoicePlaybackButton({ entry, speech }: { entry: VoiceEntry | null; speech: CompanionSpeech }) {
  const t = useTranslations("companion");
  const state = usePlayback(entry, speech);
  if (!state) return null;
  const stopping = state.active && !state.failed && !state.blocked;
  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        aria-pressed={state.active && !state.failed}
        aria-label={state.label}
        title={state.failed && speech.error ? speech.error : state.label}
        onClick={state.press}
        className={railIconBtn(state.active && !state.failed)}
      >
        {stopping ? (
          <Square size={16} aria-hidden fill="currentColor" />
        ) : (
          <Play size={16} aria-hidden fill="currentColor" />
        )}
      </button>
      {state.failed ? (
        <span className="text-sm text-coral" role="status">
          {t("voice.failed")}
        </span>
      ) : null}
    </span>
  );
}

/** The labelled transport row — the voice-forward direction, where the playback
 *  IS the content and deserves to say what it is doing in words. */
export function VoicePlaybackRow({ entry, speech }: { entry: VoiceEntry | null; speech: CompanionSpeech }) {
  const t = useTranslations("companion");
  const state = usePlayback(entry, speech);
  if (!state || !entry) return null;
  const speakable = { id: entry.id, content: entry.content, meta: entry.meta };
  const stopping = state.active && !state.failed && !state.blocked;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        aria-pressed={state.active && !state.failed}
        onClick={state.press}
        title={state.failed && speech.error ? speech.error : state.label}
        className={`${BTN_SECONDARY} h-10 px-3.5 text-sm ${state.active && !state.failed ? "border-coral/40 text-coral" : ""}`}
      >
        {stopping ? (
          <Square size={15} aria-hidden fill="currentColor" />
        ) : (
          <Play size={15} aria-hidden fill="currentColor" />
        )}
        {state.label}
      </button>
      {/* Replay is a SECOND control, not a third meaning on the first: restarting
          an utterance while it plays is a different intent from stopping it, and
          folding them together is how a stop button becomes unpredictable. It is
          drawn only while something is actually playing — over silence, the play
          button already IS the replay. */}
      {stopping ? (
        <button
          type="button"
          aria-label={t("voiceMode.replay")}
          title={t("voiceMode.replay")}
          onClick={() => speech.speak(speakable)}
          className={railIconBtn(false)}
        >
          <RotateCcw size={16} aria-hidden />
        </button>
      ) : null}
      <span className={`text-sm ${state.failed || state.blocked ? "text-coral" : "text-steel"}`} role="status">
        {state.stateText}
      </span>
      {state.failed && speech.error ? <span className="text-sm text-steel">{speech.error}</span> : null}
    </div>
  );
}
