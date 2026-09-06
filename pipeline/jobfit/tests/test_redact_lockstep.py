"""Cross-language lockstep: the Python secret redactor vs the repository's scan table.

`scripts/security/secret-scan.mjs` holds this repository's ONE answer to "what does
a credential look like" — thirteen shapes, enforced over the whole tracked tree by
`npm run security:secrets`. Two redactors are supposed to know that answer:

  * `app/_lib/redact-secrets.ts` — pinned to the table by `redact-secrets.test.ts`,
    which reads the scan source, rebuilds each row's regex, and proves each shape is
    both a genuine instance of the rule AND scrubbed. A row added to the table fails
    that test until the TS redactor learns it.
  * `pipeline/jobfit/repo_scan.redact_secret_values` — the backstop on the other side
    of the LLM boundary. `repo_scan` refines free text through a model and the deny
    rules are a fence with assumptions in them (a CLI flag, a rule grammar, a
    version); a provider that is not the Claude CLI has no fence at all. Every
    refined field is swept here before it can reach the wire.

The second one had NO pin. So the two redactors were allowed to disagree about what
a credential is, and they do: this module measures the disagreement and freezes it.

WHAT THIS PINS
  1. Every scan row is CLASSIFIED — covered, or listed in `_UNCOVERED` with a reason.
     A row added to the scan table is neither, so it fails here until someone decides.
  2. Every COVERED row's sample is a genuine instance of the scan's own regex AND is
     redacted by Python. The first half is what makes the second honest.
  3. `_UNCOVERED` is a RATCHET: a shape listed there that Python has since learned
     fails, so the list can only shrink. It is not a permanent exemption.

THE GAP, measured 2026-09-05: five shapes reached the wire from `repo_scan` unredacted
  while the same bytes would block the commit that leaked them. Four were closed the same
  day (`_SECRET_VALUE_PATTERNS` learned them); `gcp-service-account` stays listed because
  it is a JSON marker, not a keyspace, and the narrow-shapes rule excludes it by design.

Samples are ASSEMBLED AT RUNTIME, never written as literals: a key-shaped literal in
a tracked file under `pipeline/` IS a leaked key to `npm run security:secrets` (which
exempts only `scripts/security/**` and `scripts/review/**`). Each one is verified
against the scan's own regex below, which is what makes the assembly honest rather
than merely evasive.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

from pipeline.jobfit.repo_scan import REDACTED, redact_secret_values

REPO_ROOT = Path(__file__).resolve().parents[3]
SCAN_MJS = REPO_ROOT / "scripts" / "security" / "secret-scan.mjs"

# `export const SECRET_PATTERNS = [ … ];` and the `id` / `re` of each row. `[\s\S]*?`
# rather than `[^\n]*?` because rows are formatted both on one line and across four
# (the private-key row is the multi-line one, and a `[^\n]` reader silently DROPS it
# — which is how a reader of this table quietly measures twelve shapes out of
# thirteen). The source is read line-ending-normalised: this checkout is CRLF, a
# worktree may be LF, and `.` with re.S spans either, but the anchors must not care.
_TABLE = re.compile(r"export const SECRET_PATTERNS\s*=\s*\[(.*?)\n\];", re.S)
_ROW = re.compile(r"id:\s*'([^']+)'[\s\S]*?re:\s*/(.*?)/\s*,", re.S)

# Runtime-assembled filler. Split-string concatenation keeps the literal bytes out of
# the file even before assembly.
_FILL = "aB3dEf7hJk2mNp5rSt8vWx1yZ4cQ6uGi0lOe9nRb"
_HEX = "0123456789abcdef" * 3
_UPPER = "ABCDEFGHIJKLMNOP0123456789"

SAMPLES: dict[str, str] = {
    "anthropic": "sk-" + "ant-api03-" + _FILL,
    "openai-project": "sk-" + "proj-" + _FILL,
    "openai-legacy": "sk-" + _FILL[:40] + "aB3dEf7h",
    "openrouter": "sk-" + "or-v1-" + _HEX[:32],
    "elevenlabs": "sk" + "_" + _HEX[:40],
    "google": "AI" + "za" + _FILL[:35],
    "gcp-service-account": '"type"' + ': "service_account"',
    "aws": "AK" + "IA" + _UPPER[:16],
    "github": "gh" + "p_" + _FILL[:36],
    "github-fine-grained": "github" + "_pat_" + _FILL + "_" + _FILL[:20],
    "npm": "npm" + "_" + _FILL[:36],
    "slack": "xox" + "b-" + _FILL[:24],
    "private-key": "-----BEGIN " + "PRIVATE KEY-----",
}

# Scan rows `redact_secret_values` does NOT know, each with the reason it slips past
# the Python patterns. A ratchet, not an exemption — see the module docstring.
_UNCOVERED: dict[str, str] = {
    "gcp-service-account": "a JSON marker, not a keyspace; the narrow-shapes rule excludes it by design",
}


def _scan_source() -> str:
    return SCAN_MJS.read_text(encoding="utf-8").replace("\r\n", "\n")


def scan_rows() -> list[tuple[str, str]]:
    """`(id, regex source)` for every row of the scan table, in declaration order."""
    table = _TABLE.search(_scan_source())
    if not table:
        raise AssertionError(
            f"could not find `export const SECRET_PATTERNS = [...]` in {SCAN_MJS}. "
            "If the table moved, this lockstep must move with it."
        )
    rows = _ROW.findall(table.group(1))
    if not rows:
        raise AssertionError("parsed the SECRET_PATTERNS block but harvested no rows")
    return rows


class ScanTableParseTest(unittest.TestCase):
    """The reader itself, pinned — a lockstep that reads nothing passes vacuously."""

    def test_every_row_has_a_sample_and_a_verdict(self) -> None:
        ids = [rid for rid, _ in scan_rows()]
        self.assertGreaterEqual(len(ids), 13, f"only {len(ids)} scan rows parsed — the reader is broken")
        self.assertEqual(len(ids), len(set(ids)), "duplicate id in SECRET_PATTERNS")
        missing = sorted(set(ids) - set(SAMPLES))
        self.assertEqual(
            missing,
            [],
            f"scan rows {missing} have no sample here. A shape was added to "
            "scripts/security/secret-scan.mjs: add a runtime-assembled sample, then either "
            "prove repo_scan redacts it or record it in _UNCOVERED with the reason.",
        )
        stale = sorted(set(SAMPLES) - set(ids))
        self.assertEqual(stale, [], f"samples {stale} name scan rows that no longer exist")

    def test_uncovered_list_names_only_real_rows(self) -> None:
        ids = {rid for rid, _ in scan_rows()}
        stale = sorted(set(_UNCOVERED) - ids)
        self.assertEqual(stale, [], f"_UNCOVERED names {stale}, which the scan table no longer has")
        for rid, reason in _UNCOVERED.items():
            self.assertTrue(reason.strip(), f"_UNCOVERED[{rid!r}] has no reason")


class SampleAuthenticityTest(unittest.TestCase):
    """Each sample must be a genuine instance of the scan's OWN rule.

    Without this, a redaction assertion proves only that Python scrubs a string
    somebody invented — the sample could drift into a shape the scanner would never
    flag and the lockstep would keep passing while measuring nothing.
    """

    def test_each_sample_matches_its_scan_regex(self) -> None:
        for rid, pattern in scan_rows():
            with self.subTest(shape=rid):
                self.assertRegex(
                    SAMPLES[rid],
                    pattern,
                    f"the {rid} sample is not an instance of the scan's own rule",
                )


class PythonRedactorLockstepTest(unittest.TestCase):
    def test_covered_shapes_are_redacted(self) -> None:
        for rid, _pattern in scan_rows():
            if rid in _UNCOVERED:
                continue
            with self.subTest(shape=rid):
                sample = SAMPLES[rid]
                masked, hits = redact_secret_values(f"error tail: {sample} was rejected")
                self.assertGreater(hits, 0, f"repo_scan did not redact the {rid} shape")
                self.assertNotIn(sample, masked, f"the {rid} secret survived into the masked text")
                self.assertIn(REDACTED, masked)

    def test_uncovered_shapes_are_still_uncovered(self) -> None:
        """The ratchet. A shape Python has LEARNED must leave `_UNCOVERED`."""
        for rid, reason in _UNCOVERED.items():
            with self.subTest(shape=rid):
                _masked, hits = redact_secret_values(f"error tail: {SAMPLES[rid]} was rejected")
                self.assertEqual(
                    hits,
                    0,
                    f"repo_scan now redacts the {rid} shape — good. Delete its _UNCOVERED entry "
                    f"({reason}); the list is a ratchet and may only shrink.",
                )

    def test_benign_diagnostic_text_survives(self) -> None:
        # The other half of a redactor's contract, and the reason the patterns are
        # deliberately narrow: a URL, a sha and an ordinary sentence must come through
        # untouched, or the scrubber destroys the diagnostic it is protecting.
        benign = (
            "AuthenticationError: model gpt-5-mini is not available at "
            "https://api.example.com/v1 (commit 9f3c2ab, attempt 2 of 3)"
        )
        masked, hits = redact_secret_values(benign)
        self.assertEqual((masked, hits), (benign, 0))


if __name__ == "__main__":
    unittest.main()
