"""The family-case catch rule, measured on answers it was never tuned against.

``heldout/devcase_catch_heldout.json`` holds labelled candidate answers written before the
council-lite T13 r3 rule changes and kept outside the tuned tests. This module grades every
one with the real rule (``canary_outcomes`` over the real family case and seed) and asserts an
accuracy floor; it prints the per-family confusion counts and every misgraded answer, so a
later round reads accuracy rather than a pass/fail on answers the rule was shaped around.

Never edit an entry to make this pass. A rule that drops below the floor is reported, not
re-tuned against this file.
"""

import json
import unittest
from collections import defaultdict
from pathlib import Path

from pipeline.jobfit.devcase.artifact_checks import canary_outcomes
from pipeline.jobfit.devcase.design import design_case, design_role
from pipeline.jobfit.devcase.models import CASE_DRAFT_CANARY_PREFIX, CaseScenario, DevNeed, NeedAnalysis, RoleSpec
from pipeline.jobfit.devcase.seed_materializer import deterministic_seed

HELDOUT = Path(__file__).parent / "heldout" / "devcase_catch_heldout.json"

# Measured 2026-10-23: 33/56 (58.9%) on the rule before the r3 fix, 54/56 (96.4%) after it.
# The two left are figure-free comparisons, the cost of crediting a comparison only beside
# the corrected figure (r3 shape g).
ACCURACY_FLOOR = 0.90

_ROLES = {
    "sales": ("sales_marketing", "Account Executive"),
    "marketing": ("sales_marketing", "Growth Marketing Manager"),
    "operations": ("operations_logistics", "Operations Analyst"),
    "support": ("customer_support", "Support Specialist"),
    "design": ("creative_design", "Product Designer"),
}
_CAUGHT = ("flagged", "addressed")


def _seed_for(fam: str) -> dict:
    rf, title = _ROLES[fam]
    need = DevNeed(title=title, role_family=rf, seniority_target="medior")
    analysis = NeedAnalysis(real_stack=["CRM"], core_responsibilities=["x"], true_complexity="medium", risk_areas=[])
    role, _ = design_role(need, analysis, provider=None)
    role["title"], role["roleFamily"] = title, rf
    case, _ = design_case(need, analysis, role, provider=None)
    scn = CaseScenario.model_validate({**case, "id": "c1"})
    spec = RoleSpec.model_validate({"title": title, "roleFamily": rf, "seniority": "medior"})
    return deterministic_seed(scn, spec)


def grade_heldout() -> list[dict]:
    """Every held-out answer with the rule's verdict on its canary."""
    answers = json.loads(HELDOUT.read_text(encoding="utf-8"))["answers"]
    seeds: dict[str, dict] = {}
    out = []
    for a in answers:
        seed = seeds.setdefault(a["family"], _seed_for(a["family"]))
        files = [dict(f) for f in seed["files"]]
        chat = None
        if a["where"] == "chat":
            chat = [{"role": "user", "text": a["text"]}]
        else:
            files.append({"path": a["path"], "contents": a["text"]})
        prefix = CASE_DRAFT_CANARY_PREFIX if a["canary"] == "draft" else "case-"
        verdict = next(o for o in canary_outcomes(seed, files, chat) if o["id"].startswith(prefix))
        out.append({**a, "status": verdict["status"], "predicted": "catch" if verdict["status"] in _CAUGHT else "miss"})
    return out


def report(graded: list[dict]) -> str:
    conf: dict[str, dict[str, int]] = defaultdict(lambda: {"tp": 0, "fn": 0, "fp": 0, "tn": 0})
    for g in graded:
        cell = {("catch", "catch"): "tp", ("catch", "miss"): "fn", ("miss", "catch"): "fp", ("miss", "miss"): "tn"}
        conf[f"{g['family']}/{g['canary']}"][cell[(g["label"], g["predicted"])]] += 1
    right = sum(1 for g in graded if g["label"] == g["predicted"])
    lines = [f"held-out catch rule: {right}/{len(graded)} correct ({right / len(graded):.1%})",
             "  family/canary        tp fn fp tn"]
    for key in sorted(conf):
        c = conf[key]
        lines.append(f"  {key:<20} {c['tp']:>2} {c['fn']:>2} {c['fp']:>2} {c['tn']:>2}")
    wrong = [g for g in graded if g["label"] != g["predicted"]]
    if wrong:
        lines.append("  misgraded:")
        lines += [f"    {g['id']} [{g['shape'] or '-'}] label={g['label']} rule={g['status']}: {g['why']}" for g in wrong]
    return "\n".join(lines)


class TestHeldOutCatchAccuracy(unittest.TestCase):
    def test_the_set_is_well_formed(self):
        answers = json.loads(HELDOUT.read_text(encoding="utf-8"))["answers"]
        self.assertGreaterEqual(len(answers), 40)
        self.assertEqual(len({a["id"] for a in answers}), len(answers))
        self.assertEqual({a["family"] for a in answers}, set(_ROLES))
        for a in answers:
            self.assertIn(a["label"], ("catch", "miss"), a["id"])
            self.assertIn(a["canary"], ("trap", "draft"), a["id"])
            self.assertTrue(a["why"] and a["plausibility"], a["id"])
        self.assertTrue({"a", "b", "d", "e", "f", "g"} <= {a["shape"] for a in answers})

    def test_accuracy_meets_the_floor(self):
        graded = grade_heldout()
        print("\n" + report(graded))
        right = sum(1 for g in graded if g["label"] == g["predicted"])
        self.assertGreaterEqual(right / len(graded), ACCURACY_FLOOR, report(graded))


if __name__ == "__main__":
    print(report(grade_heldout()))
