"""`constraint_sent` reports what the request actually constrained.

`grounded_answer` cannot send both a grounding tool and a `response_mime_type`:
with tools attached the model answers in prose, so the mime-type constraint is
dropped. The drop is correct. Dropping it *silently* is not — the caller's
parsing posture depends on which one it got (`_parse_json` scans prose for the
payload precisely because the schema was not enforced), and the flagship
CV-analysis path at `analyze_document` passes both.

These tests pin the shed as an observable on the result rather than an
invisible branch inside the request builder.

Two things were corrected here after review, and both are worth stating because
the tests originally locked in the defects:

1. **It reports what was constrained, and it is not a boolean.** The original
   `schema_enforced` defaulted to `True` and stayed `True` whenever nothing was
   shed — including when no constraint was ever requested, and on the degraded
   fallback a caller returns when the call raises. It also read `True` for a
   mime-only call, claiming the model had been told field domains it was never
   told. And it could not survive step 3 of the work item, which sends a real
   response schema: `True` would then mean two different things. So the field is
   now `constraint_sent`, one of `"none"` / `"mime"` / `"schema"`, and the three
   states are the three facts that actually exist here.
2. **These tests were module-level pytest-style functions with a bad import**
   (`from jobfit import ...`), which this repository's gates
   (`python -m unittest discover`) cannot collect — they were a loader error, not
   a passing suite. Now a `TestCase`, so the gate actually runs them.
"""

from __future__ import annotations

import unittest
from types import SimpleNamespace
from typing import get_args
from unittest.mock import patch

from pipeline.jobfit import gemini


def _fake_response(text: str = '{"ok": 1}'):
    part = SimpleNamespace(text=text, inline_data=None)
    content = SimpleNamespace(parts=[part])
    candidate = SimpleNamespace(
        content=content, finish_reason=SimpleNamespace(name="STOP"), grounding_metadata=None
    )
    return SimpleNamespace(candidates=[candidate], text=text, usage_metadata=None)


class TestConstraintSentReporting(unittest.TestCase):
    """The four arms of the request builder, read off the result."""

    def _call(self, **kwargs):
        """Invoke the seam with the network stubbed, returning (answer, config)."""
        captured: dict = {}

        def _fake_generate(*, model, contents, config):
            captured["config"] = config
            return _fake_response()

        fake_client = SimpleNamespace(models=SimpleNamespace(generate_content=_fake_generate))
        with patch.object(gemini, "get_client", return_value=fake_client):
            answer = gemini.grounded_answer(prompt="p", use_case="cv_analysis", **kwargs)
        return answer, captured["config"]

    def test_instrument_sees_the_constrained_arm(self):
        """Known positive: mime requested alone -> sent, and reported as mime.

        Reported "mime" and not "schema": this call constrained the reply's
        *syntax* only. No response schema is sent anywhere in this repository
        yet, so claiming schema enforcement here would be the lie the old
        boolean told.
        """
        answer, config = self._call(response_mime_type="application/json")
        self.assertEqual(getattr(config, "response_mime_type", None), "application/json")
        self.assertIn(getattr(config, "tools", None), (None, []))
        self.assertEqual(answer.constraint_sent, "mime")

    def test_nothing_requested_constrains_nothing(self):
        """Known negative: no constraint asked for, so none was enforced.

        This arm previously asserted `True` on the grounds that nothing was
        *shed*. Nothing was shed and nothing was enforced either — the payload is
        unconstrained prose, and a caller must not read this flag as permission
        to parse it strictly.
        """
        answer, config = self._call()
        self.assertIsNone(getattr(config, "response_mime_type", None))
        self.assertEqual(answer.constraint_sent, "none")

    def test_grounding_sheds_the_schema_and_says_so(self):
        """The defect arm: both requested -> constraint dropped, and the caller can tell."""
        answer, config = self._call(response_mime_type="application/json", use_grounding=True)
        self.assertTrue(getattr(config, "tools", None), "grounding tool must be attached")
        self.assertIsNone(
            getattr(config, "response_mime_type", None),
            "the schema must not be sent alongside tools",
        )
        self.assertEqual(
            answer.constraint_sent,
            "none",
            "a shed constraint the caller cannot observe is the defect this pins",
        )

    def test_grounding_without_a_constraint_sends_none(self):
        """Grounding alone asked for no constraint, so nothing is enforced."""
        answer, config = self._call(use_grounding=True)
        self.assertTrue(getattr(config, "tools", None))
        self.assertEqual(answer.constraint_sent, "none")


class TestDegradedFallbackPosture(unittest.TestCase):
    """The default matters as much as the branches.

    Callers build a `GroundedAnswer` by hand on the failure path — the empty
    answer returned when the call raised. That object never went near a request,
    so it cannot have had a constraint enforced, and the dataclass default is
    what decides whether it lies about that.
    """

    def test_a_hand_built_fallback_does_not_claim_a_constraint(self):
        fallback = gemini.GroundedAnswer(text="", payload={}, sources=[])
        self.assertEqual(fallback.constraint_sent, "none")

    def test_the_vocabulary_is_closed_and_machine_readable(self):
        """The closed set must live in the type, not only in a comment.

        A value domain written down in prose and unreadable by the machines on
        either boundary is the exact defect the sibling instrument counts, so this
        pins that the set is declared once as a `Literal` and that the runtime
        tuple is derived from it rather than retyped beside it.
        """
        self.assertEqual(gemini.CONSTRAINT_SENT_VALUES, ("none", "mime", "schema"))
        self.assertEqual(set(get_args(gemini.ConstraintSent)), set(gemini.CONSTRAINT_SENT_VALUES))

    def test_every_arm_produces_a_declared_value(self):
        """No branch of the request builder may emit a state outside the set."""
        for kwargs in (
            {},
            {"response_mime_type": "application/json"},
            {"use_grounding": True},
            {"response_mime_type": "application/json", "use_grounding": True},
        ):
            with self.subTest(kwargs=kwargs):
                answer, _config = TestConstraintSentReporting()._call(**kwargs)
                self.assertIn(answer.constraint_sent, gemini.CONSTRAINT_SENT_VALUES)


if __name__ == "__main__":
    unittest.main()
