"""Grounding sheds the response schema; the shed must reach the caller.

`grounded_answer` cannot send both a grounding tool and a `response_mime_type`:
with tools attached the model answers in prose, so the mime-type constraint is
dropped. The drop is correct. Dropping it *silently* is not — the caller's
parsing posture depends on which one it got (`_parse_json` scans prose for the
payload precisely because the schema was not enforced), and the flagship
CV-analysis path at `analyze_document` passes both.

These tests pin the shed as an observable on the result rather than an
invisible branch inside the request builder.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

from jobfit import gemini


def _fake_response(text: str = '{"ok": 1}'):
    part = SimpleNamespace(text=text, inline_data=None)
    content = SimpleNamespace(parts=[part])
    candidate = SimpleNamespace(
        content=content, finish_reason=SimpleNamespace(name="STOP"), grounding_metadata=None
    )
    return SimpleNamespace(candidates=[candidate], text=text, usage_metadata=None)


def _call(**kwargs):
    """Invoke the seam with the network stubbed, returning the GroundedAnswer."""
    captured: dict = {}

    def _fake_generate(*, model, contents, config):
        captured["config"] = config
        return _fake_response()

    fake_client = SimpleNamespace(models=SimpleNamespace(generate_content=_fake_generate))
    with patch.object(gemini, "get_client", return_value=fake_client):
        answer = gemini.grounded_answer(prompt="p", use_case="cv_analysis", **kwargs)
    return answer, captured["config"]


def test_instrument_sees_the_enforced_arm():
    """Known positive: schema only -> the constraint is sent and reported enforced."""
    answer, config = _call(response_mime_type="application/json")
    assert getattr(config, "response_mime_type", None) == "application/json"
    assert getattr(config, "tools", None) in (None, [])
    assert answer.schema_enforced is True


def test_instrument_sees_the_ungrounded_unconstrained_arm():
    """Known negative: neither feature requested -> nothing was shed."""
    answer, config = _call()
    assert getattr(config, "response_mime_type", None) is None
    assert answer.schema_enforced is True


def test_grounding_sheds_the_schema_and_says_so():
    """The defect arm: both requested -> constraint dropped, and the caller can tell."""
    answer, config = _call(response_mime_type="application/json", use_grounding=True)
    assert getattr(config, "tools", None), "grounding tool must be attached"
    assert getattr(config, "response_mime_type", None) is None, (
        "the schema must not be sent alongside tools"
    )
    assert answer.schema_enforced is False, (
        "a shed constraint the caller cannot observe is the defect this pins"
    )


def test_grounding_without_a_schema_sheds_nothing():
    """Grounding alone asked for no constraint, so there is nothing to report shed."""
    answer, config = _call(use_grounding=True)
    assert getattr(config, "tools", None)
    assert answer.schema_enforced is True
