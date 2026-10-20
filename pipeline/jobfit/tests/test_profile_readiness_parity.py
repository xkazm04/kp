"""The profile editor's live readiness and profile_cli agree, case for case.

The editor evaluates archetype routing and the completeness checklist in the
browser while the recruiter types (app/features/tools/profile/profileReadiness.ts),
from the same archetypes.json this package reads. That port is a second reader of
one set of rules, and a second reader drifts unless something compares the two.

profile_readiness_cases.json is that comparison. Each case is the request body the
editor would send (``{profile, signals}``, exactly what buildProfilePayload and the
submit hook build) plus the routing and completeness the ENGINE produces for it.
This test runs ``profile_cli.main`` over every case and asserts the pinned output;
profileReadiness.test.ts runs the TypeScript port over the same file and asserts
the same fields. A rule changed on one side only turns one of the two suites red.

The server stays the authority on save - the live readiness is a preview. What
this file pins is that the preview says what the save will say.

A case may declare ``customArchetypes``: an archetype a recruiter created through
the UI (createArchetype writes it into archetypes.json at runtime with an empty
checklist). The spawn re-reads the file per request, so here the registry is
patched to hold the entry for that one case - the state the spawn would see.
"""

from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest import mock

from pipeline.jobfit import profile_cli, registry

CASES_PATH = Path(__file__).with_name("profile_readiness_cases.json")

# The fields both engines are held to. `profile` and the English `reasons` /
# `missing` are the server's alone: the live panel renders the codes and the gaps.
PINNED_FIELDS = ("archetype", "confidence", "reasonCodes", "completeness", "missingGaps")


def load_cases() -> list[dict[str, Any]]:
    return json.loads(CASES_PATH.read_text(encoding="utf-8"))["cases"]


def run_case(case: dict[str, Any]) -> dict[str, Any]:
    """profile_cli's output for one case, with the case's custom archetypes registered."""
    custom = case.get("customArchetypes") or []
    archetypes = list(registry._ARCHETYPES) + list(custom)
    by_id = {a["id"]: a for a in archetypes}
    ids = tuple(a["id"] for a in archetypes)
    out, err = io.StringIO(), io.StringIO()
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "intake.json"
        path.write_text(json.dumps(case["input"]), encoding="utf-8")
        with (
            mock.patch.object(registry, "_ARCHETYPES", archetypes),
            mock.patch.object(registry, "_BY_ID", by_id),
            mock.patch.object(profile_cli, "ARCHETYPES", ids),
            contextlib.redirect_stdout(out),
            contextlib.redirect_stderr(err),
        ):
            code = profile_cli.main(["--input-json", str(path)])
    if code != 0:
        raise AssertionError(f"profile_cli exited {code} for case {case['name']!r}: {err.getvalue()}")
    lines = [ln for ln in out.getvalue().splitlines() if ln.strip()]
    result = json.loads(lines[-1])
    return {field: result[field] for field in PINNED_FIELDS}


class ProfileReadinessParityTests(unittest.TestCase):
    def test_the_case_file_is_substantial(self) -> None:
        cases = load_cases()
        self.assertGreaterEqual(len(cases), 12, "the shared file is the whole parity contract - keep it broad")
        names = [c["name"] for c in cases]
        self.assertEqual(len(names), len(set(names)), "case names are how a red run names its case")
        self.assertTrue(any(c.get("customArchetypes") for c in cases), "a custom archetype case is required")
        self.assertTrue(
            any(code["kind"].startswith("contradiction_") for c in cases for code in c["expected"]["reasonCodes"]),
            "a contradiction case is required",
        )

    def test_profile_cli_matches_every_pinned_case(self) -> None:
        for case in load_cases():
            with self.subTest(case=case["name"]):
                self.assertEqual(run_case(case), case["expected"])

    def test_a_custom_archetype_does_not_leak_into_the_next_case(self) -> None:
        # The patch is per case: the real registry is untouched once a case returns.
        for case in load_cases():
            run_case(case)
        custom_ids = {a["id"] for c in load_cases() for a in c.get("customArchetypes") or []}
        self.assertFalse(custom_ids & set(registry.archetype_ids()))


if __name__ == "__main__":
    unittest.main()
