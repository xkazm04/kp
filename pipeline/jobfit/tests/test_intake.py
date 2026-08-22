"""Role-intake dialog engine (Phase 1) — deterministic path, merge, triage.

The keyless contract is the load-bearing one (graceful degradation is a
product property): a full scripted dialog must fill a RoleBrief with
provenance 'stated' end to end and close with a read-back. The merge rules
protect accumulated state from an LLM that forgets fields; the shape triage
implements the research doc's power-unit fast path."""

from __future__ import annotations

import json
import subprocess
import sys
import unittest

from pipeline.jobfit.intake import (
    INTAKE_PROMPT_VERSION,
    _apply_answer,
    deterministic_turn,
    detect_shape,
    extract_transcript,
    intake_system_brief,
    brief_gap_summary,
    intake_voice_fast_brief,
    run_voice_turn,
    merge_brief,
    opening_turn,
    run_intake_turn,
)
from pipeline.jobfit.rolebrief import BriefFacet, BriefRequirement, RoleBrief, coerce_role_brief


def _drive(answers: list[str], lang: str = "en") -> tuple[list[dict], dict]:
    """Drive the deterministic script: opener, then each answer in turn."""
    turns: list[dict] = []
    opener = opening_turn(lang)
    turns.append({"role": "interviewer", "text": opener["reply"]})
    brief = coerce_role_brief(opener["brief"])
    result = opener
    for answer in answers:
        result = deterministic_turn(turns, brief, answer, lang)
        turns.append({"role": "candidate", "text": answer})
        turns.append({"role": "interviewer", "text": result["reply"]})
        brief = coerce_role_brief(result["brief"])
        if result["done"]:
            break
    return turns, result


