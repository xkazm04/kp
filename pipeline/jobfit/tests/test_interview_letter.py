"""The interview FEEDBACK LETTER drafter (spark interview-feedback-letter, WP-alpha).

``automation.draft_interview_letter`` drafts the letter a candidate asked for after a person
decided on them; ``automation_cli interview-letter`` exposes it to the TS runner
(app/_lib/interview-letter-run.ts). What is pinned here:

  * WHAT REACHES THE PROMPT is competency NAMES and nothing else about the interview — no
    rating, no verdict, no evidence quote, no summary. A transcript is seeded with
    distinctive phrases, and neither the prompt nor any output may carry one of them.
  * EVERY OUTPUT is checked: a model letter that quotes the candidate, carries a number, names
    the scoring machinery or a protected characteristic, or runs over the cap is discarded
    WHOLE and reported as ``deterministic`` — never repaired, never passed through.
  * KEYLESS is a supported path: the body is EMPTY (the TS side builds the catalog template in
    the candidate's language) and the competency names it needs are present.
  * The OUTCOME shapes the frame, never the content: the same record yields the same areas for
    a hired and a not-selected candidate.
"""

from __future__ import annotations

import io
import json
import re
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from pipeline.jobfit import automation, automation_cli

# Distinctive things the candidate SAID. Each appears verbatim in the transcript and as an
# evidence quote on the scorecard — the two places the record holds their words.
PHRASE_A = "I rewrote the Zanzibar ledger over one rainy weekend"
PHRASE_B = "our purple giraffe deployment pipeline never slept"
PHRASE_SHORT = "honestly quite terrified"

TRANSCRIPT = [
    {"role": "interviewer", "text": "Tell me about a system you owned."},
    {"role": "candidate", "text": f"Well, {PHRASE_A}, and after that {PHRASE_B}."},
    {"role": "interviewer", "text": "How did the handover go?"},
    {"role": "candidate", "text": f"I was {PHRASE_SHORT} but it worked."},
]

SCORECARD = {
    "summary": f"Strong on ownership; said '{PHRASE_A}'. Confidence 0.82.",
    "recommendation": "hold",
    "ratings": [
        {"competency": "Technical depth", "rating": 5, "evidence": PHRASE_A},
        {"competency": "Communication", "rating": 4, "evidence": PHRASE_B},
        {"competency": "Problem-solving", "rating": 2, "evidence": PHRASE_SHORT},
        {
            "competency": "Experience & fit",
            "rating": 1,
            "evidence": "It was fine I guess, nothing special there",
        },
        # The not-assessed sentinel: a 3 with the placeholder. Neither strong nor weak.
        {
            "competency": "Motivation",
            "rating": 3,
            "evidence": "Not assessed (auto-synthesis unavailable).",
        },
        # Off-rubric: a laundered "competency" built from the candidate's own words.
        {"competency": "Zanzibar ledger heroics", "rating": 5, "evidence": PHRASE_A},
    ],
    "confidence": {"band": "high", "score": 0.82},
}

KIT_TITLES = ["Payments ownership", "  Incident handling  ", "payments ownership", ""]

CANDIDATE_WORDS = [PHRASE_A, PHRASE_B, PHRASE_SHORT]


class _Fake:
    """A provider double that records the prompt and returns a canned payload."""

    def __init__(self, payload):
        self.payload = payload
        self.prompt: str | None = None

    def complete_json(self, prompt, system=None, expected_keys=None):
        self.prompt = prompt
        return self.payload


def _draft(provider=None, outcome="not_selected", **kw):
    return automation.draft_interview_letter(
        SCORECARD,
        outcome=outcome,
        kit_titles=KIT_TITLES,
        job_title=kw.pop("job_title", "Backend Engineer"),
        company=kw.pop("company", "Acme"),
        lang=kw.pop("lang", "en"),
        provider=provider,
    )


def _assert_no_candidate_words(test: unittest.TestCase, text: str, where: str) -> None:
    folded = automation._normalize_for_grounding(text)
    for phrase in (
        PHRASE_A,
        PHRASE_B,
        PHRASE_SHORT,
        "zanzibar",
        "purple giraffe",
        "terrified",
    ):
        test.assertNotIn(
            automation._normalize_for_grounding(phrase),
            folded,
            f"{where} carries the candidate's words: {phrase!r}",
        )


