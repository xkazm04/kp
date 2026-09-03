"""The engine states the language it actually wrote the narrative in.

``generate`` produces the rationale either from the LLM (which is told
``language_directive(lang)``) or from ``deterministic_reasoning``, whose prose is
assembled from English string literals in ``match_reasoning.py`` — so a ``--lang cs``
run that falls back keyless answers in ENGLISH. That fact used to be documented in two
docstrings and re-derived on the TypeScript side from ``source == "llm"``
(``narrativeLangFor`` in ``app/_lib/reasoning-cache-policy.ts``), which is how the
panel's honest "shown in {language}" note came to be computed from the ask rather than
the answer once already. ``reasoning_cli`` now emits ``narrativeLang`` and TS reads it.
"""

from __future__ import annotations

import io
import json
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory

from pipeline.jobfit import reasoning_cli
from pipeline.jobfit.i18n import LANG_NAMES
from pipeline.jobfit.match_reasoning import NARRATIVE_FALLBACK_LANG, narrative_lang_for

CANDIDATE = {
    "skills": ["Python", "SQL"],
    "seniority": "medior",
    "roleFamily": "software_engineering",
    "languages": ["English"],
    "yearsExperience": 4.0,
    "summary": "Backend engineer.",
}
JOB = {
    "id": "nl-1",
    "title": "Backend Engineer",
    "company": "Acme",
    "location": "Prague",
    "workMode": "hybrid",
    "seniority": "medior",
    "roleFamily": "software_engineering",
    "requiredSkills": ["Python", "SQL"],
    "description": "Build data services in Python.",
}


class NarrativeLangForTest(unittest.TestCase):
    def test_an_llm_answer_is_in_the_requested_language(self) -> None:
        for lang in LANG_NAMES:
            with self.subTest(lang=lang):
                self.assertEqual(narrative_lang_for("llm", lang), lang)

    def test_the_deterministic_template_is_english_whatever_was_asked(self) -> None:
        for lang in LANG_NAMES:
            with self.subTest(lang=lang):
                self.assertEqual(narrative_lang_for("deterministic", lang), "en")
        self.assertEqual(NARRATIVE_FALLBACK_LANG, "en")

    def test_an_unknown_source_fails_safe_to_english(self) -> None:
        # Anything that is not an authoritative LLM answer came from the template.
        self.assertEqual(narrative_lang_for("", "cs"), "en")
        self.assertEqual(narrative_lang_for("cached", "cs"), "en")

    def test_a_bogus_lang_is_normalized_not_forwarded(self) -> None:
        # The TS side validates the field before rendering it, but the engine must not
        # emit an unknown code in the first place.
        self.assertEqual(narrative_lang_for("llm", "klingon"), "en")
        self.assertEqual(narrative_lang_for("llm", "cs-CZ"), "cs")


class ReasoningCliEmitsNarrativeLangTest(unittest.TestCase):
    """End-to-end through main(), keyless (--no-llm forces the template)."""

    def _run(self, lang: str) -> dict:
        with TemporaryDirectory() as tmp:
            cand = Path(tmp) / "cand.json"
            cand.write_text(json.dumps(CANDIDATE), encoding="utf-8")
            jobs = Path(tmp) / "jobs.json"
            jobs.write_text(json.dumps([JOB]), encoding="utf-8")
            buf = io.StringIO()
            with redirect_stdout(buf):
                rc = reasoning_cli.main(
                    [
                        "--candidate-json", str(cand),
                        "--jobs-json", str(jobs),
                        "--job-id", "nl-1",
                        "--no-llm",
                        "--lang", lang,
                    ]
                )
            self.assertEqual(rc, 0, buf.getvalue())
            return json.loads(buf.getvalue().strip().splitlines()[-1])

    def test_a_czech_request_that_fell_back_reports_english(self) -> None:
        payload = self._run("cs")
        self.assertEqual(payload["source"], "deterministic")
        self.assertEqual(payload["narrativeLang"], "en")

    def test_every_locale_falls_back_honestly(self) -> None:
        for lang in LANG_NAMES:
            with self.subTest(lang=lang):
                self.assertEqual(self._run(lang)["narrativeLang"], "en")

    def test_the_field_rides_beside_source_on_every_answer(self) -> None:
        payload = self._run("en")
        for key in ("jobId", "title", "total", "source", "narrativeLang", "promptVersion", "reasoning"):
            self.assertIn(key, payload)

    def test_a_missing_job_is_a_named_404_not_an_anonymous_500(self) -> None:
        # The other half of the same change: the failure envelope names its code.
        with TemporaryDirectory() as tmp:
            cand = Path(tmp) / "cand.json"
            cand.write_text(json.dumps(CANDIDATE), encoding="utf-8")
            err = io.StringIO()
            from contextlib import redirect_stderr

            with redirect_stderr(err):
                rc = reasoning_cli.main(["--candidate-json", str(cand), "--job-id", "nope-9999"])
            self.assertEqual(rc, 1)
            envelope = json.loads(err.getvalue().strip().splitlines()[-1])
            self.assertEqual(envelope["status"], 404)
            self.assertEqual(envelope["code"], "not_found")


if __name__ == "__main__":
    unittest.main()