class DeterministicScriptTest(unittest.TestCase):
    def test_full_story_dialog_fills_brief_and_closes(self) -> None:
        answers = [
            "We think we need someone for the data side, not sure exactly — reporting keeps slipping",  # context (story markers)
            "Data Analyst",
            "Owns the weekly reporting; dashboards nobody has to babysit",
            "SQL\nPython",
            "dbt",
            "senior, I think",
            "Czech, English",
            "Team of 4, reports to the head of data",
            "Another quarter of manual reports and we lose the ops team's trust",
            "skip",
            "ok",  # confirm turn answering the read-back (close is a separate turn)
        ]
        _turns, result = _drive(answers)
        self.assertTrue(result["done"])
        brief = coerce_role_brief(result["brief"])
        self.assertEqual(brief.title, "Data Analyst")
        self.assertEqual(brief.seniority, "senior")
        musts = [r for r in brief.requirements if r.kind == "must_have"]
        nices = [r for r in brief.requirements if r.kind == "nice_to_have"]
        self.assertEqual({r.skill for r in musts}, {"SQL", "Python"})
        self.assertEqual([r.skill for r in nices], ["dbt"])
        self.assertTrue(all(r.provenance == "stated" for r in brief.requirements))
        self.assertTrue(brief.success_criteria)
        self.assertIn("Czech", brief.languages)
        facet_keys = {f.key for f in brief.facets}
        self.assertLessEqual({"why_now", "team_context", "urgency"}, facet_keys)
        # Skipped budget leaves no facet — a skip is not data.
        self.assertNotIn("budget_band", facet_keys)
        # The confirmed close carries the END sentinel and stays grounded.
        self.assertIn("<<END>>", result["reply"])
        self.assertIn("Data Analyst", result["reply"])
        # Spine provenance (UAT L1-CONV-3): the stated seniority is marked.
        self.assertEqual(brief.spine_provenance.get("seniority"), "stated")
        self.assertEqual(brief.spine_provenance.get("title"), "stated")

    def test_power_unit_dialog_is_short(self) -> None:
        answers = [
            "Backfill — Jarda left, we need the same again for the payments squad",
            "Java Developer",
            "Takes over Jarda's services; on-call rotation runs without gaps",
            "Java, Spring",
            "senior",
            "skip",
            "ok",
        ]
        turns, result = _drive(answers)
        self.assertTrue(result["done"])
        self.assertEqual(result["shape"], "power_unit")
        # Short path: opener + 5 questions + read-back + close ⇒ ≤8 agent turns.
        agent_turns = [t for t in turns if t["role"] == "interviewer"]
        self.assertLessEqual(len(agent_turns), 8)

    def test_source_turn_traces_every_stated_value(self) -> None:
        # Defensibility (UAT drain §2.2): the deterministic path stamps the
        # EXACT transcript index that produced each requirement/facet — the
        # turn at that index must be the requestor's answer carrying the value.
        answers = [
            "Backfill — same as our old Java developer",
            "Java Developer",
            "Services run without gaps",
            "Java, Kafka",
            "senior",
            "1.8M CZK",
            "ok",
        ]
        turns, result = _drive(answers)
        brief = coerce_role_brief(result["brief"])
        for req in brief.requirements:
            self.assertIsNotNone(req.source_turn, f"{req.skill} has no source_turn")
            self.assertEqual(turns[req.source_turn]["role"], "candidate")
            self.assertIn(req.skill, turns[req.source_turn]["text"])
        for facet in brief.facets:
            self.assertIsNotNone(facet.source_turn, f"{facet.key} has no source_turn")
            self.assertEqual(turns[facet.source_turn]["role"], "candidate")
        why_now = next(f for f in brief.facets if f.key == "why_now")
        self.assertEqual(why_now.source_turn, 1)  # the very first requestor turn

    def test_readback_correction_lands_and_closes(self) -> None:
        # UAT L1-CONV-2 (3/3 Characters): the read-back's invited correction
        # must LAND — captured as the requestor's stated words — and only then
        # does the session close.
        answers = [
            "Backfill — same as our old Java developer",
            "Java Developer",
            "Services run without gaps",
            "Java, Kafka",
            "senior",
            "skip",
            "Actually Kafka is not required, general messaging experience is enough",
        ]
        _turns, result = _drive(answers)
        self.assertTrue(result["done"])
        self.assertIn("<<END>>", result["reply"])
        brief = coerce_role_brief(result["brief"])
        corrections = [f for f in brief.facets if f.key == "correction"]
        self.assertEqual(len(corrections), 1)
        self.assertIn("messaging", corrections[0].value)
        self.assertEqual(corrections[0].provenance, "stated")
        # The close acknowledges the correction verbatim-ish.
        self.assertIn("Kafka", result["reply"])

    def test_out_of_vocabulary_grade_lands_as_stated_facet(self) -> None:
        # UAT drain 2.3 (Priya: "I told it Band 5 and it wrote 'medior'"): an
        # answer matching no enum token is captured verbatim as a stated
        # grade_label facet; the enum stays default and UNMARKED (assumed chip),
        # and the read-back carries the requestor's own grading.
        answers = [
            "It's a backfill — our ward nurse left, we need the same again",
            "Registered Nurse",
            "Runs the morning ward round independently",
            "valid nursing licence, patient documentation",
            "Band 5, roughly",
            "skip",
        ]
        _turns, result = _drive(answers)
        brief = coerce_role_brief(result["brief"])
        grades = [f for f in brief.facets if f.key == "grade_label"]
        self.assertEqual(len(grades), 1)
        self.assertIn("Band 5", grades[0].value)
        self.assertEqual(grades[0].provenance, "stated")
        # Never force-mapped: the enum default stays, and stays unmarked.
        self.assertEqual(brief.seniority, "medior")
        self.assertNotIn("seniority", brief.spine_provenance)
        # The read-back (this turn — script exhausted, awaiting confirm) carries it.
        self.assertFalse(result["done"])
        self.assertIn("Band 5", result["reply"])

    def test_a_ruled_out_level_is_never_the_captured_level(self) -> None:
        # The scan takes the first level word it finds, so an answer that RULES
        # a level OUT used to land on exactly that level — marked "stated" — and
        # the panel then chipped the requestor's rejected grade as their answer.
        for answer, expected in (
            ("Not junior - we need a senior", "senior"),
            ("Rather senior than junior", "senior"),
            ("lead, not senior", "lead"),
            ("spíš senior než junior", "senior"),
            ("senior, I think", "senior"),  # unchanged: no negator, no re-reading
        ):
            with self.subTest(answer=answer):
                brief = _apply_answer(RoleBrief(), "seniority", answer, "en", 3)
                self.assertEqual(brief.seniority, expected)
                self.assertEqual(brief.spine_provenance.get("seniority"), "stated")

    def test_answer_that_only_negates_stays_unmapped_and_verbatim(self) -> None:
        # "ne junior" says which level it ISN'T. Force-mapping it onto the enum
        # is the UAT-2.3 failure — capture it verbatim, leave the enum default
        # and UNMARKED so the panel shows it as assumed.
        brief = _apply_answer(RoleBrief(), "seniority", "ne junior", "cs", 3)
        self.assertNotIn("seniority", brief.spine_provenance)
        grades = [f for f in brief.facets if f.key == "grade_label"]
        self.assertEqual(len(grades), 1)
        self.assertIn("junior", grades[0].value)
        self.assertEqual(grades[0].provenance, "stated")

    def test_czech_comma_after_ne_is_a_correction_not_a_negation(self) -> None:
        # Czech "ne, senior" = "no, senior" (a correction); only "ne senior"
        # negates. The separator rule keeps the two apart.
        brief = _apply_answer(RoleBrief(), "seniority", "ne, senior", "cs", 3)
        self.assertEqual(brief.seniority, "senior")

    def test_czech_grade_label_is_localized(self) -> None:
        answers = [
            "Je to náhrada — odešla nám sestra, potřebujeme stejnou pozici",
            "Zdravotní sestra",
            "Samostatně zvládá ranní vizitu",
            "platná registrace, dokumentace pacientů",
            "tarifní třída 10",
            "přeskočit",
        ]
        _turns, result = _drive(answers, lang="cs")
        brief = coerce_role_brief(result["brief"])
        grades = [f for f in brief.facets if f.key == "grade_label"]
        self.assertEqual(len(grades), 1)
        self.assertEqual(grades[0].label, "Úroveň (jak uvedeno)")

    def test_readback_waits_for_confirmation(self) -> None:
        # The read-back turn itself must NOT close the session.
        answers = ["Backfill — same again", "QA Engineer", "Releases ship tested", "Playwright", "junior", "skip"]
        _turns, result = _drive(answers)
        self.assertFalse(result["done"])
        self.assertNotIn("<<END>>", result["reply"])
        self.assertIn("QA Engineer", result["reply"])  # grounded read-back, awaiting confirm

    def test_czech_script_localizes(self) -> None:
        opener = opening_turn("cs")
        self.assertIn("Pojďme", opener["reply"])
        turns = [{"role": "interviewer", "text": opener["reply"]}]
        result = deterministic_turn(turns, RoleBrief(), "hledáme posilu do backendu", "cs")
        self.assertIn("nazvali", result["reply"])  # the cs title question

    def test_opening_is_deterministic_and_nonjudgmental(self) -> None:
        opener = opening_turn("en")
        self.assertEqual(opener["source"], "deterministic")
        self.assertIn("no wrong answers", opener["reply"])