CLEAN_BODY = (
    "Dear candidate,\n\nthank you for the time you gave us in the interview for the Backend Engineer role. "
    "Your depth on the technical side and the clarity with which you explained your work came through well. "
    "One area worth developing is how you break an unfamiliar problem into steps before choosing a path; "
    "practising that out loud on a small design exercise would help.\n\n"
    "Thank you again, and we wish you well.\n\nThe hiring team"
)


class LetterEvidenceTest(unittest.TestCase):
    def test_the_seeded_record_really_holds_the_phrases(self) -> None:
        # Never a tautological pass: every phrase the tests below assert ABSENT is present in
        # the candidate's own transcript turns and on the scorecard those turns produced.
        spoken = " ".join(t["text"] for t in TRANSCRIPT if t["role"] == "candidate")
        for phrase in CANDIDATE_WORDS:
            self.assertIn(phrase, spoken)
            self.assertIn(phrase, json.dumps(SCORECARD))

    def test_names_only_allowlisted_capped_and_without_ratings(self) -> None:
        ev = automation.letter_evidence(SCORECARD, KIT_TITLES)
        self.assertEqual(ev["wentWell"], ["Technical depth", "Communication"])
        # Weakest first; the not-assessed Motivation is neither list, and "Experience & fit"
        # (rated 1) is never handed back as something to work on — see the next test.
        self.assertEqual(ev["toWorkOn"], ["Problem-solving"])
        self.assertEqual(
            set(ev),
            {"wentWell", "toWorkOn", "topics"},
            "names only — no rating, no verdict, no summary",
        )
        self.assertNotIn(
            "Zanzibar ledger heroics",
            json.dumps(ev),
            "an off-rubric (laundered) name never reaches a letter",
        )
        self.assertLessEqual(len(ev["wentWell"]), automation.LETTER_MAX_WENT_WELL)
        self.assertLessEqual(len(ev["toWorkOn"]), automation.LETTER_MAX_TO_WORK_ON)

    def test_a_reading_of_the_person_is_never_advice(self) -> None:
        # Every excluded name is a live rubric axis — a renamed axis must fail here rather
        # than silently start coming back as "work on your motivation".
        vocabulary = set(automation._rubric_competency_names())
        for name in automation.LETTER_NOT_A_DEVELOPMENT_AREA:
            self.assertIn(name, vocabulary, f"{name!r} is no longer a rubric axis")
        weak_everywhere = {
            "ratings": [
                {
                    "competency": n,
                    "rating": 1,
                    "evidence": "a real observed answer here",
                }
                for n in sorted(automation.LETTER_NOT_A_DEVELOPMENT_AREA)
            ]
        }
        self.assertEqual(automation.letter_evidence(weak_everywhere)["toWorkOn"], [])
        # …but the same axes may be PRAISED.
        strong = {
            "ratings": [
                {
                    "competency": "Motivation",
                    "rating": 5,
                    "evidence": "a real observed answer here",
                }
            ]
        }
        self.assertEqual(automation.letter_evidence(strong)["wentWell"], ["Motivation"])

    def test_kit_topics_are_cleaned_and_deduplicated(self) -> None:
        ev = automation.letter_evidence(SCORECARD, KIT_TITLES)
        self.assertEqual(ev["topics"], ["Payments ownership", "Incident handling"])

    def test_no_scorecard_is_no_evidence_not_an_error(self) -> None:
        self.assertEqual(
            automation.letter_evidence(None),
            {"wentWell": [], "toWorkOn": [], "topics": []},
        )
        self.assertEqual(
            automation.letter_evidence({"ratings": "garbage"}),
            {"wentWell": [], "toWorkOn": [], "topics": []},
        )

    def test_the_quotes_are_collected_only_to_check_against(self) -> None:
        self.assertEqual(
            automation.scorecard_quotes(SCORECARD),
            [
                PHRASE_A,
                PHRASE_B,
                PHRASE_SHORT,
                "It was fine I guess, nothing special there",
                PHRASE_A,
            ],
            "every real evidence quote, placeholders excluded",
        )


