"""kp operator-companion brain door — disk-first episodic memory for Candi.

The companion's SELF lives in files, not in a database: identity, constitution
and every exchange are markdown under ``~/.personas/companion-brain``. A DB is
only ever an INDEX over that tree, so kp works with the Personas desktop app
absent, closed, or mid-write, and the operator can read or delete any of it
with a text editor.

Shared-brain contract (ported from Personas' ``.claude/skills/athena/brain.py``,
which is itself byte-compatible with the app's ``brain/episodic.rs``). Verify
these against that source when upgrading — ``test_companion_brain.py`` pins the
markdown header so drift is loud:

  - markdown   ``---\\nid/type/role/session/created\\n---\\n\\n<body>\\n``
  - ids        ``ep_{8 hex}`` (uuid4 simple prefix)
  - excerpt    <= 500 BYTES, truncated on a char boundary
  - hash       sha256 of the FULL file body (frontmatter included)
  - node row   importance 3, kind 'episode'
  - fts row    (node_id, body=content, tags='session:{sid} role:{role}')

Write order is the whole design: **markdown first, indexes after**. An index
write that fails is reported in the return value and never fails the append —
the episode is on disk either way, and a later reindex can rebuild any index
from the tree.

Three index lanes, in decreasing optionality:
  1. brain-local ``index.sqlite`` (FTS5) — ALWAYS written; the only one
     ``recall()`` reads. This is what makes kp's memory work with no Personas
     install at all.
  2. kp's own ``kp.sqlite`` ``companion_brain_index`` — a plain
     workspace-scoped mirror the app's stores read (app/_lib/db/companion.ts).
     Deliberately NOT FTS5: an fts5 virtual table drops five shadow tables into
     sqlite_master, which kp's fail-closed tenancy guard and its whole-DB
     dump/restore both enumerate.
  3. the Personas app DB (``companion_node`` + ``companion_fts``) — best
     effort, so a kp episode joins Athena's recall and sleep cycle when the app
     is installed. Locked or absent is a normal outcome, not an error.

Zero dependencies (stdlib only), so this module is importable from a spawned
CLI with nothing installed.
"""

from __future__ import annotations

import hashlib
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CONSTITUTION_TEMPLATE = Path(__file__).resolve().parent / "companion_constitution.md"

BUSY_TIMEOUT_S = 5.0

ROLES = ("user", "assistant")
EXCERPT_BYTES = 500
DEFAULT_WORKSPACE_ID = "workspace"

IDENTITY_SKELETON = """# Identity

<!-- kp-identity v1 -->

## About the operator

_(empty — this fills in from what the operator tells me, never from a guess)_

## About me

_(empty — the constitution says how I behave; this is who I have become)_
"""


def brain_root() -> Path:
    """``$PERSONAS_HOME/companion-brain`` (default ``~/.personas``). One root
    shared with Personas' Athena on purpose: same tree, same episode format."""
    base = Path(os.environ["PERSONAS_HOME"]) if os.environ.get("PERSONAS_HOME") else Path.home() / ".personas"
    return base / "companion-brain"


def kp_db_path() -> Path:
    """kp's SQLite file. Mirrors app/_lib/db-path.ts: ``KP_DB_PATH`` when set,
    otherwise ``<repo>/data/kp.sqlite``. Resolved from the module, not the cwd —
    a spawned CLI's cwd is the caller's, and opening the wrong (empty) file is
    the classic "where did my data go" trap that file warns about."""
    override = os.environ.get("KP_DB_PATH")
    return Path(override).resolve() if override else REPO_ROOT / "data" / "kp.sqlite"


def personas_db_path() -> Path:
    """The Personas desktop app's own database — present only when the app is
    installed. Resolved per call (not frozen at import) so ``PERSONAS_DB_PATH``
    can redirect it: a test that wrote into the operator's REAL Athena brain
    would be a side effect nobody asked for, and it happened once before this
    override existed."""
    override = os.environ.get("PERSONAS_DB_PATH")
    if override:
        return Path(override).resolve()
    app_data = Path(os.environ.get("APPDATA", Path.home() / "AppData/Roaming")) / "com.personas.desktop"
    return app_data / "personas_data.db"


def now_rfc3339() -> str:
    return datetime.now(timezone.utc).isoformat()


def short_id(n: int) -> str:
    return uuid.uuid4().hex[:n]


def excerpt(s: str) -> str:
    """<= 500 BYTES on a char boundary (Personas' ``util::excerpt``). Bytes, not
    chars: a Czech or Japanese excerpt is a different length in each unit and the
    node row's column is sized in bytes."""
    raw = s.encode("utf-8")
    return s if len(raw) <= EXCERPT_BYTES else raw[:EXCERPT_BYTES].decode("utf-8", errors="ignore")


