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

``recall()`` is the raw BM25 door; ``surface_recall()`` sits in front of it and
decides which hits GROUND anything (see "Surfacing" below). Storage is never
filtered — every episode is written and indexed, because episodes are the
consolidation substrate. Only what a turn stands on and shows is narrowed.

Zero dependencies (stdlib only), so this module is importable from a spawned
CLI with nothing installed.
"""

from __future__ import annotations

import hashlib
import os
import re
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


def constitution_template() -> str:
    """The SHIPPED constitution, read from the repo instead of from the brain.

    The keyless twin of ``read_constitution``. A memoryless turn still has to
    behave like Candi, but ``read_constitution`` calls ``ensure_brain`` — so
    using it would BIRTH the tree the operator has not consented to yet, which
    is the one thing a memory-off turn must never do."""
    return CONSTITUTION_TEMPLATE.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# Probe — what is on disk, WITHOUT creating any of it
# ---------------------------------------------------------------------------
#
# First-run onboarding asks the operator whether Candi may have a memory at all,
# and it cannot ask honestly without first looking. Every other reader in this
# module goes through ``ensure_brain`` — the probe is the one door that must not,
# because a probe that births the tree has already answered the question it was
# sent to ask.

EPISODE_PROBE_CAP = 999
CONSTITUTION_MARKER = "<!-- kp-constitution v1 -->"


def _count_episodes(root: Path, cap: int = EPISODE_PROBE_CAP) -> int:
    """Episode files on disk, counted cheaply and CAPPED.

    The number is shown to a human as "it holds N memories", and a human reads
    "999+" exactly as well as "41 812" — so the walk stops at the cap rather
    than paying for an exact count of a tree that grows without bound."""
    episodes = root / "episodes"
    if not episodes.is_dir():
        return 0
    seen = 0
    for _root, _dirs, files in os.walk(episodes):
        for name in files:
            if name.endswith(".md"):
                seen += 1
                if seen >= cap:
                    return cap
    return seen


def _identity_sections(identity: Path) -> int:
    """``## `` headings in identity.md — how much of a self is written down.
    Zero on a freshly born brain (the skeleton's own sections are empty)."""
    if not identity.is_file():
        return 0
    try:
        text = identity.read_text(encoding="utf-8")
    except OSError:
        return 0
    return sum(1 for line in text.splitlines() if line.startswith("## "))


def _constitution_origin(constitution: Path) -> str:
    """Who wrote the constitution this brain is running on.

    ``kp`` when it carries the marker this repo's template opens with,
    ``personas`` when a constitution exists WITHOUT it (Athena's own, or one the
    operator rewrote), ``none`` when there is no constitution at all. The middle
    verdict is deliberately a guess stated as provenance rather than authorship:
    what the caller needs to decide is "was this mind made somewhere else", and
    both an Athena tree and a hand-edited one answer that the same way."""
    if not constitution.is_file():
        return "none"
    try:
        text = constitution.read_text(encoding="utf-8")
    except OSError:
        return "none"
    return "kp" if CONSTITUTION_MARKER in text[:400] else "personas"


def probe_brain() -> dict:
    """``{root, present, episodes, identitySections, constitutionOrigin}``.

    Creates nothing, opens no index, and never raises on a missing tree: an
    absent brain is a legitimate answer, not a failure."""
    root = brain_root()
    constitution = root / "constitution.md"
    identity = root / "identity.md"
    present = root.is_dir() and (
        constitution.is_file() or identity.is_file() or (root / "episodes").is_dir()
    )
    return {
        "root": str(root),
        "present": present,
        "episodes": _count_episodes(root),
        "identitySections": _identity_sections(identity),
        "constitutionOrigin": _constitution_origin(constitution),
    }


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
# Surfacing — which recalled episodes GROUND anything
# ---------------------------------------------------------------------------
#
# BM25 answers "what is textually closest to this query", and the closest thing
# to a question is almost always THE QUESTION ITSELF: ``run_turn`` appends the
# operator's message as an episode before it recalls, so the top hit for
# "Please prepare a digest of the workspace for me" is that same sentence, one
# second old. Surfacing it back as "remembered: …" is not memory, it is an echo,
# and it made the whole recall strip read as noise (round-5 operator finding).
#
# So RECALL stays the raw BM25 door — it is the index's contract and its tests
# pin it — and this pass decides what a turn may STAND ON and what it may SHOW:
#
#   drop    a near-echo — the hit adds nothing the query did not already say
#   drop    a bare COMMAND the operator typed today (an instruction grounds
#           nothing; it is a thing asked, not a thing learned)
#   keep    everything else, and mark the insight-like ones with a one-sentence
#           `insight` the dock can print instead of a raw excerpt
#
# Storage is untouched: every episode is still written and still indexed. This
# is a display and grounding decision, made where both consumers meet it.

ECHO_OVERLAP = 0.6
INSIGHT_CHARS = 90

# Openers that make a first sentence an instruction or a question rather than a
# statement. Matched on the FIRST normalized word only, so "Show me the queue"
# is a command while "Showing up late is the pattern I keep seeing" is not.
COMMAND_OPENERS = frozenset(
    """please prepare give show list make write draft compare tell find run generate summarize
    summarise create send check open update add remove delete set put pull fetch explain help
    can could would should what who whom whose when where which how why do does did is are was
    were""".split()
)

# What keeps a sentence out of the command bucket even when it opens like one:
# "Can you always put Czech roles first" is a standing preference, not a one-off
# instruction, and a standing preference is exactly the kind of thing worth
# remembering. Matched against the normalized sentence padded with spaces, so
# every entry is a whole-word phrase.
INSIGHT_MARKERS = (
    " i prefer ",
    " i think ",
    " i want ",
    " i like ",
    " i hate ",
    " my rule ",
    " our rule ",
    " we usually ",
    " remember that ",
    " note that ",
    " from now on ",
    " always ",
    " never ",
)

_ROLE_PREFIX = re.compile(r"^\s*(?:operator|user|assistant|candi|me)\s*:\s*", re.IGNORECASE)
_LEADING_MARKUP = re.compile(r"^[\s>*\-#`]+")
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")
_WORD = re.compile(r"[^0-9a-z]+")


def _normalize(text: str) -> str:
    """Lowercase, punctuation-free, single-spaced. The comparison surface for
    every rule below — an echo differs from its source by capitalisation and a
    question mark far more often than by a word."""
    return _WORD.sub(" ", (text or "").lower()).strip()


def _tokens(text: str) -> set[str]:
    return {t for t in _normalize(text).split() if t}


def is_echo(query: str, text: str) -> bool:
    """The hit is the query wearing a different hat — it adds nothing.

    The measure is DIRECTIONAL: how much of the HIT the query already said,
    ``|hit ∩ query| / |hit|``. A symmetric ratio would be wrong on the digest
    leg, whose query is a dozen words assembled from the board's own role names —
    a long episode that happens to contain most of them is the most grounding
    thing in the index, not an echo of the question. Coverage answers the
    question that actually matters: is there anything in this episode the turn
    did not already have?"""
    a, b = _normalize(query), _normalize(text)
    if not a or not b:
        return False
    if b in a:
        # The stored episode IS the message (the user episode this turn just
        # wrote), or a line the message quotes back verbatim.
        return True
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return False
    return len(ta & tb) / len(tb) >= ECHO_OVERLAP


def episode_role(path: str) -> str:
    """``episodes/2026/08/24/ep_a4710ced_user.md`` -> ``user``. The index row
    carries no role column, and the filename has encoded it since the format was
    pinned — so this reads the record rather than adding a column to the mirror."""
    name = str(path or "").rsplit("/", 1)[-1]
    for role in ROLES:
        if name.endswith(f"_{role}.md"):
            return role
    return ""


def first_sentence(text: str) -> str:
    """The first sentence, with role prefixes and markdown scaffolding stripped.
    Mechanical: no model is asked what an episode was about."""
    body = _ROLE_PREFIX.sub("", _LEADING_MARKUP.sub("", str(text or "")))
    body = re.sub(r"\s+", " ", body).strip()
    if not body:
        return ""
    return _SENTENCE_END.split(body)[0].strip()


def is_command(text: str) -> bool:
    """A bare instruction or question — something the operator ASKED, which
    grounds nothing when it comes back a minute later."""
    sentence = _normalize(first_sentence(text))
    if not sentence:
        return False
    if any(marker in f" {sentence} " for marker in INSIGHT_MARKERS):
        return False
    if first_sentence(text).endswith("?"):
        return True
    head = sentence.split(" ", 1)[0]
    return head in COMMAND_OPENERS


def insight_sentence(text: str, limit: int = INSIGHT_CHARS) -> str:
    """One short sentence of what was learned, at most ``limit`` characters.

    Derived mechanically inside the same turn — no second model leg — because a
    chip that costs a completion is a chip that will be turned off."""
    sentence = first_sentence(text)
    if len(sentence) <= limit:
        return sentence
    cut = sentence[:limit].rsplit(" ", 1)[0].rstrip(" ,;:.-")
    return (cut or sentence[:limit].rstrip()) + "…"


def _day(stamp) -> str:
    return str(stamp or "")[:10]


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def surface_recall(query: str, hits: list[dict], today: str | None = None) -> list[dict]:
    """Filter raw recall down to what a turn may stand on, and mark what it may
    show. Returns the surviving hits, each with an ``insight`` key: a short
    sentence when the episode carries one, ``""`` when it does not (an operator
    command from another day still grounds the answer; it is just not worth a
    chip). Absence is honest — the dock shows nothing rather than an excerpt."""
    day = today or _today()
    surfaced: list[dict] = []
    for hit in hits:
        text = str(hit.get("excerpt") or "")
        if not text.strip():
            continue
        if is_echo(query, text):
            continue
        role = episode_role(str(hit.get("path") or ""))
        command = is_command(text)
        if role == "user" and command and _day(hit.get("createdAt")) == day:
            continue
        out = dict(hit)
        # An assistant episode is an observation she made; a user episode counts
        # only when it states something rather than asking for something.
        out["insight"] = "" if command else insight_sentence(text)
        surfaced.append(out)
    return surfaced


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
