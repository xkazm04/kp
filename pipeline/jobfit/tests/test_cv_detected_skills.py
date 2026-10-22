"""An uploaded CV counts in the keyless match (CX S41).

The apply intake files the CV text as one ``kind: "cv"`` evidence block carrying
the TYPED skills; the rule-based matcher reads only ``skills`` lists. These tests
pin the deterministic fold that reads the CV text with the taxonomy detector and
adds what it finds beside the typed skills — separately filed, provenance-carrying,
capped, idempotent — and that the result reaches the MatchCandidate.
"""

from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from pipeline.jobfit import profile_cli
from pipeline.jobfit.profile import (
    CV_DETECTED_TITLE,
    CandidateProfileV2,
    fold_cv_detected_skills,
)
from pipeline.jobfit.transform import build_match_candidate

CV_TEXT = "Five years running PostgreSQL and operating Kubernetes clusters."


def _intake(cv_text: str, typed: list[str]) -> CandidateProfileV2:
    # The shape app/_lib/apply-intake.ts buildIntakeProfile produces.
    evidence = []
    if cv_text:
        evidence.append({"kind": "cv", "title": "CV (uploaded at application)", "text": cv_text, "skills": typed})
    evidence.append({"kind": "project", "title": "Recent experience (from application)", "text": "—", "skills": typed})
    return CandidateProfileV2.model_validate({"displayName": "A", "evidence": evidence})


def _cv_block(profile: CandidateProfileV2):
    return [ev for ev in profile.evidence if ev.title == CV_DETECTED_TITLE]


class FoldCvDetectedSkillsTest(unittest.TestCase):
    def test_cv_skills_ride_beside_typed_with_provenance(self) -> None:
        profile = _intake(CV_TEXT, ["Python"])
        added = fold_cv_detected_skills(profile)
        self.assertEqual({s.casefold() for s in added}, {"postgresql", "kubernetes"})
        self.assertEqual(added, ["PostgreSQL", "Kubernetes"])  # the CV's own casing

        block = _cv_block(profile)
        self.assertEqual(len(block), 1)
        self.assertEqual(block[0].kind, "cv")
        # Provenance is the CV block's own resolution, not a new rung.
        self.assertEqual(block[0].provenance, profile.evidence[0].resolved_provenance())
        # Typed skills are untouched on their own blocks.
        self.assertEqual(profile.evidence[0].skills, ["Python"])
        self.assertEqual(profile.evidence[1].skills, ["Python"])

        cand = build_match_candidate(profile)
        self.assertEqual({s.casefold() for s in cand.skills}, {"python", "postgresql", "kubernetes"})
        # Python keeps the typed project provenance; read skills carry the CV's.
        self.assertEqual(cand.skill_provenance["Python"], "personal_project")
        self.assertEqual(cand.skill_provenance["PostgreSQL"], block[0].provenance)

    def test_typed_skill_is_not_duplicated_by_an_alias_in_the_cv(self) -> None:
        profile = _intake("We deploy on k8s and Postgres.", ["Kubernetes"])
        added = fold_cv_detected_skills(profile)
        self.assertEqual([s.casefold() for s in added], ["postgres"])

    def test_empty_cv_changes_nothing(self) -> None:
        for cv_text in ("", "   "):
            profile = _intake(cv_text, ["Python"])
            before = profile.model_dump()
            self.assertEqual(fold_cv_detected_skills(profile), [])
            self.assertEqual(profile.model_dump(), before)

    def test_skills_outside_the_cv_block_are_not_read(self) -> None:
        profile = CandidateProfileV2.model_validate(
            {"evidence": [{"kind": "project", "title": "p", "text": CV_TEXT, "skills": ["Python"]}]}
        )
        self.assertEqual(fold_cv_detected_skills(profile), [])
        self.assertEqual(len(profile.evidence), 1)

    def test_a_gendered_cv_line_reads_the_same_skills(self) -> None:
        m = _intake("Pracoval jako vývojář, PostgreSQL.", [])
        f = _intake("Pracovala jako vývojářka, PostgreSQL.", [])
        self.assertEqual(fold_cv_detected_skills(m), fold_cv_detected_skills(f))

    def test_typed_skills_do_not_eat_the_cap(self) -> None:
        profile = _intake("Python, Java, PostgreSQL", ["Python", "Java"])
        self.assertEqual(fold_cv_detected_skills(profile, limit=1), ["PostgreSQL"])

    def test_cap_holds(self) -> None:
        cv = "Python, Java, Go, Rust, PostgreSQL, Kubernetes, Docker, Terraform, React, Angular, Kafka, Redis"
        profile = _intake(cv, [])
        added = fold_cv_detected_skills(profile, limit=3)
        self.assertEqual(len(added), 3)
        self.assertEqual(len(_cv_block(profile)[0].skills), 3)

    def test_refold_is_idempotent(self) -> None:
        profile = _intake(CV_TEXT, ["Python"])
        first = fold_cv_detected_skills(profile)
        second = fold_cv_detected_skills(profile)
        self.assertEqual(first, second)
        self.assertEqual(len(_cv_block(profile)), 1)


class ProfileCliFoldsCvTest(unittest.TestCase):
    def test_cli_output_carries_the_read_block(self) -> None:
        draft = {"profile": _intake(CV_TEXT, ["Python"]).model_dump(by_alias=True), "signals": {}}
        out = io.StringIO()
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "intake.json"
            path.write_text(json.dumps(draft), encoding="utf-8")
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
                code = profile_cli.main(["--input-json", str(path)])
        self.assertEqual(code, 0)
        payload = json.loads([ln for ln in out.getvalue().splitlines() if ln.strip()][-1])
        read = [ev for ev in payload["profile"]["evidence"] if ev.get("title") == CV_DETECTED_TITLE]
        self.assertEqual(len(read), 1)
        self.assertEqual(read[0]["skills"], ["PostgreSQL", "Kubernetes"])


if __name__ == "__main__":
    unittest.main()
