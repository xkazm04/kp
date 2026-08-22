"""Guard the cross-language PROMPT_VERSION coupling.

The reasoning cache key is computed on the Node side (app/_lib/reasoning-run.ts)
but the Python CLI stamps its own REASONING_PROMPT_VERSION into output. If the
two drift, the cache silently serves stale reasoning for a changed prompt. This
mirrors the codegen --check pattern: compare the committed TS constant against
the Python source and fail CI on divergence rather than discovering it in prod.

The SAME coupling exists SEVEN more times, for the on-demand HR tasks:
``app/_lib/automation-run.ts::AUTOMATION_VERSION`` is the cache-key version for
screen / outreach / rejection / prep / scorecard / rematch / offer, and each entry
carries a comment promising it is "kept in lockstep with" the matching
``automation.py::*_PROMPT_VERSION``. Nothing enforced that promise — a comment is
not a guard — so a Python-side prompt bump with no TS bump served the PREVIOUS
prompt's cached letter/screening for the full 168h TTL, and a TS-side bump with no
Python bump stamped a promptVersion onto output the prompt never produced.
:class:`AutomationVersionLockstepTest` binds all seven, enumerated from BOTH
sources so a task added on either side without the other reddens the build.
"""

import re
import unittest
from pathlib import Path

from pipeline.jobfit import automation
from pipeline.jobfit.match_reasoning import REASONING_PROMPT_VERSION

REPO_ROOT = Path(__file__).resolve().parents[3]
REASONING_RUN_TS = REPO_ROOT / "app" / "_lib" / "reasoning-run.ts"
AUTOMATION_RUN_TS = REPO_ROOT / "app" / "_lib" / "automation-run.ts"

# task id (the TS AUTOMATION_VERSION key) -> the Python constant that must equal it.
# Kept as an explicit map so BOTH directions are checkable: every TS key must appear
# here, and every ``*_PROMPT_VERSION`` automation.py exports must appear here too —
# see :meth:`AutomationVersionLockstepTest.test_the_map_covers_both_sides`.
AUTOMATION_VERSION_CONSTANTS = {
    "screen": "SCREENING_PROMPT_VERSION",
    "outreach": "OUTREACH_PROMPT_VERSION",
    "rejection": "REJECTION_PROMPT_VERSION",
    "prep": "PREP_PROMPT_VERSION",
    "scorecard": "SCORECARD_PROMPT_VERSION",
    "rematch": "REMATCH_PROMPT_VERSION",
    "offer": "OFFER_PROMPT_VERSION",
}


def _extract_ts_string_record(text: str, name: str) -> dict[str, str]:
    """The ``{key: "value"}`` pairs of a TS object literal assigned to ``name``.

    Comments are stripped first (the live object is heavily commented, and a
    commented-out stale entry must not be read as live).
    """
    stripped = _strip_ts_comments(text)
    match = re.search(
        rf"\b{re.escape(name)}\b[^=]*=\s*\{{(.*?)\n\}}", stripped, re.DOTALL
    )
    if not match:
        raise AssertionError(f"could not find `{name}` object literal in {AUTOMATION_RUN_TS}")
    return dict(re.findall(r'(\w+)\s*:\s*["\']([^"\']+)["\']', match.group(1)))


def _strip_ts_comments(text: str) -> str:
    """Drop // line comments and /* */ block comments.

    bug-ui-scan-2026-07-09 (pipeline-test-suite-python #5): the old extractor took
    the FIRST unanchored match, so a commented-out stale line
    (``// REASONING_PROMPT_VERSION = "old"``) sitting above the live const would be
    compared instead of the real value. Stripping comments first removes that
    hazard. A version-string literal never contains ``//``, so line-comment removal
    cannot truncate the value we go on to extract.
    """
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    text = re.sub(r"//[^\n]*", "", text)
    return text


def _extract_ts_const(text: str, name: str) -> str:
    # bug-ui-scan-2026-07-09 (pipeline-test-suite-python #5): accept single OR
    # double quotes and anchor `name` on a word boundary. The old regex was
    # double-quote-only (a lint reformat to single quotes turned into a false red)
    # and unanchored (X_NAME could satisfy a request for NAME). Comments are
    # stripped first so a commented-out earlier definition can't win the match.
    match = re.search(rf'\b{re.escape(name)}\s*=\s*["\']([^"\']+)["\']', _strip_ts_comments(text))
    if not match:
        raise AssertionError(f"could not find `{name}` string literal in {REASONING_RUN_TS}")
    return match.group(1)


