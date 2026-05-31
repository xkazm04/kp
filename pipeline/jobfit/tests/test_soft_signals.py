"""Rec A — the candidate soft-signal panel.

The synthetic ČS seeds are internally consistent (no overclaims, empty archetype
reasons), so these crafted profiles exercise the ANTIPATTERN detectors directly,
plus confirm the hidden-strength detectors and the interview-checklist output.
"""
import unittest

from pipeline.jobfit.devcase.design import design_case
from pipeline.jobfit.devcase.models import DevNeed, NeedAnalysis
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
        self.assertTrue(any("RED FLAG" in line for line in checklist))
        # every checklist line pairs a finding with something to confirm
        self.assertTrue(all(" — " in line for line in checklist))


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