def workspace_of(session_id: str) -> str:
    """The kp workspace a ``kp-<ws>`` session tag belongs to. Sessions minted
    elsewhere (Athena's own ``cli``) fall back to the default workspace, so a
    shared tree never mis-attributes a foreign episode to a real tenant."""
    if not session_id.startswith("kp-"):
        return DEFAULT_WORKSPACE_ID
    return session_id[3:] or DEFAULT_WORKSPACE_ID


def session_tag(workspace_id: str) -> str:
    """The session identity kp writes into every episode: ``kp-<workspace>``."""
    return f"kp-{(workspace_id or DEFAULT_WORKSPACE_ID).strip() or DEFAULT_WORKSPACE_ID}"


# ---------------------------------------------------------------------------
# Birth
# ---------------------------------------------------------------------------


def ensure_brain() -> dict:
    """Create the tree if it is missing; NEVER overwrite what is already there.

    A constitution or identity on disk is the operator's file — it may have been
    edited, or written by Personas' own Athena sharing this root. Re-birthing
    over it would silently discard a self."""
    root = brain_root()
    (root / "episodes").mkdir(parents=True, exist_ok=True)
    constitution = root / "constitution.md"
    identity = root / "identity.md"
    born = []
    if not constitution.exists():
        constitution.write_text(CONSTITUTION_TEMPLATE.read_text(encoding="utf-8"), encoding="utf-8", newline="\n")
        born.append("constitution.md")
    if not identity.exists():
        identity.write_text(IDENTITY_SKELETON, encoding="utf-8", newline="\n")
        born.append("identity.md")
    return {"root": str(root), "constitution": str(constitution), "identity": str(identity), "born": born}


def read_constitution() -> str:
    ensure_brain()
    return (brain_root() / "constitution.md").read_text(encoding="utf-8")


def read_identity() -> str:
    ensure_brain()
    return (brain_root() / "identity.md").read_text(encoding="utf-8")


def read_episode(rel_path: str) -> str:
    """The full body of one episode, by the relative path recall returns."""
    return (brain_root() / rel_path).read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# The kp-local index (brain-local FTS5) — the lane that always works
# ---------------------------------------------------------------------------


def _local_index_path() -> Path:
    return brain_root() / "index.sqlite"


def _open_local_index() -> sqlite3.Connection:
    con = sqlite3.connect(str(_local_index_path()), timeout=BUSY_TIMEOUT_S)
    con.execute("PRAGMA busy_timeout = 5000")
    con.execute(
        """CREATE TABLE IF NOT EXISTS companion_brain_index (
             node_id TEXT PRIMARY KEY,
             workspace_id TEXT NOT NULL DEFAULT 'workspace',
             kind TEXT NOT NULL,
             excerpt TEXT,
             path TEXT NOT NULL,
             created_at TEXT NOT NULL
           )"""
    )
    con.execute(
        "CREATE INDEX IF NOT EXISTS idx_companion_brain_index_ws "
        "ON companion_brain_index (workspace_id, created_at)"
    )
    con.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS companion_brain_fts USING fts5(node_id UNINDEXED, body, tags)"
    )
    return con


def _fts_quote(term: str) -> str:
    return '"' + term.replace('"', '""') + '"'


def recall(query: str, limit: int = 6) -> list[dict]:
    """BM25 over the brain-local index. Returns excerpts + relative paths; the
    caller reads full bodies with ``read_episode`` when it wants them.

    An empty or unmatchable query returns [] rather than raising — a companion
    turn must never fail because recall found nothing."""
    terms = [t for t in (query or "").split() if t.strip()]
    if not terms:
        return []
    match = " OR ".join(_fts_quote(t) for t in terms)
    con = _open_local_index()
    try:
        rows = con.execute(
            """SELECT i.node_id, i.path, i.excerpt, i.created_at
                 FROM companion_brain_fts f
                 JOIN companion_brain_index i ON i.node_id = f.node_id
                WHERE companion_brain_fts MATCH ?
             ORDER BY bm25(companion_brain_fts) ASC
                LIMIT ?""",
            (match, max(1, int(limit))),
        ).fetchall()
    except sqlite3.OperationalError:
        # A malformed MATCH expression (an operator character survived quoting)
        # is a bad query, not a broken brain.
        return []
    finally:
        con.close()
    return [{"nodeId": n, "path": p, "excerpt": e, "createdAt": c} for n, p, e, c in rows]


# ---------------------------------------------------------------------------
# Append
# ---------------------------------------------------------------------------


def format_episode(ep_id: str, role: str, session_id: str, created: str, content: str) -> str:
    """The pinned markdown shape. Changing ANY of these five frontmatter keys
    breaks parity with Personas' episodic store — test_companion_brain.py fails
    loudly rather than letting the two trees drift apart silently."""
    return (
        "---\n"
        f'id: "{ep_id}"\n'
        "type: episode\n"
        f"role: {role}\n"
        f'session: "{session_id}"\n'
        f'created: "{created}"\n'
        "---\n\n"
        f"{content}\n"
    )