class PromptVersionSyncTest(unittest.TestCase):
    def test_reasoning_prompt_version_matches_node_side(self) -> None:
        self.assertTrue(REASONING_RUN_TS.exists(), f"missing {REASONING_RUN_TS}")
        ts_version = _extract_ts_const(REASONING_RUN_TS.read_text(encoding="utf-8"), "REASONING_PROMPT_VERSION")
        self.assertEqual(
            ts_version,
            REASONING_PROMPT_VERSION,
            "reasoning-run.ts REASONING_PROMPT_VERSION drifted from match_reasoning.py — "
            "bump both together or the reasoning cache goes stale.",
        )


class AutomationVersionLockstepTest(unittest.TestCase):
    """All seven automation prompt versions, both directions, enumerated.

    ``test_reasoning_prompt_version_matches_node_side`` above guarded exactly ONE of
    the eight cross-language version pairs this repo carries. These bind the other
    seven — the ones behind the recruiter-facing screening rationale, the candidate
    -facing letters and the interview scorecard, each cached for 168h under the TS
    constant while Python stamps its own into the artifact.
    """

    def setUp(self) -> None:
        self.assertTrue(AUTOMATION_RUN_TS.exists(), f"missing {AUTOMATION_RUN_TS}")
        self.ts = _extract_ts_string_record(
            AUTOMATION_RUN_TS.read_text(encoding="utf-8"), "AUTOMATION_VERSION"
        )

    def test_every_task_version_matches_the_python_constant(self) -> None:
        for task, const in AUTOMATION_VERSION_CONSTANTS.items():
            with self.subTest(task=task):
                self.assertIn(task, self.ts, f"automation-run.ts has no AUTOMATION_VERSION.{task}")
                self.assertEqual(
                    self.ts[task],
                    getattr(automation, const),
                    f"automation-run.ts AUTOMATION_VERSION.{task} drifted from "
                    f"automation.{const} — bump BOTH together or the {task} cache "
                    "serves the previous prompt's output for its full TTL.",
                )

    def test_the_map_covers_both_sides(self) -> None:
        # Enumerated, not hand-listed: a task added to the TS object, or a new
        # ``*_PROMPT_VERSION`` added to automation.py, must be wired on both sides.
        self.assertEqual(
            set(self.ts), set(AUTOMATION_VERSION_CONSTANTS),
            "AUTOMATION_VERSION tasks and the Python constant map disagree",
        )
        py_consts = {n for n in dir(automation) if n.endswith("_PROMPT_VERSION")}
        self.assertEqual(
            py_consts, set(AUTOMATION_VERSION_CONSTANTS.values()),
            "automation.py exports a *_PROMPT_VERSION with no AUTOMATION_VERSION "
            "counterpart (or vice versa)",
        )

    def test_the_extractor_is_not_vacuous(self) -> None:
        # The parse must actually find all seven non-empty versions — a regex that
        # silently returned {} would make the loop above pass by doing nothing.
        self.assertEqual(len(self.ts), 7)
        self.assertTrue(all(v.strip() for v in self.ts.values()), self.ts)
        # …and it must read the LIVE entry, not a commented-out shadow.
        self.assertEqual(
            _extract_ts_string_record(
                'const X: Record<string, string> = {\n'
                '  // a: "OLD",\n'
                '  a: "NEW",\n'
                '};',
                "X",
            ),
            {"a": "NEW"},
        )


class ExtractTsConstTest(unittest.TestCase):
    """Non-vacuous guards for the hardened extractor itself (#5). Each asserts
    exact behaviour on a constructed input, so it fails if the extractor regresses
    to the old quote-style-fragile / comment-fragile / unanchored form."""

    def test_accepts_single_and_double_quotes(self) -> None:
        self.assertEqual(_extract_ts_const('const X = "v1";', "X"), "v1")
        self.assertEqual(_extract_ts_const("const X = 'v1';", "X"), "v1")

    def test_ignores_commented_out_shadow(self) -> None:
        # The live const, not the commented-out stale one, must be returned.
        self.assertEqual(_extract_ts_const('// const X = "OLD"\nconst X = "NEW";', "X"), "NEW")
        self.assertEqual(_extract_ts_const('/* const X = "OLD" */\nconst X = "NEW";', "X"), "NEW")

    def test_word_boundary_prevents_prefix_false_match(self) -> None:
        # A different const whose name merely ends in the requested name must not match.
        with self.assertRaises(AssertionError):
            _extract_ts_const('const Y_X = "v";', "X")


if __name__ == "__main__":
    unittest.main()
