"""CLI for one role-intake dialog exchange (spawned per message by
app/_lib/intake-run.ts, mirroring the other per-request CLIs).

Input files keep the arg list short and unambiguous on Windows:
  --transcript-json  VoiceTurn[] BEFORE the new message
  --brief-json       the accumulated RoleBrief (optional; absent on turn 1)
  --message          the requestor's new message ("" + --opening for turn 0)
  --opening          emit the deterministic session opener (no LLM call)
  --shape            session shape hint for --opening (app_master opens on its
                     own question — the repo was already pointed at)
  --dossier-json     a completed RepoDossier (App master, P2's repo_scan). Its
                     presence makes the exchange an `app_master` one: persona
                     overlay, fenced machine reading, app-master slot script
  --app-master-sync  fold a dossier into the brief as `codebase_dossier.*`
                     facets AND assess the population fit over the objectives
                     the requestor chose (agent_fit use case; keyless =
                     unassessed)
  --voice-turn       the FAST voice thread: one spoken utterance in → the next
                     spoken utterance out (role_intake_voice use case, plain
                     text, 30s timeout → deterministic script on any stall)
  --extract-transcript  the PERIODIC extraction thread: RoleBrief extraction
                     over the stored transcript (--transcript-json)
  --attachments-json reference material attached to the session (list of
                     {kind,title,text}) — fenced into the dialog and
                     extraction prompts; the voice fast thread sees titles only
  --lang             en|cs|de|fr (normalized). The keyless scripted path
                     is written in all four; a locale it does NOT carry is
                     disclosed on the turn as `fallbackLang` (the language
                     actually served) rather than silently swapped.
  --no-llm           force the deterministic scripted path

Output: one JSON object — {reply, brief, shape, done, source[, fallbackReason]}
for a dialog turn; {reply, done, source[, brief]} for --voice-turn;
{brief, shape, extracted, source} for --extract-transcript;
{brief, shape, fit} for --app-master-sync.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from ._cli import CliError, configure_stdio, emit_error, invalid_input
from .agentfit import assess_population_fit
from .intake import (
    APP_MASTER_SHAPE,
    extract_transcript,
    merge_dossier,
    opening_turn,
    run_intake_turn,
    run_voice_turn,
)
from .rolebrief import coerce_role_brief
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
    parser.add_argument("--attachments-json", type=Path)
    parser.add_argument("--message", default="")
    parser.add_argument("--opening", action="store_true")
    parser.add_argument("--shape", default="")
    parser.add_argument("--dossier-json", type=Path)
    parser.add_argument("--app-master-sync", action="store_true")
    parser.add_argument("--voice-turn", action="store_true")
    parser.add_argument("--extract-transcript", action="store_true")
    parser.add_argument("--lang", default="en")
    parser.add_argument("--no-llm", action="store_true")
    args = parser.parse_args()

    try:
        attachments = _load_json(args.attachments_json)
        if attachments is not None and not isinstance(attachments, list):
            raise invalid_input("--attachments-json must contain a JSON array")
        dossier = _load_json(args.dossier_json)
        if dossier is not None and not isinstance(dossier, dict):
            raise invalid_input("--dossier-json must contain a JSON object")
        if args.app_master_sync:
            # Deterministic merge + the population-fit judgment, in ONE spawn:
            # the route calls this when a scan lands and again at compose, and
            # two subprocesses for one screen would be two subprocesses.
            if dossier is None:
                raise invalid_input("--app-master-sync needs a --dossier-json object")
            brief = merge_dossier(coerce_role_brief(_load_json(args.brief_json)), dossier, lang=args.lang)
            provider = None
            if not args.no_llm:
                provider = resolve_provider("agent_fit", timeout=120)
                if provider is not None and not provider.available():
                    provider = None  # documented dance -> unassessed population fit
            payload = {
                "brief": brief.model_dump(by_alias=True),
                "shape": APP_MASTER_SHAPE,
                "fit": assess_population_fit(dossier, brief, provider=provider, lang=args.lang),
            }
        elif args.voice_turn:
            # The FAST voice thread: one spoken utterance, no JSON contract. Its
            # own use case so a fast model can be pinned; short timeout — a slow
            # provider must fall to the deterministic script, not stall the call.
            turns = _load_json(args.transcript_json) or []
            if not isinstance(turns, list):
                raise invalid_input("--transcript-json must contain a JSON array of turns")
            brief = _load_json(args.brief_json)
            provider = None
            if not args.no_llm:
                provider = resolve_provider("role_intake_voice", timeout=30)
                if provider is not None and not provider.available():
                    provider = None  # documented dance → deterministic fast thread
            payload = run_voice_turn(provider, turns, brief, args.message, lang=args.lang, attachments=attachments)
        elif args.extract_transcript:
            turns = _load_json(args.transcript_json) or []
            if not isinstance(turns, list) or not turns:
                raise invalid_input("--extract-transcript needs a non-empty --transcript-json array")
            brief = _load_json(args.brief_json)
            provider = None
            if not args.no_llm:
                provider = resolve_provider("role_intake", timeout=180)
                if provider is not None and not provider.available():
                    provider = None  # documented dance → honest unextracted fallback
            payload = extract_transcript(provider, turns, brief, lang=args.lang, attachments=attachments)
        elif args.opening:
            payload = opening_turn(args.lang, shape=args.shape or None)
        else:
            turns = _load_json(args.transcript_json) or []
            if not isinstance(turns, list):
                raise invalid_input("--transcript-json must contain a JSON array of turns")
            brief = _load_json(args.brief_json)
            provider = None
            if not args.no_llm:
                provider = resolve_provider("role_intake", timeout=120)
                if provider is not None and not provider.available():
                    provider = None  # documented dance → deterministic fallback
            payload = run_intake_turn(
                provider, turns, brief, args.message, lang=args.lang, attachments=attachments, dossier=dossier
            )
    except Exception as exc:
        # ONE envelope, from the shared scaffold: {error, status, code}. The code
        # is chosen at the raise site (invalid_input above) or classified from the
        # exception, so python-runner.ts stops guessing "invalid input" out of a
        # status and useErrorMessage can resolve errors.<CODE> in the reader's
        # language. Exit 2 is preserved for a failure this CLI itself named as
        # caller-correctable — the only signal parseStderrError has left if the
        # envelope itself is ever unparseable.
        rc = emit_error(exc)
        return 2 if isinstance(exc, CliError) and exc.status == 400 else rc

    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
