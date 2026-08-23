"""The companion brain door: birth, disk-first append, and the parity pin.

The brain is a SHARED tree — Personas' Athena reads and sleep-cycles the same
episodes — so the two properties worth a test are (a) nothing here ever
overwrites a self that already exists on disk, and (b) the episode markdown
matches the contract byte for byte. A drift in either is silent everywhere else.
"""

from __future__ import annotations

import os
import re
import sqlite3
import tempfile
import unittest
from pathlib import Path

from pipeline.jobfit import companion_brain as brain


class CompanionBrainTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._prev_home = os.environ.get("PERSONAS_HOME")
        self._prev_db = os.environ.get("KP_DB_PATH")
        self._prev_personas_db = os.environ.get("PERSONAS_DB_PATH")
        os.environ["PERSONAS_HOME"] = self._tmp.name
        # Point kp's mirror lane at a path that does not exist: the kp DB is
        # optional by design and the append must still succeed, recording the skip.
        os.environ["KP_DB_PATH"] = str(Path(self._tmp.name) / "absent" / "kp.sqlite")
        # And the Personas lane at one that does not either. Without this the
        # suite writes real episodes into the developer's OWN Athena brain on any
        # machine where the desktop app is installed (it did, once).
        os.environ["PERSONAS_DB_PATH"] = str(Path(self._tmp.name) / "absent" / "personas_data.db")

    def tearDown(self) -> None:
        for key, value in (
            ("PERSONAS_HOME", self._prev_home),
            ("KP_DB_PATH", self._prev_db),
            ("PERSONAS_DB_PATH", self._prev_personas_db),
        ):
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self._tmp.cleanup()

    # -- birth ---------------------------------------------------------------

    def test_birth_creates_a_valid_tree(self):
        result = brain.ensure_brain()
        root = brain.brain_root()
        self.assertTrue((root / "episodes").is_dir())
        self.assertTrue((root / "identity.md").is_file())
        self.assertTrue((root / "constitution.md").is_file())
        self.assertEqual(sorted(result["born"]), ["constitution.md", "identity.md"])
        identity = brain.read_identity()
        self.assertIn("## About the operator", identity)
        self.assertIn("## About me", identity)
        self.assertIn("<!-- kp-constitution v1 -->", brain.read_constitution())

    def test_birth_never_overwrites_an_existing_self(self):
        brain.ensure_brain()
        root = brain.brain_root()
        (root / "constitution.md").write_text("MINE, edited by the operator\n", encoding="utf-8")
        (root / "identity.md").write_text("MY identity\n", encoding="utf-8")
        second = brain.ensure_brain()
        self.assertEqual(second["born"], [])
        self.assertEqual(brain.read_constitution(), "MINE, edited by the operator\n")
        self.assertEqual(brain.read_identity(), "MY identity\n")

    # -- append --------------------------------------------------------------

    def test_append_writes_markdown_and_indexes_locally(self):
        out = brain.append_episode("user", "How many candidates are waiting on me?", "kp-workspace")
        self.assertTrue(out["path"].startswith("episodes/"))
        self.assertTrue(out["path"].endswith("_user.md"))
        self.assertTrue(Path(out["absPath"]).is_file())
        self.assertTrue(out["indexed"]["brain"])
        # kp + Personas lanes are optional: absent DBs are a recorded skip, not a failure.
        self.assertFalse(out["indexed"]["kp"])
        self.assertFalse(out["indexed"]["personas"])
        self.assertTrue(any(note.startswith("kp:") for note in out["skipped"]))
        self.assertTrue(any(note.startswith("personas:") for note in out["skipped"]))

        con = sqlite3.connect(str(brain.brain_root() / "index.sqlite"))
        try:
            row = con.execute(
                "SELECT node_id, workspace_id, kind, excerpt, path FROM companion_brain_index"
            ).fetchone()
        finally:
            con.close()
        self.assertEqual(row[0], out["id"])
        self.assertEqual(row[1], "workspace")
        self.assertEqual(row[2], "episode")
        self.assertEqual(row[3], "How many candidates are waiting on me?")
        self.assertEqual(row[4], out["path"])

    def test_append_mirrors_into_kp_when_the_table_exists(self):
        kp_path = Path(self._tmp.name) / "kp.sqlite"
        os.environ["KP_DB_PATH"] = str(kp_path)
        con = sqlite3.connect(str(kp_path))
        try:
            con.execute(
                """CREATE TABLE companion_brain_index (
                     node_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL DEFAULT 'workspace',
                     kind TEXT NOT NULL, excerpt TEXT, path TEXT NOT NULL, created_at TEXT NOT NULL)"""
            )
            con.commit()
        finally:
            con.close()
        out = brain.append_episode("assistant", "Four are waiting.", "kp-team-b")
        self.assertTrue(out["indexed"]["kp"], out["skipped"])
        con = sqlite3.connect(str(kp_path))
        try:
            row = con.execute("SELECT node_id, workspace_id, excerpt FROM companion_brain_index").fetchone()
        finally:
            con.close()
        self.assertEqual(row, (out["id"], "team-b", "Four are waiting."))

    def test_append_rejects_an_empty_body_and_an_unknown_role(self):
        with self.assertRaises(ValueError):
            brain.append_episode("user", "   ", "kp-workspace")
        with self.assertRaises(ValueError):
            brain.append_episode("system", "hello", "kp-workspace")

    # -- the parity pin ------------------------------------------------------

    def test_episode_markdown_matches_the_documented_contract(self):
        """Byte-for-byte with Personas' episodic store. If this fails, kp's
        episodes have drifted out of the shared brain format and Athena's recall
        and sleep cycle will read them wrong (or not at all)."""
        out = brain.append_episode("user", "Line one.\nLine two.", "kp-workspace")
        body = Path(out["absPath"]).read_text(encoding="utf-8")
        pattern = (
            r'^---\n'
            r'id: "(ep_[0-9a-f]{8})"\n'
            r"type: episode\n"
            r"role: user\n"
            r'session: "kp-workspace"\n'
            r'created: "[^"]+"\n'
            r"---\n\n"
            r"Line one\.\nLine two\.\n$"
        )
        match = re.match(pattern, body)
        self.assertIsNotNone(match, f"episode markdown drifted from the contract:\n{body!r}")
        self.assertEqual(match.group(1), out["id"])
        self.assertNotIn("\r\n", body, "episodes are LF-only across platforms")

    def test_excerpt_is_500_bytes_on_a_char_boundary(self):
        # 'ř' is 2 bytes: 300 of them is 600 bytes, so the cut lands mid-run and
        # must not split a character (a byte slice would raise or emit U+FFFD).
        long_text = "ř" * 300
        cut = brain.excerpt(long_text)
        raw = cut.encode("utf-8")
        self.assertLessEqual(len(raw), 500)
        self.assertEqual(len(raw), 500)
        self.assertEqual(cut, "ř" * 250)
        self.assertEqual(brain.excerpt("short"), "short")

    # -- recall --------------------------------------------------------------

    def test_recall_finds_an_appended_episode(self):
        brain.append_episode("user", "The devcase for the platform role needs a rubric.", "kp-workspace")
        brain.append_episode("assistant", "Unrelated chatter about the weather.", "kp-workspace")
        hits = brain.recall("rubric devcase", limit=6)
        self.assertTrue(hits)
        self.assertIn("rubric", hits[0]["excerpt"])
        self.assertEqual(brain.read_episode(hits[0]["path"]).splitlines()[-1], "The devcase for the platform role needs a rubric.")

    def test_recall_is_empty_rather_than_raising_on_a_useless_query(self):
        brain.append_episode("user", "anything", "kp-workspace")
        self.assertEqual(brain.recall("   ", limit=6), [])
        self.assertEqual(brain.recall("zzzznotpresent", limit=6), [])


if __name__ == "__main__":
    unittest.main()
