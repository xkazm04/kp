"""The scorecard prompt must not discard the read-back it calls AUTHORITATIVE.

UAT 2026-07-20 (TZ-VI-L1-02 / PVI-L1-01). Two truncations disagreed:

  * TS (`app/_lib/interview-transcript.ts`) budgets MAX_SCORECARD_NOTES_CHARS =
    6000 and, when over budget, HEAD+TAIL samples with an in-band marker —
    deliberately preserving the CLOSING turns.
  * Python (`interview_scorecard`) then front-sliced `notes[:4000]`, throwing the
    tail away.

The tail is exactly what the same prompt then instructs the model to trust above
everything else: the interviewer's end-of-call read-back of the candidate's stack
is "the AUTHORITATIVE record", overriding earlier ASR mishearings. Front-slicing
deleted it, so on any transcript over 4000 chars the model was told to prefer a
confirmation it could no longer see — and silently fell back to the raw,
error-prone early turns it was warned about.

Compounding it, `_scorecard_confidence` measures coverage from `len(notes)` — the
FULL string — so the confidence band was computed against material the prompt
never received, overstating how much of the interview was actually scored.

The fix samples head+tail in Python too, at the same 6000 budget, so a
TS-produced note passes through untouched and any other caller degrades the same
tail-preserving way.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

from pipeline.jobfit.automation import MAX_SCORECARD_NOTES_CHARS, sample_scorecard_notes


class ScorecardNotesSamplingTest(unittest.TestCase):
    def test_short_notes_pass_through_byte_identical(self) -> None:
        notes = "Interviewer: tell me about React.\nCandidate: I used it for four years."
        self.assertEqual(sample_scorecard_notes(notes), notes)

    def test_a_transcript_at_the_ts_budget_is_untouched(self) -> None:
        """The TS side already clamps to 6000 — Python must not re-truncate it."""
        notes = "x" * MAX_SCORECARD_NOTES_CHARS
        self.assertEqual(sample_scorecard_notes(notes), notes)

    def test_the_closing_readback_survives_an_oversized_transcript(self) -> None:
        """The regression: the authoritative tail must reach the prompt."""
        readback = "Interviewer: so that's React, PostgreSQL and Go? Candidate: yes, correct."
        notes = ("filler turn. " * 2000) + readback
        self.assertGreater(len(notes), MAX_SCORECARD_NOTES_CHARS)
        sampled = sample_scorecard_notes(notes)
        self.assertIn(readback, sampled, "the end-of-call read-back is the authoritative record and must survive")

    def test_the_opening_also_survives(self) -> None:
        """Head+tail, not tail-only — the opening carries role framing."""
        opening = "Interviewer: thanks for joining, let's start with your background."
        notes = opening + (" filler turn." * 2000) + " Candidate: that's right."
        sampled = sample_scorecard_notes(notes)
        self.assertIn(opening, sampled)

    def test_oversized_output_stays_within_budget_and_marks_the_cut(self) -> None:
        notes = "y" * 50_000
        sampled = sample_scorecard_notes(notes)
        self.assertLessEqual(len(sampled), MAX_SCORECARD_NOTES_CHARS)
        self.assertIn("…", sampled, "an elided transcript must say so in-band, never silently")

    def test_empty_and_none_are_safe(self) -> None:
        self.assertEqual(sample_scorecard_notes(""), "")
        self.assertEqual(sample_scorecard_notes(None), "")

    def test_budget_matches_the_typescript_side(self) -> None:
        """Drift guard. The whole defect was two truncation budgets disagreeing
        across the language boundary; if TS lowers its budget and Python doesn't
        follow (or vice versa), the tail starts getting cut again — silently, and
        only on long interviews. Fail loudly here instead."""
        ts = (Path(__file__).resolve().parents[3] / "app" / "_lib" / "interview-transcript.ts").read_text(encoding="utf-8")
        match = re.search(r"MAX_SCORECARD_NOTES_CHARS\s*=\s*(\d+)", ts)
        self.assertIsNotNone(match, "MAX_SCORECARD_NOTES_CHARS not found in interview-transcript.ts")
        self.assertEqual(
            int(match.group(1)),
            MAX_SCORECARD_NOTES_CHARS,
            "TS and Python scorecard-notes budgets have drifted apart",
        )


if __name__ == "__main__":
    unittest.main()