class ShapeTriageTest(unittest.TestCase):
    def test_backfill_markers_yield_power_unit(self) -> None:
        turns = [{"role": "candidate", "text": "This is a backfill for the same role as the old JD"}]
        self.assertEqual(detect_shape(turns), "power_unit")

    def test_hedging_yields_story(self) -> None:
        turns = [{"role": "candidate", "text": "We think we maybe need someone, not sure what level"}]
        self.assertEqual(detect_shape(turns), "story")

    def test_undecided_defaults_to_story_after_two_turns(self) -> None:
        turns = [
            {"role": "candidate", "text": "Hello"},
            {"role": "candidate", "text": "It concerns the platform group"},
        ]
        self.assertEqual(detect_shape(turns), "story")
        self.assertIsNone(detect_shape(turns[:1]))


class MergeBriefTest(unittest.TestCase):
    def test_update_cannot_drop_stated_requirements(self) -> None:
        base = RoleBrief(
            title="Data Analyst",
            seniority="senior",
            requirements=[BriefRequirement(skill="SQL", kind="must_have", provenance="stated", confidence=0.9)],
            facets=[BriefFacet(key="urgency", value="critical", provenance="stated", confidence=0.9)],
        )
        update = RoleBrief(requirements=[BriefRequirement(skill="Python", kind="must_have", provenance="inferred")])
        merged = merge_brief(base, update)
        self.assertEqual({r.skill for r in merged.requirements}, {"SQL", "Python"})
        self.assertEqual(merged.title, "Data Analyst")  # empty update title keeps base
        self.assertEqual(merged.seniority, "senior")  # default-medior update can't regress
        self.assertEqual(merged.facets[0].value, "critical")

    def test_stated_grading_never_regresses_to_inferred(self) -> None:
        base = RoleBrief(requirements=[BriefRequirement(skill="SQL", kind="must_have", provenance="stated", confidence=0.9)])
        update = RoleBrief(requirements=[BriefRequirement(skill="SQL", kind="nice_to_have", provenance="inferred")])
        merged = merge_brief(base, update)
        self.assertEqual(merged.requirements[0].kind, "must_have")
        self.assertEqual(merged.requirements[0].provenance, "stated")

    def test_stated_update_can_revise_stated_base(self) -> None:
        base = RoleBrief(requirements=[BriefRequirement(skill="SQL", kind="must_have", provenance="stated")])
        update = RoleBrief(requirements=[BriefRequirement(skill="SQL", kind="nice_to_have", provenance="stated")])
        merged = merge_brief(base, update)
        self.assertEqual(merged.requirements[0].kind, "nice_to_have")  # the requestor demoted it

    def test_correction_onto_a_schema_default_value_lands(self) -> None:
        # The requestor said senior / data_ai, then corrected both — the update
        # re-emits them as 'stated'. The old value sentinels (`!= "medior"`,
        # `!= "software_engineering"`) could not tell a captured default from a
        # schema one, so the correction was dropped WHILE its stated provenance
        # merged in: the panel chipped the OLD value as stated (UAT L1-CONV-3).
        base = RoleBrief(
            seniority="senior",
            role_family="data_ai",
            spine_provenance={"seniority": "stated", "role_family": "stated"},
        )
        update = RoleBrief(
            seniority="medior",
            role_family="software_engineering",
            spine_provenance={"seniority": "stated", "role_family": "stated"},
        )
        merged = merge_brief(base, update)
        self.assertEqual(merged.seniority, "medior")
        self.assertEqual(merged.role_family, "software_engineering")
        self.assertEqual(merged.spine_provenance["seniority"], "stated")

    def test_inferred_update_never_regresses_a_stated_spine_scalar(self) -> None:
        # Same rule the requirements merge applies: a stated grading is not
        # overwritten by the model's own inference.
        base = RoleBrief(seniority="senior", spine_provenance={"seniority": "stated"})
        update = RoleBrief(seniority="junior", spine_provenance={"seniority": "inferred"})
        self.assertEqual(merge_brief(base, update).seniority, "senior")

    def test_merge_stamps_prompt_version(self) -> None:
        merged = merge_brief(RoleBrief(), RoleBrief())
        self.assertEqual(merged.prompt_version, INTAKE_PROMPT_VERSION)


