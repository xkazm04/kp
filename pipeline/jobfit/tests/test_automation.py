from __future__ import annotations

import unittest
from unittest import mock

from pipeline.jobfit import automation
from pipeline.jobfit.market_config import BERLIN_MARKET
from pipeline.jobfit.matching import MatchCandidate, score_job

from pipeline.jobfit.tests._helpers import mkjob as _mkjob


def mkjob(**over):
    # This suite's canonical posting is a "Backend Engineer"; defer everything
    # else to the shared factory.
    base = {"title": "Backend Engineer", "description": "A backend team."}
    base.update(over)
    return _mkjob(**base)


BAU = MatchCandidate(
    skills=["Python", "Django"], seniority="senior", role_family="software_engineering",
    languages=["English"], archetype="bau",
)
STUDENT = MatchCandidate(
    skills=["HTML"], seniority="junior", role_family="software_engineering", languages=["English"],
    archetype="student", potential_score=0.6,
)


class PolicyTest(unittest.TestCase):
    def ev(self, **kw):
        base = {"stage": "Screened", "archetype": "bau", "matchScore": 60, "daysInStage": 0, "approvalKind": None}
        base.update(kw)
        return automation.evaluate_entry(base)

    def test_bau_high_advances_after_settling(self):
        # Strong BAU clears screening and advances to Interview once it has aged in Screened.
        d = self.ev(matchScore=80, daysInStage=3)
        self.assertEqual((d["action"], d["toStage"]), ("advance", "Interview"))

    def test_bau_high_holds_until_settled(self):
        # A freshly-screened strong BAU settles in Screened before advancing.
        self.assertEqual(self.ev(matchScore=80, daysInStage=0)["action"], "hold")

    def test_bau_low_rejects(self):
        # A *genuine* low score (present, below the floor) still auto-rejects.
        self.assertEqual(self.ev(matchScore=35)["action"], "reject")

    def test_screened_without_score_holds_not_rejects(self):
        # An unscored AI-matched entry (matching not run / data gap) must HOLD, not
        # be auto-rejected: int(None or 0) == 0 < bau_reject_score must not fire.
        for missing in (0, None):
            d = self.ev(matchScore=missing)
            self.assertEqual(d["action"], "hold", f"matchScore={missing!r}")
            self.assertNotEqual(d["action"], "reject", f"matchScore={missing!r}")

    def test_screened_missing_score_key_holds(self):
        # matchScore key entirely absent behaves the same as null → hold.
        d = automation.evaluate_entry({"stage": "Screened", "archetype": "bau", "daysInStage": 0})
        self.assertEqual(d["action"], "hold")

    def test_bau_mid_holds(self):
        self.assertEqual(self.ev(matchScore=60)["action"], "hold")

    def test_early_career_never_advances_or_rejects(self):
        for score in (95, 20):
            d = self.ev(archetype="student", matchScore=score, daysInStage=9)
            self.assertEqual(d["action"], "hold", f"score {score}")

    def test_screened_with_pending_approval_holds(self):
        self.assertEqual(self.ev(approvalKind="screening_review", daysInStage=9)["action"], "hold")

    def test_interview_always_manual(self):
        self.assertEqual(self.ev(stage="Interview", daysInStage=9)["action"], "hold")

    def test_accepted_with_score_advances_to_screened(self):
        # Intake lands in Accepted; once matched it auto-advances into the Screened
        # gate (where the archetype rules actually decide).
        d = self.ev(stage="Accepted", matchScore=72)
        self.assertEqual((d["action"], d["toStage"]), ("advance", "Screened"))

    def test_accepted_advance_is_archetype_neutral(self):
        # The Accepted->Screened move is never a reject and applies to early-career too.
        d = self.ev(stage="Accepted", archetype="student", matchScore=30)
        self.assertEqual((d["action"], d["toStage"]), ("advance", "Screened"))

    def test_accepted_without_score_holds(self):
        # Both a literal 0 and a null/absent score are "unscored" → hold for matching.
        for missing in (0, None):
            self.assertEqual(self.ev(stage="Accepted", matchScore=missing)["action"], "hold", f"matchScore={missing!r}")

    def test_offer_always_holds(self):
        # Extend is the recruiter's call; Offer -> Hired is the candidate's. Policy never advances/rejects.
        for score in (95, 20):
            self.assertEqual(self.ev(stage="Offer", matchScore=score)["action"], "hold", f"score {score}")

    def test_offer_still_ages(self):
        # A stale offer should still raise an aging alert (just never auto-move).
        self.assertIn("aging_alert", self.ev(stage="Offer", daysInStage=35)["alerts"])

    def test_hired_is_terminal(self):
        d = self.ev(stage="Hired", matchScore=99, daysInStage=99)
        self.assertEqual((d["action"], d["toStage"]), ("none", None))

    def test_aging_alerts(self):
        self.assertIn("stale_alert", self.ev(matchScore=60, daysInStage=25)["alerts"])
        self.assertIn("aging_alert", self.ev(matchScore=60, daysInStage=35)["alerts"])

    def test_recent_screening_skips(self):
        self.assertEqual(self.ev(matchScore=90, recentScreening=True)["action"], "none")


