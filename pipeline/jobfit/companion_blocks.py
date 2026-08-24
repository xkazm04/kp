"""Rich turn components — the fenced-block half of one companion reply.

The model answers in prose, but an enumeration of three or more comparable
things reads badly in a 26rem dock. So the completion may carry fenced blocks:

    ```kp:table
    {"columns": [{"key": "name", "label": "Candidate"}], "rows": [{"name": "A"}]}
    ```

    ```kp:chart
    {"kind": "bar", "x": {"label": "Stage", "values": ["Screen"]},
     "y": {"label": "Candidates"}, "series": [{"label": "Active", "values": [12]}]}
    ```

``split_reply_blocks`` pulls them out of the completion, validates each one
against a STRICT schema, and hands back the prose with the fences removed.

Three properties this module exists for, in order:

1. **A malformed block never crashes a turn.** Anything that is not exactly the
   schema is dropped and counted in ``blockErrors`` — the operator still gets
   the prose, and the count is the honest record that something was thrown away.
2. **The caps are structural, not advisory.** The renderer is 240px of SVG and a
   narrow table; a 40-row block would not be a table, it would be a wall. Over-
   long arrays are TRUNCATED rather than dropped (a 10-row answer is still an
   answer at 8 rows), while a structurally wrong block is dropped whole.
3. **The prose is cleaned, not merely sliced.** Removing a fence from the middle
   of a reply leaves a blank hole; the gap is collapsed so the text still reads.

Nothing here talks to a model, a database, or the filesystem — it is pure text
in, structures out, which is why it is tested directly (tests/test_companion_blocks.py).

WP3 adds a THIRD fence, ``kp:action``, handled by ``split_reply_actions`` in its
own pass ahead of the block pass. It is not a rendering: it is a PROPOSAL the
operator will be asked to accept, and it is validated against the action catalog
the caller was shipped in ``turn.json`` — never against a list written here, which
would be a second source of truth (app/_lib/companion-actions.ts is the first).
"""

from __future__ import annotations

import json
import math
import re
from typing import Any

# Renderer-imposed caps. app/_components/chat/ChatTable.tsx and ChatMiniChart.tsx
# are built to exactly these numbers; changing one without the other produces a
# block the model may emit and the dock cannot draw.
MAX_TABLE_COLUMNS = 4
MAX_TABLE_ROWS = 8
MAX_CHART_POINTS = 8
MAX_CHART_SERIES = 2
MAX_BLOCKS = 2

MAX_TITLE_CHARS = 80
MAX_LABEL_CHARS = 40
MAX_CELL_CHARS = 60
CHART_KINDS = ("bar", "line")

# The action half (WP3). An action is a PROPOSAL — a row the operator accepts or
# declines — so the cap is tighter than the block cap: a reply that is mostly
# buttons has stopped being a conversation.
MAX_ACTIONS = 2
MAX_PARAM_CHARS = 2000

# A terminated fence: ```kp:table … ``` — the JSON may sit on the info line or on
# its own lines, because both shapes come back from real completions.
_FENCE_RE = re.compile(r"```[ \t]*kp:(table|chart)[ \t]*\r?\n?(.*?)```", re.DOTALL)
# A fence the model started and never closed (a completion cut at its token
# ceiling). Left in place it would print raw JSON at the operator; it is dropped
# and counted like any other malformed block.
_DANGLING_RE = re.compile(r"```[ \t]*kp:(?:table|chart)\b(?:(?!```).)*$", re.DOTALL)


