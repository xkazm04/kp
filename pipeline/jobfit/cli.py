from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from ._cli import ERR_ENGINE, ERR_INVALID_INPUT, CliError, configure_stdio, emit_error
from .i18n import normalize_lang
from .service import analyze


def _emit_event(event: dict) -> None:
    # Write raw bytes so Windows text-mode stdout doesn't translate "\n" to
    # "\r\n" — that would break the "\n\n" SSE separator the Next.js route
    # parses for.
    payload = f"data: {json.dumps(event, ensure_ascii=False)}\n\n".encode("utf-8")
    sys.stdout.buffer.write(payload)
    sys.stdout.buffer.flush()


def _fail(exc: Exception, status: int, code: str, *, stream: bool) -> int:
    """One failure path for BOTH framings of this entry point.

    The analyze CLI answers in two shapes — a single JSON dump (the seam
    app/_lib/analyze-run.ts parses) and an SSE event stream (``--stream``) — and each
    used to hand-roll its own envelope: the plain path printed ``{error, status}`` with
    no ``code`` at all, so python-runner.parseStderrError had to GUESS one back out of
    the status, and the stream path emitted a differently-shaped error event that could
    not carry a code even in principle. Both now name the SAME code, chosen at the raise
    site, from the SAME closed vocabulary (:data:`_cli.ERROR_CODES`).

    The stream framing still exits 0: its error was already DELIVERED on stdout as an
    event, and a non-zero exit would make the seam report a spawn failure on top of the
    error the consumer has already read.
    """
    if stream:
        _emit_event({"type": "error", "message": str(exc), "status": status, "code": code})
        return 0
    emit_error(exc, status=status, code=code)
    # 2 for a client mistake, 1 for an engine fault — the exit-code half of the
    # contract parseStderrError falls back on when stderr is not JSON.
    return 2 if status == 400 else 1


def main(argv: list[str] | None = None) -> int:
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
    args = parser.parse_args(argv)

    if args.cv_path is None:
        parser.error("Provide a CV/profile path.")

    # Normalise at the BOUNDARY, once. `--lang` arrives from a cookie-derived locale on
    # the TS side, so a regional tag or a shouted code ("cs-CZ", "CS", "de_DE") used to
    # ride raw through analyze() into the persisted pipeline-log record — canonical data
    # keyed on a value that was never canonical. Every prompt site downstream normalises
    # for itself, so this changes no narrative; it makes what we STORE match what we ask.
    lang = normalize_lang(args.lang)

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
            lang=lang,
            progress=progress,
            blind=args.blind,
        )
    except CliError as exc:
        # A raise site that already named its own code (not_found / invalid_input).
        return _fail(exc, exc.status, exc.code, stream=args.stream)
    except ValueError as exc:
        # json.JSONDecodeError and pydantic's ValidationError are both ValueError:
        # the caller's file/argument is wrong, and the form can say which.
        return _fail(exc, 400, ERR_INVALID_INPUT, stream=args.stream)
    except Exception as exc:
        # A genuine engine fault — retry/escalate, don't edit the input.
        return _fail(exc, 500, ERR_ENGINE, stream=args.stream)

    if args.stream:
        _emit_event({"type": "result", "data": payload})
        return 0

    print(json.dumps(payload, ensure_ascii=False, indent=2 if args.pretty else None))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