class ScreeningTest(unittest.TestCase):
    def test_bau_strong_advances(self):
        job = mkjob()
        m = score_job(BAU, job)
        result, source = automation.screen_candidate(BAU, job, m, provider=None)
        self.assertEqual(source, "deterministic")
        self.assertEqual(result["recommendation"], "advance")
        self.assertEqual(result["route"], "advance")

    def test_early_career_fairness_gate_forces_hold(self):
        # Student with learnable gaps + low score must never be rejected; routed to a human.
        job = mkjob(requirements=[{"skill": "Go", "kind": "must_have", "hardness": "prerequisite"}])
        m = score_job(STUDENT, job)
        self.assertLess(m.total, 55)
        result, _ = automation.screen_candidate(STUDENT, job, m, provider=None)
        self.assertEqual(result["recommendation"], "hold")
        self.assertEqual(result["route"], "hold")

    def test_early_career_never_rejected_even_without_gate(self):
        low = MatchCandidate(skills=["HTML"], seniority="junior", role_family="software_engineering",
                             languages=["English"], archetype="student", potential_score=0.2)
        job = mkjob(requirements=[{"skill": "Rust", "kind": "must_have", "hardness": "prerequisite"}])
        result, _ = automation.screen_candidate(low, job, score_job(low, job), provider=None)
        self.assertNotEqual(result["recommendation"], "reject")


class _CaptureProvider:
    """Fake LLM provider: records the prompt it was handed and returns a canned
    payload, so a test can assert what the model was asked AND how the coercer
    handles what it returns."""

    def __init__(self, payload):
        self.payload = payload
        self.prompt = None
        self.system = None

    def complete_json(self, prompt, system=None):
        self.prompt = prompt
        self.system = system
        return self.payload