class PromptTest(unittest.TestCase):
    def test_the_prompt_carries_no_candidate_words_no_ratings_no_verdict(self) -> None:
        fake = _Fake({"body": CLEAN_BODY, "language": "English"})
        _draft(fake)
        prompt = fake.prompt or ""
        self.assertTrue(prompt, "the provider was called")
        _assert_no_candidate_words(self, prompt, "the prompt")
        self.assertNotIn('"rating"', prompt, "no rating key reaches the prompt")
        self.assertNotIn(
            "recommendation", prompt, "the interview verdict is not an input"
        )
        self.assertNotIn("0.82", prompt, "the model's confidence is not an input")
        self.assertNotIn(
            "Strong on ownership",
            prompt,
            "the recruiter-facing summary is not an input",
        )
        # The competency names ARE the input, and the kit titles ride beside them.
        for name in (
            "Technical depth",
            "Communication",
            "Problem-solving",
            "Payments ownership",
        ):
            self.assertIn(name, prompt)
        self.assertIn(
            "INTERVIEW_RECORD",
            prompt,
            "the record-derived names are fenced like every candidate-derived block",
        )

    def test_the_outcome_shapes_the_frame_never_the_content(self) -> None:
        a, b = _Fake({"body": CLEAN_BODY}), _Fake({"body": CLEAN_BODY})
        rejected, _ = _draft(a, outcome="not_selected")
        hired, _ = _draft(b, outcome="hired")
        self.assertIn("NOT selected", a.prompt or "")
        self.assertIn("HIRED", b.prompt or "")
        self.assertEqual(rejected["wentWell"], hired["wentWell"])
        self.assertEqual(rejected["toWorkOn"], hired["toWorkOn"])

    def test_the_letter_is_asked_for_in_the_candidates_language(self) -> None:
        fake = _Fake({"body": CLEAN_BODY})
        _draft(fake, lang="cs")
        self.assertIn("in Czech", fake.prompt or "")

    def test_an_unknown_outcome_is_refused(self) -> None:
        with self.assertRaises(ValueError):
            automation.draft_interview_letter(SCORECARD, outcome="withdrawn")


class OutputGuardTest(unittest.TestCase):
    def test_a_clean_model_letter_is_the_draft(self) -> None:
        result, source = _draft(_Fake({"body": CLEAN_BODY, "language": "English"}))
        self.assertEqual(source, "llm")
        self.assertEqual(result["body"], CLEAN_BODY)
        self.assertEqual(
            result["promptVersion"], automation.INTERVIEW_LETTER_PROMPT_VERSION
        )

    def test_every_forbidden_letter_is_discarded_whole(self) -> None:
        cases = {
            "quotes the candidate (5-word run)": CLEAN_BODY
            + f"\nAs you said, {PHRASE_A.lower()}.",
            "quotes the candidate (short quote whole)": CLEAN_BODY
            + f"\nYou told us you were {PHRASE_SHORT}.",
            "digit rating": CLEAN_BODY + "\nTechnical depth: 4/5.",
            "percent": CLEAN_BODY + "\nYou matched 80 % of the role.",
            "names the machinery": CLEAN_BODY + "\nYour scorecard was strong.",
            "rubric": CLEAN_BODY + "\nOn our rubric you did well.",
            "czech points": "Děkujeme za rozhovor. Bodování dopadlo dobře.",
            "protected characteristic": CLEAN_BODY
            + "\nGiven your age, this role was not the best match.",
            "over the cap": "x" * (automation.LETTER_MAX_CHARS + 1),
            "empty": "   ",
        }
        for name, body in cases.items():
            with self.subTest(name):
                result, source = _draft(_Fake({"body": body, "language": "English"}))
                self.assertEqual(
                    source, "deterministic", f"{name}: the draft must be discarded"
                )
                self.assertEqual(result["body"], "", f"{name}: nothing of it survives")
                _assert_no_candidate_words(
                    self, json.dumps(result, ensure_ascii=False), f"{name} output"
                )
                self.assertIsNone(re.search(r"\d", result["body"]))

    def test_a_digit_in_the_role_title_is_the_role_not_a_rating(self) -> None:
        body = "Thank you for interviewing for the Level 2 Support Engineer role. Communication came through well."
        result, source = _draft(
            _Fake({"body": body}), job_title="Level 2 Support Engineer"
        )
        self.assertEqual(source, "llm")
        self.assertEqual(result["body"], body)

    def test_letter_problem_names_each_reason(self) -> None:
        self.assertIsNone(
            automation.letter_problem(
                CLEAN_BODY,
                candidate_words=CANDIDATE_WORDS,
                role_terms=["Backend Engineer"],
            )
        )
        self.assertEqual(automation.letter_problem("", candidate_words=[]), "empty")
        self.assertEqual(automation.letter_problem("Your score was fine."), "machinery")
        self.assertEqual(automation.letter_problem("You were 3 of 5."), "number")
        self.assertEqual(
            automation.letter_problem(
                f"You said {PHRASE_B}.", candidate_words=CANDIDATE_WORDS
            ),
            "quotes_candidate",
        )

    def test_quote_detection_ignores_case_and_punctuation_but_not_paraphrase(
        self,
    ) -> None:
        self.assertTrue(
            automation.quotes_candidate(
                "…OUR PURPLE, giraffe deployment pipeline!", [PHRASE_B]
            )
        )
        self.assertFalse(
            automation.quotes_candidate(
                "You described keeping a deployment pipeline running.", [PHRASE_B]
            ),
            "a paraphrase of the SUBJECT is not a quote of the WORDS",
        )