class RunIntakeTurnTest(unittest.TestCase):
    def test_no_provider_uses_deterministic_with_source(self) -> None:
        turns = [{"role": "interviewer", "text": opening_turn("en")["reply"]}]
        result = run_intake_turn(None, turns, None, "we need a backfill, same as before", lang="en")
        self.assertEqual(result["source"], "deterministic")
        self.assertFalse(result["done"])
        self.assertTrue(result["reply"])

    def test_llm_end_requires_sentinel(self) -> None:
        class FakeProvider:
            def complete_json(self, prompt, *, system=None, timeout=None, expected_keys=None):
                return {"reply": "Great, we're done.", "brief": {}, "shape": "story", "done": True}

        result = run_intake_turn(FakeProvider(), [], None, "hello", lang="en")
        self.assertEqual(result["source"], "llm")
        self.assertFalse(result["done"])  # done=true without <<END>> is not a close

    def test_system_brief_carries_the_register(self) -> None:
        brief = intake_system_brief("en")
        for marker in (
            "coaching session, not an interrogation",
            "ONE question per turn",
            "90 days",
            "<<END>>",
            "stated",
            # UAT drain 2.6 — the explicit LLM-era clause (role-existence doubt
            # anchors in outcomes, hypotheses offered as disposable).
            "doubts the role should exist",
            "regardless of who or what does it",
            # UAT drain 2.3 — out-of-vocabulary grades are captured, never mapped.
            "grade_label",
            # UAT L2-NEW-2 — the ROUTING half: a named hard condition owns a
            # requirements[] row, the facet keeps only the story behind it.
            "ROUTING",
            "OWN requirements[] row",
            "never an alternative home",
        ):
            self.assertIn(marker, brief)