def _text(value: Any, limit: int) -> str | None:
    """A non-empty display string, or None. Numbers are allowed because a model
    writes a score as a number as often as a string."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        if not math.isfinite(value):
            return None
        value = f"{value:g}"
    if not isinstance(value, str):
        return None
    flat = " ".join(value.split()).strip()
    return flat[:limit] or None


def _cell(value: Any) -> str:
    """One table cell. A missing or unrenderable value becomes "" — the renderer
    draws a quiet placeholder, because an absent number is not zero."""
    if value is None or isinstance(value, (dict, list)):
        return ""
    if isinstance(value, bool):
        return "yes" if value else "no"
    return _text(value, MAX_CELL_CHARS) or ""


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if math.isfinite(value) else None


def _table(raw: dict) -> dict | None:
    columns_raw = raw.get("columns")
    rows_raw = raw.get("rows")
    if not isinstance(columns_raw, list) or not isinstance(rows_raw, list):
        return None
    columns: list[dict[str, str]] = []
    seen: set[str] = set()
    for entry in columns_raw:
        if not isinstance(entry, dict):
            continue
        key = _text(entry.get("key"), MAX_LABEL_CHARS)
        label = _text(entry.get("label"), MAX_LABEL_CHARS)
        if not key or not label or key in seen:
            continue
        seen.add(key)
        columns.append({"key": key, "label": label})
        if len(columns) == MAX_TABLE_COLUMNS:
            break
    if not columns:
        return None
    rows: list[dict[str, str]] = []
    for entry in rows_raw:
        if not isinstance(entry, dict):
            continue
        row = {column["key"]: _cell(entry.get(column["key"])) for column in columns}
        if not any(row.values()):
            continue  # a row of blanks is noise, not data
        rows.append(row)
        if len(rows) == MAX_TABLE_ROWS:
            break
    if not rows:
        return None
    block: dict[str, Any] = {"type": "table", "columns": columns, "rows": rows}
    title = _text(raw.get("title"), MAX_TITLE_CHARS)
    if title:
        block["title"] = title
    return block


def _chart(raw: dict) -> dict | None:
    chart_kind = raw.get("kind")
    x_raw = raw.get("x")
    y_raw = raw.get("y")
    series_raw = raw.get("series")
    if chart_kind not in CHART_KINDS:
        return None
    if not isinstance(x_raw, dict) or not isinstance(y_raw, dict) or not isinstance(series_raw, list):
        return None
    x_label = _text(x_raw.get("label"), MAX_LABEL_CHARS)
    y_label = _text(y_raw.get("label"), MAX_LABEL_CHARS)
    x_values_raw = x_raw.get("values")
    if not x_label or not y_label or not isinstance(x_values_raw, list):
        return None
    x_values = [_text(v, MAX_LABEL_CHARS) or "" for v in x_values_raw[:MAX_CHART_POINTS]]
    if not x_values:
        return None

    series: list[dict[str, Any]] = []
    for entry in series_raw:
        if not isinstance(entry, dict):
            continue
        label = _text(entry.get("label"), MAX_LABEL_CHARS)
        values_raw = entry.get("values")
        if not label or not isinstance(values_raw, list):
            continue
        values = [_number(v) for v in values_raw[:MAX_CHART_POINTS]]
        if any(v is None for v in values) or not values:
            continue  # a hole in a series is not a chart — drop the series
        series.append({"label": label, "values": [float(v) for v in values if v is not None]})
        if len(series) == MAX_CHART_SERIES:
            break
    if not series:
        return None

    # One length wins: x and every series are truncated to the shortest of them,
    # so a bar can never be drawn against an axis tick that does not exist.
    length = min([len(x_values), *(len(s["values"]) for s in series)])
    if length < 1:
        return None
    title = _text(raw.get("title"), MAX_TITLE_CHARS)
    return {
        "type": "chart",
        "kind": chart_kind,
        **({"title": title} if title else {}),
        "x": {"label": x_label, "values": x_values[:length]},
        "y": {"label": y_label},
        "series": [{"label": s["label"], "values": s["values"][:length]} for s in series],
    }


def _validate(fence: str, body: str) -> dict | None:
    try:
        raw = json.loads(body)
    except (ValueError, TypeError):
        return None
    if not isinstance(raw, dict):
        return None
    return _table(raw) if fence == "table" else _chart(raw)


def _clean_prose(text: str) -> str:
    """Close the hole a removed fence left. Three or more newlines collapse to a
    paragraph break, and trailing whitespace on a line goes."""
    lines = [line.rstrip() for line in text.replace("\r\n", "\n").split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


# A kp:action fence, and the unterminated form of one. Kept separate from the
# block fences because actions are stripped in their OWN pass, before the blocks:
# an action is not a rendering, it is a row the operator will be asked to accept,
# and mixing the two into one regex would make "how many blocks were dropped" and
# "how many actions were dropped" the same number.
_ACTION_FENCE_RE = re.compile(r"```[ \t]*kp:action[ \t]*\r?\n?(.*?)```", re.DOTALL)
_DANGLING_ACTION_RE = re.compile(r"```[ \t]*kp:action\b(?:(?!```).)*$", re.DOTALL)


def _action(raw: dict, catalog: dict[str, dict]) -> dict | None:
    """One validated action, or None.

    Validated against the catalog THE CALLER WAS SHIPPED (companion_cli reads it
    out of turn.json, which the TS side serialized from app/_lib/companion-actions.ts).
    Nothing in this file names an action: a list here would be a second source of
    truth, and the two would drift the first time an action gained a parameter.

    Undeclared parameters are DROPPED rather than carried through — a parameter
    nothing declared is a parameter nothing can validate.
    """
    action_id = _text(raw.get("id"), MAX_LABEL_CHARS)
    spec = catalog.get(action_id) if action_id else None
    if spec is None:
        return None
    params_raw = raw.get("params")
    if params_raw is not None and not isinstance(params_raw, dict):
        return None
    params_raw = params_raw or {}
    params: dict[str, str] = {}
    for declared in spec.get("params", []):
        if not isinstance(declared, dict):
            continue
        name = declared.get("name")
        if not isinstance(name, str) or not name:
            continue
        value = _text(params_raw.get(name), MAX_PARAM_CHARS)
        if not value:
            if declared.get("required"):
                return None
            continue
        params[name] = value
    return {"id": action_id, "params": params}


def _catalog_by_id(actions: Any) -> dict[str, dict]:
    """The shipped catalog, keyed by id. An absent or malformed catalog yields an
    EMPTY map, which makes every action fence invalid — the right default for a
    caller that did not ask for an actor."""
    if not isinstance(actions, list):
        return {}
    catalog: dict[str, dict] = {}
    for entry in actions:
        if isinstance(entry, dict) and isinstance(entry.get("id"), str) and entry["id"]:
            catalog[entry["id"]] = entry
    return catalog


def split_reply_actions(completion: str, actions: Any) -> tuple[str, list[dict], int]:
    """(prose, actions, dropped). Run BEFORE ``split_reply_blocks`` so the block
    pass never sees an action fence.

    ``dropped`` counts every action fence that could not be turned into a
    proposal — bad JSON, an id the shipped catalog does not carry, a missing
    required parameter, an unterminated fence, or one past ``MAX_ACTIONS``. Never
    an exception: the same rule the block half keeps, because a reply that
    reaches the operator beats a reply that was right.
    """
    catalog = _catalog_by_id(actions)
    found: list[dict] = []
    dropped = 0

    def take(match: re.Match[str]) -> str:
        nonlocal dropped
        try:
            raw = json.loads(match.group(1).strip())
        except (ValueError, TypeError):
            raw = None
        action = _action(raw, catalog) if isinstance(raw, dict) else None
        if action is None or len(found) >= MAX_ACTIONS:
            dropped += 1
            return "\n"
        found.append(action)
        return "\n"

    prose = _ACTION_FENCE_RE.sub(take, completion or "")
    prose, dangling = _DANGLING_ACTION_RE.subn("\n", prose)
    dropped += dangling
    return prose, found, dropped


def split_reply_blocks(completion: str) -> tuple[str, list[dict], int]:
    """(prose, blocks, dropped). ``dropped`` counts every fence that was found and
    could not be rendered — malformed JSON, a wrong schema, an unterminated
    fence, or a block past ``MAX_BLOCKS``. It is never an exception: a reply that
    reaches the operator is worth more than a reply that was right."""
    blocks: list[dict] = []
    dropped = 0

    def take(match: re.Match[str]) -> str:
        nonlocal dropped
        block = _validate(match.group(1), match.group(2).strip())
        if block is None or len(blocks) >= MAX_BLOCKS:
            dropped += 1
            return "\n"
        blocks.append(block)
        return "\n"

    prose = _FENCE_RE.sub(take, completion or "")
    prose, dangling = _DANGLING_RE.subn("\n", prose)
    dropped += dangling
    return _clean_prose(prose), blocks, dropped
