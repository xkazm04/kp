import type { VoiceTurn } from "./types";

// Runtime language-consistency verdict — the TS port of the deterministic offline
// check in pipeline/jobfit/eval/interview_eval.py (_check_language_consistency +
// _clear_lang + _is_czech). The offline harness could only tell an operator, after
// the fact and only in a test run, whether the interviewer stayed in the
// candidate's language; this lifts the SAME deterministic logic over the persisted
// transcript at /complete so a recruiter sees "stayed in the candidate's language"
// vs "drifted mid-call" on every call.
//
// PARITY IS LOAD-BEARING: the word lists and the switch rule below mirror the
// Python source exactly, pinned by a shared-fixture parity test on both sides
// (language-lock.test.ts here, test_interview_eval.py there). When the Python
// detectors change, change these together. Pure + browser-safe so the transcript
// modal and drawer can render the verdict without a server round-trip.

/** locked — the interviewer stayed in the candidate's language; drifted — it
 *  switched away from the language the candidate had clearly established;
 *  indeterminate — the candidate never spoke a confidently-detected language (the
 *  minimal-answer case), so there is nothing to have stayed locked onto. */
export type LanguageLockVerdict = "locked" | "drifted" | "indeterminate";

export type LanguageLockResult = {
  verdict: LanguageLockVerdict;
  /** Index (into the non-system turns) of the first interviewer turn that drifted;
   *  null unless the verdict is "drifted". */
  driftTurnIndex: number | null;
};

// Ported verbatim from interview_eval.py _CZECH_CHARS / _CZECH_WORDS / _ENGLISH_WORDS.
const CZECH_CHARS = new Set("áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ");
const CZECH_WORDS = /\b(děkuji|dobrý|dobře|můžeme|prosím|ano|jak|proč|byste|řekněte|projekt|zkušenost|otázk\w*)\b/i;
const ENGLISH_WORDS =
  /\b(the|and|you|your|what|how|why|that|this|with|for|was|were|would|could|have|about|tell|walk|thanks|thank|question|role|project|experience)\b/i;

/** Mirror of _is_czech: a Czech diacritic character OR a Czech marker word. */
function isCzech(text: string): boolean {
  for (const ch of text) if (CZECH_CHARS.has(ch)) return true;
  return CZECH_WORDS.test(text);
}

/** Mirror of _clear_lang: "cs"/"en" only when unambiguous, else null. A turn with
 *  markers of both (a bilingual greeting, or an English sentence with a Czech name)
 *  is null so it can't cause a false drift flag. */
export function clearLang(text: string): "cs" | "en" | null {
  const cs = isCzech(text);
  const en = ENGLISH_WORDS.test(text);
  if (cs && !en) return "cs";
  if (en && !cs) return "en";
  return null;
}

/** The runtime language-lock verdict over a persisted transcript. Mirror of
 *  _check_language_consistency: the opening interviewer turn is exempt (it may
 *  greet bilingually); a switch is a drift only when the CANDIDATE had already
 *  clearly established a language and the interviewer then spoke a different one. */
export function detectLanguageLock(transcript: VoiceTurn[]): LanguageLockResult {
  const turns = transcript.filter((t) => t.role !== "system");
  let candLang: "cs" | "en" | null = null;
  let interviewerSeen = 0;
  for (let i = 0; i < turns.length; i += 1) {
    const t = turns[i];
    const lang = clearLang(t.text);
    if (t.role === "candidate") {
      if (lang) candLang = lang;
      continue;
    }
    interviewerSeen += 1;
    if (interviewerSeen === 1) continue; // opener may be bilingual
    if (lang && candLang && lang !== candLang) {
      return { verdict: "drifted", driftTurnIndex: i };
    }
  }
  return { verdict: candLang === null ? "indeterminate" : "locked", driftTurnIndex: null };
}
