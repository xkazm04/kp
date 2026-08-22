"""KP_OFFLINE must seal the DIRECT Gemini paths, not just the wrapper adapters.

docs/architecture/self-hosting.md §7 promises that with ``KP_OFFLINE=1`` the Python
pipeline's "cloud LLM engines (Gemini, Anthropic, the Claude CLI …) report
unavailable → the call falls back to deterministic output". Two Gemini call sites
bypass ``llm.base.TextProvider`` (where that seal lives) and were therefore NOT
covered:

  * ``gemini.get_client`` — the flagship multimodal CV analysis + profile extractor,
    which ships the candidate's WHOLE CV file to generativelanguage.googleapis.com;
  * ``embedding_bridge.GeminiEmbeddingProvider`` — the opt-in semantic bridge.

The Node ``fetch`` guard (``app/_lib/offline.ts``) cannot see either, because the
pipeline runs in a spawned Python process. Pre-fix, an air-gapped install with a
leftover ``GEMINI_API_KEY`` (which ``get_gemini_api_key`` re-reads from ``.env.local``
even after the service unit clears it) egressed candidate data anyway.

Everything here is offline: no SDK client is ever constructed, no key is real.
"""

from __future__ import annotations

import os
import unittest
from unittest import mock

import pipeline.jobfit.gemini as G
from pipeline.jobfit.embedding_bridge import GeminiEmbeddingProvider, default_provider

FAKE_KEY = {"GEMINI_API_KEY": "test-not-a-real-key", "GOOGLE_API_KEY": ""}


class _ClientMustNotBeBuilt:
    """Stands in for ``genai.Client`` and fails the test if it is ever constructed."""

    def __init__(self, *args, **kwargs):  # pragma: no cover - the failure is the point
        raise AssertionError("genai.Client was constructed under KP_OFFLINE — egress!")


class GeminiDirectPathOfflineTest(unittest.TestCase):
    def test_get_client_refuses_under_kp_offline_even_with_a_key(self) -> None:
        with mock.patch.dict(os.environ, {**FAKE_KEY, "KP_OFFLINE": "1"}, clear=False):
            with mock.patch.object(G.genai, "Client", _ClientMustNotBeBuilt):
                with self.assertRaises(RuntimeError) as ctx:
                    G.get_client()
        self.assertIn("KP_OFFLINE", str(ctx.exception))
        self.assertIn("Gemini", str(ctx.exception))

    def test_grounded_answer_raises_instead_of_egressing(self) -> None:
        # The CV analysis passes no fallback, so the refusal must surface as the
        # failure reason rather than silently uploading the CV.
        with mock.patch.dict(os.environ, {**FAKE_KEY, "KP_OFFLINE": "1"}, clear=False):
            with mock.patch.object(G.genai, "Client", _ClientMustNotBeBuilt):
                with self.assertRaises(RuntimeError) as ctx:
                    G.grounded_answer(prompt="hello", use_case="cv_analysis")
        self.assertIn("KP_OFFLINE", str(ctx.exception))

    def test_grounded_answer_degrades_to_the_caller_fallback(self) -> None:
        # Callers that DO carry a deterministic fallback get it — the documented
        # "falls back to deterministic output" behaviour, no exception, no egress.
        fallback = G.GroundedAnswer(text="deterministic")
        built: list[dict] = []

        class _Recording:
            def __init__(self, **kwargs):
                built.append(kwargs)

        with mock.patch.dict(os.environ, {**FAKE_KEY, "KP_OFFLINE": "1"}, clear=False):
            with mock.patch.object(G.genai, "Client", _Recording):
                answer = G.grounded_answer(prompt="hello", fallback=fallback)
        self.assertEqual(answer.text, "deterministic")
        # …and the fallback came from the SEAL, not from a client that was built
        # and then failed: nothing must be constructed at all.
        self.assertEqual(built, [])

    def test_offline_off_reaches_the_client_construction(self) -> None:
        # Non-vacuity: with KP_OFFLINE unset the guard does NOT fire — the call
        # proceeds to build the SDK client (our stub proves it got that far).
        built: list[dict] = []

        class _Recording:
            def __init__(self, **kwargs):
                built.append(kwargs)

        env = {**FAKE_KEY}
        env.pop("KP_OFFLINE", None)
        with mock.patch.dict(os.environ, env, clear=False):
            os.environ.pop("KP_OFFLINE", None)
            with mock.patch.object(G.genai, "Client", _Recording):
                G.get_client()
        self.assertEqual(len(built), 1)


class EmbeddingProviderOfflineTest(unittest.TestCase):
    def test_provider_reports_unavailable_under_kp_offline(self) -> None:
        with mock.patch.dict(os.environ, {**FAKE_KEY, "KP_OFFLINE": "1"}, clear=False):
            self.assertFalse(GeminiEmbeddingProvider().available())
            self.assertIsNone(default_provider())

    def test_provider_is_available_again_when_offline_is_off(self) -> None:
        # Non-vacuity: the same key + SDK yields an available provider without the
        # flag, so the assertion above pins KP_OFFLINE and not a missing key.
        env = {**FAKE_KEY}
        with mock.patch.dict(os.environ, env, clear=False):
            os.environ.pop("KP_OFFLINE", None)
            self.assertTrue(GeminiEmbeddingProvider().available())
            self.assertIsNotNone(default_provider())


if __name__ == "__main__":
    unittest.main()