class RecommendationContractTest(unittest.TestCase):
    """Pins the Python half of the advance|hold|reject verdict contract
    (idea-d00da358). The TS half lives in app/_lib/interview-recommendation.ts,
    pinned by interview-recommendation.test.ts."""

    def test_canonical_set_and_fallback(self):
        self.assertEqual(automation.RECOMMENDATIONS, ("advance", "hold", "reject"))
        self.assertEqual(automation.RECOMMENDATION_FALLBACK, "hold")
        self.assertIn(automation.RECOMMENDATION_FALLBACK, automation.RECOMMENDATIONS)
        # The prompt-facing choice string is derived from the set, never hand-typed.
        self.assertEqual(automation.RECOMMENDATION_CHOICES, "advance|hold|reject")

    def test_coerce_recommendation_normalizes_and_falls_back(self):
        self.assertEqual(automation.coerce_recommendation("Advance"), "advance")
        self.assertEqual(automation.coerce_recommendation(" REJECT "), "reject")
        self.assertEqual(automation.coerce_recommendation("hold"), "hold")
        # Off-set / empty / None → the default fallback (hold)...
        for bad in ("advanced", "yes", "", None, 42):
            self.assertEqual(automation.coerce_recommendation(bad), "hold", repr(bad))
        # ...unless the caller supplies a context-aware default.
        self.assertEqual(automation.coerce_recommendation("nope", "advance"), "advance")

    def test_prompts_list_the_canonical_vocabulary(self):
        # The legal set must reach the model byte-for-byte as "advance|hold|reject"
        # (derived, so it can never go stale relative to RECOMMENDATIONS).
        job = mkjob()
        cap = _CaptureProvider({"recommendation": "advance", "confidence": 90})
        automation.screen_candidate(BAU, job, score_job(BAU, job), provider=cap)
        self.assertIn('"recommendation": "advance|hold|reject"', cap.prompt)

        cap2 = _CaptureProvider({"ratings": [], "summary": "ok", "recommendation": "hold"})
        automation.interview_scorecard(BAU, job, "notes", provider=cap2)
        self.assertIn('"recommendation": "advance|hold|reject"', cap2.prompt)

    def test_screen_never_emits_off_taxonomy_verdict(self):
        # A model that returns garbage must be coerced before it leaves the function.
        job = mkjob()
        cap = _CaptureProvider({"recommendation": "definitely-hire", "confidence": 95})
        result, source = automation.screen_candidate(BAU, job, score_job(BAU, job), provider=cap)
        self.assertEqual(source, "llm")
        self.assertIn(result["recommendation"], automation.RECOMMENDATIONS)
        self.assertIn(result["route"], ("advance", "hold"))

    def test_scorecard_garbage_verdict_falls_back_to_hold(self):
        job = mkjob()
        cap = _CaptureProvider({"ratings": [], "summary": "s", "recommendation": "🤷 maybe"})
        result, _ = automation.interview_scorecard(BAU, job, "notes", provider=cap)
        self.assertEqual(result["recommendation"], "hold")


class MarketPersonaTest(unittest.TestCase):
    """The HR-automation system persona is MarketConfig-driven (mirrors campaign.py
    round 9 / group_compare.py round 10), not a hardcoded "Czech tech market"
    literal. Byte-identical for the Czech default; a re-homed market names ITS market."""

    def test_czech_default_is_byte_identical(self):
        # The exact bytes of the old "_SYSTEM" literal.
        expected = (
            "You are an HR automation assistant for the Czech tech market. Be concise, specific, fair, and "
            "grounded only in the supplied facts. Write in the requested language. Output strict JSON only."
        )
        self.assertEqual(automation._system_prompt(), expected)
        from pipeline.jobfit.market_config import CZECH_MARKET

        self.assertEqual(automation._system_prompt(CZECH_MARKET), expected)

    def test_berlin_flip_names_the_active_market(self):
        # A re-homed market names ITS market instead of biasing every task Czech.
        berlin = automation._system_prompt(BERLIN_MARKET)
        self.assertIn("German tech market", berlin)
        self.assertNotIn("Czech", berlin)

    def test_persona_reaches_the_model(self):
        # The derived persona is what the provider is actually handed as `system`.
        job = mkjob()
        cap = _CaptureProvider({"recommendation": "advance", "confidence": 90})
        automation.screen_candidate(BAU, job, score_job(BAU, job), provider=cap)
        self.assertEqual(cap.system, automation._system_prompt())


