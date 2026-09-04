from __future__ import annotations

import argparse
import json
from pathlib import Path

from ._cli import configure_stdio, emit_error, invalid_input
from .extractors import extract_text


def main(argv: list[str] | None = None) -> int:
    configure_stdio()

    parser = argparse.ArgumentParser(
        description="Extract plain text from a CV/JD document (PDF, DOCX, TXT, MD)."
    )
    parser.add_argument("path", type=Path)
    args = parser.parse_args(argv)

    # Reuse the exact extractor the CV pipeline uses (service.analyze) so a
    # caller that only has the file reads the SAME text the main analysis does.
    try:
        text = extract_text(args.path)
    except ValueError as exc:
        # Unsupported suffix, an oversized document, an undecodable body — the caller
        # can fix all three by attaching a different file, so this is 400/invalid_input
        # and NOT the anonymous 500 the hand-rolled envelope emitted with no code at
        # all (python-runner then guessed the code back out of the status).
        emit_error(invalid_input(str(exc)))
        return 2
    except Exception as exc:  # noqa: BLE001 — any other extractor failure is an engine fault
        # A broken PDF parser, a missing optional dependency, an IO fault: 500 /
        # engine_error, retry or escalate rather than re-uploading.
        return emit_error(exc)

    print(json.dumps({"text": text}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
