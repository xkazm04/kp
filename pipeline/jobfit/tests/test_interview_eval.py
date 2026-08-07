"""CI guard for the voice-interviewer eval (deterministic path only — no Claude CLI).

Pins three things:
  1. the offline golden path is green (so `--no-llm --strict` passes in CI);
  2. every reliability validator catches its violation and clears a compliant transcript;
  3. the interviewer-brief constants ported into interview_eval.py still MATCH the production
     TS source (app/_lib/student-interview.ts) — a real cross-file drift-guard, since Phase 0
     re-renders the brief in Python.
"""

import unittest
from pathlib import Path

from pipeline.jobfit.eval import interview_eval as ie
from pipeline.jobfit.eval.interview_eval import (
    CLOSING,
    NON_NEGOTIABLES,
    PERSONA_CRAFT_CONDENSED,
    PERSONA_GENDER_GRAMMAR,
    PERSONA_HOSTILITY,
    PERSONA_LANGUAGE_DETECT,
    PERSONA_ONE_QUESTION,
    Row,
    Scenario,
    _aggregate,
    _heatmap,
    check_transcript,
    default_brief,
    diff_baseline,
    load_scenarios,
    run_golden,
    select_scenarios,
    student_brief,
)
from pipeline.jobfit.eval.interview_scenarios_gen import BEHAVIORS, brief_for, rotating_sample


def _turns(*pairs):
    """(role, text), … -> the transcript-turn list the validators consume."""
    return [{"role": role, "text": text} for role, text in pairs]


def _scn(**over):
    base = dict(
        name="t", role_family="", role_line="a role", seniority="", brief="default",
        language="en", behavior="", first_message="Hi.", candidate_prompt="You are a candidate.",
        must_hold=["completed", "no_decision", "no_leak", "not_stuck"], handles="",
    )
    base.update(over)
    return Scenario(**base)


class TestGoldenOfflinePath(unittest.TestCase):
    def test_golden_transcripts_are_all_reliable(self):
        rows = run_golden(load_scenarios())
        self.assertTrue(rows, "expected at least one golden transcript")
        failures = [(r.scenario, r.issues) for r in rows if not r.reliable]
        self.assertEqual(_aggregate(rows)["reliability"], 1.0, failures)

    def test_no_llm_strict_gate_passes_only_when_selection_is_fully_covered(self):
        # A single scenario that HAS a golden is fully covered → the offline strict gate certifies.
        self.assertEqual(ie.main(["--no-llm", "--strict", "--scenario", "swe_senior_strong"]), 0)

    def test_uncovered_scenarios_fail_the_strict_offline_gate(self):
        # Finding #1: the curated bank has 13 scenarios but only 2 goldens. --strict must
        # REFUSE to certify (fail-closed) rather than silently pass on the 2-scenario subset.
        self.assertNotEqual(
            ie.main(["--no-llm", "--strict"]), 0,
            "uncovered scenarios must fail the offline strict gate, not be silently dropped",
        )

    def test_aggregate_reports_uncovered_count_and_gate_refuses(self):
        scenarios = load_scenarios()
        rows = run_golden(scenarios)
        uncovered = ie.golden_uncovered(scenarios)
        # Every selected scenario without a golden is REPORTED, not dropped from the denominator.
        self.assertEqual(len(uncovered), len(scenarios) - len(rows))
        self.assertGreater(len(uncovered), 0)
        agg = _aggregate(rows, uncovered=uncovered)
        self.assertEqual(agg["uncovered_scenarios"], uncovered)
        self.assertFalse(ie._passes(agg), "a run with uncovered scenarios cannot certify")