class CandidateLangTest(unittest.TestCase):
    """`_candidate_lang` covers the app LOCALES (en/cs/de/fr) via i18n.LANG_NAMES,
    not just the old Czech/English binary. cs/en outcomes stay byte-identical; de/fr
    speakers are newly detected instead of silently collapsing to an English letter."""

    @staticmethod
    def _cand(*langs):
        return MatchCandidate(
            skills=["Python"], seniority="senior", role_family="software_engineering",
            languages=list(langs), archetype="bau",
        )

    def test_czech_and_english_are_unchanged(self):
        # Byte-identical to the old binary under the Czech default market.
        self.assertEqual(automation._candidate_lang(self._cand("Czech", "English")), "Czech")
        self.assertEqual(automation._candidate_lang(self._cand("English")), "English")
        self.assertEqual(automation._candidate_lang(self._cand("Čeština")), "Czech")
        # No modelled language declared → English fallback (as before).
        self.assertEqual(automation._candidate_lang(self._cand()), "English")
        self.assertEqual(automation._candidate_lang(self._cand("Spanish")), "English")

    def test_english_wins_the_tiebreak_over_a_third_language(self):
        # A "German, English" speaker still gets English (the conservative lingua-franca
        # tiebreak), exactly as the old binary did — we don't regress multilingual CVs.
        self.assertEqual(automation._candidate_lang(self._cand("German", "English")), "English")

    def test_de_and_fr_only_speakers_are_newly_detected(self):
        # The whole point: a candidate who speaks NEITHER Czech nor English is no
        # longer silently written to in English.
        self.assertEqual(automation._candidate_lang(self._cand("German")), "German")
        self.assertEqual(automation._candidate_lang(self._cand("Deutsch")), "German")
        self.assertEqual(automation._candidate_lang(self._cand("Français")), "French")
        self.assertEqual(automation._candidate_lang(self._cand("Francais")), "French")

    def test_home_language_wins_under_a_rehomed_market(self):
        from pipeline.jobfit.market_config import CZECH_MARKET

        # Czech market: a Czech+German speaker gets Czech (home lang wins).
        self.assertEqual(
            automation._candidate_lang(self._cand("Czech", "German"), market=CZECH_MARKET), "Czech"
        )
        # Berlin market (home_lang=de): the SAME candidate now gets German.
        self.assertEqual(
            automation._candidate_lang(self._cand("Czech", "German"), market=BERLIN_MARKET), "German"
        )

    def test_letter_lang_prefers_an_explicit_locale_over_the_guess(self):
        # The reliable signal still wins: an explicit --lang overrides the heuristic.
        cand = self._cand("German")
        self.assertEqual(automation._letter_lang(cand, "fr"), "French")
        self.assertEqual(automation._letter_lang(cand, None), "German")


class GithubEvidenceBlockTest(unittest.TestCase):
    """GH7 — the persisted GitHub evidence reaches the screen/prep/scorecard
    prompts as a compact "Public repo evidence" block; an absent summary leaves
    every prompt byte-identical to its pre-GH7 bytes."""

    GITHUB = {
        "username": "ada-dev",
        "profileUrl": "https://github.com/ada-dev",
        "summary": "Solid Python services with real tests.",
        "confirmedSkills": ["Python", "PostgreSQL"],
        "unverifiedClaims": ["Kubernetes"],
        "hiddenStrengths": ["CI tooling"],
        "topRepositories": [{"name": "svc", "url": "https://github.com/ada-dev/svc"}],
        "analyzedAt": "2026-06-01T00:00:00Z",
    }

    def test_block_renders_compact_evidence(self):
        block = automation.github_evidence_block(self.GITHUB)
        self.assertIn("Public repo evidence", block)
        self.assertIn("ada-dev", block)
        self.assertIn("Python, PostgreSQL", block)
        self.assertIn("NOT verified by public repos: Kubernetes", block)
        self.assertIn("Hidden strengths", block)

    def test_block_empty_for_absent_or_malformed(self):
        # Boundary: anything non-dict / username-less renders nothing — the
        # prompt must never carry a half-formed evidence block.
        for bad in (None, "x", 42, [], {}, {"username": "  "}):
            self.assertEqual(automation.github_evidence_block(bad), "", repr(bad))

    def test_screen_prep_scorecard_prompts_carry_the_block(self):
        job = mkjob()
        m = score_job(BAU, job)

        cap = _CaptureProvider({"recommendation": "hold", "confidence": 50})
        automation.screen_candidate(BAU, job, m, provider=cap, github=self.GITHUB)
        self.assertIn("Public repo evidence", cap.prompt)
        self.assertIn("Kubernetes", cap.prompt)

        cap = _CaptureProvider({"questions": [], "focusAreas": []})
        automation.interview_prep(BAU, job, m, provider=cap, github=self.GITHUB)
        self.assertIn("Public repo evidence", cap.prompt)

        cap = _CaptureProvider({"ratings": [], "summary": "s", "recommendation": "hold"})
        automation.interview_scorecard(BAU, job, "notes", provider=cap, github=self.GITHUB)
        self.assertIn("Public repo evidence", cap.prompt)

    def test_prompts_unchanged_without_evidence(self):
        # No evidence → no block: evidence-less entries keep the pre-GH7 prompt
        # bytes (and thus comparable outputs).
        job = mkjob()
        m = score_job(BAU, job)
        cap = _CaptureProvider({"recommendation": "hold", "confidence": 50})
        automation.screen_candidate(BAU, job, m, provider=cap)
        self.assertNotIn("Public repo evidence", cap.prompt)


