"""The seed materializer: repoSeed prose -> a concrete, bounded, SAFE file tree.

What must hold: the deterministic fallback always ships README + the forced
DECISIONS log; the LLM path is clamped to the contract (file/char caps, path
sanitizing, decisions log guaranteed); a raising provider degrades to the
deterministic seed. Path sanitizing matters because the TS side writes these
files to disk — traversal must die at the producing seam.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit.devcase.models import CaseScenario, CoverProbe, RoleSpec
from pipeline.jobfit.devcase.seed_materializer import (
    DECISIONS_FILE,
    MAX_FILE_CHARS,
    MAX_SEED_FILES,
    _safe_path,
    deterministic_seed,
    materialize_seed,
)

CASE = CaseScenario(
    id="case-1",
    title="Order notifications",
    brief="Customers get duplicate shipping emails.",
    repo_seed="A small consumer service reading shipping events from a queue.",
    tasks=["Find why duplicates happen", "Make delivery reliable"],
    cover_probes=[CoverProbe(id="p1", kind="legacy_trap", where="the queue consumer", reveals="idempotency thinking")],
)
ROLE = RoleSpec(title="Junior Backend", role_family="software_engineering", seniority="junior",
                must_haves=["Python"])


class _StubProvider:
    def __init__(self, payload):
        self._payload = payload

    def available(self) -> bool:
        return True

    def complete_json(self, prompt, system=None):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


class DeterministicSeedTest(unittest.TestCase):
    def test_skeleton_carries_readme_and_decisions_log(self):
        seed = deterministic_seed(CASE, ROLE)
        paths = [f["path"] for f in seed["files"]]
        self.assertIn("README.md", paths)
        self.assertIn(DECISIONS_FILE, paths)
        readme = next(f["contents"] for f in seed["files"] if f["path"] == "README.md")
        self.assertIn("duplicate shipping emails", readme)  # the brief
        self.assertIn("Find why duplicates happen", readme)  # the tasks
        decisions = next(f["contents"] for f in seed["files"] if f["path"] == DECISIONS_FILE)
        self.assertIn("Rejected alternative", decisions)

    def test_no_provider_is_deterministic(self):
        seed, src = materialize_seed(CASE, ROLE, provider=None)
        self.assertEqual(src, "deterministic")
        self.assertTrue(seed["files"])


class CoercionTest(unittest.TestCase):
    def test_llm_tree_is_accepted_and_decisions_log_guaranteed(self):
        payload = {
            "files": [
                {"path": "README.md", "contents": "# Seed"},
                {"path": "src/consumer.py", "contents": "def handle(event): ..."},
            ],
            "note": "queue consumer with a duplicate-delivery seam",
        }
        seed, src = materialize_seed(CASE, ROLE, provider=_StubProvider(payload))
        self.assertEqual(src, "llm")
        paths = [f["path"] for f in seed["files"]]
        self.assertIn("src/consumer.py", paths)
        self.assertIn(DECISIONS_FILE, paths)  # appended when the model forgot it

    def test_unsafe_paths_are_dropped(self):
        payload = {
            "files": [
                {"path": "../../etc/passwd", "contents": "x"},
                {"path": "/absolute.md", "contents": "x"},
                {"path": "C:\\windows\\evil.md", "contents": "x"},
                {"path": "ok/./nested.md", "contents": "fine"},
            ]
        }
        seed, _ = materialize_seed(CASE, ROLE, provider=_StubProvider(payload))
        paths = [f["path"] for f in seed["files"]]
        self.assertIn("ok/nested.md", paths)  # "." segments collapsed
        self.assertFalse(any(".." in p or p.startswith("/") or ":" in p for p in paths))

    def test_caps_are_enforced(self):
        payload = {
            "files": [{"path": f"f{i}.md", "contents": "y" * (MAX_FILE_CHARS + 100)} for i in range(MAX_SEED_FILES + 5)]
        }
        seed, _ = materialize_seed(CASE, ROLE, provider=_StubProvider(payload))
        self.assertLessEqual(len(seed["files"]), MAX_SEED_FILES)
        self.assertTrue(all(len(f["contents"]) <= MAX_FILE_CHARS for f in seed["files"]))
        # ...and the decisions log still made it in under the cap.
        self.assertIn(DECISIONS_FILE, [f["path"] for f in seed["files"]])

    def test_garbage_payload_falls_back_wholesale(self):
        seed, src = materialize_seed(CASE, ROLE, provider=_StubProvider({"files": "not a list"}))
        self.assertEqual(src, "llm")  # the call succeeded; the SHAPE fell back
        self.assertEqual([f["path"] for f in seed["files"]], ["README.md", DECISIONS_FILE])

    def test_provider_error_degrades_to_deterministic(self):
        seed, src = materialize_seed(CASE, ROLE, provider=_StubProvider(RuntimeError("down")))
        self.assertEqual(src, "deterministic")
        self.assertTrue(seed["files"])


class SafePathTest(unittest.TestCase):
    def test_safe_path_contract(self):
        self.assertEqual(_safe_path("src\\a.py"), "src/a.py")  # backslashes normalized
        self.assertEqual(_safe_path("  README.md "), "README.md")
        self.assertIsNone(_safe_path("../up.md"))
        self.assertIsNone(_safe_path("/abs.md"))
        self.assertIsNone(_safe_path("D:stuff.md"))
        self.assertIsNone(_safe_path(""))


if __name__ == "__main__":
    unittest.main()
