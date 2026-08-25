"use client";

import { Play, Square } from "lucide-react";
import { useTranslations } from "next-intl";
import { railIconBtn } from "@/app/_components/ui/recipes";
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
    press: () => {
      if (blocked) speech.resume();
      else if (active && !failed) speech.stop();
      else speech.speak(speakable);
    },
  };
}

/** Icon-only transport — the strip, where every millimetre of height is screen
 *  the operator asked to keep.
 *
 *  THREE meanings on one control and never a fourth: start the shown answer,
 *  stop the one playing, unblock a playback the browser refused. Replay is the
 *  same press once playback has settled — the button is a Play again the moment
 *  it stops being a Stop, which is why V3 did not carry Stage's separate replay
 *  control across: on a one-line strip a second transport button would cost
 *  height to say what the first one already does. */
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
