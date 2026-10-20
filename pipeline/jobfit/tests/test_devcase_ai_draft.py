"""S2 (ADR 0027) — the supplied AI-draft critique stimulus.

Every case carries exactly ONE truthfully labelled, unreviewed AI-generated draft whose
flaws have real ground truth, curated per role family on the keyless path (which used to
plant no canaries at all). It is graded by the EXISTING channel-neutral canary rule
(artifact_checks.canary_outcomes) — no new scoring channel, and AI use itself earns
nothing (the two-sided fairness gate stays green, the observed judgment gap stays 0).

What must hold:
  * every keyless role family gets one draft, labelled as unreviewed AI output the
    candidate may use, fix or discard, and every canary fragment locates verbatim (once)
    in the file its path names;
  * the draft never hints at its flaws beyond that label;
  * the LLM path keeps its own canaries AND still ships exactly one draft;
  * on the observed cast, careful_verifier and ai_then_verify catch the draft's flaws,
    ai_no_verify propagates them, and the two verifiers' caught rates sit within 2 points.
"""

from __future__ import annotations

import re
import unittest

from pipeline.jobfit.devcase.ai_drafts import DRAFT_LABEL, DRAFTS, draft_for
from pipeline.jobfit.devcase.artifact_checks import _fragment, canary_outcomes
from pipeline.jobfit.devcase.models import CaseScenario, RoleSpec
from pipeline.jobfit.devcase.scenarios import DOMAINS
from pipeline.jobfit.devcase.seed_materializer import (
    CANARY_KINDS,
    DECISIONS_FILE,
    MAX_SEED_FILES,
    _coerce,
    deterministic_seed,
)
from pipeline.jobfit.devcase.submission_eval import fairness, run_one
from pipeline.jobfit.devcase.submission_scenarios import generate_submissions
from pipeline.jobfit.taxonomy import ROLE_FAMILIES

CASE = CaseScenario(id="case-s2", title="Work sample", brief="Do the work.", tasks=["Task one", "Task two"])

# Every family string the keyless seed path can be handed: the canonical taxonomy, the
# devcase scenario vocabulary (devops_sre, fpna, …), and anything else (falls back).
_SCENARIO_FAMILIES = sorted({f for d in DOMAINS.values() for f in d["families"]})
KEYLESS_FAMILIES = sorted(set(ROLE_FAMILIES) | set(_SCENARIO_FAMILIES) | {"", "not_a_family"})

# Words that would point the candidate at the planted flaws.
_HINT_RE = re.compile(r"\b(bug|bugs|wrong|incorrect|error|errors|mistake|flaw|flaws|trap|canary|canaries|deliberate|planted|todo|fixme)\b", re.IGNORECASE)


def _drafts_in(seed: dict) -> list[dict]:
    return [f for f in seed["files"] if DRAFT_LABEL in f["contents"]]


class KeylessDraftTest(unittest.TestCase):
    def test_every_taxonomy_family_has_a_curated_draft(self):
        self.assertEqual(set(DRAFTS), set(ROLE_FAMILIES))

    def test_every_keyless_family_seed_has_exactly_one_locatable_draft(self):
        for family in KEYLESS_FAMILIES:
            with self.subTest(family=family):
                seed = deterministic_seed(CASE, RoleSpec(title="Role", role_family=family))
                drafts = _drafts_in(seed)
                self.assertEqual(len(drafts), 1)
                draft = drafts[0]
                self.assertIn("use it, fix it or discard it", draft["contents"])
                canaries = seed["canaries"]
                self.assertTrue(1 <= len(canaries) <= 3)
                self.assertEqual(len({c["id"] for c in canaries}), len(canaries))
                for c in canaries:
                    self.assertEqual(c["path"], draft["path"])
                    self.assertIn(c["kind"], CANARY_KINDS)
                    self.assertTrue(c["groundTruth"] and c["reveals"])
                    frag = _fragment(c["flaw"])
                    self.assertIsNotNone(frag, c["flaw"])
                    self.assertEqual(draft["contents"].count(frag), 1, frag)

    def test_seed_paths_stay_unique_and_decisions_log_kept(self):
        seed = deterministic_seed(CASE, RoleSpec(title="Role", role_family="software_engineering"))
        paths = [f["path"] for f in seed["files"]]
        self.assertEqual(len(paths), len(set(paths)))
        self.assertIn(DECISIONS_FILE, paths)
        readme = next(f["contents"] for f in seed["files"] if f["path"] == "README.md")
        self.assertIn(_drafts_in(seed)[0]["path"], readme)

    def test_drafts_never_hint_at_their_flaws(self):
        for family, entry in DRAFTS.items():
            with self.subTest(family=family):
                self.assertIsNone(_HINT_RE.search(entry["contents"]), _HINT_RE.search(entry["contents"]))

    def test_unknown_family_falls_back_to_a_curated_draft(self):
        self.assertEqual(draft_for("not_a_family")["path"], draft_for("general_professional")["path"])
        self.assertEqual(draft_for("devops_sre")["path"], draft_for("software_engineering")["path"])


