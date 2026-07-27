"""Name / gender-proxy neutrality of the deterministic scoring path (EU AI Act).

Annex-III high-risk recruitment invariant: the applicant's NAME must not be able
to influence any score. The name is the strongest proxy for gender (Czech -ová
surnames), ethnicity, and migration background, and the product's own blind-mode
threat model (redact.py) treats it as protected — yet until this test nothing
asserted the deterministic engine actually ignores it (docs/harness/
ambiguity-biz-2026-06-25/pipeline-test-suite-python.md, finding #2; AI-Act pack
gaps G3+G10 in docs/AI_ACT_CONFORMITY.md).

Mechanism under test: ``profile.display_name`` survives the transform as
``MatchCandidate.label`` (transform.py — ``label=profile.display_name or
"Candidate"``), i.e. unlike ``education_detail`` the name is NOT dropped before
matching. It must therefore remain display-only: ``match()`` may echo it back in
the ``candidate.label`` block, but no score, tier, breakdown, confidence band,
ranking, or KO decision may differ between two candidates who differ ONLY in
name.

The assertion is BYTE-identity of the full serialized ``MatchResponse`` (with
the one sanctioned display carrier, ``candidate.label``, removed) across a
perturbation set chosen for the Czech labor market's known discrimination axes:
Czech male vs Czech female (incl. the gender-marking -ová surname), Vietnamese,
Ukrainian, Arabic, and Roma-associated names. Exact equality, not a tolerance:
any non-zero delta IS the bug (same reasoning as the pedigree probe's ``== 0``).

No API key, no LLM — this pins the deterministic engine only. The LLM reasoning
layer (Gemini prompts that DO see the label) is covered by the blind-mode /
redaction path, not here.
"""

from __future__ import annotations

import json
import unittest
from typing import Any

from pipeline.jobfit.matching import MatchCandidate, load_corpus, match
from pipeline.jobfit.profile import CandidateProfileV2, Evidence, SkillClaim
from pipeline.jobfit.transform import build_match_candidate

# The baseline uses a name-shaped placeholder (not None) so the comparison is
# name-vs-name, not name-vs-missing-field: a hypothetical "any label present"
# branch would fire identically on both sides and only a name-VALUE dependence
# can produce a diff.
BASELINE_NAME = "Alex Smith"

# Perturbation set — one axis per entry, per the Czech-market discrimination
# evidence the harness finding cites. Given names are the gender proxy; the
# -ová surname is an explicit grammatical gender marker; Horváth/Lakatošová and
# the given names Gejza/Květoslava are strongly Roma-associated in CZ/SK.
NAME_VARIANTS: dict[str, str] = {
    "czech_male": "Jiří Novák",
    "czech_female_ova": "Jana Nováková",
    "vietnamese": "Nguyễn Thị Thu Hà",
    "ukrainian": "Oleksandra Shevchenko",
    "arabic": "Ahmed Al-Farsi",
    "roma_associated": "Gejza Horváth",
    "roma_associated_female": "Květoslava Lakatošová",
}

# MatchCandidate fields that are ALLOWED to carry the name because they are
# display/reasoning context, never a deterministic score input:
#   label                 — the sanctioned display carrier (asserted echoed only)
#   experience_highlights — CV excerpts for the LLM reasoning layer (Layer C)
#   work_links            — URLs for the reasoning layer
# Everything else feeds (or may feed) score_job/ko_filter and must be name-free.
_DISPLAY_ONLY_FIELDS = {"label", "experience_highlights", "work_links"}


def _profile(display_name: str, *, name_in_cv_text: bool = False) -> CandidateProfileV2:
    """A fixed early-career profile exercising every scored surface: skills with
    provenance, evidence (thesis/internship/project), education, languages and
    aspirations (the score_personal text-overlap path). Only the name varies."""
    name_line = f"{display_name} — personal portfolio site" if name_in_cv_text else "Personal portfolio site"
    return CandidateProfileV2(
        display_name=display_name,
        archetype="student",
        role_family="software_engineering",
        education_level="bachelor",
        education_detail="Computer Science, ČVUT FEL",
        languages=["Czech", "English"],
        aspirations=["Junior frontend developer"],
        skill_claims=[
            SkillClaim(skill="React"),
            SkillClaim(skill="JavaScript"),
            SkillClaim(skill="Git"),
            SkillClaim(skill="TypeScript", provenance="coursework"),
        ],
        evidence=[
            Evidence(
                kind="thesis",
                title="Recommender web app",
                text=f"Built by {display_name} as a bachelor thesis" if name_in_cv_text else "Bachelor thesis project",
                skills=["React", "TypeScript", "REST API"],
                link="http://example.test/thesis",
            ),
            Evidence(kind="internship", title="FE intern", skills=["JavaScript", "CSS"]),
            Evidence(kind="project", title=name_line, skills=["HTML"], link="http://example.test/portfolio"),
        ],
    )


