"use client";

import { useCallback, useState } from "react";
import { useLocale } from "next-intl";
import { useTts, type TtsPlayback } from "@/packages/voice-tts/src/react/useTts";
import { speechReady } from "@/packages/voice-tts/src/text/normalize";
import type { CompanionVoiceReply } from "@/app/_lib/companion-turn";

/*
 * The dock's spoken channel (V1) — one narrow seam between a companion turn and
 * the portable TTS package (packages/voice-tts, docs/architecture/voice-tts-package.md).
 *
 * WHAT THIS OWNS, and why it is a hook rather than a button's onClick. Three
 * decisions have to be made in one place or they are made inconsistently:
 *
 *   1. WHAT gets spoken. A reply is dual-channel — prose written for a 30rem
 *      column, and `meta.voiceReply`, the same answer composed for the ear by
 *      the CLI (pipeline/jobfit/companion_cli.py's voice contract). Speaking the
 *      prose when a voice form exists is the defect this whole round is about:
 *      the listener gets a report, an enumeration and a reference to a table
 *      they are not looking at.
 *   2. ONE utterance at a time, and which turn it belongs to. `speakingId` is
 *      the utterance's identity at the surface: a second speak supersedes the
 *      first (useTts's generation token makes the superseded audio inert even if
 *      it resolves later), and the button that started it is the one that shows
 *      as speaking.
 *   3. STOP MEANS NOW, including on unmount. The dock unmounts its body when the
 *      operator collapses it (CompanionDock renders `CompanionRest` instead), so
 *      "audio that outlives its surface" is a live risk here, not a theoretical
 *      one. It is already covered: useTts registers `useEffect(() => stop, [stop])`,
 *      which aborts in-flight synthesis and releases the element. Nothing is
 *      re-implemented here — the discipline lives inside the package, which is
 *      also why this hook never hands a caller the raw playback resource.
 *
 * NO PROBE ON MOUNT. `GET /api/tts` probes every configured provider, and for a
 * cloud engine that is a network round trip; the dock is mounted whenever it is
 * open, and most sessions never press play. So availability is learned by
 * ATTEMPTING: the route answers 503 with a typed reason when nothing can speak,
 * and that reason is surfaced on the control. Never a silent no-op — but never a
 * probe nobody asked for either. `refreshProviders` stays available for a
 * settings surface that legitimately wants the roster.
 */

/** The shape this hook needs from a turn. Structural rather than `CompanionTurn`
 *  so the dock's client bundle never has a reason to reach the db slice, and so
 *  a caller with a leaner projection (a preview, a test) still works. */
export type CompanionSpeakableTurn = {
  id: string;
  content: string;
  meta?: { voiceReply?: CompanionVoiceReply } | null;
};

export type CompanionSpeech = {
  /** Speak one turn. Imperative and fire-and-forget on purpose: V2's
   *  "auto-speak replies" setting is a caller of exactly this, with no state of
   *  its own to keep in step. Speaking a second turn stops the first. */
  speak: (turn: CompanionSpeakableTurn) => void;
  stop: () => void;
  /** Resume a playback the browser blocked. Must run from a user gesture — which
   *  is why a speak STARTED by a click almost never lands here, and an auto-speak
   *  that was never clicked almost always will. */
  resume: () => void;
  /** The turn being synthesized or played, or null. Null the moment playback
   *  settles back to idle, so a finished utterance leaves no control lit. */
  speakingId: string | null;
  playback: TtsPlayback;
  /** The last attempt's failure text, straight from the route (an engine reason,
   *  a rate limit, a transport error). Null while nothing has failed. */
  error: string | null;
  /** The provider roster, for a surface that wants to show or choose one. NOT
   *  called by this hook — see the header. */
  refreshProviders: () => Promise<void>;
};

/**
 * The text one turn is spoken as, already through the one door.
 *
 * `speechReady` (packages/voice-tts/src/text/normalize.ts) is THE normalizer
 * every utterance passes before any engine sees it — one pure isomorphic
 * function, per the registry's speech-ready-text technique. It runs HERE rather
 * than inside `speak()` so that this function's own answer is exactly what the
 * engine would receive: an empty string means there is genuinely nothing to say,
 * which is what lets the dock decide whether to offer the control at all instead
 * of rendering one that does nothing.
 *
 * Preference order is deliberate. `meta.voiceReply.text` is a composition FOR
 * the ear; the prose is a fallback for turns stored before the channel existed.
 */
export function voiceTextForTurn(turn: CompanionSpeakableTurn): string {
  const composed = turn.meta?.voiceReply?.text?.trim();
  return speechReady(composed || turn.content || "");
}

export function useCompanionSpeech(): CompanionSpeech {
  // maxChunkChars is left at the package default (280), which is also the CLI's
  // MAX_VOICE_CHARS: a voice reply is one chunk by construction, so there is no
  // boundary to place, no prosody reset and no lookahead to pay for. The default
  // still does the right thing on the fallback path, where a long stored prose
  // reply is chunked and pipelined.
  const tts = useTts({ endpoint: "/api/tts" });
  const locale = useLocale();
  const [lastId, setLastId] = useState<string | null>(null);
  const { speak: ttsSpeak, stop: ttsStop, resume: ttsResume, playback } = tts;

  const speak = useCallback(
    (turn: CompanionSpeakableTurn) => {
      const text = voiceTextForTurn(turn);
      if (!text) return;
      setLastId(turn.id);
      // `format: "plain"` because the door already ran in voiceTextForTurn —
      // running it twice would be harmless but would put a second call site on
      // the one function that is supposed to have exactly one.
      void ttsSpeak({ text, language: locale, format: "plain" });
    },
    [ttsSpeak, locale]
  );

  const stop = useCallback(() => {
    ttsStop();
    setLastId(null);
  }, [ttsStop]);

  const resume = useCallback(() => {
    void ttsResume();
  }, [ttsResume]);

  return {
    speak,
    stop,
    resume,
    // Derived, never stored: playback returning to idle IS the utterance ending,
    // and a separate "am I still speaking" flag would be a second source of truth
    // that drifts on every path the package settles through (done, superseded,
    // aborted on unmount).
    speakingId: playback === "idle" ? null : lastId,
    playback,
    error: tts.error,
    refreshProviders: tts.refreshProviders,
  };
}
