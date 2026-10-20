"""One education ladder (challenge-r09 candidate-matching/A).

The candidate level ``university`` is minted from a SCHOOL NAME with no degree
title (taxonomy.classify_education falls through to it exactly when no
phd/master/bachelor term matched). It means "attended, degree not stated", not
"holds less than a bachelor" — yet the matcher used to rank it below ``bachelor``
and hard-knock the candidate out of every bachelor+ role, while a CV naming no
school at all (``unknown``) passed unpenalized. ``pipeline/jobfit/education.py``
now owns both ladders and a three-valued gate; these cases pin:

 * the gate itself (meets / below / uncertain / not_required),
 * ko_filter knocks out only on a MEASURED shortfall,
 * an unstated degree widens the band and is named as an assumption,
 * winnability no longer reports a phantom education loose-gate,
 * the vocabulary has one source (identity by import, never a literal copy),
 * every other KO path is unchanged.
"""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

from pipeline.jobfit import (
    codegen,
    education,
    jobs,
    pipeline as pipeline_mod,
    profile_draft_cli,
    taxonomy,
    transform,
)
from pipeline.jobfit.jobs import Job, JobEntryProfile, JobRequirement
from pipeline.jobfit.matching import (
    KoReason,
    MatchCandidate,
    candidate_assumption_codes,
    ko_filter,
    score_job,
)
from pipeline.jobfit.winnability import assess_winnability

ROOT = Path(__file__).resolve().parents[3]


def _job(**kw) -> Job:
    base = dict(
        id="job-1", title="Backend Engineer", company="Acme", location="Prague",
        requirements=[JobRequirement(skill="python")],
    )
    base.update(kw)
    return Job(**base)


def _cand(**kw) -> MatchCandidate:
    kw.setdefault("skills", ["python"])
    return MatchCandidate(**kw)


class EducationGateTest(unittest.TestCase):
    def test_gate_is_three_valued_over_the_two_ladders(self) -> None:
        g = education.education_gate
        self.assertEqual(g("university", "bachelor"), "uncertain")
        self.assertEqual(g("university", "master"), "uncertain")
        self.assertEqual(g("university", "phd"), "uncertain")
        self.assertEqual(g("university", "university"), "meets")
        self.assertEqual(g("university", "high_school"), "meets")
        self.assertEqual(g("high_school", "bachelor"), "below")
        self.assertEqual(g("bachelor", "master"), "below")
        self.assertEqual(g("master", "bachelor"), "meets")
        self.assertEqual(g("bachelor", "university"), "meets")
        self.assertEqual(g("unknown", "phd"), "uncertain")
        self.assertEqual(g("bachelor", "none"), "not_required")
        self.assertEqual(g("bachelor", None), "not_required")
        self.assertEqual(g("bachelor", ""), "not_required")
        # A level nobody modelled is not evidence of a shortfall either.
        self.assertEqual(g("diploma??", "bachelor"), "uncertain")


class KoFilterEducationTest(unittest.TestCase):
    def test_unstated_degree_is_not_knocked_out(self) -> None:
        self.assertEqual(
            ko_filter(_cand(education_level="university"), _job(min_education="bachelor")),
            (True, []),
        )

    def test_measured_shortfall_still_knocks_out(self) -> None:
        passed, reasons = ko_filter(_cand(education_level="high_school"), _job(min_education="bachelor"))
        self.assertFalse(passed)
        self.assertEqual(reasons, [KoReason(key="education", detail="below minimum education (bachelor)")])


class UnstatedDegreeIsNamedTest(unittest.TestCase):
    def test_band_driver_and_assumption_for_unstated_degree(self) -> None:
        cand = _cand(education_level="university", languages=["English"])
        res = score_job(cand, _job(min_education="bachelor"))
        self.assertIn("eduDegreeUnstated", [c.code for c in res.confidence.driver_codes])
        self.assertIn("eduDegreeUnstated", [c.code for c in candidate_assumption_codes(cand)])

    def test_a_stated_degree_carries_neither(self) -> None:
        cand = _cand(education_level="bachelor", languages=["English"])
        res = score_job(cand, _job(min_education="bachelor"))
        self.assertNotIn("eduDegreeUnstated", [c.code for c in res.confidence.driver_codes])
        self.assertNotIn("eduDegreeUnstated", [c.code for c in candidate_assumption_codes(cand)])

    def test_the_four_catalogs_carry_both_codes(self) -> None:
        for locale in ("en", "cs", "de", "fr"):
            cat = json.loads((ROOT / "messages" / f"{locale}.json").read_text(encoding="utf-8"))
            self.assertTrue(cat["match"]["drivers"].get("eduDegreeUnstated"), locale)
            self.assertTrue(cat["match"]["assumptions"].get("eduDegreeUnstated"), locale)


class WinnabilityEducationTest(unittest.TestCase):
    def test_unstated_degree_is_eligible_and_raises_no_education_gate(self) -> None:
        pool = [
            MatchCandidate(label="school-named", skills=["python"], education_level="university",
                           provenance_default="professional"),
            MatchCandidate(label="degree", skills=["python"], education_level="bachelor",
                           provenance_default="professional"),
        ]
        out = assess_winnability(pool, _job(min_education="bachelor"))
        self.assertEqual(out["eligible"], 2)
        self.assertEqual([g for g in out["looseGates"] if g["kind"] == "education"], [])


