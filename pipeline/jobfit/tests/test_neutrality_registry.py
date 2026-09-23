"""Every candidate-typed scorer proves name-neutrality, or says why not.

The registry lives in ``pipeline/jobfit/eval/neutrality.py``; this file is its
gate. Four halves:

1. COMPLETENESS — the set of public functions that take a ``MatchCandidate`` /
   ``CandidateProfileV2`` / ``CandidateProfile`` is DERIVED from the tree by an AST
   walk, and must equal ``SCORERS | EXEMPT``. A new scorer that nobody registered
   fails here by name, at the moment it is written.
2. INVARIANCE — each registered scorer x each entry of the one perturbation set
   produces a byte-identical canonical payload once the name is removed from that
   scorer's DECLARED carrier paths, and nowhere else.
3. SECOND CARRIER — a sentinel name found at any undeclared JSON path fails,
   naming the path; the baseline payload must be non-empty and carry the scored key
   the runner declares, so no runner can pass by returning nothing.
4. THE GAP, MEASURED — a planted ``-ová`` penalty in the score_job that recruiter
   ranking calls is caught here. Before this registry the same planted penalty left
   test_fairness.py, test_name_neutrality.py and test_recruiter.py all green: none
   of them ever ranked a pool under two names.
"""

from __future__ import annotations

import ast
import unicodedata
import unittest
from pathlib import Path
from unittest import mock

from pipeline.jobfit import recruiter
from pipeline.jobfit.eval import neutrality as N

JOBFIT = Path(__file__).resolve().parents[1]

# The 41 functions the card's AST scan found on 2026-09-23 include these; each is a
# scorer a recruiter-facing decision reads, and none was perturbed before.
_MUST_BE_DISCOVERED = {
    "recruiter.fairness_check",
    "recruiter.rank_candidates_for_job",
    "automation.screen_candidate",
    "automation.rematch_candidate",
    "winnability.assess_winnability",
    "weight_proposal.deterministic_proposals",
    "soft_signals.build_soft_signal_panel",
}

# The engines the card names as the minimum registered set.
_MUST_BE_REGISTERED = {
    "matching.match",
    "matching.score_job",
    "matching.fairness_matrix",
    "matching.ko_filter",
    "matching.eligibility_flags",
    "matching.propose_weights",
    "recruiter.rank_candidates_for_job",
    "recruiter.rank_candidates_by_track",
    "recruiter.fairness_check",
    "automation.rematch_candidate",
    "automation.screen_candidate",
    "winnability.assess_winnability",
    "weight_proposal.deterministic_proposals",
    "soft_signals.build_soft_signal_panel",
}


class DiscoveryTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.discovered = N.discover_candidate_scorers()

    def test_discovers_every_candidate_typed_public_function(self) -> None:
        self.assertGreaterEqual(len(self.discovered), 41, sorted(self.discovered))
        self.assertLessEqual(_MUST_BE_DISCOVERED, self.discovered)

    def test_harnesses_are_not_scorers(self) -> None:
        for fn in self.discovered:
            module = fn.rsplit(".", 1)[0]
            with self.subTest(fn=fn):
                self.assertFalse(module.startswith(("tests.", "eval.", "llm.bench.")), fn)
                self.assertFalse(module.endswith("_cli") or module.split(".")[-1].startswith("seed_"), fn)
                self.assertFalse(fn.rsplit(".", 1)[1].startswith("_"), fn)

    def test_the_discoverer_reads_annotations_not_names(self) -> None:
        src = (
            "from x import MatchCandidate\n"
            "def plain(c: MatchCandidate) -> int: return 0\n"
            "def quoted(c: 'CandidateProfileV2 | None') -> int: return 0\n"
            "def pooled(cs: list[tuple[str, MatchCandidate]]) -> int: return 0\n"
            "def _private(c: MatchCandidate) -> int: return 0\n"
            "def untyped(candidate) -> int: return 0\n"
        )
        self.assertEqual(
            N.discover_in_source("m", src), {"m.plain", "m.quoted", "m.pooled"}
        )

    def test_registry_is_complete(self) -> None:
        problems = N.completeness_problems(self.discovered, N.SCORERS, N.EXEMPT)
        self.assertEqual(problems, [], "\n".join(problems))
        self.assertEqual(set(N.SCORERS) & set(N.EXEMPT), set())
        self.assertEqual(set(N.SCORERS) | set(N.EXEMPT), self.discovered)

    def test_a_new_unregistered_scorer_fails_by_name(self) -> None:
        # The list is derived from the tree, never hand-kept: a scorer added
        # tomorrow shows up in the discovered set and the check names it.
        added = N.discover_in_source("matching", "def new_scorer(c: MatchCandidate) -> int:\n    return 0\n")
        problems = N.completeness_problems(self.discovered | added, N.SCORERS, N.EXEMPT)
        self.assertEqual(len(problems), 1, problems)
        self.assertIn("new_scorer", problems[0])

    def test_a_registration_for_a_deleted_function_fails(self) -> None:
        problems = N.completeness_problems(
            self.discovered - {"matching.score_job"}, N.SCORERS, N.EXEMPT
        )
        self.assertTrue(any("matching.score_job" in p for p in problems), problems)


