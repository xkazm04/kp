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

    # -- surfacing -----------------------------------------------------------
    #
    # The round-5 operator finding: the recall strip printed "remembered: Please
    # prepare a digest of the workspace for me" — their own command, one second
    # old, handed back as a memory. These pin the two drops and the short form.

    def test_an_echo_of_the_current_query_is_not_a_memory(self):
        query = "Please prepare a digest of the workspace for me"
        self.assertTrue(brain.is_echo(query, query))
        self.assertTrue(brain.is_echo(query, "please prepare a digest of the workspace for me?"))
        # Containment the other way: a long question that reproduces a short note.
        self.assertTrue(brain.is_echo("So what about the rubric, is the rubric ready", "the rubric"))
        # A genuinely different sentence that happens to share a word is not.
        self.assertFalse(brain.is_echo(query, "You prefer Czech-market roles listed first."))

    def test_a_long_episode_survives_the_digests_many_word_query(self):
        """The digest leg assembles its query from the board's own role names, so
        a SYMMETRIC overlap ratio would call the most grounding episode in the
        index an echo of the question. Coverage is measured against the hit."""
        query = "Senior Java Backend Engineer Junior Mobile QA Junior Risk Data Analyst decisions pipeline"
        episode = (
            "Today's load is front-heavy on decisions and channels. Sixteen decisions are waiting on you, "
            "17 channel items are open, and five jobs need a look. The pipeline carries 11 attention items "
            "across 58 active entries, with the Senior Java Backend Engineer and Junior Risk Data Analyst "
            "roles holding the most."
        )
        self.assertFalse(brain.is_echo(query, episode))

    def test_a_command_is_recognised_by_its_opening_and_a_preference_is_not(self):
        self.assertTrue(brain.is_command("Please prepare a digest of the workspace for me"))
        self.assertTrue(brain.is_command("What needs my attention today?"))
        self.assertTrue(brain.is_command("Show me the top candidates"))
        self.assertFalse(brain.is_command("I prefer candidates who ship before they talk."))
        self.assertFalse(brain.is_command("The platform devcase needs a rubric."))
        # Opens like a command, states a standing rule: kept.
        self.assertFalse(brain.is_command("Can you always put Czech roles first"))

    def test_the_role_comes_from_the_episode_filename(self):
        self.assertEqual(brain.episode_role("episodes/2026/08/24/ep_a4710ced_user.md"), "user")
        self.assertEqual(brain.episode_role("episodes/2026/08/24/ep_c502cae4_assistant.md"), "assistant")
        self.assertEqual(brain.episode_role("index.sqlite"), "")

    def test_an_insight_is_one_short_sentence_without_the_role_prefix(self):
        self.assertEqual(
            brain.insight_sentence("ME: Decisions are the choke point. Channels hold 17 open items."),
            "Decisions are the choke point.",
        )
        long_one = "Today's load is front-heavy on decisions and channels across every open role in the studio right now"
        short = brain.insight_sentence(long_one)
        self.assertLessEqual(len(short), brain.INSIGHT_CHARS + 1)
        self.assertTrue(short.endswith("…"))
        self.assertTrue(long_one.startswith(short[:-1]))
        self.assertEqual(brain.insight_sentence("   "), "")

    def test_surfacing_drops_the_echo_and_todays_command_and_shortens_the_rest(self):
        today = "2026-08-24"
        hits = [
            {
                "path": "episodes/2026/08/24/ep_1_user.md",
                "excerpt": "Please prepare a digest of the workspace for me",
                "createdAt": f"{today}T13:50:41+00:00",
            },
            {
                "path": "episodes/2026/08/24/ep_2_user.md",
                "excerpt": "Show me the top candidates",
                "createdAt": f"{today}T09:02:00+00:00",
            },
            {
                "path": "episodes/2026/08/23/ep_3_assistant.md",
                "excerpt": "Sixteen decisions were waiting on you. The board leans early-stage.",
                "createdAt": "2026-08-23T18:11:22+00:00",
            },
            {
                "path": "episodes/2026/08/20/ep_4_user.md",
                "excerpt": "What needs my attention today?",
                "createdAt": "2026-08-20T08:00:00+00:00",
            },
        ]
        out = brain.surface_recall("Please prepare a digest of the workspace for me", hits, today=today)
        paths = [h["path"] for h in out]
        # The echo and today's bare command are gone; the cross-day command
        # survives as GROUNDING but earns no chip.
        self.assertEqual(paths, ["episodes/2026/08/23/ep_3_assistant.md", "episodes/2026/08/20/ep_4_user.md"])
        self.assertEqual(out[0]["insight"], "Sixteen decisions were waiting on you.")
        self.assertEqual(out[1]["insight"], "")

    def test_surfacing_keeps_a_preference_the_operator_stated_today(self):
        today = "2026-08-24"
        hits = [
            {
                "path": "episodes/2026/08/24/ep_5_user.md",
                "excerpt": "I prefer Czech-market roles listed before the remote ones.",
                "createdAt": f"{today}T07:00:00+00:00",
            }
        ]
        out = brain.surface_recall("which roles should I look at", hits, today=today)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["insight"], "I prefer Czech-market roles listed before the remote ones.")


if __name__ == "__main__":
    unittest.main()
