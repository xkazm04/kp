// The decisions behind the intake composer's voice pair — PURE, so the two
// hooks beside it (useIntakeDictation, useIntakeSpeech) stay thin wrappers over
// the portable packages and every rule that could be got wrong is provable
// under `node --test` with no DOM.
//
// Voice I/O is two independent pipelines pointed in opposite directions
// (registry: software-engineering/llm-agent/runtime-and-io/voice-io), and the
// three questions below are the ones that belong to THIS surface rather than to
// packages/voice-stt or packages/voice-tts:
//
//   1. When does an install stop offering a control at all (the latch)?
//   2. Should this agent turn be spoken right now, unasked (auto-speak)?
//   3. Where does a transcript land in a half-typed sentence (the append)?
//
// Runner:
//   node scripts/run-unit-tests.mjs app/features/library/jds/intake/intakeVoiceIo.test.ts

/** The 503 code `/api/stt` answers when nothing on this install can listen. */
export const STT_UNAVAILABLE_CODE = "STT_UNAVAILABLE";
/** The 503 code `/api/tts` answers when nothing on this install can speak. */
export const TTS_UNAVAILABLE_CODE = "TTS_UNAVAILABLE";

/**
 * The sticky half of the degradation ladder: once the host says the engine is
 * not configured, this surface stops offering that control and says why in one
 * sentence, instead of failing into the same 503 on every press.
 *
 * STICKY IN ONE DIRECTION ONLY, and deliberately not cleared here: the fix for
 * `*_UNAVAILABLE` is a server config, so nothing the operator can do inside this
 * composer changes the answer, and a latch that reset itself on the next render
 * would put the dead control straight back. Every OTHER code leaves the latch
 * alone — a throttle, a denied microphone, an engine fault are all one press
 * from working, and disabling on those is the placeholder problem in a costume.
 *
 * The two pipelines call this SEPARATELY. That independence is the whole of
 * rung 2 of the ladder ("partial voice"): a machine with whisper.cpp and no
 * Piper dictates fine and simply does not read aloud.
 */
export function latchUnavailable(current: boolean, code: string | null | undefined, unavailableCode: string): boolean {
  return current || code === unavailableCode;
}

/** What the auto-speak decision needs to know. All four are facts the caller
 *  already holds; none of them is read from a global here, which is what makes
 *  the rule testable. */
export type AutoSpeakInput = {
  /** The persisted preference. Default OFF — see `DEFAULT_AUTO_SPEAK`. */
  autoSpeak: boolean;
  /** `document.visibilityState !== "hidden"`. A tab in the background speaking
   *  is audio with no visible indicator anywhere near it, which the standard
   *  rules out regardless of the preference. */
  visible: boolean;
  /** False on the very first evaluation of a mounted session. */
  primed: boolean;
  /** The last text this surface actually started speaking, or null. */
  lastSpoken: string | null;
  /** The speech-ready text of the current agent turn, or null when there is
   *  nothing to read. */
  next: string | null;
};

/**
 * "Should this be spoken now, without anyone pressing anything?"
 *
 * PRIMING is the subtle half. Opening a stored intake session hands this
 * surface the last agent turn immediately, and that turn may be a week old —
 * speaking it would be the app talking at a requestor who has just arrived. So
 * the first evaluation of a mount records what it saw and says nothing; only a
 * CHANGE after that is an arrival. The same rule makes switching the preference
 * on silent: priming has already happened, so nothing speaks until the agent
 * next answers.
 *
 * DE-DUPED BY TEXT IDENTITY rather than by a turn id, because that is what the
 * surface is handed. Re-rendering with the same reply — a keystroke in the
 * composer, a panel resize — must not restart the utterance.
 */
export function shouldAutoSpeak({ autoSpeak, visible, primed, lastSpoken, next }: AutoSpeakInput): boolean {
  if (!primed) return false;
  if (!autoSpeak || !visible) return false;
  if (!next) return false;
  return next !== lastSpoken;
}

/**
 * Where a transcript lands in whatever is already typed.
 *
 * APPENDED, NEVER REPLACING, and never sent: a transcript is an engine's guess,
 * so it lands in an editable field where a mis-heard word is fixed before the
 * agent ever sees it. The requestor may also have typed half a sentence before
 * pressing the mic, and a transcript that clobbered it would lose words the app
 * never had to lose.
 *
 * The spacing rules are small and all of them are "do not make the requestor
 * fix punctuation by hand":
 *   - a draft that ends in a deliberate line break keeps it (a new paragraph
 *     was being started, and joining onto the previous line undoes that);
 *   - a fragment opening with closing punctuation (", so…", ". Then…") joins
 *     with no space, because a space before a comma is never what was meant;
 *   - anything else joins with exactly one space.
 * Leading whitespace in the draft is preserved — only the join point is ours.
 */
export function appendDictation(draft: string, text: string): string {
  const addition = text.trim();
  if (!addition) return draft;
  const base = draft.replace(/[^\S\n]+$/, "");
  if (!base.trim()) return addition;
  if (/\n\s*$/.test(base)) return `${base}${addition}`;
  if (/^[,.!?;:]/.test(addition)) return `${base}${addition}`;
  return `${base} ${addition}`;
}

/* ── The preference. Per-BROWSER UX, not workspace data: it describes how this
 *    screen is being used right now and carries nothing another operator needs,
 *    so localStorage, the same call intakeLayoutShared and the companion's
 *    prefs already made. ── */

export const INTAKE_AUTO_SPEAK_KEY = "kp-intake-auto-speak";

/** OFF. An utterance nobody asked for is the one failure a voice feature cannot
 *  take back, and the browser will refuse the first un-gestured playback anyway. */
export const DEFAULT_AUTO_SPEAK = false;

/** Any stored string -> a usable boolean. Total, because the consumer renders a
 *  control that must have a current value: a null, last version's JSON, a
 *  hand-edited word all mean "the default", never "no preference". */
export function parseAutoSpeak(raw: string | null | undefined): boolean {
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return DEFAULT_AUTO_SPEAK;
}

export function readAutoSpeak(): boolean {
  if (typeof window === "undefined") return DEFAULT_AUTO_SPEAK;
  try {
    return parseAutoSpeak(window.localStorage.getItem(INTAKE_AUTO_SPEAK_KEY));
  } catch {
    // Private mode / blocked storage: the preference simply has no stored value,
    // which is exactly the default. Nothing an operator would act on.
    return DEFAULT_AUTO_SPEAK;
  }
}

export function storeAutoSpeak(value: boolean): void {
  try {
    window.localStorage.setItem(INTAKE_AUTO_SPEAK_KEY, value ? "1" : "0");
  } catch {
    // Storage unavailable — the choice still holds for this page, it just does
    // not survive the reload.
  }
}