class DraftsTest(unittest.TestCase):
    def setUp(self):
        self.job = mkjob()
        self.m = score_job(BAU, self.job)

    def test_outreach_deterministic(self):
        r, src = automation.draft_outreach(BAU, self.job, ["Python"], provider=None)
        self.assertEqual(src, "deterministic")
        self.assertTrue(r["subject"] and r["body"])

    def test_rejection_deterministic(self):
        r, _ = automation.draft_rejection(BAU, self.job, self.m, "Screened", provider=None)
        self.assertTrue(r["body"])

    def test_prep_deterministic(self):
        r, _ = automation.interview_prep(BAU, self.job, self.m, provider=None)
        self.assertTrue(len(r["questions"]) >= 1)
        self.assertIn("question", r["questions"][0])

    def test_scorecard_deterministic(self):
        r, _ = automation.interview_scorecard(BAU, self.job, "Strong on Python, weak on system design.", provider=None)
        self.assertIn(r["recommendation"], ("advance", "hold", "reject"))
        self.assertTrue(r["ratings"])
        # Self-describing: which rubric it was scored on + how far to trust it.
        self.assertEqual(r["scoringModel"], "experienced")
        self.assertIn(r["confidence"]["level"], ("tight", "moderate", "wide"))
        self.assertEqual(r["promptVersion"], automation.SCORECARD_PROMPT_VERSION)

    def test_scorecard_is_archetype_aware(self):
        # Same transcript, different rubric: BAU on the experienced axes, a student
        # on the 6 early-career potential constructs.
        bau, _ = automation.interview_scorecard(BAU, self.job, "x", provider=None)
        self.assertEqual(bau["scoringModel"], "experienced")
        self.assertEqual(
            [r["competency"] for r in bau["ratings"]],
            [c["competency"] for c in automation.INTERVIEW_RUBRICS["experienced"]],
        )
        stu, _ = automation.interview_scorecard(STUDENT, self.job, "x", provider=None)
        self.assertEqual(stu["scoringModel"], "early_career")
        self.assertEqual(
            [r["competency"] for r in stu["ratings"]],
            [c["competency"] for c in automation.INTERVIEW_RUBRICS["early_career"]],
        )
        self.assertGreaterEqual(len(stu["ratings"]), 6)

    def test_scorecard_confidence_tracks_transcript_richness(self):
        rubric = automation.INTERVIEW_RUBRICS["early_career"]
        n = len(rubric)
        full = [{"competency": c["competency"], "rating": 4, "evidence": "concrete thing the candidate said"} for c in rubric]
        unassessed = [{"competency": c["competency"], "rating": 3, "evidence": "Not assessed."} for c in rubric]
        # Thin transcript OR nothing evidenced -> wide (provisional), not a low score.
        self.assertEqual(automation._scorecard_confidence("short", full, n)["level"], "wide")
        self.assertEqual(automation._scorecard_confidence("x" * 3000, unassessed, n)["level"], "wide")
        # Long + fully evidenced -> tight; mid-length + fully evidenced -> moderate.
        self.assertEqual(automation._scorecard_confidence("x" * 3000, full, n)["level"], "tight")
        self.assertEqual(automation._scorecard_confidence("x" * 1000, full, n)["level"], "moderate")


