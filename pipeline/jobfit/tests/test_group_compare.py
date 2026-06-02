"""Deterministic-path tests for the comparative ("compare all") summary.

The LLM path is best-effort; these lock the structured, bold-formatted
deterministic synthesis and the provider-failure fallback so the Decisions group
evaluation always has usable formatted output.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit.group_compare import (
    GROUP_COMPARE_PROMPT_VERSION,
    deterministic_comparison,
    generate,
)

CONTEXT = {
    "roleTitle": "Backend Engineer",
    "candidates": [
        {
            "label": "Alice",
            "archetype": "bau",
            "seniority": "senior",
            "total": 82,
            "skills": 88,
            "career": 75,
            "personal": 70,
            "matchedSkills": ["Python", "PostgreSQL", "Docker"],
            "missingSkills": ["Kubernetes"],
            "verdict": "Strong senior backend fit.",
        },
        {
            "label": "Bob",
            "archetype": "career_switcher",
            "seniority": "medior",
            "total": 58,
            "skills": 55,
            "career": 60,
            "personal": 62,
            "matchedSkills": ["Python"],
            "missingSkills": ["PostgreSQL", "Docker", "Kubernetes"],
            "verdict": "Promising switcher with a delivery track record.",
        },
    ],
}


def _all_text(comparison: dict) -> str:
    return " ".join([comparison["headline"], *comparison["keyPoints"], comparison.get("recommendation", "")])


class DeterministicComparisonTest(unittest.TestCase):
    def test_headline_names_leader_and_role_and_is_bolded(self) -> None:
        c = deterministic_comparison(CONTEXT)
        self.assertIn("Alice", c["headline"])
        self.assertIn("Backend Engineer", c["headline"])
        self.assertIn("**", c["headline"])  # carries bold markers for the UI

    def test_keypoints_present_and_bolded(self) -> None:
        c = deterministic_comparison(CONTEXT)
        self.assertTrue(c["keyPoints"])
        self.assertTrue(any("**" in p for p in c["keyPoints"]))

    def test_flags_early_career_candidate(self) -> None:
        text = _all_text(deterministic_comparison(CONTEXT))
        self.assertIn("Bob", text)
        self.assertIn("early-career", text)

    def test_recommendation_is_actionable(self) -> None:
        self.assertIn("Advance", deterministic_comparison(CONTEXT)["recommendation"])

    def test_empty_candidates(self) -> None:
        c = deterministic_comparison({"roleTitle": "X", "candidates": []})
        self.assertIn("No candidates", c["headline"])
        self.assertEqual(c["keyPoints"], [])

    def test_tolerates_missing_fields(self) -> None:
        c = deterministic_comparison({"roleTitle": "Y", "candidates": [{"label": "Solo"}]})
        self.assertIn("Solo", c["headline"])


class GenerateFallbackTest(unittest.TestCase):
    def test_no_provider_is_deterministic(self) -> None:
        comparison, source = generate(CONTEXT, provider=None)
        self.assertEqual(source, "deterministic")
        self.assertIn("Alice", comparison["headline"])

    def test_provider_failure_falls_back(self) -> None:
        class Boom:
            def complete_json(self, *_args, **_kwargs):
                raise RuntimeError("nope")

        comparison, source = generate(CONTEXT, provider=Boom())
        self.assertEqual(source, "deterministic")
        self.assertTrue(comparison["headline"])

    def test_provider_success_is_coerced(self) -> None:
        class Ok:
            def complete_json(self, *_args, **_kwargs):
                return {
                    "headline": "**Alice** edges **Bob** on senior depth.",
                    "keyPoints": ["**Alice** covers **3/4** must-haves."],
                    "recommendation": "Advance **Alice**.",
                }

        comparison, source = generate(CONTEXT, provider=Ok())
        self.assertEqual(source, "llm")
        self.assertEqual(comparison["headline"], "**Alice** edges **Bob** on senior depth.")
        self.assertEqual(len(comparison["keyPoints"]), 1)

    def test_provider_partial_payload_falls_back(self) -> None:
        class Partial:
            def complete_json(self, *_args, **_kwargs):
                return {"headline": "x"}  # no keyPoints → backfill from deterministic

        comparison, source = generate(CONTEXT, provider=Partial())
        # Source stays 'llm' (the call succeeded) but the body is the deterministic synthesis.
        self.assertEqual(source, "llm")
        self.assertIn("Alice", comparison["headline"])
        self.assertTrue(comparison["keyPoints"])

    def test_prompt_version_is_stamped(self) -> None:
        self.assertTrue(GROUP_COMPARE_PROMPT_VERSION)


if __name__ == "__main__":
    unittest.main()
