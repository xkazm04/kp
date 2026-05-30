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


def _extract_ts_const(text: str, name: str) -> str:
    match = re.search(rf'{name}\s*=\s*"([^"]+)"', text)
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


if __name__ == "__main__":
    unittest.main()
