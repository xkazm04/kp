"""Rec A — the candidate soft-signal panel.

The synthetic ČS seeds are internally consistent (no overclaims, empty archetype
reasons), so these crafted profiles exercise the ANTIPATTERN detectors directly,
plus confirm the hidden-strength detectors and the interview-checklist output.
"""
import unittest

from pipeline.jobfit.devcase.design import design_case
from pipeline.jobfit.devcase.models import DevNeed, NeedAnalysis
from pipeline.jobfit.models import JobFitResult, SoftSignal, SoftSignalPanel
from pipeline.jobfit.profile import CandidateProfileV2, Evidence, SkillClaim
from pipeline.jobfit.soft_signals import (
    ANTIPATTERN,
    STRENGTH,
    build_soft_signal_panel,
    panel_to_probe_briefs,
)


def _keys(signals):
    return {s.key for s in signals}


class TestSoftSignals(unittest.TestCase):
    def test_overclaim_fires_when_strong_skill_uncited(self):
        p = CandidateProfileV2(
            archetype="bau",
            skill_claims=[SkillClaim(skill="Kubernetes", level="strong")],
            evidence=[Evidence(kind="job", title="Backend dev", text="Built REST APIs.", skills=["Python"])],
        )
        panel = build_soft_signal_panel(p)
        self.assertIn("overclaim_risk", _keys(panel.antipatterns))
        sig = next(s for s in panel.antipatterns if s.key == "overclaim_risk")
        self.assertEqual(sig.kind, ANTIPATTERN)
        self.assertTrue(sig.needs_confirmation)
        self.assertEqual(sig.probe_kind, "verification_trap")  # routes to a devcase probe (Rec B)

    def test_no_overclaim_when_skill_is_cited(self):
        p = CandidateProfileV2(
            archetype="bau",
            skill_claims=[SkillClaim(skill="Kubernetes", level="strong")],
            evidence=[Evidence(kind="job", title="SRE", text="Ran k8s clusters.", skills=["Kubernetes"])],
        )
        self.assertNotIn("overclaim_risk", _keys(build_soft_signal_panel(p).antipatterns))

    def test_archetype_contradiction_surfaced(self):
        p = CandidateProfileV2(
            archetype="student",
            archetype_reasons=["contradiction: 3+ years of relevant experience for a 'student'"],
        )
        self.assertIn("archetype_contradiction", _keys(build_soft_signal_panel(p).antipatterns))

    def test_tenure_instability_flags_job_hopping(self):
        p = CandidateProfileV2(
            archetype="bau",
            years_experience=4.0,
            evidence=[Evidence(kind="job", title=f"Role {i}", text="x") for i in range(4)],
        )
        self.assertIn("tenure_instability", _keys(build_soft_signal_panel(p).antipatterns))

    def test_vague_vs_concrete_are_mutually_exclusive(self):
        vague = CandidateProfileV2(
            archetype="bau",
            evidence=[
                Evidence(kind="job", title="Eng", text="Worked on the platform and helped the team."),
                Evidence(kind="job", title="Eng2", text="Maintained services and fixed bugs."),
            ],
        )
        vkeys = _keys(build_soft_signal_panel(vague).antipatterns) | _keys(build_soft_signal_panel(vague).strengths)
        self.assertIn("vague_delivery", vkeys)
        self.assertNotIn("concrete_ownership", vkeys)

        concrete = CandidateProfileV2(
            archetype="bau",
            evidence=[
                Evidence(kind="job", title="Eng", text="Cut p99 latency by 40% and scaled to 3x traffic."),
                Evidence(kind="project", title="Pipe", text="Reduced cost 25%."),
            ],
        )
        ckeys = _keys(build_soft_signal_panel(concrete).strengths) | _keys(build_soft_signal_panel(concrete).antipatterns)
        self.assertIn("concrete_ownership", ckeys)
        self.assertNotIn("vague_delivery", ckeys)

    def test_career_switcher_gets_transferable_strength(self):
        p = CandidateProfileV2(
            archetype="career_switcher",
            years_experience=6.0,
            evidence=[Evidence(kind="job", title="High School Teacher", text="Taught maths for six years.")],
        )
        self.assertIn("transferable_strengths", _keys(build_soft_signal_panel(p).strengths))

    def test_interview_checklist_renders_actionable_items(self):
        p = CandidateProfileV2(
            archetype="bau",
            skill_claims=[SkillClaim(skill="Rust", level="strong")],
            evidence=[Evidence(kind="job", title="Dev", text="Helped the team ship features.")],
        )
        checklist = build_soft_signal_panel(p).to_interview_checklist()
        self.assertTrue(checklist)
        # Deliberately "TO CONFIRM", not "RED FLAG" (models.SoftSignalPanel): this is
        # the one artifact that leaves the product attached to a named person, and
        # every row on it is an UNCONFIRMED hypothesis.
        self.assertTrue(any("[TO CONFIRM]" in line for line in checklist))
        self.assertFalse(any("RED FLAG" in line for line in checklist))
        # every checklist line pairs a finding with something to confirm
        self.assertTrue(all(" — " in line for line in checklist))


