"""LOCALE PARITY for the observed LLM-era controls (2026-08-22 sweep).

A dev case is delivered in the posting's language: the brief/tasks, the seed's README +
DECISIONS scaffolding and BOTH chat personas render in `--lang` (devcase_cli, chat.py,
seed_materializer). Two keyword sets that grade the resulting evidence were English-only,
so the SAME candidate behaviour scored differently by language:

  * prompt_signals._VERIFY_RE — a Czech/German/French "please verify this" produced
    verificationAsks=0, which costs 0.2 of the observed verification term in
    evaluate_submission's deterministic path (judgment 80 instead of 100).
  * artifact_checks.canary_outcomes — the FLAGGED verdict required the literal substring
    "wrong", so a Czech decision log calling the planted flaw out scored `propagated`
    ("the planted flaw survived untouched"), the strongest negative the check emits.

Both are the CV pipeline's confirmed gendered-inflection defect in another costume: a
word list that only speaks one of the four locales the product ships.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit.devcase.artifact_checks import canary_outcomes
from pipeline.jobfit.devcase.evaluate import evaluate_submission
from pipeline.jobfit.devcase.process_events import tooling_from_events
from pipeline.jobfit.devcase.prompt_signals import derive_prompt_signals

CASE = {
    "title": "Rate table",
    "brief": "Fix the rate table and keep a decision log.",
    "coverProbes": [{"id": "p1", "kind": "verification_trap", "where": "config.py", "reveals": "r"}],
    "rubricDimensions": [],
}
ROLE = {"title": "Analyst", "seniority": "medior"}

# One "please double-check your answer" per locale, phrased the way a candidate would.
VERIFY_BY_LANG = {
    "en": "Can you verify that the rate calculation is right?",
    "cs": "Můžeš ověřit, jestli ten výpočet sazby sedí?",
    "de": "Kannst du bitte überprüfen, ob die Berechnung stimmt?",
    "fr": "Peux-tu vérifier que le calcul du taux est correct ?",
}


def _chat(text: str) -> list[dict]:
    return [
        {"channel": "assistant", "role": "user", "text": text},
        {"channel": "assistant", "role": "model", "text": "Sure."},
    ]


class VerificationAskIsDetectedInEveryLocale(unittest.TestCase):
    def test_every_locale_registers_the_verification_ask(self) -> None:
        for lang, text in VERIFY_BY_LANG.items():
            with self.subTest(lang=lang):
                sig = derive_prompt_signals(_chat(text), CASE)
                self.assertEqual(sig["verificationAsks"], 1, f"{lang}: verification ask not detected")

    def test_a_plain_generation_prompt_is_still_not_a_verification_ask(self) -> None:
        """Non-vacuity: the widened pattern must not mark every prompt as verification."""
        for lang, text in {
            "en": "Write the rate table module for me.",
            "cs": "Napiš mi prosím modul se sazbami.",
            "de": "Schreibe mir bitte das Modul für die Tabelle.",
            "fr": "Écris-moi le module du tableau des taux.",
        }.items():
            with self.subTest(lang=lang):
                self.assertEqual(derive_prompt_signals(_chat(text), CASE)["verificationAsks"], 0)

    def test_identical_behaviour_scores_identically_across_locales(self) -> None:
        """End to end: same events, same work, message in a different language — the
        deterministic evaluator must land on the same judgment score. Before the fix the
        non-English sessions lost the 0.2 observed-verification term (judgment 80 vs 100)."""
        events = [
            {"t": 1, "kind": "open", "path": "config.py"},
            {"t": 2, "kind": "edit", "path": "config.py"},
            {"t": 3, "kind": "edit", "path": "test_config.py"},
            {"t": 4, "kind": "decision_log", "path": "DECISIONS.md"},
            {"t": 5, "kind": "decision_log", "path": "DECISIONS.md"},
        ]
        tooling = tooling_from_events(events, CASE["coverProbes"], ["config.py"])
        scores = {}
        for lang, text in VERIFY_BY_LANG.items():
            psig = derive_prompt_signals(_chat(text), CASE)
            ev, _ = evaluate_submission({}, tooling, CASE, ROLE, extras={"promptSignals": psig}, provider=None)
            scores[lang] = ev["dimensionScores"]["judgment"]
        self.assertEqual(scores["en"], 100, "the English baseline changed — retune the fixture, not the parity")
        self.assertEqual(set(scores.values()), {100}, f"locale-dependent judgment scores: {scores}")


SEED = {
    "files": [{"path": "config.py", "contents": "RATE = 0.15\nX = 1\n"}, {"path": "DECISIONS.md", "contents": "# D\n"}],
    "canaries": [
        {
            "id": "c1",
            "kind": "wrong_constant",
            "path": "config.py",
            "flaw": "the constant 'RATE = 0.15' contradicts the docs",
            "reveals": "r",
        }
    ],
}
# The flaw is left in place (RATE = 0.15 survives) but called out in the decision log —
# the definition of FLAGGED. Only the language of the call-out differs.
FILES = [{"path": "config.py", "contents": "RATE = 0.15\nX = 1\n"}]


class CanaryFlaggedVerdictIsLocaleIndependent(unittest.TestCase):
    def _verdict(self, decisions: str) -> str:
        files = FILES + [{"path": "DECISIONS.md", "contents": decisions}]
        (out,) = canary_outcomes(SEED, files)
        return out["status"]

    def test_calling_the_flaw_out_flags_it_in_every_locale(self) -> None:
        for lang, note in {
            "en": "config.py: the rate constant looks wrong, leaving it for now.",
            "cs": "config.py: sazba mi přijde špatně, zatím ji nechávám být.",
            "de": "config.py: die Rate ist falsch, ich lasse sie vorerst stehen.",
            "fr": "config.py : le taux est faux, je le laisse pour l'instant.",
        }.items():
            with self.subTest(lang=lang):
                self.assertEqual(self._verdict(note), "flagged", f"{lang}: call-out not credited")

    def test_a_decision_log_that_says_nothing_about_it_still_propagates(self) -> None:
        """Non-vacuity: the widened word list must not turn silence into a free FLAGGED."""
        self.assertEqual(self._verdict("Refactored the loader for readability."), "propagated")
        # Mentioning the file without calling anything wrong is not a call-out either.
        self.assertEqual(self._verdict("Read config.py and moved on."), "propagated")


if __name__ == "__main__":
    unittest.main()
