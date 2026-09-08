"""Offline certification of the role-intake dialog eval (intake_eval.py).

Runs the full 12-persona bank in --no-llm mode (deterministic agent + golden
requestor answers) and requires every reliability invariant to hold — the
keyless product path is certified in CI, mirroring how the interview eval's
golden mode is gated."""

from __future__ import annotations

import unittest

from pipeline.jobfit.eval.intake_eval import check_dialog, load_scenarios, run_eval, simulate


class IntakeEvalOfflineTest(unittest.TestCase):
    def test_all_personas_pass_offline(self) -> None:
        scenarios = load_scenarios()
        self.assertGreaterEqual(len(scenarios), 12)
        report, ok = run_eval(scenarios, no_llm=True, cap=30, color=False)
        self.assertTrue(ok, f"offline intake eval failed:\n{report}")
        self.assertIn("personas PASS", report)

    def test_market_breadth_bank_passes_offline(self) -> None:
        # The UAT-style breadth exercise: 100 generated scenarios spanning ALL
        # 16 role families × seniority × need shape (intake_scenarios_gen).
        # Every one must fill a RoleBrief, triage its shape, respect the
        # power-unit turn budget and close with a grounded read-back — keyless.
        from pipeline.jobfit.eval.intake_scenarios_gen import fixed_bank

        bank = fixed_bank(100)
        self.assertEqual(len(bank), 100)
        families = {s["family"] for s in bank}
        self.assertEqual(len(families), 16, "the bank must span every role family")
        report, ok = run_eval(bank, no_llm=True, cap=30, color=False)
        self.assertTrue(ok, f"market-breadth intake eval failed:\n{report}")

    # NOTE: `test_every_scenario_carries_both_standing_assertions` was defined
    # TWICE in this class — the first definition was shadowed by the second and
    # never ran (ruff F811). The surviving one below is the stronger of the two
    # (it also proves the declaration materialises as a check).

    def test_undeclared_scenario_would_lose_both_assertions(self) -> None:
        # Proves the guard above is load-bearing rather than decorative: strip
        # the two declaring keys and check_dialog stops emitting both checks —
        # a vacuous PASS. This is the failure the guard exists to prevent.
        scenario = load_scenarios(["power_unit_backfill"])[0]
        turns, brief, shape, done = simulate(None, None, scenario)
        undeclared = {k: v for k, v in scenario.items() if k not in ("family", "dealbreakers")}
        undeclared["expect"] = {k: v for k, v in (scenario.get("expect") or {}).items() if k != "role_family"}
        checks = check_dialog(undeclared, turns, brief, shape, done)
        self.assertNotIn("role_family", checks)
        self.assertNotIn("requirements_captured", checks)
        # …and the stripped scenario still "passes", which is exactly the hazard.
        _, ok = run_eval([undeclared], no_llm=True, cap=30, color=False)
        self.assertTrue(ok)

    def test_premature_end_is_caught(self) -> None:
        # A dialog whose agent emitted <<END>> mid-conversation must fail the
        # no_premature_end invariant — the check itself is load-bearing.
        scenario = load_scenarios(["power_unit_backfill"])[0]
        turns, brief, shape, done = simulate(None, None, scenario)
        agent_idx = [i for i, t in enumerate(turns) if t["role"] == "interviewer"]
        sabotaged = [dict(t) for t in turns]
        sabotaged[agent_idx[1]]["text"] += " <<END>>"
        checks = check_dialog(scenario, sabotaged, brief, shape, done)
        self.assertFalse(checks["no_premature_end"])

    def test_ungrounded_close_is_caught(self) -> None:
        scenario = load_scenarios(["power_unit_backfill"])[0]
        turns, brief, shape, done = simulate(None, None, scenario)
        sabotaged = [dict(t) for t in turns]
        sabotaged[-1]["text"] = "Thanks, that's everything! <<END>>"  # generic goodbye, no read-back
        checks = check_dialog(scenario, sabotaged, brief, shape, done)
        self.assertFalse(checks["grounded_readback"])

    def test_every_scenario_carries_both_standing_assertions(self) -> None:
        # role_family and requirements_captured are CONDITIONAL in check_dialog
        # (a scenario that declares neither field simply skips them, and the
        # bank still reports PASS). That makes the coverage silently erodable:
        # a persona added without `family`/`dealbreakers` would quietly drop the
        # two UAT regressions it was supposed to carry. Pin the declaration in
        # BOTH banks so the skip can never happen unnoticed.
        from pipeline.jobfit.eval.intake_scenarios_gen import fixed_bank

        for label, bank in (("curated", load_scenarios()), ("generated", fixed_bank(100))):
            for scenario in bank:
                name = f"{label}/{scenario['name']}"
                with self.subTest(scenario=name):
                    family = scenario.get("family") or (scenario.get("expect") or {}).get("role_family")
                    self.assertTrue(family, f"{name} declares no role family — role_family would be skipped")
                    self.assertTrue(
                        scenario.get("dealbreakers"),
                        f"{name} states no dealbreaker — requirements_captured would be skipped",
                    )

        # …and prove the declaration actually materialises as a check, rather
        # than merely being present in the JSON.
        scenario = load_scenarios(["power_unit_backfill"])[0]
        turns, brief, shape, done = simulate(None, None, scenario)
        checks = check_dialog(scenario, turns, brief, shape, done)
        self.assertIn("role_family", checks)
        self.assertIn("requirements_captured", checks)

    def test_misclassified_family_is_caught(self) -> None:
        # A brief carrying the WRONG family — or the right value with default
        # spine provenance (the schema default nothing ever classified) — must
        # fail the role_family assertion (UAT 2026-08-10 L1-HRBP-17 / B11).
        scenario = load_scenarios(["power_unit_backfill"])[0]
        turns, brief, shape, done = simulate(None, None, scenario)
        wrong = dict(brief)
        wrong["roleFamily"] = "healthcare_clinical"
        self.assertFalse(check_dialog(scenario, turns, wrong, shape, done)["role_family"])
        defaulted = dict(brief)
        defaulted["spineProvenance"] = {
            k: v for k, v in dict(brief.get("spineProvenance") or {}).items() if k != "role_family"
        }
        self.assertFalse(check_dialog(scenario, turns, defaulted, shape, done)["role_family"])

    def test_starved_requirements_are_caught(self) -> None:
        # The persona stated hard dealbreakers in-dialog; a brief whose
        # requirements[] ended up empty (the L2-NEW-2 failure: hard conditions
        # filed as facet prose) must fail requirements_captured.
        scenario = load_scenarios(["power_unit_backfill"])[0]
        turns, brief, shape, done = simulate(None, None, scenario)
        starved = dict(brief)
        starved["requirements"] = []
        self.assertFalse(check_dialog(scenario, turns, starved, shape, done)["requirements_captured"])

    def test_dealbreaker_filed_as_prose_is_caught(self) -> None:
        # The check must be PER-CONDITION, not merely non-empty. A brief that
        # kept one unrelated requirement while filing every stated dealbreaker
        # as facet prose is exactly the L2-NEW-2 shape, and it satisfies both
        # `len(requirements) >= 1` and brief_core — so a non-empty check could
        # never catch it. The extraction contract (intake.py prompt v2) says
        # each named condition MUST get its own row; assert that.
        scenario = load_scenarios(["power_unit_backfill"])[0]
        self.assertEqual(scenario["dealbreakers"], ["Java", "Spring", "Kafka"])
        turns, brief, shape, done = simulate(None, None, scenario)
        prose = dict(brief)
        prose["requirements"] = [
            {"skill": "team player", "kind": "must_have", "hardness": "learnable",
             "weight": 0.5, "provenance": "stated", "confidence": 0.6}
        ]
        prose["facets"] = [
            *(brief.get("facets") or []),
            {"key": "dealbreaker_context", "label": "Must-haves",
             "value": "Java, Spring and Kafka are non-negotiable", "importance": "core"},
        ]
        checks = check_dialog(scenario, turns, prose, shape, done)
        self.assertTrue(checks["brief_core"], "the decoy must pass brief_core — that is the point")
        self.assertFalse(checks["requirements_captured"])

    def test_partially_routed_dealbreakers_are_caught(self) -> None:
        # Two of three routed is still a dropped hard condition.
        scenario = load_scenarios(["power_unit_backfill"])[0]
        turns, brief, shape, done = simulate(None, None, scenario)
        partial = dict(brief)
        partial["requirements"] = [
            r for r in brief["requirements"] if "kafka" not in str(r.get("skill", "")).lower()
        ]
        self.assertEqual(len(partial["requirements"]), 2)
        self.assertFalse(check_dialog(scenario, turns, partial, shape, done)["requirements_captured"])

    def test_narrowed_dealbreaker_phrasing_still_passes(self) -> None:
        # Tolerant in both directions: a live agent that captures "Java 17" for
        # a stated "Java", or "Flutter" for a stated "Flutter or React Native",
        # has routed the condition — only prose is a miss.
        scenario = load_scenarios(["cant_articulate_level"])[0]
        turns, brief, shape, done = simulate(None, None, scenario)
        self.assertIn("Flutter or React Native", scenario["dealbreakers"])
        narrowed = dict(brief)
        narrowed["requirements"] = [
            {**r, "skill": "Flutter"} if r.get("skill") == "Flutter or React Native" else r
            for r in brief["requirements"]
        ]
        self.assertTrue(check_dialog(scenario, turns, narrowed, shape, done)["requirements_captured"])


