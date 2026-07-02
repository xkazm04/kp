"""Metering tests for the Gemini-direct path (backlog item 8).

grounded_answer is the single seam for every Gemini-backed feature that does
NOT go through the llm.base wrapper adapters — the flagship CV analysis, the
profile extractor, the grounded salary CLI, and the profile-draft default.
Those calls used to bypass monitor.emit_result entirely, so ~100% of the
flagship traffic escaped the llm_usage ledger. The contract under test:

  - one NDJSON ledger line per successful generate call when KP_LLM_USAGE_LOG
    is set, carrying the caller's use_case, the model, the token counts from
    the response's usage metadata, and a cost stamped from the shared
    MTOK_PRICES table (llm.base.price_usd — no duplicated price rows);
  - no file and no error when the env var is unset (keyless/offline runs);
  - no ledger spend line for a FAILED generate (fallback still honored);
  - each caller threads its own use_case label through to grounded_answer.

Everything is offline: get_client is mocked, no SDK network, no API key.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import pipeline.jobfit.gemini as G
from pipeline.jobfit.llm import monitor
from pipeline.jobfit.llm.base import price_usd


class _FakeUsage:
    prompt_token_count = 1000
    candidates_token_count = 200
    total_token_count = 1200
    cached_content_token_count = 100


class _FakeResponse:
    def __init__(self, text: str, usage: object | None = None) -> None:
        self.text = text
        self.candidates = []
        self.usage_metadata = usage


class _FakeClient:
    def __init__(self, response: _FakeResponse | Exception) -> None:
        self._response = response

    @property
    def models(self):  # mimic genai.Client.models.generate_content
        outer = self

        class _Models:
            def generate_content(self, **_kwargs):
                if isinstance(outer._response, Exception):
                    raise outer._response
                return outer._response

        return _Models()


class _LedgerEnv:
    """Point KP_LLM_USAGE_LOG at a temp sidecar for the duration of a test,
    with LightTrack off (the default deployment) and the monitor cache reset."""

    def __init__(self, test: unittest.TestCase) -> None:
        test.addCleanup(monitor.reset)
        monitor.reset()
        self._dir = tempfile.TemporaryDirectory()
        test.addCleanup(self._dir.cleanup)
        self.path = os.path.join(self._dir.name, "usage.ndjson")
        test.enterContext(mock.patch.dict(os.environ, {"KP_LLM_USAGE_LOG": self.path}, clear=False))
        os.environ.pop("LIGHTTRACK_URL", None)

    def rows(self) -> list[dict]:
        with open(self.path, encoding="utf-8") as fh:
            return [json.loads(line) for line in fh.read().splitlines() if line.strip()]


class GroundedAnswerLedgerTest(unittest.TestCase):
    def test_success_writes_one_ledger_line_with_use_case_model_tokens_cost(self) -> None:
        env = _LedgerEnv(self)
        fake = _FakeClient(_FakeResponse('{"ok": true}', _FakeUsage()))
        with mock.patch.object(G, "get_client", lambda: fake):
            answer = G.grounded_answer(
                prompt="analyze",
                response_mime_type="application/json",
                parse_json=True,
                expected_keys=("ok",),
                use_case="cv_analysis",
            )
        self.assertEqual(answer.payload, {"ok": True})
        rows = env.rows()
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["use_case"], "cv_analysis")
        self.assertEqual(row["provider"], "gemini")
        self.assertEqual(row["model"], G.GEMINI_MODEL)
        self.assertEqual(row["input_tokens"], 1000)
        self.assertEqual(row["output_tokens"], 200)
        self.assertEqual(row["cached_tokens"], 100)
        # Cost comes from the shared MTOK_PRICES mechanism, and the model in use
        # MUST be priced there — cost_usd=None would silently escape accounting.
        expected_cost = price_usd(G.GEMINI_MODEL, 1000, 200)
        self.assertIsNotNone(expected_cost)
        self.assertEqual(row["cost_usd"], expected_cost)
        self.assertEqual(row["source"], "llm")

    def test_spend_is_recorded_even_when_json_parse_fails(self) -> None:
        # The tokens are paid for before parsing; a prose (non-JSON) body still
        # bills exactly one line, and the fallback contract is untouched.
        env = _LedgerEnv(self)
        fake = _FakeClient(_FakeResponse("sorry, no JSON here", _FakeUsage()))
        fallback = G.GroundedAnswer(text="", payload={"fallback": True})
        with mock.patch.object(G, "get_client", lambda: fake):
            answer = G.grounded_answer(
                prompt="analyze",
                response_mime_type="application/json",
                parse_json=True,
                expected_keys=("ok",),
                fallback=fallback,
                use_case="cv_analysis",
            )
        self.assertEqual(answer.payload, {"fallback": True})
        self.assertEqual(len(env.rows()), 1)

    def test_failed_generate_writes_no_spend_line(self) -> None:
        env = _LedgerEnv(self)
        fake = _FakeClient(RuntimeError("boom"))
        fallback = G.GroundedAnswer(text="", payload={})
        with mock.patch.object(G, "get_client", lambda: fake):
            answer = G.grounded_answer(prompt="analyze", fallback=fallback, use_case="grounded_salary")
        self.assertEqual(answer.payload, {})
        self.assertFalse(os.path.exists(env.path), "a failed generate must not bill spend")

    def test_no_env_no_file_and_call_unaffected(self) -> None:
        # Keyless/offline guarantee: without KP_LLM_USAGE_LOG the call behaves
        # exactly as before — no sidecar, no error.
        monitor.reset()
        self.addCleanup(monitor.reset)
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("KP_LLM_USAGE_LOG", None)
            os.environ.pop("LIGHTTRACK_URL", None)
            fake = _FakeClient(_FakeResponse('{"ok": true}', _FakeUsage()))
            with mock.patch.object(G, "get_client", lambda: fake):
                answer = G.grounded_answer(prompt="analyze", parse_json=True, use_case="cv_analysis")
        self.assertEqual(answer.payload, {"ok": True})


class UseCaseThreadingTest(unittest.TestCase):
    """Each caller stamps its own label — grounded_answer never guesses."""

    def _spy(self, payload: dict):
        captured: dict = {}

        def fake_grounded(**kwargs):
            captured.update(kwargs)
            return G.GroundedAnswer(text=json.dumps(payload), payload=payload)

        return captured, fake_grounded

    def test_profile_extract_labels_itself(self) -> None:
        payload = {"raw_text": "cv text", "structured_profile": {}, "parsing_notes": []}
        captured, fake = self._spy(payload)
        with tempfile.TemporaryDirectory() as d:
            doc = Path(d) / "cv.txt"
            doc.write_text("cv text", encoding="utf-8")
            with mock.patch.object(G, "grounded_answer", fake):
                G.extract_profile_text_with_gemini(doc)
        self.assertEqual(captured["use_case"], "profile_extract")

    def test_cv_analysis_labels_itself(self) -> None:
        payload = {"profile": {"name": None}}
        captured, fake = self._spy(payload)
        with mock.patch.object(G, "grounded_answer", fake):
            # blind_text path: no file bytes are read, so the Path can be virtual.
            G.analyze_profile_with_gemini(Path("unused.txt"), blind_text="redacted cv text")
        self.assertEqual(captured["use_case"], "cv_analysis")

    def test_grounded_salary_labels_itself(self) -> None:
        from pipeline.jobfit import market_salary_cli as M

        payload = {
            "suggestedMinimum": 70000,
            "suggestedMaximum": 90000,
            "currency": "CZK",
            "confidence": "medium",
            "summary": "ok",
        }
        captured, fake = self._spy(payload)
        with tempfile.TemporaryDirectory() as d:
            role = Path(d) / "role.json"
            role.write_text(json.dumps({"title": "QA Engineer"}), encoding="utf-8")
            with mock.patch.object(M, "grounded_answer", fake):
                with contextlib.redirect_stdout(io.StringIO()):
                    code = M.main(["--input-json", str(role)])
        self.assertEqual(code, 0)
        self.assertEqual(captured["use_case"], "grounded_salary")

    def test_profile_draft_default_labels_itself(self) -> None:
        from pipeline.jobfit import profile_draft_cli as P

        payload = {"name": "Jane"}
        captured, fake = self._spy(payload)
        # No KP_LLM_CONFIG → the unconfigured default direct-Gemini path runs.
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("KP_LLM_CONFIG", None)
            # _extract imports grounded_answer from the gemini module at call
            # time, so patching the gemini attribute intercepts it.
            with mock.patch.object(G, "grounded_answer", fake):
                P._extract("informal notes about a candidate")
        self.assertEqual(captured["use_case"], "profile_draft")


if __name__ == "__main__":
    unittest.main()
