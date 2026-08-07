"""CLI for one role-intake dialog exchange (spawned per message by
app/_lib/intake-run.ts, mirroring the other per-request CLIs).

Input files keep the arg list short and unambiguous on Windows:
  --transcript-json  VoiceTurn[] BEFORE the new message
  --brief-json       the accumulated RoleBrief (optional; absent on turn 1)
  --message          the requestor's new message ("" + --opening for turn 0)
  --opening          emit the deterministic session opener (no LLM call)
  --voice-turn       the FAST voice thread: one spoken utterance in → the next
                     spoken utterance out (role_intake_voice use case, plain
                     text, 30s timeout → deterministic script on any stall)
  --extract-transcript  the PERIODIC extraction thread: RoleBrief extraction
                     over the stored transcript (--transcript-json)
  --lang             en|cs (normalized)
  --no-llm           force the deterministic scripted path

Output: one JSON object — {reply, brief, shape, done, source[, fallbackReason]}
for a dialog turn; {reply, done, source[, brief]} for --voice-turn;
{brief, shape, extracted, source} for --extract-transcript.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from ._cli import configure_stdio
from .intake import extract_transcript, opening_turn, run_intake_turn, run_voice_turn
from .llm.registry import resolve_provider


def _load_json(path: Path | None):
    if path is None:
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    configure_stdio()
    parser = argparse.ArgumentParser(description="One role-intake dialog exchange.")
    parser.add_argument("--transcript-json", type=Path)
    parser.add_argument("--brief-json", type=Path)
    parser.add_argument("--message", default="")
    parser.add_argument("--opening", action="store_true")
    parser.add_argument("--voice-turn", action="store_true")
    parser.add_argument("--extract-transcript", action="store_true")
    parser.add_argument("--lang", default="en")
    parser.add_argument("--no-llm", action="store_true")
    args = parser.parse_args()

    try:
        if args.voice_turn:
            # The FAST voice thread: one spoken utterance, no JSON contract. Its
            # own use case so a fast model can be pinned; short timeout — a slow
            # provider must fall to the deterministic script, not stall the call.
            turns = _load_json(args.transcript_json) or []
            if not isinstance(turns, list):
                raise ValueError("--transcript-json must contain a JSON array of turns")
            brief = _load_json(args.brief_json)
            provider = None
            if not args.no_llm:
                provider = resolve_provider("role_intake_voice", timeout=30)
                if provider is not None and not provider.available():
                    provider = None  # documented dance → deterministic fast thread
            payload = run_voice_turn(provider, turns, brief, args.message, lang=args.lang)
        elif args.extract_transcript:
            turns = _load_json(args.transcript_json) or []
            if not isinstance(turns, list) or not turns:
                raise ValueError("--extract-transcript needs a non-empty --transcript-json array")
            brief = _load_json(args.brief_json)
            provider = None
            if not args.no_llm:
                provider = resolve_provider("role_intake", timeout=180)
                if provider is not None and not provider.available():
                    provider = None  # documented dance → honest unextracted fallback
            payload = extract_transcript(provider, turns, brief, lang=args.lang)
        elif args.opening:
            payload = opening_turn(args.lang)
        else:
            turns = _load_json(args.transcript_json) or []
            if not isinstance(turns, list):
                raise ValueError("--transcript-json must contain a JSON array of turns")
            brief = _load_json(args.brief_json)
            provider = None
            if not args.no_llm:
                provider = resolve_provider("role_intake", timeout=120)
                if provider is not None and not provider.available():
                    provider = None  # documented dance → deterministic fallback
            payload = run_intake_turn(provider, turns, brief, args.message, lang=args.lang)
    except ValueError as exc:
        print(json.dumps({"error": str(exc), "status": 400}, ensure_ascii=False), file=sys.stderr)
        return 2
    except Exception as exc:  # keep the TS-side stderr contract: JSON error line
        print(json.dumps({"error": str(exc), "status": 500}, ensure_ascii=False), file=sys.stderr)
        return 1

    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
