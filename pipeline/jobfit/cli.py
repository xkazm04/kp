from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from ._cli import configure_stdio
from .service import analyze


def _emit_event(event: dict) -> None:
    # Write raw bytes so Windows text-mode stdout doesn't translate "\n" to
    # "\r\n" — that would break the "\n\n" SSE separator the Next.js route
    # parses for.
    payload = f"data: {json.dumps(event, ensure_ascii=False)}\n\n".encode("utf-8")
    sys.stdout.buffer.write(payload)
    sys.stdout.buffer.flush()


def main() -> int:
    configure_stdio()

    parser = argparse.ArgumentParser(description="Analyze a CV and estimate job fit salary.")
    parser.add_argument("cv_path", type=Path, nargs="?")
    parser.add_argument("--grounding", action="store_true")
    parser.add_argument("--job-description-path", type=Path)
    parser.add_argument("--job-description-text")
    parser.add_argument(
        "--job-json",
        type=Path,
        help="Path to the structured Job record (camelCase payload_json shape) backing the JD, "
        "so scoring reads the authored must/nice + prerequisite/learnable grading instead of "
        "re-deriving a flattened requirement list from the JD prose.",
    )
    parser.add_argument("--company-path", type=Path)
    parser.add_argument("--company-text")
    parser.add_argument(
        "--lang",
        default="en",
        help="Output locale for LLM-generated narrative (e.g. en, cs). "
        "Code values, skills, and proper nouns stay verbatim regardless.",
    )
    parser.add_argument(
        "--blind",
        action="store_true",
        help="Blind screening: redact identity (name/contact/photo/gendered terms/age) from the CV before scoring; re-attach the name only in the result.",
    )
    parser.add_argument("--pretty", action="store_true")
    parser.add_argument(
        "--stream",
        action="store_true",
        help="Emit SSE-formatted progress and result events on stdout instead of a single JSON dump.",
    )
    args = parser.parse_args()

    if args.cv_path is None:
        parser.error("Provide a CV/profile path.")

    progress = (lambda stage, status: _emit_event({"type": "stage", "stage": stage, "status": status})) if args.stream else None

    try:
        payload = analyze(
            args.cv_path,
            grounding=args.grounding,
            job_description_path=args.job_description_path,
            job_description_text=args.job_description_text,
            job_json_path=args.job_json,
            company_path=args.company_path,
            company_text=args.company_text,
            lang=args.lang,
            progress=progress,
            blind=args.blind,
        )
    except ValueError as exc:
        if args.stream:
            _emit_event({"type": "error", "message": str(exc), "status": 400})
            return 0
        print(json.dumps({"error": str(exc), "status": 400}, ensure_ascii=False), file=sys.stderr)
        return 2
    except Exception as exc:
        if args.stream:
            _emit_event({"type": "error", "message": str(exc), "status": 500})
            return 0
        print(json.dumps({"error": str(exc), "status": 500}, ensure_ascii=False), file=sys.stderr)
        return 1

    if args.stream:
        _emit_event({"type": "result", "data": payload})
        return 0

    print(json.dumps(payload, ensure_ascii=False, indent=2 if args.pretty else None))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
