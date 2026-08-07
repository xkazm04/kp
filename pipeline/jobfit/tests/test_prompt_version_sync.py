"""Guard the cross-language PROMPT_VERSION coupling.

The reasoning cache key is computed on the Node side (app/_lib/reasoning-run.ts)
but the Python CLI stamps its own REASONING_PROMPT_VERSION into output. If the
two drift, the cache silently serves stale reasoning for a changed prompt. This
mirrors the codegen --check pattern: compare the committed TS constant against
the Python source and fail CI on divergence rather than discovering it in prod.
"""

import re
import unittest
from pathlib import Path

from pipeline.jobfit.match_reasoning import REASONING_PROMPT_VERSION

REPO_ROOT = Path(__file__).resolve().parents[3]
REASONING_RUN_TS = REPO_ROOT / "app" / "_lib" / "reasoning-run.ts"


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
