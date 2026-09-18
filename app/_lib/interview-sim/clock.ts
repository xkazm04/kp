// The interview simulator's SIMULATED CLOCK (spark interview-uat-tranche, WP-1).
//
// The director's time arithmetic runs on event timestamps and a `nowMs` it is handed
// (voice/director.ts — "no clock reads"), so a text conversation can drive it on a
// simulated clock: every turn advances the clock by how long it would take to SAY it,
// plus a fixed gap for the turn to change hands. That is what lets the time directives
// (stay_narrow, move_on, close_now, ask_overrun, end_now) fire in a conversation that
// really lasts a few seconds of CPU.
//
// THE NUMBERS, AND WHY.
//   - SPEAKING_WPM = 150. Conversational English sits around 140–170 words per minute
//     (broadcast and podcast speech ~150–160; answers with hesitations run lower, a TTS
//     voice at its default rate runs ~150–170). 150 is the middle of that band. It is
//     ONE rate for every language on purpose: Czech runs fewer (longer) words per minute
//     but carries more per word, and a per-language rate would be a second number to
//     defend with no measurement behind it. Recorded as a known limit.
//   - TURN_LATENCY_MS = 1500. Charged once per model response (the interviewer's and
//     the candidate's): a realtime model answers in roughly 0.5–1.5 s after the
//     end-of-turn is detected, and semantic VAD at the default "low" eagerness waits a
//     little longer before it decides the candidate has finished; a person answering a
//     question takes about as long to start. A continuation after a tool result (the
//     production `function_call_output` + `response.create`) is a new response and pays
//     it again.
//   - DIRECTOR_HEARTBEAT_MS = 20 000 — the browser's heartbeat
//     (app/_components/voice/useDirector.ts DIRECTOR_HEARTBEAT_MS; that module is a
//     client hook and is not importable here, so the value is mirrored and pinned by a
//     source test). Clock-driven directives reach a live call only in a director
//     response, and the heartbeat is what produces one while nobody finishes a turn.
//
// A candidate PAUSE (the `<<pause N>>` token of the candidate harness) advances the
// clock by N seconds without any words — silence before an answer, or instead of one.

/** Words per minute a spoken turn is timed at (see the header for the reasoning). */
export const SPEAKING_WPM = 150;
/** Fixed gap charged once per model response before its words start. */
export const TURN_LATENCY_MS = 1500;
/** The browser's director heartbeat (mirrors useDirector.ts DIRECTOR_HEARTBEAT_MS). */
export const DIRECTOR_HEARTBEAT_MS = 20_000;
/** The simulated call's wall-clock origin. Fixed, so a conversation is a pure function
 *  of its inputs: the director's directive ids and every event timestamp are
 *  reproducible run to run. */
export const SIM_EPOCH_MS = Date.UTC(2026, 0, 5, 9, 0, 0);
/** The longest single silence a `<<pause N>>` may claim (a runaway N is a model
 *  artifact, not a candidate who sat silent for an hour). */
export const MAX_PAUSE_MS = 5 * 60_000;

/** Whitespace-delimited words — what a speaking rate counts. */
export function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** How long `text` takes to say at SPEAKING_WPM, in whole milliseconds. */
export function spokenMs(text: string, wpm: number = SPEAKING_WPM): number {
  return Math.round((wordCount(text) / wpm) * 60_000);
}

/** The first `share` (0..1) of `text`'s words — what a candidate cut off mid-answer
 *  had said by the time the call ended. */
export function spokenPrefix(text: string, share: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const n = Math.max(0, Math.min(words.length, Math.floor(words.length * Math.max(0, Math.min(1, share)))));
  return words.slice(0, n).join(" ");
}
