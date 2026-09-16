"""CV studio (cv_polish) — the keyless contract is the load-bearing one.

A full scripted dialog must reach `done` with parsed preferences (salary floor WITH
currency and period), never answer an empty reply, keep every source line of the CV
somewhere (cvMarkdown or unreadable), and open in all four locales."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import pathlib
import unittest

from pipeline.jobfit.jobseeker import (
    CV_POLISH_PROMPT_VERSION,
    FIT_PROMPT_VERSION,
    build_fit_prompt,
    deterministic_fit_turn,
    deterministic_turn,
    fit_gaps,
    opening_turn,
    parse_locations,
    parse_salary,
    parse_seniority,
    parse_work_modes,
    preferences_complete,
    reflow_cv,
    run_turn,
)

CV_TEXT = """Jana Nováková
Praha · jana@example.com · +420 777 000 111

Profil
Passionate team player with a proven track record in backend development.

Pracovní zkušenosti
2019–2024 Backend Engineer, Acme s.r.o.
Responsible for the payments platform.
Cut p99 latency by 40% and scaled the service to 12M requests/day.

Vzdělání
2015–2019 ČVUT FIT, bakalář

Dovednosti
Python, Go, PostgreSQL, Kubernetes

Jazyky
čeština (rodilý mluvčí), angličtina (C1)
"""

PROFILE = {
    "displayName": "Jana Nováková",
    "roleFamily": "software_engineering",
    "languages": ["Czech", "English"],
    "location": "Praha",
    "yearsExperience": 5,
    "skillClaims": [{"skill": "Python", "level": "strong", "provenance": "professional"}],
    "evidence": [{"kind": "job", "title": "Backend Engineer", "text": "Responsible for the payments platform.", "skills": ["Python"]}],
}


def _req(lang: str = "en", **over):
    base = {
        "kind": "cv_polish",
        "lang": lang,
        "profile": PROFILE,
        "preferences": {},
        "cvSourceText": CV_TEXT,
        "artifact": None,
        "transcript": [],
        "message": None,
    }
    base.update(over)
    return base


def _drive(answers: list[str], lang: str = "en") -> tuple[list[dict], dict]:
    """Opener, then each answer in turn, carrying the artifact forward as the route does."""
    turns: list[dict] = []
    result = opening_turn(_req(lang))
    turns.append({"role": "interviewer", "text": result["reply"]})
    artifact = result["artifact"]
    for answer in answers:
        result = deterministic_turn(_req(lang, transcript=turns, message=answer, artifact=artifact))
        turns.append({"role": "candidate", "text": answer})
        turns.append({"role": "interviewer", "text": result["reply"]})
        artifact = result["artifact"]
        if result["done"]:
            break
    return turns, result


class SalaryParseTest(unittest.TestCase):
    def test_czech_amount_with_currency_and_period(self) -> None:
        self.assertEqual(parse_salary("60 000 Kč měsíčně"), {"amount": 60000, "currency": "CZK", "period": "month"})

    def test_k_suffix(self) -> None:
        self.assertEqual(parse_salary("60k CZK"), {"amount": 60000, "currency": "CZK", "period": "month"})

    def test_eur_per_month_slash(self) -> None:
        self.assertEqual(parse_salary("3000 EUR/month"), {"amount": 3000, "currency": "EUR", "period": "month"})

    def test_symbol_and_thousands_separator(self) -> None:
        self.assertEqual(parse_salary("at least €3,000 per month"), {"amount": 3000, "currency": "EUR", "period": "month"})

    def test_yearly(self) -> None:
        self.assertEqual(parse_salary("1 200 000 CZK ročně"), {"amount": 1200000, "currency": "CZK", "period": "year"})
        self.assertEqual(parse_salary("85k GBP per year"), {"amount": 85000, "currency": "GBP", "period": "year"})

    def test_no_currency_is_not_a_floor(self) -> None:
        # No conversion, no guessing: a bare number is answered None and re-asked.
        self.assertIsNone(parse_salary("60 000"))
        self.assertIsNone(parse_salary("about sixty thousand"))


class ParsersTest(unittest.TestCase):
    def test_locations_split_countries_from_places(self) -> None:
        parsed = parse_locations("Praha, Brno and Germany, remote is fine")
        self.assertEqual(parsed["locations"], ["Praha", "Brno"])
        self.assertEqual(parsed["countries"], ["de"])
        self.assertEqual(parsed["workModes"], ["remote"])

    def test_work_modes_from_card_labels_in_any_locale(self) -> None:
        self.assertEqual(parse_work_modes("Na dálku, Hybridně"), ["remote", "hybrid"])
        self.assertEqual(parse_work_modes("Vor Ort"), ["onsite"])

    def test_seniority(self) -> None:
        self.assertEqual(parse_seniority("Senior"), "senior")
        self.assertEqual(parse_seniority("Confirmé"), "medior")
        self.assertIsNone(parse_seniority("I don't know"))


class ReflowTest(unittest.TestCase):
    def test_every_source_line_lands_somewhere(self) -> None:
        markdown, unreadable = reflow_cv(CV_TEXT, "en")
        haystack = markdown + "\n" + "\n".join(unreadable)
        for line in CV_TEXT.splitlines():
            line = line.strip()
            if not line:
                continue
            # Heading words become a localized heading; every other line is verbatim.
            if line in ("Profil", "Pracovní zkušenosti", "Vzdělání", "Dovednosti", "Jazyky"):
                continue
            self.assertIn(line, haystack, f"lost source line: {line!r}")

    def test_sections_are_recognised_across_locales(self) -> None:
        markdown, unreadable = reflow_cv(CV_TEXT, "en")
        self.assertIn("# Jana Nováková", markdown)
        for heading in ("## Summary", "## Experience", "## Education", "## Skills", "## Languages"):
            self.assertIn(heading, markdown)
        self.assertEqual(unreadable, [])

    def test_unrecognised_blocks_are_listed_not_dropped(self) -> None:
        text = "Jana Nováková\n\nSomething odd here\nwith two lines\n\nExperience\n2020 Dev, Acme\n\nRandom block after heading-less gap"
        markdown, unreadable = reflow_cv(text, "en")
        self.assertIn("## Experience", markdown)
        self.assertIn("- 2020 Dev, Acme", markdown)
        # The pre-heading block is the header (name + contact-ish lines)…
        self.assertIn("Something odd here", markdown)
        # …and a later block under a recognised heading stays there; nothing vanishes.
        haystack = markdown + "\n".join(unreadable)
        self.assertIn("Random block after heading-less gap", haystack)

    def test_no_headings_at_all(self) -> None:
        markdown, unreadable = reflow_cv("Jan Dvořák\nline two\nline three", "cs")
        self.assertIn("# Jan Dvořák", markdown)
        self.assertEqual(unreadable, ["line two line three"])


class DeterministicDialogTest(unittest.TestCase):
    def test_openings_non_empty_in_four_locales(self) -> None:
        for lang in ("en", "cs", "de", "fr"):
            result = opening_turn(_req(lang))
            self.assertTrue(result["reply"].strip(), lang)
            self.assertEqual(result["source"], "deterministic")
            self.assertNotIn("fallbackLang", result, "a scripted locale is not a stand-in")
            self.assertEqual(result["promptVersion"], CV_POLISH_PROMPT_VERSION)
            self.assertTrue(result["artifact"]["cvMarkdown"].startswith("# "))

    def test_unscripted_locale_is_disclosed(self) -> None:
        result = opening_turn(_req("pl"))
        self.assertEqual(result["fallbackLang"], "en")

    def test_full_flow_reaches_done_in_at_most_eight_turns(self) -> None:
        answers = [
            "Praha, Brno",
            "60 000 Kč měsíčně",
            "Backend Engineer, Platform Engineer",
            "Remote, Hybrid",
            "Senior",
            "yes",
        ]
        turns, result = _drive(answers)
        self.assertTrue(result["done"], result["reply"])
        seeker_turns = [t for t in turns if t["role"] == "candidate"]
        self.assertLessEqual(len(seeker_turns), 8)
        prefs = result["artifact"]["preferences"]
        self.assertEqual(prefs["locations"], ["Praha", "Brno"])
        self.assertEqual(prefs["salaryFloor"], {"amount": 60000, "currency": "CZK", "period": "month"})
        self.assertEqual(prefs["targetTitles"], ["Backend Engineer", "Platform Engineer"])
        self.assertEqual(prefs["workModes"], ["remote", "hybrid"])
        self.assertEqual(prefs["seniority"], "senior")
        # Seeded from the CV, never asked.
        self.assertEqual(prefs["languages"], ["Czech", "English"])
        self.assertTrue(preferences_complete(prefs))
        for turn in turns:
            self.assertTrue(turn["text"].strip(), "never an empty reply")

    def test_card_turns_carry_choices(self) -> None:
        # After the three prose slots the work-modes question rides a decision card.
        _turns, result = _drive(["Praha", "3000 EUR/month", "Data Engineer"])
        self.assertIsNotNone(result["choices"])
        self.assertEqual(result["choices"]["field"], "workModes")
        self.assertTrue(result["choices"]["multi"])
        self.assertEqual([o["id"] for o in result["choices"]["options"]], ["remote", "hybrid", "onsite"])

    def test_salary_without_currency_is_re_asked_once_never_guessed(self) -> None:
        turns, result = _drive(["Praha", "60 000"])
        self.assertNotIn("salaryFloor", result["artifact"]["preferences"])
        self.assertIn("currency", result["reply"])
        turns, result = _drive(["Praha", "60 000", "60 000 CZK"])
        self.assertEqual(result["artifact"]["preferences"]["salaryFloor"]["currency"], "CZK")

    def test_confirm_over_incomplete_set_does_not_close(self) -> None:
        turns, result = _drive(["Praha", "skip", "Backend Engineer", "Remote", "Senior", "yes"])
        self.assertFalse(result["done"])
        self.assertNotIn("salaryFloor", result["artifact"]["preferences"])

    def test_correction_after_readback_is_parsed(self) -> None:
        turns, result = _drive(["Praha", "60 000 Kč", "Backend Engineer", "Remote", "Senior", "no, 70 000 Kč"])
        self.assertFalse(result["done"])
        self.assertEqual(result["artifact"]["preferences"]["salaryFloor"]["amount"], 70000)
        self.assertIn("Salary floor", result["reply"])

    def test_suggestions_are_grounded_in_source_sentences(self) -> None:
        result = opening_turn(_req())
        suggestions = result["artifact"]["suggestions"]
        for s in suggestions:
            self.assertIn(s["before"], CV_TEXT)
            self.assertTrue(s["section"] and s["after"] and s["why"])

    def test_apply_suggestion_rewrites_the_sheet(self) -> None:
        opening = opening_turn(_req())
        artifact = {**opening["artifact"], "suggestions": [{"section": "Summary", "before": "Passionate team player with a proven track record in backend development.", "after": "Backend engineer, 5 years on payments.", "why": "test"}]}
        turns = [{"role": "interviewer", "text": opening["reply"]}]
        result = deterministic_turn(_req(transcript=turns, message="Apply suggestion: Summary", artifact=artifact))
        self.assertIn("Backend engineer, 5 years on payments.", result["artifact"]["cvMarkdown"])
        self.assertNotIn("Passionate team player", result["artifact"]["cvMarkdown"])
        self.assertEqual(result["artifact"]["suggestions"], [])
        self.assertIn("Summary", result["reply"])

    def test_run_turn_without_provider_is_the_twin(self) -> None:
        turns, _ = _drive(["Praha"])
        result = run_turn(None, _req(transcript=turns, message="3000 EUR/month", artifact=None))
        self.assertEqual(result["source"], "deterministic")
        self.assertEqual(result["fallbackReason"], "no provider available")
        self.assertEqual(result["artifact"]["preferences"]["salaryFloor"]["currency"], "EUR")


POSTING = {
    "id": "p1",
    "title": "Senior Backend Engineer",
    "company": "Acme s.r.o.",
    "location": "Praha",
    "workMode": "hybrid",
    "salaryMin": None,
    "salaryMax": None,
    "salaryCurrency": None,
    "salaryPeriod": None,
    "bodyText": "We build the payments platform. You will own services in Python and Go. Experience with Kafka is required. Terraform is a plus. Fluent Czech and English.",
    "url": "https://example.com/jobs/1",
    "matchTotal": 71,
    "fitTier": "promising",
    "reasoning": None,
}

MATCH = {
    "total": 71,
    "fitTier": "promising",
    "matchedSkills": ["Python", "Go"],
    "missingSkills": ["Kafka", "Terraform"],
    "unprovenSkills": ["Kubernetes"],
    "eligibility": [
        {"key": "salary", "state": "unknown", "detail": "The posting states no pay."},
        {"key": "location", "state": "ok", "detail": "Praha is one of your places."},
    ],
    "confidence": {"low": 64, "high": 78, "level": "moderate", "drivers": []},
}

DISMISSALS = [
    {"reason": "salary", "note": None, "title": "Backend Developer"},
    {"reason": "salary", "note": "too low", "title": "Platform Engineer"},
    {"reason": "salary", "note": None, "title": "Go Developer"},
    {"reason": "location", "note": None, "title": "SRE"},
]


def _fit_req(lang: str = "en", **over):
    base = _req(lang, kind="fit", posting=POSTING, match=MATCH, dismissals=DISMISSALS)
    base.update(over)
    return base


def _drive_fit(answers: list[str], lang: str = "en") -> tuple[list[dict], dict]:
    turns: list[dict] = []
    result = opening_turn(_fit_req(lang))
    turns.append({"role": "interviewer", "text": result["reply"]})
    artifact = result["artifact"]
    for answer in answers:
        result = deterministic_fit_turn(_fit_req(lang, transcript=turns, message=answer, artifact=artifact))
        turns.append({"role": "candidate", "text": answer})
        turns.append({"role": "interviewer", "text": result["reply"]})
        artifact = result["artifact"]
        if result["done"]:
            break
    return turns, result


class FitDialogTest(unittest.TestCase):
    def test_openings_in_four_locales_carry_the_gap_card(self) -> None:
        for lang in ("en", "cs", "de", "fr"):
            result = opening_turn(_fit_req(lang))
            self.assertTrue(result["reply"].strip(), lang)
            self.assertEqual(result["source"], "deterministic")
            self.assertEqual(result["promptVersion"], FIT_PROMPT_VERSION)
            self.assertNotIn("fallbackLang", result)
            self.assertEqual(result["artifact"]["verdict"], "undecided")
            self.assertIsNotNone(result["choices"], lang)
            self.assertEqual(result["choices"]["field"], "gap")
            self.assertLessEqual(len(result["choices"]["options"]), 3)
            self.assertIn("71", result["reply"])

    def test_every_gap_cites_a_posting_sentence_or_a_match_field(self) -> None:
        gaps = fit_gaps(_fit_req())
        self.assertTrue(gaps)
        for g in gaps:
            self.assertTrue(g["source"], g)
            self.assertTrue(g["source"] in POSTING["bodyText"] or g["source"] in ("missingSkills", "unprovenSkills") or g["source"].startswith("eligibility."), g)
        # Kafka is named by a posting sentence, so THAT sentence is the citation.
        kafka = next(g for g in gaps if g["skill"] == "Kafka")
        self.assertIn("Kafka is required", kafka["source"])
        # On the wire the citation rides inside the mitigation.
        result = opening_turn(_fit_req())
        for g in result["artifact"]["gaps"]:
            self.assertIn("Cited:", g["mitigation"], g)

    def test_keyless_flow_reaches_a_verdict_in_at_most_six_turns(self) -> None:
        turns, result = _drive_fit(["Kafka", "Terraform", "Apply"])
        self.assertTrue(result["done"], result["reply"])
        self.assertEqual(result["artifact"]["verdict"], "apply")
        seeker_turns = [t for t in turns if t["role"] == "candidate"]
        self.assertLessEqual(len(seeker_turns), 6)
        # After two gaps the verdict card was on the table.
        mid = deterministic_fit_turn(_fit_req(transcript=turns[:3], message="Terraform", artifact=result["artifact"]))
        self.assertEqual(mid["choices"]["field"], "verdict")
        # The gap answer states a benign reading beside the risk.
        self.assertIn("benign reading", turns[2]["text"])
        for turn in turns:
            self.assertTrue(turn["text"].strip())

    def test_cover_note_is_profile_facts_only(self) -> None:
        _turns, result = _drive_fit(["Kafka", "Terraform", "Apply"])
        note = result["artifact"]["coverNoteMd"]
        self.assertTrue(note)
        self.assertLessEqual(note.count(". "), 4)
        self.assertIn("Senior Backend Engineer", note)
        self.assertIn("Acme s.r.o.", note)
        self.assertIn("Praha", note)
        self.assertIn("Python", note)
        # Nothing the profile does not state: no invented employer, no invented number.
        self.assertNotIn("Kafka", note)

    def test_skip_and_undecided_close_without_a_cover_note(self) -> None:
        _turns, result = _drive_fit(["Kafka", "Skip"])
        self.assertTrue(result["done"])
        self.assertEqual(result["artifact"]["verdict"], "skip")
        self.assertIsNone(result["artifact"]["coverNoteMd"])

    def test_dismissals_reach_the_prompt_and_the_opening(self) -> None:
        prompt = build_fit_prompt(_fit_req(), "hello")
        self.assertIn("RECENT DISMISSALS", prompt)
        self.assertIn("Platform Engineer: salary (too low)", prompt)
        self.assertIn("<<<POSTING_TEXT>>>", prompt)
        # The taste line: three dismissals for pay, and this posting states no pay.
        opening = opening_turn(_fit_req())
        self.assertIn("dismissed 3 recent postings for pay", opening["reply"])
        self.assertIn("states no pay", opening["reply"])

    def test_no_gaps_offers_the_verdict_card_at_once(self) -> None:
        clean = {**MATCH, "missingSkills": [], "unprovenSkills": [], "eligibility": []}
        result = opening_turn(_fit_req(match=clean))
        self.assertEqual(result["choices"]["field"], "verdict")
        self.assertEqual(result["artifact"]["gaps"], [])

    def test_run_turn_without_provider_is_the_fit_twin(self) -> None:
        turns, _ = _drive_fit(["Kafka"])
        result = run_turn(None, _fit_req(transcript=turns, message="Terraform", artifact=None))
        self.assertEqual(result["source"], "deterministic")
        self.assertEqual(result["fallbackReason"], "no provider available")
        self.assertEqual(result["promptVersion"], FIT_PROMPT_VERSION)
        self.assertTrue(result["artifact"]["gaps"])


class CliTest(unittest.TestCase):
    def test_cli_round_trip_keyless(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / "in.json"
            path.write_text(json.dumps(_req("cs")), encoding="utf-8")
            proc = subprocess.run(
                [sys.executable, "-m", "pipeline.jobfit.jobseeker_cli", "--input-json", str(path), "--no-llm"],
                capture_output=True, text=True, encoding="utf-8", check=False,
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            out = json.loads(proc.stdout.strip().splitlines()[-1])
            self.assertIn("Mám vaše CV", out["reply"])
            self.assertEqual(out["source"], "deterministic")

    def test_cli_rejects_a_bad_kind_with_the_envelope(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / "in.json"
            path.write_text(json.dumps(_req(kind="nope")), encoding="utf-8")
            proc = subprocess.run(
                [sys.executable, "-m", "pipeline.jobfit.jobseeker_cli", "--input-json", str(path)],
                capture_output=True, text=True, encoding="utf-8", check=False,
            )
            self.assertNotEqual(proc.returncode, 0)
            envelope = json.loads(proc.stderr.strip().splitlines()[-1])
            self.assertEqual(envelope["code"], "invalid_input")
            self.assertEqual(envelope["status"], 400)


if __name__ == "__main__":
    unittest.main()