class LlmPathDraftTest(unittest.TestCase):
    ROLE = RoleSpec(title="Backend", role_family="software_engineering")

    def test_llm_canaries_kept_and_one_draft_added(self):
        payload = {
            "files": [{"path": "src/app.py", "contents": "RATE = 0.19\n"}],
            "canaries": [{"id": "c1", "kind": "wrong_constant", "path": "src/app.py", "flaw": "'RATE = 0.19'"}],
        }
        seed = _coerce(payload, CASE, self.ROLE)
        self.assertEqual(len(_drafts_in(seed)), 1)
        ids = [c["id"] for c in seed["canaries"]]
        self.assertIn("c1", ids)
        self.assertEqual(len(ids), len(set(ids)))
        draft_path = draft_for("software_engineering")["path"]
        self.assertEqual(
            {c["id"] for c in seed["canaries"] if c["path"] == draft_path},
            {c["id"] for c in draft_for("software_engineering")["canaries"]},
        )

    def test_llm_file_at_the_draft_path_is_replaced_and_caps_hold(self):
        draft_path = draft_for("software_engineering")["path"]
        payload = {
            "files": [{"path": draft_path, "contents": "model copy"}]
            + [{"path": f"f{i}.md", "contents": "y"} for i in range(MAX_SEED_FILES + 3)],
        }
        seed = _coerce(payload, CASE, self.ROLE)
        self.assertLessEqual(len(seed["files"]), MAX_SEED_FILES)
        self.assertEqual(len(_drafts_in(seed)), 1)
        self.assertEqual([f["path"] for f in seed["files"]].count(draft_path), 1)
        self.assertIn(DECISIONS_FILE, [f["path"] for f in seed["files"]])


class ObservedCastDraftTest(unittest.TestCase):
    """The scope's verify line, on the observed (Live Work Surface) cast."""

    @classmethod
    def setUpClass(cls):
        cls.scenarios = generate_submissions(48, path="observed")

    def _draft_outcomes(self, scn) -> list[dict]:
        draft_path = draft_for("software_engineering")["path"]
        out = canary_outcomes(scn.seed, scn.files, scn.chat)
        return [o for o in out if o["path"] == draft_path]

    def _caught_rate(self, behavior: str) -> float:
        rows = [s for s in self.scenarios if s.planted["behavior"] == behavior]
        outcomes = [o for s in rows for o in self._draft_outcomes(s)]
        self.assertTrue(outcomes)
        return 100.0 * sum(o["status"] in ("addressed", "flagged") for o in outcomes) / len(outcomes)

    def test_every_observed_seed_carries_the_draft(self):
        for scn in self.scenarios:
            self.assertEqual(len(_drafts_in(scn.seed)), 1)

    def test_verifiers_catch_and_the_gamer_propagates(self):
        for scn in self.scenarios:
            behavior = scn.planted["behavior"]
            statuses = {o["status"] for o in self._draft_outcomes(scn)}
            if behavior in ("careful_verifier", "ai_then_verify"):
                self.assertTrue(statuses <= {"addressed", "flagged"}, (behavior, statuses))
            elif behavior == "ai_no_verify":
                self.assertEqual(statuses, {"propagated"}, behavior)

    def test_caught_rate_gap_between_verifiers_is_at_most_2(self):
        gap = abs(self._caught_rate("careful_verifier") - self._caught_rate("ai_then_verify"))
        self.assertLessEqual(gap, 2.0)

    def test_ai_use_is_not_rewarded_and_judgment_gap_stays_zero(self):
        f = fairness([run_one(s, None) for s in self.scenarios])
        self.assertEqual(f["status"], "pass")
        self.assertTrue(f["ai_not_rewarded"])
        self.assertEqual(f["margins"]["ai_gap"], 0.0)


if __name__ == "__main__":
    unittest.main()
