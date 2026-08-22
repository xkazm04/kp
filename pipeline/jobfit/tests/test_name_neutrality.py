"""Name / gender-proxy neutrality of the deterministic scoring path (EU AI Act).

Annex-III high-risk recruitment invariant: the applicant's NAME must not be able
to influence any score. The name is the strongest proxy for gender (Czech -ová
surnames), ethnicity, and migration background, and the product's own blind-mode
threat model (redact.py) treats it as protected — yet until this test nothing
asserted the deterministic engine actually ignores it (fairness scan, 
ambiguity-biz-2026-06-25/pipeline-test-suite-python.md, finding #2; AI-Act pack
gaps G3+G10 in docs/features/compliance/ai-act-conformity.md).

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

import copy
import json
import unittest
from pathlib import Path
from typing import Any
from unittest import mock

import pipeline.jobfit.pipeline as P
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


# ---------------------------------------------------------------------------
# Layer 2: the CV-ANALYSIS engine (pipeline.analyze_cv)
#
# The matching guard above pins ``match()``. It cannot see the OTHER scored
# surface the product ships — the 0-100 headline on the Analyze tab, which
# pipeline automation, auto-reject and the shortlist all read. That score is
# assembled in ``analyze_cv`` from the model payload plus a long deterministic
# post-pass (salary anchoring, soft signals, keyword coverage, evidence trace,
# interview kit, sanity checks, the v2 profile). AUDIT 2026-08-22: a gendered
# penalty planted in that post-pass —
#
#     if (profile.name or "").casefold().endswith("ov\u00e1"):
#         score = score.model_copy(update={"total": max(0, score.total - 7)})
#
# — left every guard in this context GREEN, because nothing here ever called
# ``analyze_cv`` with two different names. The class below closes that: the
# model payload is held byte-constant and ONLY the name varies, so any delta in
# the assembled AnalysisResult is by construction a name dependence.
#
# The LLM's own judgement is still out of scope (it is mitigated by blind mode /
# redact.py) — what is pinned here is that the deterministic Python half never
# re-reads the name.
# ---------------------------------------------------------------------------

# A complete, valid Gemini payload (profile + score + salary) so the whole
# post-Gemini assembly runs; ``{name}`` is substituted only for the
# name-inside-the-CV-text variant.
_CV_RAW_TEXT_TEMPLATE = (
    "{name} is a senior backend engineer with 8 years building Python and Go "
    "services at a fintech. Led a team of four, owned the payments platform, "
    "mentored juniors and shipped the billing rewrite."
) * 2

_CV_PAYLOAD: dict[str, Any] = {
    "profile": {
        "raw_text": "",  # filled per run
        "name": "",  # the perturbed field
        "years_experience": 8,
        "current_seniority": "senior",
        "role_family": "backend",
        "education_level": "master",
        "skills": ["Python", "Go", "Postgres"],
    },
    "score": {
        "experience": 20,
        "skills": 25,
        "role_seniority": 20,
        "education": 10,
        "traits": 8,
        "total": 83,
    },
    "salary": {"minimum": 90000, "maximum": 130000, "currency": "CZK", "period": "month"},
    "strengths": ["Strong backend"],
    "gaps": [],
    "recommendations": [],
    "explanation": "Solid senior backend candidate.",
}

# The ONLY fields of an AnalysisResult that may legitimately differ between two
# runs that differ solely in the applicant's name. Everything else — score,
# salary, job_fit, soft_signals, keyword_coverage, market_evidence,
# evidence_trace, interview_kit, sanity_checks, metadata — must be identical.
_ANALYSIS_NAME_CARRIERS = (
    "candidate.name",
    "soft_signals.display_name",
    "v2_profile.displayName",
)
# Additionally allowed when the name is written INSIDE the CV text: the verbatim
# document text and its length, which are transcription, not judgement.
_ANALYSIS_CV_TEXT_CARRIERS = (
    "candidate.raw_text",
    "extraction_comparison.gemini_text",
    "extraction_comparison.pypdf_text",
    "extraction_quality.gemini_text_length",
    "extraction_quality.pypdf_text_length",
)


def _pop_path(data: dict[str, Any], dotted: str) -> Any:
    """Remove ``a.b.c`` from a nested dict, FAILING if the path is absent.

    Failing loudly matters: if a carrier is renamed, the exclusion list must be
    updated deliberately rather than silently widening to cover a field that no
    longer exists (which would let a real name leak through unexamined).
    """
    node: Any = data
    parts = dotted.split(".")
    for part in parts[:-1]:
        if not isinstance(node, dict) or part not in node:
            raise KeyError(f"carrier path {dotted!r} no longer exists in the AnalysisResult")
        node = node[part]
    if not isinstance(node, dict) or parts[-1] not in node:
        raise KeyError(f"carrier path {dotted!r} no longer exists in the AnalysisResult")
    return node.pop(parts[-1])


def _analysis_payload(
    name: str, *, name_in_cv_text: bool = False, carriers: tuple[str, ...] = _ANALYSIS_NAME_CARRIERS
) -> tuple[bytes, dict[str, Any], Any]:
    """Run analyze_cv over a FIXED model payload whose only variable is the name.

    Returns (canonical bytes with the sanctioned carriers removed, the carrier
    values that were removed, the AnalysisResult itself).
    """
    raw_text = _CV_RAW_TEXT_TEMPLATE.format(name=name if name_in_cv_text else "The candidate")
    payload = copy.deepcopy(_CV_PAYLOAD)
    payload["profile"]["name"] = name
    payload["profile"]["raw_text"] = raw_text
    with mock.patch.object(P, "extract_text", lambda _p: raw_text), mock.patch.object(
        P, "analyze_profile_with_gemini", lambda *a, **k: (payload, [], {})
    ):
        result = P.analyze_cv(Path("fixture.pdf"))
    data = result.model_dump()
    carried = {path: _pop_path(data, path) for path in carriers}
    blob = json.dumps(data, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")
    return blob, carried, result


class AnalyzeCvNameNeutralityTest(unittest.TestCase):
    """The applicant's name cannot influence the CV-analysis result either."""

    baseline: bytes

    @classmethod
    def setUpClass(cls) -> None:
        cls.baseline, _, _ = _analysis_payload(BASELINE_NAME)

    def test_the_analysis_actually_ran(self) -> None:
        # Non-vacuity: an empty/aborted result would make every comparison
        # trivially equal. Assert the expensive surfaces really are present.
        _blob, carried, result = _analysis_payload(BASELINE_NAME)
        self.assertEqual(result.score.total, 83)
        self.assertEqual(result.salary.minimum, 90000)
        self.assertIsNotNone(result.soft_signals)
        self.assertIsNotNone(result.v2_profile)
        # ...and the sanctioned carriers really do carry the name (the probe is live).
        for path, value in carried.items():
            self.assertEqual(value, BASELINE_NAME, f"{path} stopped echoing the name")
        # The compared surface still contains the score/salary blocks.
        self.assertIn(b'"score"', self.baseline)
        self.assertIn(b'"salary"', self.baseline)

    def test_name_never_moves_the_analysis_payload(self) -> None:
        for axis, name in NAME_VARIANTS.items():
            with self.subTest(axis=axis, name=name):
                blob, carried, _ = _analysis_payload(name)
                self.assertEqual(carried["candidate.name"], name)
                self.assertEqual(
                    blob,
                    self.baseline,
                    f"NAME INFLUENCED THE CV-ANALYSIS PAYLOAD for {axis} ({name}) — "
                    "a gender/ethnic proxy reached the analyze_cv assembly",
                )

    def test_gendered_surname_pair_analyses_identically(self) -> None:
        male, _, _ = _analysis_payload(NAME_VARIANTS["czech_male"])
        female, _, _ = _analysis_payload(NAME_VARIANTS["czech_female_ova"])
        self.assertEqual(male, female, "gendered surname moved the CV-analysis payload")

    def test_name_inside_the_cv_text_moves_only_the_transcription(self) -> None:
        """A real CV carries the name in its text. That text is transcribed into
        raw_text / the extraction comparison (allowed) but must not move any
        judgement: score, salary, soft signals, coverage, evidence trace, kit."""
        carriers = _ANALYSIS_NAME_CARRIERS + _ANALYSIS_CV_TEXT_CARRIERS
        baseline, _, _ = _analysis_payload(BASELINE_NAME, name_in_cv_text=True, carriers=carriers)
        for axis, name in NAME_VARIANTS.items():
            with self.subTest(axis=axis, name=name):
                blob, carried, _ = _analysis_payload(
                    name, name_in_cv_text=True, carriers=carriers
                )
                self.assertIn(name, str(carried["candidate.raw_text"]))  # probe is live
                self.assertEqual(
                    blob,
                    baseline,
                    f"a name written INSIDE the CV text moved the analysis for {axis} ({name})",
                )


if __name__ == "__main__":
    unittest.main()
