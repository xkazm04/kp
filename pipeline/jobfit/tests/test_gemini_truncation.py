from __future__ import annotations

import json
import unittest
from unittest import mock

from google.genai import types

import pipeline.jobfit.gemini as G


def _full_payload() -> dict:
    """A schema-shaped analysis payload (top-level keys in schema order)."""
    return {
        "profile": {"name": "Jane", "skills": ["Python", "Go", "Rust"]},
        "score": {"total": 80},
        "salary": {"minimum": 90000, "maximum": 130000},
        "market_evidence": {"summary": "ok"},
        "strengths": ["a", "b"],
        "gaps": ["c"],
        "recommendations": ["d"],
        "explanation": "Solid senior backend candidate.",
        "job_fit": {
            "score": 75,
            "matching_skills": ["Python", "Go", "Kubernetes", "AWS", "Terraform"],
        },
    }


_KEYS = tuple(_full_payload().keys())


class _FakeReason:
    """Stand-in for a finish_reason that exposes only ``.name``."""

    def __init__(self, name: str) -> None:
        self.name = name


class _FakeCandidate:
    def __init__(self, finish_reason: object) -> None:
        self.finish_reason = finish_reason


class _FakeResponse:
    def __init__(self, text: str, finish_reason: object) -> None:
        self.text = text
        self.candidates = [_FakeCandidate(finish_reason)]
        self.usage_metadata = None


class _FakeClient:
    def __init__(self, response: _FakeResponse) -> None:
        self._response = response

    @property
    def models(self):  # noqa: D401 - mimic genai.Client.models.generate_content
        outer = self

        class _Models:
            def generate_content(self, **_kwargs):
                return outer._response

        return _Models()


def _answer_for(text: str, finish_reason: object) -> G.GroundedAnswer:
    fake = _FakeClient(_FakeResponse(text, finish_reason))
    with mock.patch.object(G, "get_client", lambda: fake):
        return G.grounded_answer(
            prompt="analyze",
            response_mime_type="application/json",
            parse_json=True,
            expected_keys=_KEYS,
            max_output_tokens=16000,
        )


class FinishReasonTest(unittest.TestCase):
    def test_normalises_enum_to_bare_name(self) -> None:
        resp = _FakeResponse("{}", types.FinishReason.MAX_TOKENS)
        self.assertEqual(G._finish_reason(resp), "MAX_TOKENS")

    def test_uses_name_attribute_when_present(self) -> None:
        resp = _FakeResponse("{}", _FakeReason("STOP"))
        self.assertEqual(G._finish_reason(resp), "STOP")

    def test_none_when_no_candidates(self) -> None:
        resp = _FakeResponse("{}", None)
        resp.candidates = []
        self.assertIsNone(G._finish_reason(resp))


class RepairTruncatedJsonTest(unittest.TestCase):
    def test_recovers_object_truncated_mid_string(self) -> None:
        full = json.dumps(_full_payload())
        cut = full.index('"Terraform"') + len('"Terra')
        recovered = G._repair_truncated_json(full[:cut])
        self.assertEqual(set(recovered.keys()), set(_KEYS))
        # The dangling final element is dropped; the rest of the array survives.
        self.assertEqual(
            recovered["job_fit"]["matching_skills"], ["Python", "Go", "Kubernetes", "AWS"]
        )

    def test_returns_empty_when_no_object_present(self) -> None:
        self.assertEqual(G._repair_truncated_json("not json at all"), {})


class GroundedAnswerTruncationTest(unittest.TestCase):
    def test_complete_response_parses_normally(self) -> None:
        answer = _answer_for(json.dumps(_full_payload()), types.FinishReason.STOP)
        self.assertFalse(answer.truncated)
        self.assertEqual(answer.payload["score"]["total"], 80)

    def test_truncated_but_salvageable_degrades_with_flag(self) -> None:
        full = json.dumps(_full_payload())
        cut = full.index('"Terraform"') + len('"Terra')
        answer = _answer_for(full[:cut], types.FinishReason.MAX_TOKENS)
        self.assertTrue(answer.truncated)
        self.assertEqual(answer.finish_reason, "MAX_TOKENS")
        # Full schema shape preserved, just a shorter tail array.
        self.assertEqual(set(answer.payload.keys()), set(_KEYS))
        self.assertNotIn("Terraform", answer.payload["job_fit"]["matching_skills"])

    def test_truncated_unsalvageable_raises_clear_error(self) -> None:
        full = json.dumps(_full_payload())
        cut = full.index('"Go"') + len('"G')  # cut deep inside profile.skills
        with self.assertRaises(RuntimeError) as ctx:
            _answer_for(full[:cut], types.FinishReason.MAX_TOKENS)
        msg = str(ctx.exception)
        self.assertIn("truncated", msg)
        self.assertIn("max_output_tokens", msg)
        self.assertNotIn("non-JSON", msg)

    def test_fallback_short_circuits_truncation_error(self) -> None:
        full = json.dumps(_full_payload())
        cut = full.index('"Go"') + len('"G')
        fallback = G.GroundedAnswer(text="", payload={"fallback": True})
        fake = _FakeClient(_FakeResponse(full[:cut], types.FinishReason.MAX_TOKENS))
        with mock.patch.object(G, "get_client", lambda: fake):
            answer = G.grounded_answer(
                prompt="analyze",
                response_mime_type="application/json",
                parse_json=True,
                expected_keys=_KEYS,
                max_output_tokens=16000,
                fallback=fallback,
            )
        self.assertEqual(answer.payload, {"fallback": True})


class GroundedAnswerMalformedCompleteTest(unittest.TestCase):
    """The gap the truncation tests don't cover: a COMPLETE (finish=STOP) response
    that is valid JSON but NOT the analysis shape, or not JSON at all. The model can
    legitimately finish cleanly yet return a refusal object or prose."""

    def test_complete_but_wrong_shape_json_parses_without_truncation(self) -> None:
        # Valid JSON, finished cleanly, but the model returned an OTHER object (a
        # refusal) instead of the schema. The gemini layer is shape-agnostic — the
        # downstream analysisSchema validates the shape — so it must NOT crash and must
        # NOT mis-flag a clean finish as truncated; it hands the payload up to be rejected.
        payload = {"error": "I cannot analyze this document."}
        answer = _answer_for(json.dumps(payload), types.FinishReason.STOP)
        self.assertFalse(answer.truncated)
        self.assertEqual(answer.payload, payload)

    def test_complete_non_json_prose_raises_a_clear_non_truncation_error(self) -> None:
        # The model finished cleanly but returned PROSE (a refusal), not JSON. This must
        # raise a clear error that is NOT mislabeled as a truncation/max-tokens problem.
        with self.assertRaises(RuntimeError) as ctx:
            _answer_for("I'm sorry, but I can't help with that request.", types.FinishReason.STOP)
        msg = str(ctx.exception).lower()
        self.assertNotIn("truncated", msg)
        self.assertNotIn("max_output_tokens", msg)


if __name__ == "__main__":
    unittest.main()
