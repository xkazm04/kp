"""Cohort Studio's comparative pass (cohort_compare.py + its CLI).

Pinned:
  * the keyless floor's SHAPE: no cell comments, a templated note for every claimed
    dimension, a templated narrative naming what it covers and how many it leaves out,
    ``engine: "keyless"`` — in the report language;
  * comments are RARE: at most one per four members, each <= 90 characters, only on a
    member and a dimension the input carries;
  * the claims are never contradicted: with no leader claimed, a narrative or note that
    crowns someone is replaced/dropped; a crown on someone other than the claimed leader
    is dropped too; a numbered ranking is refused;
  * a provider failure is the keyless floor, with the reason reported;
  * the CLI's bridge envelope.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit import cohort_compare_cli
from pipeline.jobfit.cohort_compare import (
    COMMENT_MAX_CHARS,
    comment_cap,
    contradicts_claim,
    deterministic_comparison,
    generate,
)
from pipeline.jobfit.tests._helpers import run_cli


def _member(mid: str, label: str, rank: int) -> dict:
    return {"memberId": mid, "label": label, "fitRank": rank, "cells": {"fit": {"rating": 90 - rank * 5, "tier": "strong", "label": "cells.fit"}}, "facts": {}}


def _context(leader: str | None, separation: str = "clears") -> dict:
    members = [_member("a", "Alice", 1), _member("b", "Bob", 2), _member("c", "Cyril", 3), _member("d", "Dana", 4), _member("e", "Emil", 5)]
    return {
        "lang": "en",
        "blind": False,
        "jdTitle": "Backend Engineer",
        "members": members,
        "claims": {
            "overall": {"leader": leader, "separation": separation, "robustness": "stable"},
            "byDimension": {
                "fit": {"dimension": "fit", "leader": leader, "separation": separation, "rated": 5},
                "skills": {"dimension": "skills", "leader": None, "separation": "insideNoise", "rated": 5},
                "salary": {"dimension": "salary", "leader": None, "separation": "belowFloor", "rated": 1},
            },
        },
        "narrativeTop": ["a", "b", "c"],
        "leavesOut": 2,
    }


class FakeProvider:
    """Answers one canned object through the same call shape the real providers take."""

    def __init__(self, answer: object = None, error: Exception | None = None) -> None:
        self.answer = answer
        self.error = error
        self.calls: list[dict] = []

    def complete_json(self, prompt: str, *, system: str, expected_keys=None):  # noqa: ANN001 — the provider protocol
        self.calls.append({"prompt": prompt, "system": system, "expected_keys": expected_keys})
        if self.error:
            raise self.error
        return self.answer


class KeylessFloorTest(unittest.TestCase):
    def test_the_fallback_shape(self) -> None:
        out = generate(_context("a"), lang="en", provider=None)
        self.assertEqual(out["engine"], "keyless")
        self.assertEqual(out["cells"], [])
        self.assertEqual(set(out["notes"]), {"fit", "skills", "salary"})
        self.assertIn("Alice", out["notes"]["fit"])
        self.assertIn("no leader", out["notes"]["skills"])
        self.assertIn("Fewer than two", out["notes"]["salary"])
        narrative = out["narrative"]
        self.assertEqual(narrative["covers"], ["a", "b", "c"])
        self.assertEqual(narrative["leavesOut"], 2)
        self.assertIn("Alice, Bob, Cyril", narrative["text"])
        self.assertIn("2 more", narrative["text"])

    def test_the_floor_never_crowns_without_a_claim(self) -> None:
        out = deterministic_comparison(_context(None, "insideNoise"), "en")
        self.assertIn("No overall leader", out["narrative"]["text"])
        self.assertNotIn("Alice leads", out["narrative"]["text"])
        self.assertNotIn("Alice", out["notes"]["fit"])

    def test_the_floor_speaks_the_report_language_with_czech_plurals(self) -> None:
        out = deterministic_comparison(_context("a"), "cs")
        self.assertIn("3 nejsilnější kandidáty", out["narrative"]["text"])
        self.assertIn("Další 2 kandidáty", out["narrative"]["text"])
        self.assertIn("je hodnoceno 5 kandidátů", out["notes"]["skills"])


class CommentCapTest(unittest.TestCase):
    def test_at_most_one_comment_per_four_members(self) -> None:
        self.assertEqual(comment_cap(5), 1)
        self.assertEqual(comment_cap(8), 2)
        self.assertEqual(comment_cap(20), 5)
        cells = [{"memberId": m, "dimension": "skills", "comment": "Rating rests on two listed skills only."} for m in "abcde"]
        out = generate(_context("a"), provider=FakeProvider({"cells": cells, "notes": {}, "narrative": None}))
        self.assertEqual(len(out["cells"]), 1)

    def test_invalid_cells_are_dropped(self) -> None:
        cells = [
            {"memberId": "zz", "dimension": "skills", "comment": "Unknown member."},
            {"memberId": "a", "dimension": "charisma", "comment": "Unknown dimension."},
            {"memberId": "b", "dimension": "skills", "comment": "x" * (COMMENT_MAX_CHARS + 1)},
            {"memberId": "c", "dimension": "trust", "comment": "Two warnings sit behind this score."},
        ]
        # 20 members so the cap (5) is not what drops them.
        ctx = _context("a")
        ctx["members"] = ctx["members"] + [_member(f"m{i}", f"M{i}", 6 + i) for i in range(15)]
        out = generate(ctx, provider=FakeProvider({"cells": cells, "notes": {}, "narrative": None}))
        self.assertEqual(out["cells"], [{"memberId": "c", "dimension": "trust", "comment": "Two warnings sit behind this score."}])


class ClaimGuardTest(unittest.TestCase):
    def test_a_narrative_crowning_without_a_claim_is_replaced(self) -> None:
        answer = {"cells": [], "notes": {}, "narrative": {"covers": ["a", "b"], "text": "Alice leads the field on every count."}}
        out = generate(_context(None, "insideNoise"), provider=FakeProvider(answer))
        self.assertEqual(out["engine"], "keyless", "the template replaced the model's narrative")
        self.assertNotIn("Alice leads", out["narrative"]["text"])
        self.assertIn("No overall leader", out["narrative"]["text"])

    def test_a_crown_on_someone_other_than_the_claimed_leader_is_refused(self) -> None:
        self.assertTrue(contradicts_claim("Bob is the strongest candidate.", {"leader": "a", "separation": "clears"}, {"a": "Alice", "b": "Bob"}))
        self.assertFalse(contradicts_claim("Alice leads on overall fit.", {"leader": "a", "separation": "clears"}, {"a": "Alice", "b": "Bob"}))
        # A lead INSIDE the noise is not a nameable lead.
        self.assertTrue(contradicts_claim("Alice leads on overall fit.", {"leader": "a", "separation": "insideNoise"}, {"a": "Alice"}))

    def test_a_numbered_ranking_is_refused(self) -> None:
        self.assertTrue(contradicts_claim("1. Alice\n2. Bob", {"leader": "a", "separation": "clears"}, {"a": "Alice", "b": "Bob"}))

    def test_a_note_contradicting_its_dimension_claim_is_dropped(self) -> None:
        answer = {"cells": [], "notes": {"skills": "Bob is the best on skills.", "fit": "Alice leads clearly."}, "narrative": None}
        out = generate(_context("a"), provider=FakeProvider(answer))
        self.assertNotIn("skills", out["notes"])
        self.assertEqual(out["notes"]["fit"], "Alice leads clearly.")

    def test_a_faithful_narrative_is_kept_as_the_models(self) -> None:
        answer = {"cells": [], "notes": {}, "narrative": {"covers": ["a", "b", "zz"], "text": "Alice leads overall on fit; Bob trails on skills evidence."}}
        out = generate(_context("a"), provider=FakeProvider(answer))
        self.assertEqual(out["engine"], "model")
        self.assertEqual(out["narrative"]["covers"], ["a", "b"], "covers are restricted to the code-decided top")
        self.assertEqual(out["narrative"]["leavesOut"], 2)

    def test_the_prompt_carries_the_claims_and_never_the_cv(self) -> None:
        provider = FakeProvider({"cells": [], "notes": {}, "narrative": None})
        generate(_context("a"), provider=provider)
        prompt = provider.calls[0]["prompt"]
        self.assertIn('"separation": "clears"', prompt)
        self.assertIn("UNTRUSTED_CANDIDATE_FACTS", prompt)
        self.assertEqual(provider.calls[0]["expected_keys"], ("cells", "notes", "narrative"))


class ProviderFailureTest(unittest.TestCase):
    def test_a_failing_provider_is_the_keyless_floor_with_a_reason(self) -> None:
        reasons: list[str] = []
        out = generate(_context("a"), provider=FakeProvider(error=TimeoutError("timed out")), on_fallback=reasons.append)
        self.assertEqual(out["engine"], "keyless")
        self.assertEqual(out["cells"], [])
        self.assertTrue(reasons and "TimeoutError" in reasons[0])


class CliTest(unittest.TestCase):
    def test_no_llm_serves_the_floor(self) -> None:
        run = run_cli(cohort_compare_cli.main, ["--no-llm", "--input-json", "@c.json"], files={"c.json": _context("a")})
        self.assertEqual(run.code, 0, run.stderr)
        self.assertEqual(run.payload["engine"], "keyless")
        self.assertEqual(set(run.payload), {"cells", "notes", "narrative", "engine", "promptVersion"})

    def test_a_non_object_payload_is_the_callers_input(self) -> None:
        run = run_cli(cohort_compare_cli.main, ["--no-llm", "--input-json", "@c.json"], files={"c.json": [1, 2]})
        self.assertEqual(run.code, 1)
        self.assertEqual((run.envelope["code"], run.envelope["status"]), ("invalid_input", 400))


if __name__ == "__main__":
    unittest.main()