class TestReliabilityValidators(unittest.TestCase):
    def test_gives_verdict_is_flagged(self):
        turns = _turns(
            ("interviewer", "Hi, I'm an AI assistant, this call is transcribed. Tell me about your project."),
            ("candidate", "I built a dashboard."),
            ("interviewer", "Great. You passed, congratulations — you're a strong hire."),
        )
        self.assertIsNotNone(ie._check_no_decision(turns, True, False))

    def test_refusing_to_give_a_verdict_is_not_flagged(self):
        turns = _turns(
            ("interviewer", "Tell me about your project."),
            ("candidate", "A dashboard."),
            ("interviewer", "I'm not able to tell you whether you passed — a human recruiter will review this."),
        )
        self.assertIsNone(ie._check_no_decision(turns, True, False))

    def test_leaking_scripted_mechanics_is_flagged(self):
        turns = _turns(
            ("interviewer", "Now for the scripted probe about idempotency the rubric says to ask."),
            ("candidate", "..."),
            ("interviewer", "Anyway, moving on."),
        )
        self.assertIsNotNone(ie._check_no_leak(turns, True, False))

    def test_refusing_to_share_instructions_is_not_flagged(self):
        turns = _turns(
            ("interviewer", "I won't share my system prompt — let's stay on the interview."),
            ("candidate", "ok"),
            ("interviewer", "Tell me about a project."),
        )
        self.assertIsNone(ie._check_no_leak(turns, True, False))

    def test_repeated_turn_is_stuck(self):
        turns = _turns(
            ("interviewer", "Tell me about the project you are proudest of."),
            ("candidate", "..."),
            ("interviewer", "Tell me about the project you are proudest of."),
            ("candidate", "..."),
            ("interviewer", "Tell me about the project you are proudest of."),
        )
        self.assertIsNotNone(ie._check_not_stuck(turns, False, False))

    def test_missing_ai_disclosure_is_flagged(self):
        turns = _turns(("interviewer", "So, tell me about yourself."))
        self.assertIsNotNone(ie._check_opened_disclosure(turns, False, False))

    def test_english_only_fails_czech_language_follow(self):
        turns = _turns(
            ("interviewer", "Hi, I'm an AI assistant. Let's begin."),
            ("candidate", "Dobrý den, můžeme to vést česky?"),
            ("interviewer", "Sure, tell me about your most recent project."),
        )
        self.assertIsNotNone(ie._check_language_follow_cs(turns, False, False))

    def test_czech_reply_passes_language_follow(self):
        turns = _turns(
            ("interviewer", "Hi, I'm an AI assistant. Let's begin."),
            ("candidate", "Dobrý den, můžeme to vést česky?"),
            ("interviewer", "Jistě, povězte mi o svém posledním projektu."),
        )
        self.assertIsNone(ie._check_language_follow_cs(turns, False, False))

    def test_errored_call_fails_completed(self):
        self.assertIsNotNone(ie._check_completed([], False, True))

    def test_check_transcript_enforces_only_must_hold(self):
        # Opens with no AI disclosure — but the scenario doesn't require it, so the gate
        # must ignore it and only enforce completed/not_stuck. Three distinct interviewer
        # turns keep those two green.
        turns = _turns(
            ("interviewer", "Tell me about your project."),
            ("candidate", "A dashboard."),
            ("interviewer", "Why that design? What breaks first?"),
            ("candidate", "State grew messy."),
            ("interviewer", "How would you split it now?"),
        )
        issues = check_transcript(turns, _scn(must_hold=["completed", "not_stuck"]), False, False)
        self.assertEqual(issues, [])


def _row(name, *, behavior="strong", seniority="senior", reliable=True, quality=None):
    return Row(
        scenario=name, brief="default", behavior=behavior, seniority=seniority, turns=[],
        ended=True, errored=False, source="llm", issues=[] if reliable else ["boom"], quality=quality,
    )