class SingleSourcedVocabularyTest(unittest.TestCase):
    def test_python_consumers_import_the_ladders(self) -> None:
        self.assertIs(jobs.EDU_LEVELS, education.JOB_MIN_LEVELS)
        self.assertIs(taxonomy._EDUCATION_PRIORITY, education.CLASSIFY_PRIORITY)
        self.assertIs(transform.EDU_FOUNDATION, education.FOUNDATION_WEIGHTS)
        self.assertEqual(set(transform.EDU_FOUNDATION), set(education.CLASSIFY_PRIORITY))
        self.assertEqual(profile_draft_cli._EDU_LEVELS, frozenset(education.CANDIDATE_LEVELS))
        self.assertEqual(pipeline_mod._CANDIDATE_EDU_CHOICES, frozenset(education.CANDIDATE_LEVELS))

    def test_no_hand_copied_list_survives_in_the_consumers(self) -> None:
        # The literal the lists used to be; a re-typed copy is how the two
        # memberships drifted apart in the first place.
        copy = re.compile(r"""["']phd["']\s*,\s*["']master["']""")
        for mod in ("jobs.py", "taxonomy.py", "transform.py", "profile_draft_cli.py", "pipeline.py", "matching.py"):
            src = (ROOT / "pipeline" / "jobfit" / mod).read_text(encoding="utf-8")
            self.assertIsNone(copy.search(src), f"{mod} re-types the education ladder")

    def test_ts_editor_options_are_generated(self) -> None:
        rendered = codegen.render_taxonomy()
        want = "export const CANDIDATE_EDUCATION_LEVELS = [\n" + "".join(
            f"  {json.dumps(v)},\n" for v in education.CANDIDATE_LEVELS
        ) + "];"
        self.assertIn(want, rendered)
        self.assertEqual(codegen.TAXONOMY_OUTPUT.read_text(encoding="utf-8"), rendered)
        types_src = (ROOT / "app" / "features" / "shared" / "profileTypes.ts").read_text(encoding="utf-8")
        self.assertRegex(types_src, r"CANDIDATE_EDUCATION_LEVELS as EDU_LEVELS")
        self.assertNotRegex(types_src, r"EDU_LEVELS\s*=\s*\[")


_ENTRY = JobEntryProfile(is_entry_eligible=True, graduate_friendliness=0.9)

# Golden KoReason lists recorded on base 11ee55111 (before the education gate
# moved). Each fixture exercises a non-education gate; the lists must not move.
_OTHER_KO_FIXTURES = [
    ("language_missing",
     _cand(languages=["English"]), _job(languages=["German"]),
     [KoReason(key="language", detail="missing required language (German)")]),
    ("language_skipped_when_none_listed",
     _cand(languages=[]), _job(languages=["German"]), []),
    ("language_alias_at_blob_end",
     _cand(languages=["Czech", "EN"]), _job(languages=["English"]), []),
    ("seniority_gap",
     _cand(seniority="junior"), _job(seniority="senior"),
     [KoReason(key="seniority", detail="seniority gap (junior candidate vs senior role)")]),
    ("seniority_gap_waived_for_entry_role",
     _cand(seniority="junior"), _job(seniority="senior", entry_profile=_ENTRY), []),
    ("unclassified_archetype_never_seniority_gated",
     _cand(seniority="junior", archetype="unknown"), _job(seniority="lead"), []),
    ("early_career_closed_role",
     _cand(archetype="student"), _job(seniority="junior"),
     [KoReason(key="early_career", detail="role not open to early-career")]),
    ("early_career_open_role",
     _cand(archetype="student"), _job(seniority="junior", entry_profile=_ENTRY), []),
    ("work_mode_not_preferred",
     _cand(preferred_work_modes=["remote"]), _job(work_mode="onsite"),
     [KoReason(key="work_mode", detail="work mode onsite not preferred")]),
    ("work_mode_defaulted_is_no_gate",
     _cand(preferred_work_modes=["remote"]), _job(work_mode="onsite", defaulted_fields=["work_mode"]), []),
    ("all_gates_with_measured_education",
     _cand(seniority="junior", languages=["English"], preferred_work_modes=["remote"], education_level="bachelor"),
     _job(seniority="senior", languages=["German"], work_mode="onsite", min_education="master"),
     [
         KoReason(key="seniority", detail="seniority gap (junior candidate vs senior role)"),
         KoReason(key="education", detail="below minimum education (master)"),
         KoReason(key="language", detail="missing required language (German)"),
         KoReason(key="work_mode", detail="work mode onsite not preferred"),
     ]),
]


class OtherKoPathsUnchangedTest(unittest.TestCase):
    def test_every_other_ko_path_is_byte_identical(self) -> None:
        for name, cand, job, want in _OTHER_KO_FIXTURES:
            with self.subTest(name):
                passed, reasons = ko_filter(cand, job)
                self.assertEqual(reasons, want)
                self.assertEqual(passed, not want)
                self.assertEqual(
                    json.dumps([r.model_dump() for r in reasons]),
                    json.dumps([r.model_dump() for r in want]),
                )


if __name__ == "__main__":
    unittest.main()