class TestNoRiskStatementsAreNotAntipatterns(unittest.TestCase):
    """`recruiter_risk_flags` has no "return [] when clean" contract, so a clean CV
    comes back as a SENTENCE saying there are no risks. Folding one in turned the
    absence of a finding into an ANTIPATTERN row against a named person."""

    def _panel(self, flags):
        p = CandidateProfileV2(archetype="bau")
        return build_soft_signal_panel(p, job_fit=JobFitResult(
            score=70, summary="", matching_skills=[], missing_skills=[],
            seniority_alignment="", role_alignment="", salary_assessment="",
            recommendations=[], recruiter_risk_flags=flags,
        ))

    def test_no_risk_sentences_never_become_antipatterns(self):
        for clean in (
            "No major red flags.",
            "No significant concerns identified.",
            "No obvious risks for this role.",
            "There are no concerns with this candidate.",
            "Nothing concerning in the CV.",
            "None",
            "N/A",
        ):
            with self.subTest(clean=clean):
                keys = _keys(self._panel([clean]).antipatterns)
                self.assertNotIn("llm_risk_flag", keys, f"{clean!r} asserts the ABSENCE of a risk")

    def test_a_real_flag_that_merely_starts_with_no_survives(self):
        for real in (
            "No evidence of Kubernetes anywhere in the CV.",
            "No formal degree, while the JD requires a completed BSc.",
            "Candidate lists no certifications, which is a concern for the compliance requirement.",
            "Two-year employment gap is unexplained.",
        ):
            with self.subTest(real=real):
                self.assertIn("llm_risk_flag", _keys(self._panel([real]).antipatterns), real)


class TestCzechAchievementVerbs(unittest.TestCase):
    """The Czech l-participle carries gender/number: the masculine-only stems matched
    a man's CV and missed the identical sentence written by a woman, flipping the
    signal from `concrete_ownership` to the `vague_delivery` antipattern."""

    def _panel_for(self, sentence: str):
        p = CandidateProfileV2(
            archetype="bau",
            evidence=[
                Evidence(kind="job", title="Analytik", text=sentence),
                Evidence(kind="job", title="Analytik", text=sentence),
            ],
        )
        return build_soft_signal_panel(p)

    def test_feminine_and_plural_forms_count_as_quantified_outcomes(self):
        for form in ("Snížil jsem náklady na provoz.", "Snížila jsem náklady na provoz.",
                     "Snížili jsme náklady na provoz.", "Zvýšila jsem prodej týmu.",
                     "Zlepšily jsme dodací lhůty."):
            with self.subTest(form=form):
                panel = self._panel_for(form)
                self.assertNotIn("vague_delivery", _keys(panel.antipatterns), form)
                self.assertIn("concrete_ownership", _keys(panel.strengths), form)

    def test_prose_without_an_achievement_verb_is_still_vague(self):
        panel = self._panel_for("Pracovala jsem na platformě a pomáhala týmu.")
        self.assertIn("vague_delivery", _keys(panel.antipatterns))