class KeylessTest(unittest.TestCase):
    def test_keyless_returns_an_empty_body_and_the_names_the_template_needs(
        self,
    ) -> None:
        for outcome in automation.LETTER_OUTCOMES:
            with self.subTest(outcome):
                result, source = _draft(None, outcome=outcome)
                self.assertEqual(source, "deterministic")
                self.assertEqual(
                    result["body"],
                    "",
                    "the keyless letter is the TS catalog template, never Python prose",
                )
                self.assertEqual(
                    result["wentWell"], ["Technical depth", "Communication"]
                )
                self.assertEqual(result["toWorkOn"], ["Problem-solving"])
                blob = json.dumps(
                    {k: result[k] for k in ("body", "wentWell", "toWorkOn")},
                    ensure_ascii=False,
                )
                _assert_no_candidate_words(self, blob, "the keyless output")
                self.assertIsNone(
                    re.search(r"\d", blob), "no digit anywhere the template will read"
                )


class CliTest(unittest.TestCase):
    def _run(self, *argv: str) -> tuple[int, str, str]:
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = automation_cli.main(list(argv))
        return code, out.getvalue(), err.getvalue()

    def test_the_command_drafts_keyless_from_the_record_without_a_candidate_profile(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            spec = Path(tmp, "letter.json")
            spec.write_text(
                json.dumps(
                    {
                        "outcome": "hired",
                        "jobTitle": "Backend Engineer",
                        "company": "Acme",
                        "kitTopics": KIT_TITLES,
                    }
                ),
                encoding="utf-8",
            )
            scorecard = Path(tmp, "scorecard.json")
            scorecard.write_text(json.dumps(SCORECARD), encoding="utf-8")
            code, out, _ = self._run(
                "interview-letter",
                "--letter-json",
                str(spec),
                "--scorecard-file",
                str(scorecard),
                "--lang",
                "de",
                "--no-llm",
            )
        self.assertEqual(code, 0)
        envelope = json.loads(out)
        self.assertEqual(envelope["source"], "deterministic")
        self.assertEqual(envelope["result"]["body"], "")
        self.assertEqual(envelope["result"]["language"], "German")
        self.assertEqual(
            envelope["result"]["wentWell"], ["Technical depth", "Communication"]
        )
        _assert_no_candidate_words(self, out, "the CLI envelope")

    def test_a_missing_letter_spec_is_an_honest_400(self) -> None:
        code, _, err = self._run("interview-letter", "--no-llm")
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(err)["status"], 400)

    def test_an_unknown_outcome_is_an_honest_400(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            spec = Path(tmp, "letter.json")
            spec.write_text(json.dumps({"outcome": "maybe"}), encoding="utf-8")
            code, _, err = self._run(
                "interview-letter", "--letter-json", str(spec), "--no-llm"
            )
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(err)["code"], "invalid_input")


if __name__ == "__main__":
    unittest.main()
