"""Guard the automation constants that are hand-mirrored into TypeScript.

Three numbers in this package say "MUST match the TS side" in a COMMENT and
nothing more, while the rubric set beside them is single-sourced from JSON and
the fit floors are pinned by ``test_fit_threshold_sync.py``. A comment is not a
gate: move one side alone and the two languages silently disagree.

  * ``automation.MAX_SCORECARD_NOTES_CHARS`` vs ``MAX_SCORECARD_NOTES_CHARS`` in
    ``app/_lib/interview-transcript.ts`` — the transcript budget handed to the
    scorecard prompt. The TS side samples FIRST, so if TS grows past Python's
    limit every TS-produced note is re-sampled here (double elision, the closing
    read-back cut twice); if TS shrinks below it, Python's own sampling never
    fires for a TS caller and the guarantee that the elision announces itself
    stops being checked on the path that actually runs.
  * ``calibration_drift.MIN_CALIBRATION_OUTCOMES`` and
    ``CALIBRATION_BIN_COUNT`` vs ``app/_lib/calibration.ts`` — the drift alarm
    consumes payloads the TS engine emits verbatim. A bin-count disagreement
    makes the PSI comparison read bins that describe different score ranges (no
    error, just a wrong number); a min-outcomes disagreement makes Python call
    "drift" on a window TS itself considers uncalibrated, i.e. an alarm computed
    on noise — the exact honesty failure calibration_drift's docstring forbids.

The TS side no longer carries these numbers as literals: ``pipeline/jobfit/codegen.py``
(``CONTRACT_CONSTANTS``) renders them from Python into
``app/_lib/contract-constants.generated.ts`` and each TS module below re-exports the
generated name. So this file pins the DOOR, not a regex over TS literals: every
mirrored name is a codegen row bound to the Python value here, the committed
generated file declares that value, and the TS module re-exports it and types no
number of its own. The behavioural probes below keep the Python side honest — each
number must still be the one the Python code actually reads.
"""

from __future__ import annotations

import inspect
import unittest
from pathlib import Path

from pipeline.jobfit import automation, calibration_drift, codegen
from pipeline.jobfit.tests.test_codegen_contract_constants import home_problems

REPO_ROOT = Path(__file__).resolve().parents[3]
TRANSCRIPT_TS = REPO_ROOT / "app" / "_lib" / "interview-transcript.ts"
CALIBRATION_TS = REPO_ROOT / "app" / "_lib" / "calibration.ts"
CACHE_KEY_TS = REPO_ROOT / "app" / "_lib" / "automation-cache-key.ts"
INTERVIEW_KIT_TS = REPO_ROOT / "app" / "_lib" / "interview-kit-types.ts"
INTERVIEW_LETTER_TS = REPO_ROOT / "app" / "_lib" / "interview-letter-types.ts"

# TS file -> {TS constant: the Python value it must equal}. Explicit so the map
# itself is checkable (see test_the_map_names_live_python_constants).
MIRRORED: dict[Path, dict[str, int]] = {
    TRANSCRIPT_TS: {"MAX_SCORECARD_NOTES_CHARS": automation.MAX_SCORECARD_NOTES_CHARS},
    # The screening VOLUME tier boundaries. Python tiers on them (POLICY /
    # screening_volume_tier) and TS BUCKETS the cache key on them — if the two
    # disagreed, one cache bucket would span two strictness rules and a lenient
    # verdict computed in a sparse pipeline would be served to a strict, dense one.
    CACHE_KEY_TS: {
        "SCREEN_VOLUME_SPARSE_MAX": automation.POLICY["screen_volume_sparse_max"],
        "SCREEN_VOLUME_MODERATE_MAX": automation.POLICY["screen_volume_moderate_max"],
    },
    CALIBRATION_TS: {
        "MIN_CALIBRATION_OUTCOMES": calibration_drift.MIN_CALIBRATION_OUTCOMES,
        "CALIBRATION_BIN_COUNT": calibration_drift.CALIBRATION_BIN_COUNT,
    },
    # The job interview kit's collection caps. TS is the ENFORCING side (the normalizer
    # truncates over-cap input before a kit is stored); the generator repeats them so it
    # stops short of the cap instead of paying for work the store then trims. If Python
    # grew past TS, a generated kit would be silently cut; if it shrank below, the prompt
    # would ask for less than the product allows and nobody would know why.
    INTERVIEW_KIT_TS: {
        "KIT_MAX_COMPETENCIES": automation.KIT_MAX_COMPETENCIES,
        "KIT_MAX_QUESTIONS_PER_COMPETENCY": automation.KIT_MAX_QUESTIONS_PER_COMPETENCY,
        "KIT_MAX_MUST_ASKS": automation.KIT_MAX_MUST_ASKS,
        "KIT_MAX_FAQ": automation.KIT_MAX_FAQ,
    },
    # The feedback letter's length cap. TS is the ENFORCING side (the store refuses a text
    # over it at every write); the generator DISCARDS a draft over it rather than handing the
    # store a letter it would refuse. If Python grew past TS, a model draft would pass here
    # and fail the store write; if it shrank below, drafts the product accepts would be
    # thrown away for no stated reason.
    INTERVIEW_LETTER_TS: {"LETTER_MAX_CHARS": automation.LETTER_MAX_CHARS},
}