class _FakeIntakeServer:
    """A stand-in for the kp intake API, backed by the deterministic engine.

    Enough of the route surface for `simulate_http`: create seeds the opener,
    message runs one real `run_intake_turn`, promote hands back a slug. One
    instance per worker, exactly as `run_corpus_eval` builds real clients.
    """

    base_url = "http://localhost:3000"

    def __init__(self, on_create=None, fail_on: str | None = None) -> None:
        self._on_create = on_create
        self._fail_on = fail_on
        self._sessions: dict[str, dict] = {}
        self._next = 0

    def create(self, lang: str = "en") -> dict:
        from pipeline.jobfit.intake import opening_turn

        if self._on_create is not None:
            self._on_create()
        self._next += 1
        session_id = f"s{self._next}"
        opener = opening_turn(lang)
        self._sessions[session_id] = {
            "turns": [{"role": "interviewer", "text": opener["reply"]}],
            "brief": opener["brief"],
        }
        return {
            "id": session_id,
            "transcript": [{"role": "interviewer", "text": opener["reply"]}],
            "brief": opener["brief"],
            "shape": opener["shape"],
        }

    def attach(self, session_id: str, title: str, text: str) -> dict:
        if self._fail_on and self._fail_on in title:
            raise RuntimeError(f"simulated kill on {title}")
        return {"attachments": [{"title": title}]}

    def message(self, session_id: str, text: str) -> dict:
        from pipeline.jobfit.intake import run_intake_turn

        state = self._sessions[session_id]
        result = run_intake_turn(None, state["turns"], state["brief"], text, lang="en")
        state["turns"].append({"role": "candidate", "text": text})
        state["turns"].append({"role": "interviewer", "text": result["reply"]})
        state["brief"] = result["brief"]
        return result

    def promote(self, session_id: str, **_kw) -> dict:
        return {"slug": f"job-{session_id}", "jobId": f"id-{session_id}", "taskId": "t"}

    def get(self, session_id: str) -> dict:
        return self._sessions[session_id]