class ReadbackEntitiesTest(unittest.TestCase):
    """scorecard-v5 — the closing read-back becomes STRUCTURED `entities`. Contract/
    parse-level only (no live LLM): a canned provider payload proves the coercer keeps
    a real exchange and drops an absent one, never inventing a read-back."""

    def setUp(self):
        self.job = mkjob()

    def test_prompt_asks_for_structured_entities(self):
        # The v5 prompt must instruct the model to emit the structured contract.
        cap = _CaptureProvider({"ratings": [], "summary": "s", "recommendation": "hold"})
        automation.interview_scorecard(BAU, self.job, "notes", provider=cap)
        self.assertIn('"entities"', cap.prompt)
        self.assertIn('"corrected"', cap.prompt)
        self.assertIn("read-back", cap.prompt)

    def test_readback_correction_survives_coercion(self):
        # A transcript WITH a read-back correction: Rust heard, React meant.
        cap = _CaptureProvider({
            "ratings": [], "summary": "s", "recommendation": "advance",
            "entities": {
                "confirmed": ["PostgreSQL", " Docker "],
                "corrected": [{"heard": "Rust", "meant": "React"}, {"heard": "", "meant": "x"}],
                "unconfirmed": ["Kubernetes", 42, ""],
            },
        })
        result, _ = automation.interview_scorecard(BAU, self.job, "notes", provider=cap)
        ent = result["entities"]
        self.assertEqual(ent["confirmed"], ["PostgreSQL", "Docker"])  # trimmed
        self.assertEqual(ent["corrected"], [{"heard": "Rust", "meant": "React"}])  # half-empty pair dropped
        self.assertEqual(ent["unconfirmed"], ["Kubernetes"])  # non-strings/blanks dropped

    def test_cross_bucket_dedupe_precedence(self):
        # PARITY FIXTURE — kept byte-identical to the input/expected literals in
        # app/_lib/interview-scorecard.test.ts ("cross-bucket dedupe ..."). A token in
        # more than one bucket renders once, precedence corrected.meant > confirmed >
        # unconfirmed. "React" is a corrected.meant (also redundantly confirmed +
        # unconfirmed); "Docker" is confirmed AND unconfirmed.
        cap = _CaptureProvider({
            "ratings": [], "summary": "s", "recommendation": "advance",
            "entities": {
                "confirmed": ["React", "Docker", "PostgreSQL"],
                "corrected": [{"heard": "Rust", "meant": "React"}],
                "unconfirmed": ["Docker", "Kubernetes", "React"],
            },
        })
        result, _ = automation.interview_scorecard(BAU, self.job, "notes", provider=cap)
        ent = result["entities"]
        self.assertEqual(ent["confirmed"], ["Docker", "PostgreSQL"])  # "React" dropped (corrected.meant)
        self.assertEqual(ent["corrected"], [{"heard": "Rust", "meant": "React"}])
        self.assertEqual(ent["unconfirmed"], ["Kubernetes"])  # "Docker" (confirmed) + "React" (meant) dropped

    def test_no_readback_omits_entities(self):
        # A transcript WITHOUT any read-back: entities null / absent → key omitted
        # entirely (never fabricated), so consumers render no chrome.
        for payload_entities in (None, {}, {"confirmed": [], "corrected": [], "unconfirmed": []}, "not-a-dict"):
            cap = _CaptureProvider({
                "ratings": [], "summary": "s", "recommendation": "hold", "entities": payload_entities,
            })
            result, _ = automation.interview_scorecard(BAU, self.job, "notes", provider=cap)
            self.assertNotIn("entities", result, repr(payload_entities))

    def test_entities_absent_when_key_missing(self):
        # No `entities` key at all in the model payload → omitted.
        cap = _CaptureProvider({"ratings": [], "summary": "s", "recommendation": "hold"})
        result, _ = automation.interview_scorecard(BAU, self.job, "notes", provider=cap)
        self.assertNotIn("entities", result)

    def test_deterministic_has_no_entities(self):
        # The keyless deterministic fallback never read anything back.
        result, _ = automation.interview_scorecard(BAU, self.job, "notes", provider=None)
        self.assertNotIn("entities", result)