class VoicePlaneTest(unittest.TestCase):
    _TURNS = [
        {"role": "interviewer", "text": "Where did the team feel the missing person most?"},
        {"role": "candidate", "text": "It's a backfill — our Java developer left the payments squad"},
        {"role": "interviewer", "text": "What should they have done in 90 days?"},
        {"role": "candidate", "text": "Take over the services, on-call runs without gaps. Java and Spring are dealbreakers."},
    ]

    def test_voice_fast_brief_speaks_no_json_contract(self) -> None:
        brief = intake_voice_fast_brief("en")
        # Persona + technique carry over; the text-plane JSON machinery must NOT.
        for marker in ("coaching session, not an interrogation", "ONE question per turn", "SPOKEN conversation"):
            self.assertIn(marker, brief)
        for forbidden in ("no JSON",):
            self.assertIn(forbidden, brief)
        for forbidden in ("spineProvenance", "done=true", "Respond as JSON"):
            self.assertNotIn(forbidden, brief)

    def test_voice_turn_llm_is_plain_text_and_leaves_brief_to_extraction(self) -> None:
        class FakeFastProvider:
            def complete(self, prompt, *, system=None, timeout=None):
                class R:
                    text = "So the on-call gaps are the real pain — who covers them today?"
                assert "CAPTURED SO FAR" in prompt  # the gap digest feeds the fast thread
                assert "no JSON" in (system or "")
                return R()

        base = RoleBrief(title="Java Developer", spine_provenance={"title": "stated"})
        result = run_voice_turn(FakeFastProvider(), self._TURNS, base.model_dump(by_alias=True), "Nobody, that's the problem", lang="en")
        self.assertEqual(result["source"], "llm")
        self.assertFalse(result["done"])
        self.assertNotIn("brief", result)  # extraction belongs to the periodic thread
        self.assertTrue(result["reply"].startswith("So the on-call"))

    def test_voice_turn_keyless_uses_scripted_engine_with_inline_brief(self) -> None:
        result = run_voice_turn(None, self._TURNS[:1], None, "It's a backfill — our Java developer left", lang="en")
        self.assertEqual(result["source"], "deterministic")
        self.assertIn("brief", result)  # the scripted engine extracts inline for free
        self.assertTrue(result["reply"])

    def test_voice_turn_provider_failure_degrades_with_reason(self) -> None:
        class Down:
            def complete(self, prompt, *, system=None, timeout=None):
                raise RuntimeError("down")

        result = run_voice_turn(Down(), self._TURNS[:1], None, "hello", lang="en")
        self.assertEqual(result["source"], "deterministic")
        self.assertIn("fallbackReason", result)
        self.assertIn("brief", result)

    def test_brief_gap_summary_names_captured_and_missing(self) -> None:
        base = RoleBrief(
            title="Java Developer",
            spine_provenance={"title": "stated"},
            requirements=[BriefRequirement(skill="Java", kind="must_have", provenance="stated")],
        )
        digest = brief_gap_summary(base)
        self.assertIn("title: Java Developer", digest)
        self.assertIn("dealbreakers: Java", digest)
        self.assertIn("STILL MISSING", digest)
        self.assertIn("90-day outcomes", digest)
        self.assertIn("seniority", digest)

    def test_extract_keyless_is_honest(self) -> None:
        # No provider → the brief is UNCHANGED and the result says so; nothing
        # is silently invented from the transcript.
        base = RoleBrief(title="Java Developer", spine_provenance={"title": "stated"})
        result = extract_transcript(None, self._TURNS, base.model_dump(by_alias=True), lang="en")
        self.assertEqual(result["source"], "deterministic")
        self.assertFalse(result["extracted"])
        self.assertEqual(coerce_role_brief(result["brief"]).title, "Java Developer")
        self.assertEqual(result["shape"], "power_unit")  # triage still runs (deterministic)

    def test_extract_llm_merges_onto_base(self) -> None:
        class FakeProvider:
            def complete_json(self, prompt, *, system=None, timeout=None, expected_keys=None):
                return {
                    "brief": {
                        "title": "Java Developer",
                        "requirements": [
                            {"skill": "Java", "kind": "must_have", "provenance": "stated", "confidence": 0.9}
                        ],
                    },
                    "shape": "power_unit",
                }

        base = RoleBrief(
            requirements=[BriefRequirement(skill="SQL", kind="must_have", provenance="stated", confidence=0.9)]
        )
        result = extract_transcript(FakeProvider(), self._TURNS, base.model_dump(by_alias=True), lang="en")
        self.assertEqual(result["source"], "llm")
        self.assertTrue(result["extracted"])
        merged = coerce_role_brief(result["brief"])
        # merge_brief semantics hold: the pre-call stated requirement survives.
        self.assertEqual({r.skill for r in merged.requirements}, {"SQL", "Java"})