class JdGroundedCorpusTest(unittest.TestCase):
    """The JD-grounded simulation: real postings → requestor personas → the same invariants."""

    FIXTURE = [
        {
            "id": "p1",
            "title": "Registered Nurse",
            "company": "Ward Health",
            "description": "You will run the morning ward round and keep patient documentation audit-ready.",
            "requirements": ["Valid nursing licence", "Patient documentation experience"],
            "seniority": "medior",
        },
        {
            # No role_family declared and no requirements[] — the loader must
            # fill the family from title+body through the product's classifier.
            "id": "p2",
            "title": "Senior Java Backend Engineer",
            "company": "Bank",
            "jd_text": "You will design and operate resilient Java microservices. "
            "Required: 6 years experience with Java and Spring Boot. Knowledge of Kafka is required.",
        },
        {
            "id": "p3",
            "title": "registered   nurse",  # same normalized title as p1 — must not be picked twice
            "company": "Other Ward",
            "role_family": "healthcare_clinical",
            "description": "Ward nursing. Requirements: valid nursing licence.",
        },
    ]

    def _fixture_path(self, tmp: str) -> str:
        import json as _json
        import os

        path = os.path.join(tmp, "jobs.json")
        with open(path, "w", encoding="utf-8") as handle:
            _json.dump(self.FIXTURE, handle)
        return path

    def test_loader_fills_family_and_appends_requirements(self) -> None:
        import tempfile

        from pipeline.jobfit.eval.intake_corpus import load_jd_corpus

        with tempfile.TemporaryDirectory() as tmp:
            postings = load_jd_corpus(self._fixture_path(tmp))
        self.assertEqual([p.id for p in postings], ["p1", "p2", "p3"])
        # requirements[] land in the body as bullets — that is where the persona reads must-haves from.
        self.assertIn("- Valid nursing licence", postings[0].body)
        # An undeclared family is classified, not defaulted blindly to the schema default.
        self.assertEqual(postings[1].role_family, "software_engineering")
        self.assertEqual(postings[1].seniority, "senior")  # read off the title when undeclared
        self.assertEqual(postings[0].role_family, "healthcare_clinical")

    def test_stratification_is_distinct_and_round_robin(self) -> None:
        import tempfile

        from pipeline.jobfit.eval.intake_corpus import load_jd_corpus, stratified_distinct_roles

        with tempfile.TemporaryDirectory() as tmp:
            postings = load_jd_corpus(self._fixture_path(tmp))
        picked = stratified_distinct_roles(postings, 5)
        # p3 repeats p1's normalized title — a corpus of 3 yields 2 distinct roles.
        self.assertEqual([p.id for p in picked], ["p1", "p2"])
        # Round-robin: one family, then the next, before a family's second pick.
        self.assertEqual([p.role_family for p in picked], ["healthcare_clinical", "software_engineering"])
        # Deterministic: same input, same order, every run.
        self.assertEqual(picked, stratified_distinct_roles(list(reversed(postings)), 5))

    def test_persona_prompt_is_a_fenced_requestor(self) -> None:
        from pipeline.jobfit.eval.intake_corpus import Posting
        from pipeline.jobfit.eval.intake_jd_persona import golden_answers_from_jd, requestor_prompt_from_jd

        posting = Posting(
            id="p", title="Registered Nurse", company="Ward Health", role_family="healthcare_clinical",
            seniority="medior", lang="en", body="You will run the ward round.\n\n- Valid nursing licence",
        )
        prompt = requestor_prompt_from_jd(posting, "en")
        self.assertIn("<<<JOB_DESCRIPTION", prompt)
        self.assertIn("Valid nursing licence", prompt)
        self.assertIn("HIRING MANAGER", prompt)
        self.assertIn("ONE topic per reply", prompt)
        self.assertIn("not decided yet", prompt)  # the JD-is-silent rule
        self.assertIn("NEVER invent", prompt)
        answers = golden_answers_from_jd(posting)
        self.assertTrue(all(a.strip() for a in answers))
        self.assertEqual(answers, golden_answers_from_jd(posting))  # deterministic
        self.assertIn("Registered Nurse", answers[1])

    @staticmethod
    def _posting(body: str, title: str = "Registered Nurse"):
        from pipeline.jobfit.eval.intake_corpus import Posting

        return Posting(
            id="p", title=title, company="Ward Health", role_family="healthcare_clinical",
            seniority="medior", lang="en", body=body,
        )

    def test_dealbreakers_are_short_phrases_never_headings(self) -> None:
        # The GROUND TRUTH for requirements_captured. The first cut fed
        # `unrouted_dealbreakers` sentence fragments and literal headings, which
        # no requirement row can ever contain — every live role failed a check
        # its brief actually satisfied.
        from pipeline.jobfit.eval.intake_jd_persona import dealbreakers_from_jd

        found = dealbreakers_from_jd(
            self._posting(
                "Job description\n\nRequirements\n\nHigh school diploma and experience with "
                "patient documentation are required. Qualifications: knowledge of ward rounds."
            ),
            limit=3,
        )
        self.assertTrue(found)
        for phrase in found:
            self.assertEqual(phrase, phrase.lower())
            self.assertTrue(2 <= len(phrase.split()) <= 5, phrase)
            for heading in ("job description", "requirement", "qualification", "responsibilit"):
                self.assertNotIn(heading, phrase)
        self.assertIn("high school diploma", found)

    def test_dealbreaker_phrases_respect_the_length_bounds(self) -> None:
        from pipeline.jobfit.eval.intake_jd_persona import dealbreakers_from_jd

        # A cue followed by a long clause is TRUNCATED to a noun phrase, never
        # carried as a fragment; a one-word capture is dropped (too generic to
        # match anything meaningfully).
        long_clause = dealbreakers_from_jd(
            self._posting(
                "The successful candidate will have experience with electronic patient "
                "documentation systems across several wards and shifts."
            )
        )
        self.assertTrue(all(2 <= len(p.split()) <= 5 for p in long_clause), long_clause)
        self.assertEqual(dealbreakers_from_jd(self._posting("Knowledge of nursing.")), [])

    def test_a_jd_with_nothing_clean_yields_no_ground_truth(self) -> None:
        # …and the check is then NOT EMITTED, rather than passing vacuously.
        from pipeline.jobfit.eval.intake_eval import check_dialog, simulate
        from pipeline.jobfit.eval.intake_jd_persona import dealbreakers_from_jd, scenario_from_posting

        posting = self._posting(
            "greets visitors and answers telephones and directs the caller to the appropriate "
            "associate maintains and manages calendars for conference rooms",
            title="Front Desk Associate",
        )
        self.assertEqual(dealbreakers_from_jd(posting), [])
        scenario = scenario_from_posting(posting)
        self.assertEqual(scenario["dealbreakers"], [])
        turns, brief, shape, done = simulate(None, None, scenario)
        checks = check_dialog(scenario, turns, brief, shape, done)
        self.assertNotIn("requirements_captured", checks)
        self.assertTrue(all(checks.values()), checks)

    def test_stated_dealbreakers_land_as_their_own_requirement_rows(self) -> None:
        # The offline half of the contract the persona prompt states live: each
        # phrase leads the must-have answer, so it becomes its own row.
        from pipeline.jobfit.eval.intake_eval import check_dialog, simulate
        from pipeline.jobfit.eval.intake_jd_persona import scenario_from_posting

        posting = self._posting(
            "Requirements: high school diploma. Experience with patient documentation is required."
        )
        scenario = scenario_from_posting(posting)
        self.assertTrue(scenario["dealbreakers"])
        turns, brief, shape, done = simulate(None, None, scenario)
        skills = [str(r.get("skill", "")).lower() for r in brief["requirements"]]
        for phrase in scenario["dealbreakers"]:
            self.assertIn(phrase, skills)
        self.assertTrue(check_dialog(scenario, turns, brief, shape, done)["requirements_captured"])

    def test_persona_prompt_names_the_non_negotiables(self) -> None:
        from pipeline.jobfit.eval.intake_jd_persona import dealbreakers_from_jd, requestor_prompt_from_jd

        posting = self._posting("Requirements: high school diploma is required.")
        prompt = requestor_prompt_from_jd(posting)
        self.assertIn("NON-NEGOTIABLES", prompt)
        for phrase in dealbreakers_from_jd(posting):
            self.assertIn(phrase, prompt)
        # …and a JD with nothing screenable tells the persona to say so, not invent one.
        bare = requestor_prompt_from_jd(self._posting("greets visitors and answers telephones"))
        self.assertIn("rather than inventing", bare)

    def test_corpus_run_passes_every_invariant_offline(self) -> None:
        import tempfile

        from pipeline.jobfit.eval.intake_eval import main

        with tempfile.TemporaryDirectory() as tmp:
            code = main(["--no-llm", "--jd-corpus", self._fixture_path(tmp), "--roles", "2", "--strict"])
        self.assertEqual(code, 0)

    def test_resume_skips_recorded_roles(self) -> None:
        import json as _json
        import os
        import tempfile

        from pipeline.jobfit.eval.intake_eval import main

        with tempfile.TemporaryDirectory() as tmp:
            dump = os.path.join(tmp, "dump")
            argv = ["--no-llm", "--jd-corpus", self._fixture_path(tmp), "--roles", "2", "--dump", dump]
            self.assertEqual(main(argv), 0)
            with open(os.path.join(dump, "run.json"), encoding="utf-8") as handle:
                first = _json.load(handle)
            self.assertEqual(first["ran"], 2)
            self.assertEqual(first["resumed"], 0)
            self.assertTrue(os.path.exists(os.path.join(dump, "transcripts", first["rows"][0]["name"] + ".md")))
            self.assertTrue(os.path.exists(os.path.join(dump, "briefs", first["rows"][0]["name"] + ".json")))
            self.assertEqual(main(argv + ["--resume"]), 0)
            with open(os.path.join(dump, "run.json"), encoding="utf-8") as handle:
                second = _json.load(handle)
        self.assertEqual(second["ran"], 0, "every recorded role must be skipped on resume")
        self.assertEqual(second["resumed"], 2)
        self.assertEqual([r["name"] for r in second["rows"]], [r["name"] for r in first["rows"]])

    def _pairs(self, tmp: str, roles: int = 3):
        """Pairs for THREE distinct roles (the class fixture repeats a title)."""
        import json as _json
        import os

        from pipeline.jobfit.eval.intake_eval import corpus_pairs

        path = os.path.join(tmp, "jobs3.json")
        with open(path, "w", encoding="utf-8") as handle:
            _json.dump(
                [
                    *self.FIXTURE[:2],
                    {
                        "id": "p4",
                        "title": "Logistics Planner",
                        "company": "Depot",
                        "role_family": "operations_logistics",
                        "description": "Requirements: high school diploma. Experience with shift planning.",
                    },
                ],
                handle,
            )
        pairs = corpus_pairs(path, roles, "en")
        self.assertEqual(len(pairs), 3)
        return pairs

    @staticmethod
    def _report_role_order(report: str) -> list[str]:
        rows = [ln for ln in report.splitlines() if ln.startswith("| ") and not ln.startswith("| role")]
        return [ln.split("|")[1].strip() for ln in rows]

    def test_workers_run_every_role_and_report_in_order(self) -> None:
        # Concurrency must not reorder the report: rows are collected by the
        # role's index in the deterministic selection, not by completion time.
        import tempfile

        from pipeline.jobfit.eval.intake_eval import run_corpus_eval

        with tempfile.TemporaryDirectory() as tmp:
            pairs = self._pairs(tmp)
            report, ok, reported = run_corpus_eval(
                pairs, no_llm=True, cap=20, color=False, workers=3,
                client_factory=lambda: _FakeIntakeServer(),
            )
        self.assertEqual(reported, len(pairs))
        self.assertTrue(ok, report)
        self.assertEqual(self._report_role_order(report), [s["name"] for _p, s in pairs])
        self.assertIn("promoted", report)  # the HTTP-only column

    def test_run_json_is_written_after_each_role_not_at_the_end(self) -> None:
        # The defect this pins: a killed sweep used to leave an EMPTY dump
        # directory, so --resume had nothing to read.
        import json as _json
        import os
        import tempfile

        from pipeline.jobfit.eval.intake_eval import run_corpus_eval

        seen: list[int] = []
        with tempfile.TemporaryDirectory() as tmp:
            dump = os.path.join(tmp, "dump")
            run_json = os.path.join(dump, "run.json")

            def observe() -> None:
                if os.path.exists(run_json):
                    with open(run_json, encoding="utf-8") as handle:
                        seen.append(len(_json.load(handle)["rows"]))
                else:
                    seen.append(0)

            pairs = self._pairs(tmp)
            run_corpus_eval(
                pairs, no_llm=True, cap=20, color=False, dump=dump, workers=1,
                client_factory=lambda: _FakeIntakeServer(on_create=observe),
            )
            names = [s["name"] for _p, s in pairs]
            for index, name in enumerate(names):
                self.assertTrue(os.path.exists(os.path.join(dump, "transcripts", name + ".md")))
                self.assertGreaterEqual(len(seen), index + 1)
        # Role 1 saw no file; every later role saw the ones before it already persisted.
        self.assertEqual(seen[0], 0)
        self.assertEqual(seen[1:], list(range(1, len(seen))))

    def test_resume_after_a_kill_finishes_the_remaining_roles(self) -> None:
        import os
        import tempfile

        from pipeline.jobfit.eval.intake_eval import run_corpus_eval

        with tempfile.TemporaryDirectory() as tmp:
            dump = os.path.join(tmp, "dump")
            pairs = self._pairs(tmp)
            doomed = pairs[-1][1]["title"]
            with self.assertRaises(RuntimeError):
                run_corpus_eval(
                    pairs, no_llm=True, cap=20, color=False, dump=dump, workers=1,
                    client_factory=lambda: _FakeIntakeServer(fail_on=doomed),
                )
            # The rows that DID finish survived the crash…
            self.assertTrue(os.path.exists(os.path.join(dump, "run.json")))
            report, ok, reported = run_corpus_eval(
                pairs, no_llm=True, cap=20, color=False, dump=dump, resume=True, workers=1,
                client_factory=lambda: _FakeIntakeServer(),
            )
        # …and the resumed run reports ALL roles, not only the one it ran.
        self.assertEqual(reported, len(pairs))
        self.assertTrue(ok, report)
        self.assertIn("resumed", report)
        self.assertEqual(self._report_role_order(report), [s["name"] for _p, s in pairs])

    def test_http_client_refuses_a_public_host(self) -> None:
        # No network: the guard fires in the constructor, before any request.
        from pipeline.jobfit.eval.intake_http_client import IntakeHttpClient, IntakeHttpError

        with self.assertRaises(IntakeHttpError) as caught:
            IntakeHttpClient("https://kp.example.com", allowed_hosts=frozenset())
        self.assertIn("not a loopback/private kp server", str(caught.exception))
        # …and an explicitly allowlisted host is accepted.
        self.assertEqual(
            IntakeHttpClient("https://kp.example.com/", allowed_hosts={"kp.example.com"}).base_url,
            "https://kp.example.com",
        )
        # Loopback is always legal.
        self.assertEqual(IntakeHttpClient("http://localhost:3000").base_url, "http://localhost:3000")

    def test_http_client_is_sealed_offline_except_loopback(self) -> None:
        import unittest.mock

        from pipeline.jobfit.eval.intake_http_client import IntakeHttpClient, IntakeHttpError

        with unittest.mock.patch.dict("os.environ", {"KP_OFFLINE": "1"}):
            IntakeHttpClient("http://127.0.0.1:3000")  # on-box hop stays legal
            with self.assertRaises(IntakeHttpError) as caught:
                IntakeHttpClient("http://10.0.0.5:3000", allowed_hosts={"10.0.0.5"})
        self.assertIn("KP_OFFLINE", str(caught.exception))

    def test_simulate_http_runs_the_whole_product_path(self) -> None:
        # No network and no server: a fake client backed by the SAME deterministic
        # engine the route runs. What is under test here is the sequence the HTTP
        # mode performs — create → attach the JD → one message per answer →
        # promote — and that check_dialog grades an HTTP session exactly like an
        # in-process one.
        from pipeline.jobfit.eval.intake_corpus import Posting
        from pipeline.jobfit.eval.intake_eval import check_dialog
        from pipeline.jobfit.eval.intake_http_client import simulate_http
        from pipeline.jobfit.eval.intake_jd_persona import scenario_from_posting
        from pipeline.jobfit.intake import opening_turn, run_intake_turn

        posting = Posting(
            id="p", title="Registered Nurse", company="Ward Health", role_family="healthcare_clinical",
            seniority="medior", lang="en",
            body="You will run the morning ward round.\n\n- Valid nursing licence\n- Patient documentation",
        )
        scenario = scenario_from_posting(posting, "en", "power_unit")

        class FakeClient:
            base_url = "http://localhost:3000"

            def __init__(self) -> None:
                self.attachments: list[tuple[str, str]] = []
                self.promotes = 0
                self.turns: list[dict] = []
                self.brief: dict = {}

            def create(self, lang: str = "en") -> dict:
                opener = opening_turn(lang)
                self.turns = [{"role": "interviewer", "text": opener["reply"]}]
                self.brief = opener["brief"]
                return {"id": "sess-1", "transcript": [{"role": "interviewer", "text": opener["reply"]}],
                        "brief": opener["brief"], "shape": opener["shape"]}

            def attach(self, session_id: str, title: str, text: str) -> dict:
                self.attachments.append((title, text))
                return {"attachments": self.attachments}

            def message(self, session_id: str, text: str) -> dict:
                result = run_intake_turn(None, self.turns, self.brief, text, lang="en")
                self.turns.append({"role": "candidate", "text": text})
                self.turns.append({"role": "interviewer", "text": result["reply"]})
                self.brief = result["brief"]
                return result

            def promote(self, session_id: str, **_kw) -> dict:
                self.promotes += 1
                return {"slug": "registered-nurse", "jobId": "job-1", "taskId": "t1"}

        client = FakeClient()
        result = simulate_http(client, None, posting, scenario, cap=20)
        self.assertEqual(len(client.attachments), 1, "the JD must ride along as exactly one note")
        self.assertIn("Valid nursing licence", client.attachments[0][1])
        self.assertTrue(result["done"])
        self.assertEqual(client.promotes, 1)
        self.assertEqual(result["promoted"]["slug"], "registered-nurse")
        checks = check_dialog(scenario, result["turns"], result["brief"], result["shape"], result["done"])
        self.assertTrue(all(checks.values()), checks)

    def test_http_client_retries_a_429_then_succeeds(self) -> None:
        import io
        import unittest.mock
        import urllib.error

        from pipeline.jobfit.eval.intake_http_client import IntakeHttpClient

        client = IntakeHttpClient("http://localhost:3000", sleep=lambda _s: None)
        throttled = urllib.error.HTTPError(
            "http://localhost:3000/api/intake", 429, "Too Many Requests",
            {"Retry-After": "2"}, io.BytesIO(b'{"code":"TOO_MANY_REQUESTS"}'),
        )

        class _Response:
            def read(self):
                return b'{"id":"s1"}'

            def __enter__(self):
                return self

            def __exit__(self, *_a):
                return False

        with unittest.mock.patch("urllib.request.urlopen", side_effect=[throttled, _Response()]) as opened:
            self.assertEqual(client.create("en"), {"id": "s1"})
        self.assertEqual(opened.call_count, 2)


if __name__ == "__main__":
    unittest.main()


class SentinelOverHttpTest(unittest.TestCase):
    def test_no_premature_end_is_not_measured_when_the_wire_strips_the_sentinel(self) -> None:
        from pipeline.jobfit.eval.intake_eval import check_dialog

        turns = [
            {"role": "interviewer", "text": "Where did the team feel the gap?"},
            {"role": "requestor", "text": "Reporting."},
            {"role": "interviewer", "text": "Read-back done. What did I miss?"},
        ]
        brief = {"title": "Analyst", "requirements": [{"skill": "sql", "kind": "must_have"}]}
        in_process = check_dialog({}, turns, brief, "power_unit", True)
        over_http = check_dialog({}, turns, brief, "power_unit", True, sentinel_on_wire=False)
        # In-process the sentinel is expected and its absence is a real finding.
        self.assertIs(in_process["no_premature_end"], False)
        # Over HTTP the route strips it by contract, so the key is not emitted.
        self.assertNotIn("no_premature_end", over_http)
        self.assertTrue(over_http["completed"])

