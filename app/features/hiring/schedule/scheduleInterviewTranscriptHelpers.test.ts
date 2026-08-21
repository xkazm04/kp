// Pins the transcript modal's pure helpers: the scorecard-rating clamp and the
// evidence→turn anchoring that drives the "· cited" markers and the
// jump-to-this-moment button in ScheduleInterviewTranscriptModal.
//
// Runner (the helper imports @/app/_lib/format, so the alias loader is needed):
//   node --import ./scripts/test-alias-loader.mjs --experimental-transform-types \
//        --test-isolation=process --test app/features/hiring/schedule/scheduleInterviewTranscriptHelpers.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanRating, findEvidenceTurn } from "./scheduleInterviewTranscriptHelpers.ts";
import type { VoiceTurn } from "@/app/_lib/voice/types";

const turn = (role: VoiceTurn["role"], text: string): VoiceTurn => ({ role, text });

test("a verbatim quote anchors to the turn that contains it", () => {
  const turns = [
    turn("interviewer", "tell me about a hard rollout you owned"),
    turn("candidate", "we moved the billing platform onto kubernetes over two quarters"),
  ];
  assert.equal(findEvidenceTurn("we moved the billing platform onto kubernetes", turns), 1);
});

test("a paraphrased quote anchors by DISTINCT shared words, not by repetition", () => {
  // The scorecard's evidence is a paraphrase, so the containment pass misses and the
  // word-overlap fallback decides. Four distinctive words: migrated / billing /
  // platform / kubernetes.
  const evidence = "we migrated the billing platform to kubernetes";
  const turns = [
    // The INTERVIEWER's question shares exactly ONE distinctive word ("platform"),
    // repeated three times. Counting occurrences scored it 3/4 = 0.75 and won the
    // match — the "· cited" marker and the jump-to-moment button landed on the
    // question instead of the answer being cited.
    turn("interviewer", "so tell me about platform work at platform scale and platform ownership"),
    // The candidate's actual answer shares TWO distinctive words → 2/4 = 0.5.
    turn("candidate", "yes the billing stack ended up on kubernetes after a long haul"),
  ];
  assert.equal(findEvidenceTurn(evidence, turns), 1, "anchors to the candidate's answer, not the repetitive question");
});

test("a turn sharing one distinctive word twice no longer clears the majority gate", () => {
  // 2 occurrences of one word / 4 distinct evidence words used to read as 0.5 — exactly
  // the "majority of distinctive words" threshold — on the strength of a single word.
  const turns = [turn("interviewer", "which service did you own and was that service legacy")];
  assert.equal(findEvidenceTurn("we migrated the billing service to kubernetes", turns), -1);
});

test("nothing matches well enough → -1 (never mis-anchored)", () => {
  const turns = [turn("interviewer", "how did you find the office"), turn("candidate", "the tram was quick")];
  assert.equal(findEvidenceTurn("we migrated the billing platform to kubernetes", turns), -1);
  assert.equal(findEvidenceTurn("short", turns), -1, "a too-short quote is never anchored");
});

test("cleanRating coerces stored junk to a clamped int, or null for 'not assessed'", () => {
  assert.equal(cleanRating(4), 4);
  assert.equal(cleanRating("3"), 3);
  assert.equal(cleanRating(9), 5, "clamped to RATING_MAX");
  assert.equal(cleanRating(-2), 1, "clamped to the 1 floor");
  assert.equal(cleanRating(null), null);
  assert.equal(cleanRating("n/a"), null);
});
