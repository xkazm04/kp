"""The keyless twin of profile_draft: a CV must become a (thin, honest) profile with no
model — an install without a provider can still import, and says what read it."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

from pipeline.jobfit.cv_draft import deterministic_draft
from pipeline.jobfit.profile_draft_cli import build_draft

CV = """Jan Novák
Praha, Czech Republic · jan@example.com · +420 777 123 456

Senior backend engineer with 8 years of experience in Java, Spring and PostgreSQL,
running services on Kubernetes. Czech native, English C1.
Looking for a lead role, remote or hybrid.

Education
Ing., Czech Technical University in Prague, 2016
"""


class DeterministicDraftTest(unittest.TestCase):
    def test_reads_the_header_and_the_summary(self) -> None:
        d = deterministic_draft(CV)
        self.assertEqual(d["display_name"], "Jan Novák")
        self.assertEqual(d["location"], "Praha")
        self.assertEqual(d["years_experience"], 8)
        self.assertIn("java", [c["skill"] for c in d["skill_claims"]])
        self.assertTrue({"Czech", "English"} <= set(d["languages"]))
        self.assertEqual(d["education_level"], "master")
        self.assertTrue(any("lead role" in a for a in d["aspirations"]))
        self.assertTrue(d["has_substantial_experience"])

    def test_every_claim_is_self_declared_and_nothing_is_invented(self) -> None:
        d = deterministic_draft("Some prose with no name, no years and no skills at all.")
        self.assertIsNone(d["years_experience"])
        self.assertEqual(d["skill_claims"], [])
        self.assertIsNone(d["location"])
        for claim in deterministic_draft(CV)["skill_claims"]:
            self.assertEqual(claim["provenance"], "self_declared")

    def test_build_draft_routes_the_twin_like_a_model_payload(self) -> None:
        draft = build_draft(deterministic_draft(CV))
        self.assertIn("profile", draft)
        self.assertIn("archetype", draft)
        self.assertEqual(draft["profile"]["roleFamily"], "software_engineering")

    def test_cli_degrades_to_the_twin_when_no_provider_can_serve(self) -> None:
        env = {**os.environ, "KP_OFFLINE": "1", "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}
        proc = subprocess.run(
            [sys.executable, "-m", "pipeline.jobfit.profile_draft_cli", "--lang", "en"],
            input=json.dumps({"text": CV}),
            capture_output=True,
            text=True,
            encoding="utf-8",
            env=env,
            cwd=str(Path(__file__).resolve().parents[3]),
            check=False,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr[-400:])
        out = json.loads(proc.stdout)
        self.assertEqual(out["source"], "deterministic")
        self.assertEqual(out["profile"]["displayName"], "Jan Novák")
        self.assertIn("deterministic twin", proc.stderr)


if __name__ == "__main__":
    unittest.main()
