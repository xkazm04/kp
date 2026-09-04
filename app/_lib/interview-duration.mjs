// Single source of truth for the voice interview's length targets (idea-0ecbe5a5).
//
// Four numbers used to disagree: the candidate portal promised "About 5 minutes",
// the persona prompts said "under five minutes", the ElevenLabs agent was capped at
// 600s (10 min), and the grounded run-of-show targeted ~20 min. A candidate told
// "5 minutes" was then steered through a 20-minute agenda under a 10-minute hard
// cap — cut off mid-answer, feeding a truncated transcript to the scorecard.
//
// There are TWO interview modes, so we keep ONE canonical target per mode and
// derive every piece of copy, persona wording and the provider cap from them:
//
//   • QUICK screen    — the ungrounded A/B harness (interview lab) and the
//                       baseline ElevenLabs agent prompt: a few questions, ~5 min.
//   • GROUNDED screen — the candidate-facing /interview/<token> run: a CV-derived
//                       run-of-show in the documented 15–30 min band (run-of-show.ts),
//                       defaulting to GROUNDED_DEFAULT_MIN when a plan omits its own.
//
// Plain .mjs (not .ts) on purpose: scripts/setup-eleven-agent.mjs is a standalone
// ops script run with bare `node`, so it must import these with no build step or
// type-stripping. The sibling interview-duration.d.mts gives the TS app full types,
// and interview-duration.test.ts pins the invariants (incl. that the provider cap
// clears the grounded maximum, so a real interview is never truncated).

/** Quick ungrounded screen: a handful of questions, kept deliberately short. */
export const QUICK_SCREEN_MIN = 5;

/** Grounded candidate screen fallback when a generated run-of-show carries no
 *  explicit duration. Sits inside the [15, 30] band defined in run-of-show.ts. */
export const GROUNDED_DEFAULT_MIN = 20;

/** Longest a grounded run-of-show can legitimately run. Mirrors MAX_DURATION_MIN
 *  in run-of-show.ts; interview-duration.test.ts asserts the two stay equal. */
export const GROUNDED_MAX_MIN = 30;

/** Headroom (minutes) added on top of the grounded maximum before the provider
 *  hard cap, so natural pacing and the candidate's own questions never trip it. */
export const PROVIDER_HEADROOM_MIN = 10;

/** ElevenLabs / provider hard cap. ONE agent serves BOTH modes — the grounded
 *  prompt is pushed via runtime override onto the same agent — so the cap must
 *  clear the grounded maximum, not the 5-minute quick screen. Otherwise a real
 *  20–30 min interview is severed mid-answer and the scorecard scores a stub. */
export const PROVIDER_CAP_MIN = GROUNDED_MAX_MIN + PROVIDER_HEADROOM_MIN; // 40
export const PROVIDER_MAX_DURATION_SECONDS = PROVIDER_CAP_MIN * 60; // 2400

// NO COPY LIVES HERE. `durationLabel` and `durationChip` used to compose the
// candidate-facing sentence ("About 20 minutes", "~20 min") out of this module,
// and InterviewSidebar — a CANDIDATE surface reached from an invite written in the
// candidate's own language — rendered the chip verbatim, so a Czech applicant read
// an English chip beside a Czech agenda. This module owns the NUMBERS; the words
// are the catalog's (`interview.sidebar.durationChip`, four locales), and
// interview-duration.test.ts pins that no copy helper comes back.
