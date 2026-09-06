"""Every use case the pipeline resolves has an EXAMINED output-token ceiling.

WHY THIS FILE. ``USE_CASE_MAX_TOKENS`` is a sparse map and ``default_max_tokens``
returns None for anything absent, which lands the call on ``base.DEFAULT_MAX_TOKENS``
(2048). That is a real default, not a neutral one: every row that exists was bought
with a measured truncation (``automation`` 4096, ``jd_ingest`` 6144, ``repo_scan``
6144 — the comments in capabilities.py record each failure), and for months SEVEN
use cases sat on the 2048 cap because nobody had looked, which is indistinguishable
in the source from "we looked and 2048 is right".

So the durable guard is not "these rows have these values" — it is that a use case
cannot REACH a provider without a decision on the record. ``BASE_CAP_BY_DECISION``
is the other half of that record: the deliberate stay-on-2048 verdicts, each with
its reason. A new ``resolve_provider("<new_case>")`` call site fails this test until
the author writes one or the other.

The call sites are read from the SOURCE rather than listed here, for the same
reason the TS lockstep test reads capabilities.py: a hand-maintained list of call
sites rots into a list of the call sites that existed when someone last cared.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

from pipeline.jobfit.llm.base import DEFAULT_MAX_TOKENS
from pipeline.jobfit.llm.capabilities import (
    BASE_CAP_BY_DECISION,
    USE_CASE_MAX_TOKENS,
    USE_CASE_REQUIREMENTS,
    default_max_tokens,
)

PIPELINE_ROOT = Path(__file__).resolve().parents[2]
_RESOLVE = re.compile(r'resolve_provider\(\s*"([a-z_]+)"')


def _resolved_use_cases() -> set[str]:
    """Every use case a ``resolve_provider`` call names with a string literal, outside tests.

    NB: the examples in this module's docstrings deliberately avoid writing that call
    with a quoted argument inline. ``test_byom_coverage`` scans EVERY tracked .py file
    (tests included) with a regex and would read such an example as a real call site,
    failing on a use case that exists only in prose.

    Tests are excluded on purpose: they resolve ``match_reasoning`` dozens of times
    as a stand-in for "some use case", and a fixture must never be able to satisfy
    (or widen) a production guard.
    """
    found: set[str] = set()
    for path in sorted(PIPELINE_ROOT.rglob("*.py")):
        if "tests" in path.parts or "__pycache__" in path.parts:
            continue
        found.update(_RESOLVE.findall(path.read_text(encoding="utf-8")))
    return found


class CallSiteScanTest(unittest.TestCase):
    """The anti-vacuity floor: every assertion below is over a SCANNED set, so a
    scan that silently found nothing would make all of them pass while proving
    the opposite of what they claim."""

    def test_the_scan_still_finds_the_known_call_sites(self) -> None:
        found = _resolved_use_cases()
        self.assertGreaterEqual(
            len(found), 15, f"the resolve_provider scan found only {len(found)} use cases — did the call shape change?"
        )
        for known in ("match_reasoning", "cv_analysis", "jd_ingest", "devcase_judge", "role_intake_voice"):
            self.assertIn(known, found, f"{known} is resolved in the pipeline but the scan missed it")


class TokenCeilingDecisionTest(unittest.TestCase):
    def test_every_resolved_use_case_has_a_token_ceiling_decision(self) -> None:
        """A use case reaches a provider only with an EXAMINED ceiling.

        This is the guard that matters. It fails the moment a new
        ``resolve_provider`` call site lands with neither a USE_CASE_MAX_TOKENS
        row nor a BASE_CAP_BY_DECISION entry — i.e. when a call would run on the
        base 2048 cap because nobody sized its output, rather than because someone
        decided 2048 fits.
        """
        undecided = sorted(
            uc for uc in _resolved_use_cases() if uc not in USE_CASE_MAX_TOKENS and uc not in BASE_CAP_BY_DECISION
        )
        self.assertEqual(
            undecided,
            [],
            "these use cases resolve a provider with no output-token decision on record, so they "
            f"silently run on the base {DEFAULT_MAX_TOKENS}-token cap: {undecided}. Read the call site's "
            "output contract, then either add a USE_CASE_MAX_TOKENS row (with the comment saying what "
            "the task returns and why 2048 is too low) or a BASE_CAP_BY_DECISION entry saying why it is not.",
        )

    def test_the_two_maps_are_disjoint(self) -> None:
        """A use case cannot be both raised and deliberately-not-raised."""
        both = sorted(set(USE_CASE_MAX_TOKENS) & set(BASE_CAP_BY_DECISION))
        self.assertEqual(both, [], f"contradictory ceiling decisions for {both}")

    def test_every_decision_names_a_declared_use_case(self) -> None:
        """Both maps are keyed by the use-case vocabulary, so a typo is caught here
        rather than by ``default_max_tokens`` quietly returning None forever."""
        for name, table in (("USE_CASE_MAX_TOKENS", USE_CASE_MAX_TOKENS), ("BASE_CAP_BY_DECISION", BASE_CAP_BY_DECISION)):
            for use_case in table:
                with self.subTest(table=name, use_case=use_case):
                    self.assertIn(use_case, USE_CASE_REQUIREMENTS, f"{name}[{use_case!r}] is not a declared use case")

    def test_every_base_cap_decision_carries_a_reason(self) -> None:
        """The entry IS the record — an empty or one-word value would leave the next
        reader exactly where the seven un-rowed use cases left this one."""
        for use_case, reason in BASE_CAP_BY_DECISION.items():
            with self.subTest(use_case=use_case):
                self.assertGreater(len(reason.split()), 20, f"{use_case}'s base-cap decision states no reason")

    def test_every_ceiling_is_above_the_base_cap(self) -> None:
        """A row exists to RAISE the ceiling; one at or below the base cap is either
        a mistake or a lowering that belongs in its own decision with its own comment."""
        for use_case, ceiling in USE_CASE_MAX_TOKENS.items():
            with self.subTest(use_case=use_case):
                self.assertGreater(ceiling, DEFAULT_MAX_TOKENS, f"{use_case}'s row does not raise anything")


class NewRowsTest(unittest.TestCase):
    """The rows added for the previously-unexamined use cases return what they mean."""

    def test_agent_fit_clears_twelve_rationales_plus_a_system_prompt(self) -> None:
        self.assertEqual(default_max_tokens("agent_fit"), 4096)

    def test_profile_draft_matches_its_own_direct_gemini_budget(self) -> None:
        # profile_draft_cli._extract's unconfigured path passes max_output_tokens=4000;
        # the routed path must not get LESS room than the default path chose.
        self.assertGreaterEqual(default_max_tokens("profile_draft") or 0, 4000)

    def test_role_intake_is_sized_with_jd_ingest(self) -> None:
        # Same shape: re-emit the whole structured artifact on every call.
        self.assertEqual(default_max_tokens("role_intake"), USE_CASE_MAX_TOKENS["jd_ingest"])

    def test_the_deliberate_base_cap_cases_still_return_none(self) -> None:
        # None is what lands the call on base.DEFAULT_MAX_TOKENS — the decision, not an omission.
        for use_case in ("match_reasoning", "cv_analysis", "role_intake_voice", "devcase_judge"):
            with self.subTest(use_case=use_case):
                self.assertIsNone(default_max_tokens(use_case))


if __name__ == "__main__":
    unittest.main()