class TestChecklistExport(unittest.TestCase):
    """models.SoftSignalPanel.to_interview_checklist — the copyable artifact.

    It is the one thing that leaves the product attached to a named person, so it
    must read as a hypothesis (``[TO CONFIRM]``, never ``RED FLAG``) and must carry
    ``detail`` — the benign alternative reading the on-screen panel shows and the
    export used to delete.
    """

    def _panel(self, **over):
        base = dict(
            key="tenure_pattern", kind=ANTIPATTERN, label="~1.4 yr average across 4 roles",
            detail="Short tenures are common in agency and contract work.",
            suggested_probe="Ask what drove each move.",
        )
        base.update(over)
        return SoftSignalPanel(antipatterns=[SoftSignal(**base)])

    def test_detail_is_carried_and_the_tag_is_not_a_verdict(self):
        line = self._panel().to_interview_checklist()[0]
        self.assertIn("Short tenures are common in agency and contract work.", line)
        self.assertTrue(line.startswith("[TO CONFIRM] "))
        self.assertNotIn("RED FLAG", line)
        self.assertEqual(
            line,
            "[TO CONFIRM] ~1.4 yr average across 4 roles — "
            "Short tenures are common in agency and contract work. — Ask what drove each move.",
        )

    def test_an_empty_detail_leaves_no_dangling_separator(self):
        line = self._panel(detail="").to_interview_checklist()[0]
        self.assertEqual(line, "[TO CONFIRM] ~1.4 yr average across 4 roles — Ask what drove each move.")

    def test_strengths_keep_their_own_tag(self):
        panel = SoftSignalPanel(strengths=[SoftSignal(
            key="concrete_ownership", kind=STRENGTH, label="Quantified outcomes",
            detail="Three roles cite measured results.", suggested_probe="Ask them to walk one through.",
        )])
        self.assertTrue(panel.to_interview_checklist()[0].startswith("[STRENGTH] "))


class TestProbeBridge(unittest.TestCase):
    """Rec B — a CV overclaim becomes a TARGETED covert probe in the work-sample."""

    def _overclaim_panel(self):
        p = CandidateProfileV2(
            archetype="bau",
            skill_claims=[SkillClaim(skill="Kubernetes", level="strong")],
            evidence=[Evidence(kind="job", title="Dev", text="Built REST APIs.", skills=["Python"])],
        )
        return build_soft_signal_panel(p)

    def test_panel_yields_targeted_probe_brief(self):
        briefs = panel_to_probe_briefs(self._overclaim_panel())
        self.assertTrue(briefs)
        self.assertEqual(briefs[0]["kind"], "verification_trap")
        self.assertIn("Kubernetes", briefs[0]["focus"])

    def test_design_case_bakes_in_the_targeted_probe(self):
        briefs = panel_to_probe_briefs(self._overclaim_panel())
        need = DevNeed(role_family="software_engineering", seniority_target="senior", stack=["Python"])
        analysis = NeedAnalysis(real_stack=["Python", "Kubernetes"], true_complexity="high", risk_areas=["auth"])
        role = {"title": "Senior Backend Engineer", "seniority": "senior", "roleFamily": "software_engineering"}
        # provider=None → deterministic path, so the assertion is on guaranteed structure
        case, source = design_case(need, analysis, role, provider=None, focus_probes=briefs)
        targeted = [p for p in case["coverProbes"] if p["id"].startswith("t")]
        self.assertTrue(targeted, "expected a targeted probe appended from the panel")
        self.assertEqual(targeted[0]["kind"], "verification_trap")
        self.assertIn("Kubernetes", targeted[0]["where"])

    def test_design_case_unchanged_without_focus(self):
        need = DevNeed(role_family="software_engineering", seniority_target="senior")
        analysis = NeedAnalysis(real_stack=["Python"])
        role = {"title": "X", "seniority": "senior", "roleFamily": "software_engineering"}
        case, _ = design_case(need, analysis, role, provider=None)
        self.assertFalse([p for p in case["coverProbes"] if p["id"].startswith("t")])


if __name__ == "__main__":
    unittest.main()