class ExemptionTest(unittest.TestCase):
    def test_every_reason_says_something(self) -> None:
        for fn, reason in N.EXEMPT.items():
            with self.subTest(fn=fn):
                self.assertGreaterEqual(len(reason.strip()), 20, fn)

    def test_a_short_reason_fails_naming_the_entry(self) -> None:
        problems = N.completeness_problems({"x.thin"}, set(), {"x.thin": "prose only"})
        self.assertEqual(len(problems), 1, problems)
        self.assertIn("x.thin", problems[0])

    def test_a_cited_covering_scorer_must_be_registered(self) -> None:
        reason = "a letter that gates nothing; covered by matching.not_a_scorer"
        problems = N.completeness_problems({"x.letter"}, set(), {"x.letter": reason})
        self.assertTrue(any("matching.not_a_scorer" in p for p in problems), problems)

    def test_the_exemptions_are_the_name_addressing_drafts(self) -> None:
        # Pinned so an exemption cannot quietly grow into a way out of the proof: a
        # new entry is a deliberate edit to this list.
        self.assertEqual(
            set(N.EXEMPT),
            {"automation.draft_outreach", "automation.draft_rejection", "automation.draft_offer"},
        )


def _strip(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


class PerturbationSetTest(unittest.TestCase):
    """One set, the union of the three that used to be typed out separately."""

    def test_the_seven_name_axes(self) -> None:
        self.assertEqual(
            set(N.name_axes()),
            {"czech_male", "czech_female_ova", "vietnamese", "ukrainian", "arabic",
             "roma_associated", "roma_associated_female"},
        )
        self.assertTrue(N.name_axes()["czech_female_ova"].endswith("ová"))

    def test_the_gender_pairs(self) -> None:
        pairs = N.gender_pairs()
        self.assertGreaterEqual(len(pairs), 4)
        # the accent-stripped pair is exactly the stripped Czech pair (a lossy extract)
        self.assertIn(tuple(_strip(x) for x in pairs[0]), pairs)
        self.assertNotEqual(tuple(_strip(x) for x in pairs[0]), pairs[0])
        # an English control, and a titled form
        self.assertTrue(any(all(x.isascii() for x in p) and _strip(p[0]) == p[0] and "Smith" in p[0] for p in pairs))
        self.assertTrue(any(p[0].startswith("Ing. ") for p in pairs))
        for masculine, feminine in pairs:
            self.assertNotEqual(masculine, feminine)

    def test_the_gendered_prose(self) -> None:
        prose = N.gendered_prose()
        self.assertEqual(len(prose), 2)
        self.assertTrue(any("paní" in f for _m, f in prose))
        self.assertTrue(any(" her " in f for _m, f in prose))

    def test_the_three_suites_read_the_one_set(self) -> None:
        files = [
            JOBFIT / "tests" / "test_fairness.py",
            JOBFIT / "tests" / "test_name_neutrality.py",
            JOBFIT / "eval" / "matching_eval.py",
        ]
        surname = N.name_axes()["czech_female_ova"].split()[-1]
        self.assertIn(surname, (JOBFIT / "eval" / "neutrality.py").read_text(encoding="utf-8"))
        for path in files:
            src = path.read_text(encoding="utf-8")
            with self.subTest(file=path.name):
                self.assertTrue("PERTURBATIONS" in src, f"{path.name} does not read neutrality.PERTURBATIONS")
                self.assertFalse(surname in src, f"{path.name} re-types a name the one set owns")
                self.assertFalse(_strip(surname) in src, f"{path.name} re-types a name the one set owns")


class RegistryInvarianceTest(unittest.TestCase):
    """Every registered scorer x every perturbation: the name moves nothing."""

    def test_the_named_engines_are_registered(self) -> None:
        self.assertLessEqual(_MUST_BE_REGISTERED, set(N.SCORERS))
        self.assertGreaterEqual(len(N.SCORERS), 12)

    def test_every_runner_reaches_its_scored_surface(self) -> None:
        for name, scorer in N.SCORERS.items():
            with self.subTest(scorer=name):
                problems = N.liveness_problems(name, scorer)
                self.assertEqual(problems, [], "\n".join(problems))

    def test_the_name_reaches_only_declared_carriers(self) -> None:
        for name, scorer in N.SCORERS.items():
            with self.subTest(scorer=name):
                problems = N.leak_problems(name, scorer)
                self.assertEqual(problems, [], "\n".join(problems))

    def test_no_perturbation_moves_any_scorer(self) -> None:
        for name, scorer in N.SCORERS.items():
            with self.subTest(scorer=name):
                problems = N.neutrality_problems(name, scorer)
                self.assertEqual(problems, [], "\n".join(problems))

    def test_the_scored_keys_the_card_names(self) -> None:
        self.assertEqual(N.SCORERS["recruiter.rank_candidates_for_job"].scored_key, "result")
        self.assertEqual(N.SCORERS["automation.screen_candidate"].scored_key, "recommendation")


class CheckMechanicsTest(unittest.TestCase):
    """The checks themselves are live: each one fails on the defect it exists for."""

    def test_an_undeclared_carrier_is_named_by_path(self) -> None:
        leaky = N.Scorer(lambda p: {"score": 1, "note": f"for {p.display_name}"}, "score")
        problems = N.leak_problems("fake.leaky", leaky)
        self.assertTrue(problems)
        self.assertTrue(all("$.student.note" in p or "$.senior.note" in p for p in problems), problems)

    def test_a_declared_carrier_is_not_a_leak(self) -> None:
        shown = N.Scorer(lambda p: {"score": 1, "note": f"for {p.display_name}"}, "score", ("note",))
        self.assertEqual(N.leak_problems("fake.shown", shown), [])
        self.assertEqual(N.neutrality_problems("fake.shown", shown), [])

    def test_a_name_dependent_score_is_caught(self) -> None:
        biased = N.Scorer(
            lambda p: {"score": 70 - (4 if (p.display_name or "").endswith("ová") else 0)}, "score"
        )
        problems = N.neutrality_problems("fake.biased", biased)
        self.assertTrue(any("czech_female_ova" in p for p in problems), problems)
        self.assertTrue(all(p.endswith("score: 70 != 66") for p in problems), problems)

    def test_an_empty_payload_or_missing_scored_key_is_not_a_pass(self) -> None:
        self.assertTrue(N.liveness_problems("fake.empty", N.Scorer(lambda p: {}, "score")))
        self.assertTrue(N.liveness_problems("fake.nokey", N.Scorer(lambda p: {"other": 1}, "score")))

    def test_a_dead_carrier_declaration_is_named(self) -> None:
        dead = N.Scorer(lambda p: {"score": 1}, "score", ("label",))
        problems = N.liveness_problems("fake.dead", dead)
        self.assertTrue(any("'label'" in p for p in problems), problems)


class PlantedMutationTest(unittest.TestCase):
    """The gap this registry closes, as a live case."""

    def test_an_ova_penalty_in_recruiter_ranking_is_caught(self) -> None:
        real = recruiter.score_job

        def penalised(candidate, job, **kwargs):
            result = real(candidate, job, **kwargs)
            if (candidate.label or "").endswith("ová"):
                return result.model_copy(update={"total": result.total - 4})
            return result

        with mock.patch.object(recruiter, "score_job", penalised):
            problems = N.neutrality_problems(
                "recruiter.rank_candidates_for_job", N.SCORERS["recruiter.rank_candidates_for_job"]
            )
        self.assertTrue(any("czech_female_ova" in p for p in problems), problems)
        # ...and the unpatched tree is clean, so the failure above is the mutation.
        self.assertEqual(
            N.neutrality_problems(
                "recruiter.rank_candidates_for_job", N.SCORERS["recruiter.rank_candidates_for_job"]
            ),
            [],
        )


class NoLooseningTest(unittest.TestCase):
    """Switching two suites to the shared set must not cost them a test."""

    FLOORS = {"test_fairness.py": 16, "test_name_neutrality.py": 10}

    def test_test_method_counts_did_not_drop(self) -> None:
        for filename, floor in self.FLOORS.items():
            tree = ast.parse((JOBFIT / "tests" / filename).read_text(encoding="utf-8"))
            count = sum(
                1
                for node in ast.walk(tree)
                if isinstance(node, ast.FunctionDef) and node.name.startswith("test_")
            )
            with self.subTest(file=filename):
                self.assertGreaterEqual(count, floor)


if __name__ == "__main__":
    unittest.main()