def _score_payload(profile: CandidateProfileV2, jobs: list[Any]) -> tuple[bytes, str]:
    """Full match response, serialized canonically, with the ONE sanctioned
    display carrier (candidate.label) removed. Returns (bytes, echoed_label)."""
    resp = match(build_match_candidate(profile), jobs, limit=25)
    payload = resp.model_dump()
    label = payload["candidate"].pop("label")
    return json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8"), label


def _scored_surface(candidate: MatchCandidate) -> str:
    """Serialize every MatchCandidate field that can reach the scorer (i.e. all
    but the display-only carriers), for the structural token-absence check."""
    data = candidate.model_dump()
    for f in _DISPLAY_ONLY_FIELDS:
        data.pop(f)
    return json.dumps(data, ensure_ascii=False, sort_keys=True)


class NameNeutralityTest(unittest.TestCase):
    """The applicant's name cannot influence the deterministic score — exactly."""

    jobs: list[Any]
    baseline: bytes

    @classmethod
    def setUpClass(cls) -> None:
        cls.jobs = load_corpus()
        cls.baseline, _ = _score_payload(_profile(BASELINE_NAME), cls.jobs)

    def test_corpus_is_nonempty(self) -> None:
        # A 0-job corpus would make every payload trivially identical (green
        # theater); the neutrality claim is only evidence if real matches ran.
        self.assertGreater(len(self.jobs), 0, "job corpus empty — neutrality run is vacuous")
        self.assertIn(b'"matches": [{', b" ".join(self.baseline.split()))

    def test_name_never_moves_any_score(self) -> None:
        # Byte-identity of the ENTIRE response (scores, tiers, breakdowns,
        # confidence bands, ranking order, KO meta) across the perturbation set.
        for axis, name in NAME_VARIANTS.items():
            with self.subTest(axis=axis, name=name):
                payload, label = _score_payload(_profile(name), self.jobs)
                self.assertEqual(label, name)  # display carrier still works
                self.assertEqual(
                    payload,
                    self.baseline,
                    f"NAME INFLUENCED THE SCORE PAYLOAD for {axis} ({name}) — "
                    "a gender/ethnic proxy reached the deterministic scoring path",
                )

    def test_gendered_surname_pair_scores_identically(self) -> None:
        # The single most sensitive pair spelled out on its own: the -ová
        # surname is a deterministic gender marker, so Novák vs Nováková is the
        # purest gender-proxy perturbation available in Czech.
        male, _ = _score_payload(_profile(NAME_VARIANTS["czech_male"]), self.jobs)
        female, _ = _score_payload(_profile(NAME_VARIANTS["czech_female_ova"]), self.jobs)
        self.assertEqual(male, female, "gendered surname moved the score payload")

    def test_name_absent_from_every_scored_field(self) -> None:
        # Structural invariant (the pedigree-probe pattern): a distinctive name
        # token must not appear in ANY MatchCandidate field the scorer can read.
        # This catches a future refactor that folds the label into a scored
        # text feature even before it produces a measurable delta.
        sentinel = "Zzneutralitynamezz"
        candidate = build_match_candidate(_profile(f"{sentinel} Uniqueson"))
        surface = _scored_surface(candidate).casefold()
        self.assertNotIn(sentinel.casefold(), surface, "name token leaked into a scored field")
        # ...and the sanctioned carrier really does carry it (the test is live).
        self.assertIn(sentinel, candidate.label)

    def test_name_in_cv_text_does_not_move_scores(self) -> None:
        # Raw CV text (evidence title/text) legitimately contains the name on a
        # real CV. It feeds experience_highlights — reasoning-layer display, not
        # a scored feature — so the score payload must stay byte-identical when
        # the name appears inside the evidence text too.
        with_name, _ = _score_payload(
            _profile(NAME_VARIANTS["czech_female_ova"], name_in_cv_text=True), self.jobs
        )
        other_name, _ = _score_payload(
            _profile(NAME_VARIANTS["vietnamese"], name_in_cv_text=True), self.jobs
        )
        self.assertEqual(with_name, self.baseline, "name inside CV text moved the score payload")
        self.assertEqual(other_name, self.baseline, "name inside CV text moved the score payload")

    def test_name_in_cv_text_reaches_only_display_fields(self) -> None:
        # The name-in-text variant DOES flow into the highlights (expected: the
        # reasoning layer cites real CV lines) but never into a scored field.
        sentinel = "Zzcvtextnamezz"
        candidate = build_match_candidate(_profile(f"{sentinel} Person", name_in_cv_text=True))
        self.assertNotIn(sentinel.casefold(), _scored_surface(candidate).casefold())
        self.assertTrue(
            any(sentinel in h for h in candidate.experience_highlights),
            "fixture stopped putting the name into the CV text — the probe went dark",
        )


if __name__ == "__main__":
    unittest.main()