class CliSmokeTest(unittest.TestCase):
    def test_opening_and_no_llm_turn(self) -> None:
        out = subprocess.run(
            [sys.executable, "-m", "pipeline.jobfit.intake_cli", "--opening", "--lang", "en"],
            capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(out.returncode, 0, out.stderr)
        opening = json.loads(out.stdout)
        self.assertIn("reply", opening)
        self.assertEqual(opening["source"], "deterministic")


class AttachmentsTest(unittest.TestCase):
    _ATTACH = [{"kind": "jd", "title": "Legacy JD", "text": "Senior Java Developer. Must: Java, Spring."}]

    def test_llm_prompt_carries_the_fence_and_rules(self) -> None:
        captured: dict = {}

        class FakeProvider:
            def complete_json(self, prompt, *, system=None, timeout=None, expected_keys=None):
                captured["prompt"] = prompt
                return {"reply": "Noted.", "brief": {}, "shape": "story", "done": False}

        run_intake_turn(FakeProvider(), [], None, "hello", lang="en", attachments=self._ATTACH)
        self.assertIn("<<<ATTACHED_MATERIAL>>>", captured["prompt"])
        self.assertIn("Legacy JD", captured["prompt"])
        # The trust framing: third-party data, inferred-until-confirmed, requestor wins.
        self.assertIn("REFERENCE MATERIAL", captured["prompt"])
        self.assertIn("'inferred'", captured["prompt"])
        self.assertIn("the requestor wins", captured["prompt"])

    def test_no_attachments_means_no_fence(self) -> None:
        captured: dict = {}

        class FakeProvider:
            def complete_json(self, prompt, *, system=None, timeout=None, expected_keys=None):
                captured["prompt"] = prompt
                return {"reply": "Noted.", "brief": {}, "shape": "story", "done": False}

        run_intake_turn(FakeProvider(), [], None, "hello", lang="en")
        self.assertNotIn("ATTACHED_MATERIAL", captured["prompt"])

    def test_attachment_budget_truncates(self) -> None:
        captured: dict = {}

        class FakeProvider:
            def complete_json(self, prompt, *, system=None, timeout=None, expected_keys=None):
                captured["prompt"] = prompt
                return {"reply": "Noted.", "brief": {}, "shape": "story", "done": False}

        big = [{"kind": "note", "title": "Huge", "text": "x" * 20_000}]
        run_intake_turn(FakeProvider(), [], None, "hello", lang="en", attachments=big)
        self.assertIn("truncated for the prompt budget", captured["prompt"])
        self.assertLess(captured["prompt"].count("x"), 12_000)

    def test_deterministic_acknowledges_once_and_never_mines(self) -> None:
        # Keyless honesty: the scripted path says it can see the material but
        # cannot mine it — once — and the brief gains nothing from the text.
        opener = opening_turn("en")
        turns = [{"role": "interviewer", "text": opener["reply"]}]
        first = run_intake_turn(
            None, turns, opener["brief"], "we need a backfill, same as before", lang="en", attachments=self._ATTACH
        )
        self.assertIn("attached material", first["reply"].lower())
        brief = coerce_role_brief(first["brief"])
        self.assertEqual(brief.requirements, [])  # nothing invented from the JD text
        # Second exchange: the ack does not repeat.
        turns2 = turns + [
            {"role": "candidate", "text": "we need a backfill, same as before"},
            {"role": "interviewer", "text": first["reply"]},
        ]
        second = run_intake_turn(None, turns2, first["brief"], "Java Developer", lang="en", attachments=self._ATTACH)
        self.assertNotIn("attached material", second["reply"].lower())

    def test_ack_prepended_to_a_readback_still_closes_cleanly(self) -> None:
        # The keyless ack is PREPENDED to the reply, so a read-back produced on
        # the turn material was first attached no longer STARTS with the
        # read-back line. Prefix-only detection then missed it: the requestor's
        # "ok" fell through to the last scripted question and was recorded as a
        # stated `budget_band: "ok"` facet they never gave, and the session read
        # back a second time instead of closing.
        answers = [
            "Backfill - same as our old Java developer",
            "Java Developer",
            "Services run without gaps",
            "Java, Kafka",
            "senior",
        ]
        opener = opening_turn("en")
        turns = [{"role": "interviewer", "text": opener["reply"]}]
        brief = opener["brief"]
        for answer in answers:
            result = run_intake_turn(None, turns, brief, answer, lang="en")
            turns += [{"role": "candidate", "text": answer}, {"role": "interviewer", "text": result["reply"]}]
            brief = result["brief"]
        # The last scripted answer arrives together with freshly attached material.
        result = run_intake_turn(None, turns, brief, "skip", lang="en", attachments=self._ATTACH)
        self.assertIn("attached material", result["reply"].lower())
        self.assertIn("Here's what I took away", result["reply"])  # ack + read-back in one turn
        turns += [{"role": "candidate", "text": "skip"}, {"role": "interviewer", "text": result["reply"]}]

        confirm = run_intake_turn(None, turns, result["brief"], "ok", lang="en", attachments=self._ATTACH)
        self.assertTrue(confirm["done"], "the confirmed read-back must close the session")
        self.assertIn("<<END>>", confirm["reply"])
        facet_keys = {f.key for f in coerce_role_brief(confirm["brief"]).facets}
        self.assertNotIn("budget_band", facet_keys)  # "ok" is a confirmation, not pay

    def test_voice_fast_thread_sees_titles_only(self) -> None:
        captured: dict = {}

        class FakeProvider:
            def complete(self, prompt, *, system=None, timeout=None):
                captured["prompt"] = prompt

                class R:
                    text = "And what should they get done?"

                return R()

        from pipeline.jobfit.intake import run_voice_turn

        run_voice_turn(FakeProvider(), [], None, "hello", lang="en", attachments=self._ATTACH)
        self.assertIn("Legacy JD", captured["prompt"])
        self.assertNotIn("Must: Java, Spring.", captured["prompt"])  # body never rides the fast thread


if __name__ == "__main__":
    unittest.main()
