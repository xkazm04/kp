"""The case's own AI draft counts toward tooling only (council-lite r3, T13).

Correcting the draft used to be credited as verification too, which fed judgment and
transfer, so a candidate who corrected only the draft outscored one who caught the
planted error. Keyless dimension path, no provider.
"""

import unittest

from pipeline.jobfit.devcase.evaluate import evaluate_submission
from pipeline.jobfit.devcase.models import CASE_DRAFT_CANARY_PREFIX

_DRAFT = f"{CASE_DRAFT_CANARY_PREFIX}backoff"
_PLANTED = "planted-1"


def _score(canaries, *, signals=None):
    reflection = {"readBeforeWrite": 0.5, "verificationHabits": []}
    tooling = {"fluency": 0.5, "probeOutcomes": []}
    if signals is not None:
        tooling["signals"] = signals
    extras = {"canaryOutcomes": canaries} if canaries is not None else None
    ev, source = evaluate_submission(reflection, tooling, {"rubricDimensions": []}, {"title": "Backend"}, extras=extras, provider=None)
    assert source == "deterministic"
    return ev["dimensionScores"]


class TestDraftCountsTowardToolingOnly(unittest.TestCase):
    def _cases(self, **kw):
        draft_only = _score([{"id": _DRAFT, "status": "addressed"}, {"id": _PLANTED, "status": "propagated"}], **kw)
        planted_only = _score([{"id": _DRAFT, "status": "propagated"}, {"id": _PLANTED, "status": "addressed"}], **kw)
        neither = _score([{"id": _DRAFT, "status": "propagated"}, {"id": _PLANTED, "status": "propagated"}], **kw)
        return draft_only, planted_only, neither

    def test_draft_only_equals_neither_on_judgment_and_transfer(self):
        a, _, c = self._cases()
        self.assertEqual(a["judgment"], c["judgment"])
        self.assertEqual(a["transfer"], c["transfer"])
        self.assertGreater(a["tooling"], c["tooling"])

    def test_planted_catch_beats_draft_correction_on_judgment(self):
        a, b, _ = self._cases()
        self.assertGreater(b["judgment"], a["judgment"])
        self.assertGreater(b["transfer"], a["transfer"])

    def test_same_holds_when_observed_signals_are_present(self):
        a, b, c = self._cases(signals={"readBeforeWrite": 0.5})
        self.assertEqual(a["judgment"], c["judgment"])
        self.assertEqual(a["transfer"], c["transfer"])
        self.assertGreater(b["judgment"], a["judgment"])

    def test_only_a_draft_canary_graded_leaves_verification_alone(self):
        caught = _score([{"id": _DRAFT, "status": "addressed"}])
        missed = _score([{"id": _DRAFT, "status": "propagated"}])
        self.assertEqual(caught["judgment"], missed["judgment"])
        self.assertEqual(caught["transfer"], missed["transfer"])
        self.assertGreater(caught["tooling"], missed["tooling"])

    def test_no_draft_canary_scores_as_before(self):
        none = _score(None)
        caught = _score([{"id": _PLANTED, "status": "addressed"}])
        missed = _score([{"id": _PLANTED, "status": "propagated"}])
        self.assertEqual(caught["tooling"], none["tooling"])
        self.assertEqual(caught["judgment"], 50)  # verif = CANARY_VERIFY_WEIGHT (0.5), no graded probes
        self.assertEqual(missed["judgment"], none["judgment"])


if __name__ == "__main__":
    unittest.main()
