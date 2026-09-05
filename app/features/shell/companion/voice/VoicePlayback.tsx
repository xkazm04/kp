"use client";

import { Play, Square } from "lucide-react";
import { useTranslations } from "next-intl";
import { railIconBtn } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
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
  /** Why the last attempt failed, IN THE READER'S LANGUAGE, or null. Resolved
   *  from the route's code and never from `speech.error`: that half is the
   *  route's canonical English, and painting it put "ELEVENLABS_API_KEY is not
   *  set" in this button's tooltip on a Czech install. An unknown code (a
   *  transport fault the server never named) falls back to the one generic
   *  sentence this surface has always had. */
  reason: string | null;
  /** A quiet fact about the utterance that is NOT a failure: the host asked us
   *  to wait before the next chunk. Rendered beside the control rather than on
   *  it, because `label` is the verb for pressing and this is the state. */
  note: string | null;
  press: () => void;
};

function usePlayback(entry: VoiceEntry | null, speech: CompanionSpeech): PlaybackState | null {
  const t = useTranslations("companion");
  const resolveError = useErrorMessage();
  const speakable = entry ? { id: entry.id, content: entry.content, meta: entry.meta } : null;
  const hasVoice = speakable ? voiceTextForTurn(speakable).length > 0 : false;
  const active = Boolean(entry && speech.speakingId === entry.id);
  const blocked = active && speech.playback === "blocked";
  const failed = active && speech.playback === "error";
  // The engine (or our own throttle) asked for a pause. Saying so is the whole
  // point: the utterance used to truncate here, and a control that goes quiet
  // for two seconds with no word is indistinguishable from one that broke.
  const waiting = active && speech.playback === "waiting";
  // The clip is in the WRONG LANGUAGE and it played anyway: no installed engine
  // declares the one that was asked for (Kokoro speaks no cs/de), so a Czech
  // answer comes back in an English accent. Serving it is right — silence is
  // worse — but saying nothing turns a known limitation into a bug the listener
  // has to guess at. Shown only while this turn owns the utterance.
  const wrongLanguage = active && !failed && Boolean(speech.unsupportedLanguage);
  if (!speakable || !hasVoice) return null;
  return {
    active,
    blocked,
    failed,
    note: waiting ? t("voice.waiting") : wrongLanguage ? t("voice.wrongLanguage") : null,
    reason: failed ? resolveError({ code: speech.errorCode }, t("voice.failed")) : null,
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
  const state = usePlayback(entry, speech);
  if (!state) return null;
  const stopping = state.active && !state.failed && !state.blocked;
  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        aria-pressed={state.active && !state.failed}
        aria-label={state.label}
        title={state.reason ?? state.label}
        onClick={state.press}
        className={railIconBtn(state.active && !state.failed)}
      >
        {stopping ? (
          <Square size={16} aria-hidden fill="currentColor" />
        ) : (
          <Play size={16} aria-hidden fill="currentColor" />
        )}
      </button>
      {state.reason ? (
        <span className="text-sm text-coral" role="status">
          {state.reason}
        </span>
      ) : state.note ? (
        <span className="text-sm text-stone-400" role="status">
          {state.note}
        </span>
      ) : null}
    </span>
  );
}