class AutomationConstantSyncTest(unittest.TestCase):
    def setUp(self) -> None:
        self.sources: dict[Path, str] = {}
        for path in MIRRORED:
            self.assertTrue(path.exists(), f"missing {path}")
            self.sources[path] = path.read_text(encoding="utf-8")

    def test_every_mirrored_constant_matches_the_python_value(self) -> None:
        rows = {row.ts_name: row for row in codegen.CONTRACT_CONSTANTS}
        generated = codegen.CONTRACT_OUTPUT.read_text(encoding="utf-8")
        for path, pairs in MIRRORED.items():
            for name, python_value in pairs.items():
                with self.subTest(ts=path.name, constant=name):
                    self.assertIn(name, rows, f"{name} is not a codegen CONTRACT_CONSTANTS row")
                    self.assertEqual(rows[name].ts_home, path.name, f"{name}'s codegen row names another TS home")
                    self.assertEqual(
                        codegen.resolve_contract_constant(rows[name]),
                        python_value,
                        f"codegen reads {name} from {rows[name].source()}, not from the Python value this map pins",
                    )
                    self.assertIn(
                        f"\nexport const {name} = {python_value};\n",
                        generated,
                        f"{codegen.CONTRACT_OUTPUT.name} is stale for {name} — run `python -m pipeline.jobfit.codegen`",
                    )
                    self.assertEqual(home_problems(self.sources[path], name), [])

    def test_the_map_names_live_python_constants(self) -> None:
        # A rename on the Python side must not quietly leave the map checking a
        # value nothing reads any more.
        self.assertEqual(
            inspect.signature(automation.sample_scorecard_notes).parameters["limit"].default,
            automation.MAX_SCORECARD_NOTES_CHARS,
            "sample_scorecard_notes no longer defaults to the mirrored budget",
        )
        self.assertEqual(
            len(calibration_drift.compute_calibration([{"score": 50, "outcome": 1}] * 25)["bins"]),
            calibration_drift.CALIBRATION_BIN_COUNT,
            "compute_calibration no longer emits CALIBRATION_BIN_COUNT bins",
        )
        # The volume thresholds must still be the ones the tier function reads — a
        # rename in POLICY would otherwise leave this map checking a dead key.
        self.assertEqual(
            automation.screening_volume_tier(automation.POLICY["screen_volume_sparse_max"]), "sparse"
        )
        self.assertEqual(
            automation.screening_volume_tier(automation.POLICY["screen_volume_sparse_max"] + 1), "moderate"
        )
        self.assertEqual(
            automation.screening_volume_tier(automation.POLICY["screen_volume_moderate_max"] + 1), "dense"
        )
        # The kit caps must still be the ones interview_kit's coercer reads: feed it more
        # of everything than the caps allow and it must come back AT the caps.
        from pipeline.jobfit.jobs import Job

        class _Echo:
            def complete_json(self, prompt, system=None, expected_keys=None):
                many_q = [{"text": f"Q{i}?", "mustAsk": True} for i in range(automation.KIT_MAX_QUESTIONS_PER_COMPETENCY + 3)]
                return {
                    "competencies": [
                        {"title": f"C{i}", "weight": 2, "budgetMin": 10, "questions": many_q}
                        for i in range(automation.KIT_MAX_COMPETENCIES + 3)
                    ],
                    "faq": [{"question": f"F{i}?", "answer": "A."} for i in range(automation.KIT_MAX_FAQ + 3)],
                }

        job = Job.model_validate({"id": "j", "title": "Role", "company": "", "location": ""})
        kit, _ = automation.interview_kit(job, None, provider=_Echo())
        self.assertEqual(len(kit["competencies"]), automation.KIT_MAX_COMPETENCIES)
        self.assertEqual(len(kit["competencies"][0]["questions"]), automation.KIT_MAX_QUESTIONS_PER_COMPETENCY)
        self.assertEqual(len(kit["faq"]), automation.KIT_MAX_FAQ)
        self.assertEqual(
            sum(q["mustAsk"] for c in kit["competencies"] for q in c["questions"]), automation.KIT_MAX_MUST_ASKS
        )

    def test_extractor_rejects_a_documented_value(self) -> None:
        # The mutation guard for the guard: a literal that appears ONLY in a comment
        # does not count against a home, and a real hand-typed declaration does.
        reexport = 'export { MAX_SCORECARD_NOTES_CHARS } from "./contract-constants.generated";\n'
        documented = "// export const MAX_SCORECARD_NOTES_CHARS = 1;\n" + reexport
        self.assertEqual(home_problems(documented, "MAX_SCORECARD_NOTES_CHARS"), [])
        self.assertNotEqual(home_problems("export const MAX_SCORECARD_NOTES_CHARS = 7;\n", "MAX_SCORECARD_NOTES_CHARS"), [])


if __name__ == "__main__":
    unittest.main()
