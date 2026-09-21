"""CLI: structure harvested postings deterministically (posting_structure.py).

stdin or ``--input-json <path>``::

    [{"id": "<posting id>", "raw": <RawPosting dict>}, ...]

stdout::

    {"jobs": [{"id": "<posting id>", "job": <Job>}], "notes": ["<id>: <note>", ...]}

One malformed posting is skipped and named in ``notes`` — a batch of 200 must not
fail on one. Exit 2 + the ``invalid_input`` envelope when the INPUT itself is not a
list of {id, raw} objects; exit 1 + ``engine_error`` for an unexpected fault.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from ._cli import configure_stdio, emit_error, invalid_input
from .posting_structure import structure_posting


def _load(path: Path | None) -> Any:
    text = path.read_text(encoding="utf-8") if path else (sys.stdin.read() or "[]")
    return json.loads(text)


def run(items: Any) -> dict[str, Any]:
    if not isinstance(items, list):
        raise invalid_input("input must be a JSON array of {id, raw} objects")
    jobs: list[dict[str, Any]] = []
    notes: list[str] = []
    for index, item in enumerate(items):
        if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not isinstance(item.get("raw"), dict):
            raise invalid_input(f"items[{index}] must be an object with a string id and a raw object")
        try:
            job, item_notes = structure_posting(item["raw"], job_id=item["id"])
        except ValueError as exc:
            notes.append(f"{item['id']}: skipped ({exc})")
            continue
        jobs.append({"id": item["id"], "job": job.model_dump(mode="json")})
        notes.extend(f"{item['id']}: {n}" for n in item_notes)
    return {"jobs": jobs, "notes": notes}


def main(argv: list[str] | None = None) -> int:
    configure_stdio()
    parser = argparse.ArgumentParser(description="Structure harvested postings into matcher Jobs, deterministically.")
    parser.add_argument("--input-json", type=Path, help="JSON array of {id, raw}. Reads stdin if omitted.")
    args = parser.parse_args(argv)
    try:
        payload = run(_load(args.input_json))
    except json.JSONDecodeError as exc:
        emit_error(invalid_input(f"input is not JSON: {exc}"))
        return 2
    except Exception as exc:  # noqa: BLE001 — the envelope classifies it (CliError keeps its code)
        rc = emit_error(exc)
        # Exit 2 for the caller's fault, as every sibling CLI does (python-runner maps it to 400).
        return 2 if getattr(exc, "code", None) == "invalid_input" else rc
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