class RematchTest(unittest.TestCase):
    def test_finds_best_alternative_excluding_current(self):
        cur = mkjob(title="Cur Python", requirements=[{"skill": "Python", "kind": "must_have", "hardness": "prerequisite"}])
        alt = mkjob(title="Alt Python/Django", requirements=[
            {"skill": "Python", "kind": "must_have", "hardness": "prerequisite"},
            {"skill": "Django", "kind": "must_have", "hardness": "prerequisite"},
        ])
        far = mkjob(title="PM role", role_family="product_project", requirements=[{"skill": "product management", "kind": "must_have", "hardness": "prerequisite"}])
        out = automation.rematch_candidate(BAU, cur.id, [cur, alt, far], provider=None)
        self.assertTrue(out["found"])
        self.assertEqual(out["jobId"], alt.id)
        self.assertNotEqual(out["jobId"], cur.id)

    def test_no_alternative_above_floor(self):
        weak = MatchCandidate(skills=["Figma"], seniority="junior", role_family="software_engineering", languages=["English"], archetype="bau")
        job = mkjob(requirements=[{"skill": "Rust", "kind": "must_have", "hardness": "prerequisite"}], seniority="senior", description="seasoned only")
        out = automation.rematch_candidate(weak, "other", [job], provider=None)
        self.assertFalse(out["found"])


class OfferTest(unittest.TestCase):
    def test_offer_stays_within_band(self):
        job = mkjob()
        out, _ = automation.draft_offer(BAU, job, score_job(BAU, job), provider=None)
        self.assertLessEqual(out["salaryMin"], out["recommended"])
        self.assertLessEqual(out["recommended"], out["salaryMax"])
        self.assertTrue(out["subject"] and out["body"])

    def test_offer_scales_with_match(self):
        job = mkjob()
        strong = MatchCandidate(skills=["Python", "Django", "PostgreSQL"], seniority="senior", role_family="software_engineering", languages=["English"], archetype="bau")
        weak = MatchCandidate(skills=["Python"], seniority="medior", role_family="software_engineering", languages=["English"], archetype="bau")
        hi, _ = automation.draft_offer(strong, job, score_job(strong, job), provider=None)
        lo, _ = automation.draft_offer(weak, job, score_job(weak, job), provider=None)
        self.assertGreaterEqual(hi["recommended"], lo["recommended"])

    def test_offer_currency_is_the_active_market_czk_by_default(self):
        # Byte-identical: the Czech default labels the offer "CZK" as before.
        job = mkjob()
        out, _ = automation.draft_offer(BAU, job, score_job(BAU, job), provider=None)
        self.assertEqual(out["currency"], "CZK")
        self.assertIn("CZK", out["body"])

    def test_offer_currency_follows_a_flipped_market(self):
        # Re-homing the active market re-labels the offer in ITS currency instead of
        # a hardcoded "CZK" — proving the literal now reads MarketConfig.
        job = mkjob()
        with mock.patch.object(automation, "ACTIVE_MARKET", BERLIN_MARKET):
            out, _ = automation.draft_offer(BAU, job, score_job(BAU, job), provider=None)
        self.assertEqual(out["currency"], "EUR")
        self.assertIn("EUR", out["body"])
        self.assertNotIn("CZK", out["body"])

    def test_offer_falls_back_to_seniority_band_without_role_band(self):
        # a role_family/seniority with no role_band still yields a usable band
        out, _ = automation.draft_offer(BAU, mkjob(role_family="other", seniority="lead"), score_job(BAU, mkjob(role_family="other", seniority="lead")), provider=None)
        self.assertGreater(out["recommended"], 0)
        self.assertLessEqual(out["salaryMin"], out["recommended"])

    def test_letter_lang_override_beats_cv_guess(self):
        # Backlog #34: the TS seam passes the ENTRY's resolved comms locale; it must
        # override the CV-language guess so the letter matches the chrome it ships in.
        job = mkjob()
        m = score_job(BAU, job)  # BAU's CV lists English only
        offer, _ = automation.draft_offer(BAU, job, m, lang="cs", provider=None)
        self.assertEqual(offer["language"], "Czech")
        self.assertIn("Nabídka", offer["subject"])
        rejection, _ = automation.draft_rejection(BAU, job, m, "Screened", lang="cs", provider=None)
        self.assertEqual(rejection["language"], "Czech")
        outreach, _ = automation.draft_outreach(BAU, job, ["Python"], lang="cs", provider=None)
        self.assertEqual(outreach["language"], "Czech")
        # Without an explicit lang the historical CV guess still applies (English CV -> English).
        legacy, _ = automation.draft_offer(BAU, job, m, provider=None)
        self.assertEqual(legacy["language"], "English")


if __name__ == "__main__":
    unittest.main()
