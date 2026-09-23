"""Test providers that answer in TEXT, the way a real model does (challenge-r08 tests-devcase/A).

Every devcase step pins its model answer BY SHAPE (``expected_keys``) because the
submission it reads is candidate-authored: a trailing JSON object the candidate
coaxes into the reply must not replace the genuine answer. That pin lives in the
extractor (:func:`pipeline.jobfit.json_values.extract_json`) — and the devcase fakes
used to return canned dicts, so the extractor never ran under them and no test ever
measured the pin. Production even carried a signature sniff that dropped the pin for
a fake too old to accept it.

A fake here gets a reply the way a provider does: a dict is serialised to JSON text,
a string is used verbatim, and the result goes through the REAL ``extract_json`` with
the ``expected_keys`` the step passed. The contract (every ``complete_json`` in
``pipeline/jobfit/tests`` accepts ``expected_keys``) is scanned by
``test_devcase_shape_pinning.FakeContractTest``.
"""

from __future__ import annotations

import json
from typing import Any, Callable, Sequence, Union

from pipeline.jobfit.json_values import extract_json

# What a fake may answer: model TEXT, a JSON-able value (serialised to text), an
# exception (raised), or a callable of the prompt returning any of those.
Reply = Union[str, dict, list, BaseException, Callable[[str], Any]]


def as_text(value: Any) -> str:
    """A reply value as the text a model would have written."""
    return value if isinstance(value, str) else json.dumps(value)


class TextReply:
    """An available provider whose answer is text, parsed by the real extractor.

    ``reply`` is a :data:`Reply`. A callable is dispatched on the prompt, which is how
    a multi-step fake answers one step and fails the rest. ``calls`` records every
    ``(prompt, system, expected_keys)`` so a test can read what the step sent.
    """

    def __init__(self, reply: Reply, *, model: str | None = None) -> None:
        self._reply = reply
        self.model = model
        self.calls: list[tuple[str, Any, Any]] = []

    def available(self) -> bool:
        return True

    def complete_json(
        self, prompt: str, system: str | None = None, *, expected_keys: Sequence[str] | None = None
    ) -> Any:
        self.calls.append((prompt, system, expected_keys))
        reply = self._reply(prompt) if callable(self._reply) else self._reply
        if isinstance(reply, BaseException):
            raise reply
        return extract_json(as_text(reply), expected_keys=expected_keys)

    @property
    def last_prompt(self) -> str:
        return self.calls[-1][0]


class RaisingProvider(TextReply):
    """An available provider whose every call raises ``exc`` — every step falls back."""

    def __init__(self, exc: BaseException, *, model: str | None = None) -> None:
        super().__init__(exc, model=model)


def by_prompt(routes: Sequence[tuple[str, Any]], default: Any) -> Callable[[str], Any]:
    """A prompt-dispatch reply: the first ``(marker, reply)`` whose marker is in the
    prompt answers; otherwise ``default`` (typically an exception)."""

    def dispatch(prompt: str) -> Any:
        for marker, reply in routes:
            if marker in prompt:
                return reply
        return default

    return dispatch