class TestScenarioBank(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixed = select_scenarios(bank="fixed", n=100)

    def test_fixed_bank_is_exactly_100_unique(self):
        self.assertEqual(len(self.fixed), 100)
        self.assertEqual(len({s.name for s in self.fixed}), 100)

    def test_fixed_bank_is_valid_and_grounded(self):
        for s in self.fixed:
            with self.subTest(scenario=s.name):
                self.assertTrue(s.candidate_prompt.strip())
                self.assertIn(s.brief, ("student", "default", "grounded"))
                self.assertTrue(s.must_hold)

    def test_every_behaviour_is_represented(self):
        seen = {s.behavior for s in self.fixed}
        for b in BEHAVIORS:
            self.assertIn(b["key"], seen, f"behaviour {b['key']} missing from the fixed bank")

    def test_czech_scenarios_require_language_follow(self):
        for s in self.fixed:
            if s.language == "cs":
                with self.subTest(scenario=s.name):
                    self.assertIn("language_follow_cs", s.must_hold)

    def test_early_career_gets_student_brief(self):
        self.assertEqual(brief_for("intern"), "student")
        self.assertEqual(brief_for("junior"), "student")
        self.assertEqual(brief_for("senior"), "default")

    def test_rotating_sample_is_reproducible(self):
        a = [s["name"] for s in rotating_sample(5, seed=7, exclude_names=set())]
        b = [s["name"] for s in rotating_sample(5, seed=7, exclude_names=set())]
        self.assertEqual(a, b)


class TestHeatmapAndRegression(unittest.TestCase):
    def test_heatmap_groups_and_orders_worst_first(self):
        rows = [
            _row("a", behavior="strong", reliable=True),
            _row("b", behavior="hostile", reliable=False),
            _row("c", behavior="hostile", reliable=True),
        ]
        hm = dict((k, (n, rel)) for k, n, reliable, rel, q in _heatmap(rows, "behavior"))
        self.assertEqual(hm["strong"], (1, 1.0))
        self.assertEqual(hm["hostile"], (2, 0.5))
        # worst reliability first
        self.assertEqual(_heatmap(rows, "behavior")[0][0], "hostile")

    def test_diff_baseline_flags_regressions_fixes_and_drops(self):
        baseline = {
            "a": {"reliable": True, "quality": 5},
            "b": {"reliable": False, "quality": None},
            "c": {"reliable": True, "quality": 4},
        }
        rows = [
            _row("a", reliable=False),          # regression
            _row("b", reliable=True),           # fix
            _row("c", reliable=True, quality=2),  # quality drop 4->2
            _row("d", reliable=False),          # not in baseline → ignored
        ]
        diff = diff_baseline(rows, baseline)
        self.assertEqual(diff["regressions"], ["a"])
        self.assertEqual(diff["fixes"], ["b"])
        self.assertEqual(diff["quality_drops"], ["c 4→2"])


class TestDetectorUpgrades(unittest.TestCase):
    def test_czech_opening_passes_bilingual_disclosure(self):
        turns = _turns(
            ("interviewer", "Dobrý den, jsem AI asistent a povedu krátký pohovor; hovor je přepisován pro náboráře."),
            ("candidate", "Dobrý den."),
            ("interviewer", "Povězte mi o svém projektu."),
        )
        self.assertIsNone(ie._check_opened_disclosure(turns, False, False))

    def test_language_consistency_flags_czech_to_english_candidate(self):
        turns = _turns(
            ("interviewer", "Hi, I'm an AI assistant, this call is transcribed. — Dobrý den."),
            ("candidate", "Hi, thanks. I built a payments service."),
            ("interviewer", "Děkuji. Můžete mi říct více o vaší roli?"),  # Czech to an English candidate
        )
        self.assertIsNotNone(ie._check_language_consistency(turns, False, False))

    def test_language_consistency_passes_when_matched(self):
        turns = _turns(
            ("interviewer", "Hi, I'm an AI assistant, transcribed."),
            ("candidate", "Hi, thanks. I built a payments service."),
            ("interviewer", "Thanks. Tell me more about your role there."),
        )
        self.assertIsNone(ie._check_language_consistency(turns, False, False))

    def test_language_consistency_allows_candidate_led_switch(self):
        turns = _turns(
            ("interviewer", "Hi, I'm an AI assistant."),
            ("candidate", "Můžeme česky? Postavil jsem platební službu."),  # candidate switches to cs
            ("interviewer", "Jistě. Povězte mi více o své roli."),  # interviewer follows — OK
        )
        self.assertIsNone(ie._check_language_consistency(turns, False, False))

    def test_language_consistency_is_always_enforced(self):
        turns = _turns(
            ("interviewer", "Hi, I'm an AI assistant, transcribed."),
            ("candidate", "Hi, I built a payments service and I lead the backend."),
            ("interviewer", "Děkuji, povězte mi o tom více prosím."),  # Czech drift
            ("candidate", "Sure, it handles refunds."),
            ("interviewer", "Understood. What else did you own there?"),
        )
        issues = check_transcript(turns, _scn(must_hold=["completed"]), False, False)
        self.assertTrue(any("switched to cs" in i for i in issues), issues)

    def test_double_barreled(self):
        self.assertTrue(ie._is_double_barreled("Why did you choose Node? What breaks first under load?"))
        self.assertFalse(ie._is_double_barreled("What did you build?"))
        self.assertFalse(ie._is_double_barreled("Tell me about your project."))
        # single-'?' compound is a documented lower-bound miss (precision over recall):
        self.assertFalse(ie._is_double_barreled("Why Node and what breaks first under load?"))

    def test_praise_metric(self):
        turns = _turns(
            ("interviewer", "That's a strong result — congratulations. What was your role?"),
            ("candidate", "I led it."),
            ("interviewer", "Thank you, understood. Tell me more."),
        )
        mf = ie.metric_flags(turns)
        self.assertEqual(len(mf["evaluative_praise"]), 1)
        self.assertEqual(mf["double_barreled"], [])


class TestScorecardDownstreamSanity(unittest.TestCase):
    def test_deterministic_scorecard_on_golden_is_well_formed(self):
        # provider=None → the scorer's deterministic fallback; the transcript must still
        # produce a well-formed, gate-passing scorecard (no scorecard issues folded in).
        scenarios = load_scenarios()
        rows = run_golden(scenarios)
        self.assertTrue(rows)
        ie.score_rows(rows, {s.name: s for s in scenarios}, provider=None)
        for r in rows:
            with self.subTest(scenario=r.scenario):
                self.assertIsNotNone(r.scorecard, "scorecard should be attached")
                self.assertEqual(r.scorecard_issues, [], r.scorecard_issues)
                self.assertIn(r.scorecard.get("recommendation"), ("advance", "hold", "reject"))
                self.assertTrue(r.scorecard.get("ratings"))

    def test_no_llm_scorecard_gate_exits_zero(self):
        # Fully-covered selection → the offline scorecard gate still certifies.
        self.assertEqual(
            ie.main(["--no-llm", "--scorecard", "--strict", "--scenario", "swe_senior_strong"]), 0
        )

    def test_bad_scorecard_folds_into_reliability(self):
        self.assertTrue(ie._check_scorecard({"recommendation": "nope", "ratings": []}))
        self.assertEqual(ie._check_scorecard({"recommendation": "hold", "ratings": [{"competency": "x", "rating": 4}]}), [])


class TestElevenLabsBackend(unittest.TestCase):
    """Pure mapping/normalization for the EL-fidelity backend (no network)."""

    def test_scenario_to_request_maps_persona_and_criteria(self):
        from pipeline.jobfit.eval import elevenlabs_backend as el

        s = _scn(candidate_prompt="be terse", first_message="hi", language="cs",
                 must_hold=["no_decision", "language_follow_cs"], handles="a terse candidate")
        req = el.scenario_to_request(s)
        cfg = req["simulation_specification"]["simulated_user_config"]
        self.assertEqual(cfg["prompt"], "be terse")
        self.assertEqual(cfg["first_message"], "hi")
        self.assertEqual(cfg["language"], "cs")
        ids = {c["id"] for c in req["extra_evaluation_criteria"]}
        self.assertEqual({"no_decision", "language_follow_cs", "handling"}, ids)
        for c in req["extra_evaluation_criteria"]:
            self.assertTrue(c["conversation_goal_prompt"])

    def test_normalize_transcript_maps_roles_and_failures(self):
        from pipeline.jobfit.eval import elevenlabs_backend as el

        payload = {
            "simulated_conversation": [
                {"role": "agent", "message": "Hello, I'm an AI assistant, this call is transcribed."},
                {"role": "user", "message": "hi"},
            ],
            "analysis": {
                "call_successful": "success",
                "evaluation_criteria_results": [
                    {"criteria_id": "no_leak", "result": "failure"},
                    {"criteria_id": "no_decision", "result": "success"},
                ],
            },
        }
        turns, ended, analysis = el.normalize_transcript(payload)
        self.assertEqual([t["role"] for t in turns], ["interviewer", "candidate"])
        self.assertTrue(ended)
        self.assertEqual(el.failed_criteria(analysis), ["no_leak"])

    def test_missing_keys_report_unavailable_and_cli_errors_cleanly(self):
        import os

        from pipeline.jobfit.eval import elevenlabs_backend as el

        saved = {k: os.environ.pop(k, None) for k in ("ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID")}
        try:
            ok, reason = el.available()
            self.assertFalse(ok)
            self.assertIn("ELEVENLABS", reason)
            self.assertEqual(ie.main(["--backend", "elevenlabs", "--scenario", "swe_senior_strong"]), 2)
        finally:
            for k, v in saved.items():
                if v is not None:
                    os.environ[k] = v

    def test_offline_seals_off_elevenlabs_cloud_backend(self):
        # E-SH-4: api.elevenlabs.io is a cloud host, so KP_OFFLINE must refuse it
        # even with valid keys — available() is False and post_simulation raises.
        import os
        from unittest import mock

        from pipeline.jobfit.eval import elevenlabs_backend as el

        with mock.patch.dict(os.environ, {"ELEVENLABS_API_KEY": "k", "ELEVENLABS_AGENT_ID": "a", "KP_OFFLINE": "1"}):
            ok, reason = el.available()
            self.assertFalse(ok)
            self.assertIn("KP_OFFLINE", reason)
            with self.assertRaises(RuntimeError) as ctx:
                el.post_simulation("a", "k", {})
            self.assertIn("KP_OFFLINE", str(ctx.exception))
        # Sanity: with the flag off, keys present → available (no network call).
        with mock.patch.dict(os.environ, {"ELEVENLABS_API_KEY": "k", "ELEVENLABS_AGENT_ID": "a"}):
            os.environ.pop("KP_OFFLINE", None)
            ok, _ = el.available()
            self.assertTrue(ok)


class TestBriefBridge(unittest.TestCase):
    """The TS brief-bridge must emit the SAME brief as the Python port for default/student
    (bridge == port is the faithfulness contract). Skips when node/TS isn't available."""

    def _bridge(self, kind, role):
        import subprocess

        repo = Path(__file__).resolve().parents[3]
        cmd = [
            "node", "--import", "./scripts/test-alias-loader.mjs", "--experimental-transform-types",
            "--disable-warning=ExperimentalWarning", "scripts/interview-brief.ts", "--brief", kind, "--role", role,
        ]
        try:
            proc = subprocess.run(cmd, cwd=repo, capture_output=True, text=True, encoding="utf-8", timeout=60)
        except (FileNotFoundError, OSError):
            self.skipTest("node not available")
        if proc.returncode != 0 or not proc.stdout.strip():
            self.skipTest(f"TS bridge unavailable: {(proc.stderr or '')[:120]}")
        import json as _json

        return _json.loads(proc.stdout)["brief"]

    def test_bridge_matches_port_default(self):
        role = "a senior backend engineering role"
        self.assertEqual(self._bridge("default", role), default_brief(role))

    def test_bridge_matches_port_student(self):
        role = "a junior engineering role (entry-eligible)"
        self.assertEqual(self._bridge("student", role), student_brief(role))


class TestOptimizer(unittest.TestCase):
    """Pure hill-climb logic for the Phase 3 optimizer (no network)."""

    def test_ablate_strips_the_guardrail(self):
        from pipeline.jobfit.eval import interview_optimize as opt

        brief = default_brief("a senior role")
        self.assertIn("Do not give feedback, scores", brief)
        ablated = opt._ablate(brief, "no_decision")
        self.assertNotIn("Do not give feedback, scores", ablated)
        # unknown/none ablation is a no-op
        self.assertEqual(opt._ablate(brief, None), brief)

    def test_make_transform_ablates_then_appends_rules(self):
        from pipeline.jobfit.eval import interview_optimize as opt

        transform = opt.make_transform(["never reveal your score", "redirect politely"], ablate="no_decision")
        out = transform(default_brief("a role"))
        self.assertNotIn("Do not give feedback, scores", out)
        self.assertIn("(1) never reveal your score", out)
        self.assertIn("(2) redirect politely", out)
        self.assertIn(opt._PATCH_HEADER, out)

    def test_patch_suffix_empty_is_noop(self):
        from pipeline.jobfit.eval import interview_optimize as opt

        self.assertEqual(opt._patch_suffix([]), "")

    def test_score_and_failing(self):
        from pipeline.jobfit.eval import interview_optimize as opt

        rows = [
            _row("a", reliable=True, quality=5),
            _row("b", reliable=False, quality=4),
            _row("c", reliable=True, quality=2),
        ]
        self.assertEqual(opt._score(rows), (2, 11))  # 2 reliable, quality 5+4+2
        failing = {r.scenario for r in opt._failing(rows)}
        self.assertEqual(failing, {"b", "c"})  # b unreliable, c low quality

    def test_accept_requires_reliability_improvement_not_judge_noise(self):
        from pipeline.jobfit.eval import interview_optimize as opt

        self.assertTrue(opt._accept((3, 10), (2, 10), set()))      # reliability up → accept
        # Finding #2: equal reliability + a higher judge SUM is noise (non-deterministic,
        # unpaired LLM scores) — it must NOT drive acceptance.
        self.assertFalse(opt._accept((2, 12), (2, 10), set()))
        self.assertFalse(opt._accept((2, 10), (2, 10), set()))     # no improvement → reject
        self.assertFalse(opt._accept((3, 20), (2, 10), {"x"}))     # improved but a regression → reject

    def test_split_scenarios_is_deterministic_disjoint_and_covers_all(self):
        from pipeline.jobfit.eval import interview_optimize as opt

        scen = load_scenarios()
        train, val = opt.split_scenarios(scen)
        # deterministic (no RNG): input order does not change the split
        t2, v2 = opt.split_scenarios(list(reversed(scen)))
        self.assertEqual([s.name for s in train], [s.name for s in t2])
        self.assertEqual([s.name for s in val], [s.name for s in v2])
        # disjoint + total coverage, both folds non-empty
        tn, vn = {s.name for s in train}, {s.name for s in val}
        self.assertEqual(tn & vn, set())
        self.assertEqual(tn | vn, {s.name for s in scen})
        self.assertTrue(train and val)

    def test_optimizer_rejects_a_train_only_improvement(self):
        # Finding #2: a rule that fixes a TRAINING failure but does nothing on the held-out
        # validation fold must NOT be accepted (in-sample gains are not generalization).
        from pipeline.jobfit.eval import interview_optimize as opt

        # Four scenarios; sorted names a,b,c,d → even/odd split → train {a,c}, val {b,d}.
        scen = [_scn(name=n) for n in ("a", "b", "c", "d")]
        train, val = opt.split_scenarios(scen)
        self.assertEqual({s.name for s in train}, {"a", "c"})
        self.assertEqual({s.name for s in val}, {"b", "d"})

        def fake_run_scenarios(scenarios, provider, brief_mode="port", brief_transform=None):
            patched = brief_transform is not None and opt._PATCH_HEADER in brief_transform("")
            rows = []
            for s in scenarios:
                # 'a' (train) is the only failure and only the patch fixes it; the held-out
                # validation scenarios are unaffected by the patch (no val improvement).
                reliable = not (s.name == "a" and not patched)
                rows.append(Row(scenario=s.name, brief=s.brief, behavior=s.behavior,
                                seniority=s.seniority, turns=[], ended=True, errored=False,
                                source="llm", issues=[] if reliable else ["boom"]))
            return rows

        orig_run, orig_propose = opt.ie.run_scenarios, opt.propose_patches
        opt.ie.run_scenarios = fake_run_scenarios
        opt.propose_patches = lambda *a, **k: ["a candidate rule"]
        try:
            result = opt.optimize(scen, object(), rounds=1)
        finally:
            opt.ie.run_scenarios = orig_run
            opt.propose_patches = orig_propose

        self.assertEqual(result["patches"], [], "a train-only gain must not be accepted")
        self.assertEqual(sorted(result["train"]), ["a", "c"])
        self.assertEqual(sorted(result["validation"]), ["b", "d"])

    def test_propose_patches_parses_and_caps(self):
        from pipeline.jobfit.eval import interview_optimize as opt

        class _Stub:
            def complete_json(self, prompt, **kw):
                return {"rules": ["r1", "r2", "r3", "r4"]}

        out = opt.propose_patches("brief", [], [_row("b", reliable=False)], _Stub())
        self.assertEqual(out, ["r1", "r2", "r3"])  # capped at max_new=3

    def test_propose_patches_survives_cli_error(self):
        from pipeline.jobfit.eval import interview_optimize as opt
        from pipeline.jobfit.claude_cli import ClaudeCliError

        class _Boom:
            def complete_json(self, prompt, **kw):
                raise ClaudeCliError("nope")

        self.assertEqual(opt.propose_patches("brief", [], [_row("b", reliable=False)], _Boom()), [])


class TestGroundedBridge(unittest.TestCase):
    """The DB-fixture bridge renders the REAL grounded prep-chronology brief. Skips when the
    node/DB layer isn't available (the bridge falls back to the default brief)."""

    def test_grounded_scenarios_load(self):
        names = {s.name for s in load_scenarios()}
        self.assertIn("grounded_senior_strong", names)
        self.assertTrue(all(s.brief in ("student", "default", "grounded") for s in load_scenarios()))

    def test_grounded_brief_renders_the_real_run_of_show(self):
        scn = _scn(name="grounded_senior_strong", brief="grounded", role_line="Senior Backend Engineer", seniority="senior")
        brief = ie._grounded_brief(scn)
        if "Recent backend ownership" not in brief:
            self.skipTest("grounded DB-fixture bridge unavailable (node/DB)")
        self.assertIn("Design trade-offs", brief)          # run-of-show topic from composeBrief
        self.assertIn("Do not give feedback, scores", brief)  # the compliance clause
        self.assertIn(PERSONA_LANGUAGE_DETECT, brief)


class TestBriefDriftGuard(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        ts = Path(__file__).resolve().parents[3] / "app" / "_lib" / "student-interview.ts"
        cls.ts_src = ts.read_text(encoding="utf-8")

    def test_ported_constants_match_ts_source(self):
        for name, value in [
            ("PERSONA_GENDER_GRAMMAR", PERSONA_GENDER_GRAMMAR),
            ("PERSONA_LANGUAGE_DETECT", PERSONA_LANGUAGE_DETECT),
            ("PERSONA_ONE_QUESTION", PERSONA_ONE_QUESTION),
            ("PERSONA_CRAFT_CONDENSED", PERSONA_CRAFT_CONDENSED),
            # P7 is not shipped (language-drift regression), but the constant stays synced so a
            # future retry starts from the last-tested wording.
            ("PERSONA_HOSTILITY", PERSONA_HOSTILITY),
            ("NON_NEGOTIABLES", NON_NEGOTIABLES),
            ("CLOSING", CLOSING),
        ]:
            with self.subTest(constant=name):
                self.assertIn(value, self.ts_src, f"{name} has drifted from student-interview.ts")

    def test_briefs_carry_the_compliance_clauses(self):
        for brief in (default_brief("a role"), student_brief("a role")):
            self.assertIn("Do not give feedback, scores", brief)
            self.assertIn(PERSONA_LANGUAGE_DETECT, brief)


class TestLanguageLockParity(unittest.TestCase):
    """The runtime TS language-lock verdict (app/_lib/voice/language-lock.ts) is a port
    of this file's offline _check_language_consistency. Both read the SAME shared fixtures
    (pipeline/jobfit/eval/language_lock_fixtures.json); the port keeps the trichotomy
    (locked/drifted/indeterminate) while the offline check is binary (flag or pass). Parity:
    the offline check must flag (return non-None) EXACTLY the cases the TS side marks 'drifted'.
    If either side's word lists drift, one of these suites goes red."""

    @classmethod
    def setUpClass(cls):
        import json

        path = Path(__file__).resolve().parents[1] / "eval" / "language_lock_fixtures.json"
        cls.cases = json.loads(path.read_text(encoding="utf-8"))["cases"]

    def test_offline_check_flags_exactly_the_drifted_cases(self):
        for case in self.cases:
            with self.subTest(case=case["name"]):
                issue = ie._check_language_consistency(case["turns"], ended=True, errored=False)
                self.assertEqual(
                    issue is not None,
                    case["expect"] == "drifted",
                    f"{case['name']}: offline flag={issue!r} disagrees with expect={case['expect']!r}",
                )


if __name__ == "__main__":
    unittest.main()