def _index_locally(node_id: str, workspace_id: str, content: str, rel: str, created: str, tags: str) -> None:
    con = _open_local_index()
    try:
        con.execute(
            """INSERT INTO companion_brain_index (node_id, workspace_id, kind, excerpt, path, created_at)
               VALUES (?, ?, 'episode', ?, ?, ?)
               ON CONFLICT(node_id) DO UPDATE SET excerpt = excluded.excerpt, path = excluded.path""",
            (node_id, workspace_id, excerpt(content), rel, created),
        )
        con.execute(
            "INSERT INTO companion_brain_fts (node_id, body, tags) VALUES (?, ?, ?)",
            (node_id, content, tags),
        )
        con.commit()
    finally:
        con.close()


def _index_in_kp(node_id: str, workspace_id: str, content: str, rel: str, created: str) -> None:
    """Mirror into kp's own DB so the app can list/search the brain. The table is
    created by ensureDb (app/_lib/db/core.ts); if kp has never booted there is
    nothing to mirror into and the caller records the skip."""
    path = kp_db_path()
    if not path.exists():
        raise FileNotFoundError(f"kp database not found at {path}")
    con = sqlite3.connect(str(path), timeout=BUSY_TIMEOUT_S)
    try:
        con.execute("PRAGMA busy_timeout = 5000")
        con.execute(
            """INSERT INTO companion_brain_index (node_id, workspace_id, kind, excerpt, path, created_at)
               VALUES (?, ?, 'episode', ?, ?, ?)
               ON CONFLICT(node_id) DO UPDATE SET excerpt = excluded.excerpt, path = excluded.path""",
            (node_id, workspace_id, excerpt(content), rel, created),
        )
        con.commit()
    finally:
        con.close()


def _index_in_personas(node_id: str, session_id: str, role: str, body: str, content: str, rel: str, created: str) -> None:
    """The parity write: the same two rows Personas' own append_episode makes,
    so a kp turn is a first-class episode for its recall AND its sleep cycle."""
    path = personas_db_path()
    if not path.exists():
        raise FileNotFoundError(f"Personas database not found at {path}")
    con = sqlite3.connect(str(path), timeout=BUSY_TIMEOUT_S)
    try:
        con.execute("PRAGMA busy_timeout = 5000")
        con.execute(
            """INSERT INTO companion_node
                 (id, kind, session_id, file_path, content_hash, importance, body_excerpt, created_at, updated_at)
               VALUES (?, 'episode', ?, ?, ?, 3, ?, ?, ?)""",
            (node_id, session_id, rel, hashlib.sha256(body.encode("utf-8")).hexdigest(), excerpt(content), created, created),
        )
        con.execute(
            "INSERT INTO companion_fts (node_id, body, tags) VALUES (?, ?, ?)",
            (node_id, content, f"session:{session_id} role:{role}"),
        )
        con.commit()
    finally:
        con.close()


def append_episode(role: str, content: str, session_id: str) -> dict:
    """Write one episode. Disk is truth; every index is best-effort after it.

    ``session_id`` is the Personas-side session identity and should be
    ``kp-<workspace>`` (see ``session_tag``) — it becomes the ``session``
    frontmatter key and the ``session:`` FTS tag on all three lanes.

    Returns ``{id, path, absPath, indexed, skipped}`` where ``skipped`` names
    each index lane that could not be written and why. The brain-local lane is
    the only one whose failure raises."""
    if role not in ROLES:
        raise ValueError(f"role must be one of {ROLES}, got {role!r}")
    content = (content or "").strip()
    if not content:
        raise ValueError("refusing to append an empty episode")
    ensure_brain()

    ep_id = f"ep_{short_id(8)}"
    stamp = datetime.now(timezone.utc)
    created = stamp.isoformat()
    rel = f"episodes/{stamp:%Y}/{stamp:%m}/{stamp:%d}/{ep_id}_{role}.md"
    body = format_episode(ep_id, role, session_id, created, content)

    abs_path = brain_root() / rel
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_text(body, encoding="utf-8", newline="\n")  # disk first — source of truth

    workspace_id = workspace_of(session_id)
    tags = f"session:{session_id} role:{role}"
    indexed: dict[str, bool] = {}
    skipped: list[str] = []
    _index_locally(ep_id, workspace_id, content, rel, created, tags)
    indexed["brain"] = True
    for lane, write in (
        ("kp", lambda: _index_in_kp(ep_id, workspace_id, content, rel, created)),
        ("personas", lambda: _index_in_personas(ep_id, session_id, role, body, content, rel, created)),
    ):
        try:
            write()
            indexed[lane] = True
        except Exception as exc:  # noqa: BLE001 — an index is optional, the episode is not
            indexed[lane] = False
            skipped.append(f"{lane}: {type(exc).__name__}: {exc}"[:200])
    return {"id": ep_id, "path": rel, "absPath": str(abs_path), "indexed": indexed, "skipped": skipped}
