"use client";

import { useEffect } from "react";
import { useCompanionAutoSpeak } from "./useCompanionAutoSpeak";
import { useCompanionPrefs, type CompanionPrefsState } from "./useCompanionPrefs";
import { useCompanionSpeech, type CompanionSpeech } from "./useCompanionSpeech";
import { useCompanionThread, type CompanionThreadState } from "./useCompanionThread";

/*
 * Everything Candi IS, as opposed to how she is drawn — assembled once, in the
 * provider, above every surface that shows her.
 *
 * WHY IT MOVED UP (round V3). Until V3 all of this lived inside `CompanionDock`,
 * which was sound while the dock was the only thing that rendered a conversation.
 * V3 gives her a second consumer that is nowhere near it: the footer control
 * dock's `candi` panel, which is the input in voice mode and lives in a
 * different feature entirely (`shell/simulation`). Two surfaces that must send
 * into the SAME conversation cannot each own a thread, and the alternatives were
 * both worse than hoisting — a portal from the dock into the footer's panel slot
 * makes the input's existence depend on the render order of two independent
 * trees, and a "register your composer upward" callback is the same hoist with
 * an effect in the middle of it.
 *
 * SO THIS IS THE SEAM: one thread, one utterance, one preference set, one
 * auto-speak, one seed handoff. The dock and the input panel both consume it and
 * neither creates any of it, which is what keeps a mode flip mid-conversation
 * from dropping a turn — and what makes "her answer is playing" a fact both the
 * strip and the footer can read.
 *
 * WHAT IT COSTS, said plainly: these four hooks now load with the shell rather
 * than with the deferred `CompanionDock` chunk. They are hooks — fetch, a state
 * machine, a localStorage read, the TTS package's headless half — and every
 * heavy piece of the companion (the transcript, chat blocks, charts, the voice
 * strip) is still behind the same `dynamic()` boundary it always was.
 *
 * `active` still gates the boot request, so a workspace where nobody opens her
 * makes no companion call at all.
 */
export type CompanionRuntime = {
  thread: CompanionThreadState;
  speech: CompanionSpeech;
  prefs: CompanionPrefsState;
};

export function useCompanionRuntime({
  active,
  seed,
  consumeSeed,
  markUnread,
}: {
  /** Whether a surface is showing her right now. Gates the thread's boot fetch
   *  and decides whether a landing reply counts as unread. */
  active: boolean;
  /** A message some other surface handed over (the palette's query), to be sent
   *  once the thread exists — once. */
  seed: string | null;
  consumeSeed: () => void;
  markUnread: () => void;
}): CompanionRuntime {
  const thread = useCompanionThread(active, markUnread);
  // ONE utterance for the whole companion, whichever surface is on screen. It is
  // created here rather than in a body so switching modes cannot orphan audio.
  const speech = useCompanionSpeech();
  const prefs = useCompanionPrefs();
  useCompanionAutoSpeak(prefs.autoSpeak, thread.turns, speech.speak);

  // The palette hands over a query; send it once the thread exists, then clear it
  // so re-opening her does not re-ask the same question. It lives here rather
  // than in the dock because the dock is no longer the only thing that can be on
  // screen when the seed lands.
  const { ready, send } = thread;
  useEffect(() => {
    if (!active || !seed || !ready) return;
    consumeSeed();
    void send(seed);
  }, [active, seed, ready, send, consumeSeed]);

  return { thread, speech, prefs };
}
