"""Job-seeker dialog turns (CV polish, fit) — the process boundary the app spawns.

One exchange per process, mirroring ``intake_cli``: the TypeScript bridge
(``app/_lib/jobseeker-run.ts``) writes the request to a file, spawns this module and
reads ONE JSON line back. The engine (persona, deterministic twin, grounding) lives in
:mod:`jobseeker`; this file only moves JSON across the boundary and resolves the
provider.

Contract
--------
``--input-json <path>`` (or stdin)::

    {"kind": "cv_polish" | "fit",
     "lang": "en" | "cs" | "de" | "fr",
     "profile": <CandidateProfileV2 dict, camelCase>,
     "preferences": <JobseekerPreferences dict>,        # what the profile row holds
     "cvSourceText": str | null,
     "artifact": <CvPolishArtifact> | null,             # the dialog's artifact so far
     "posting": <posting dict> | null,                   # fit only
     "match": <MatchResult dict> | null,                 # fit only
     "dismissals": [{"reason": str, "note": str|null, "title": str}],  # taste signal
     "transcript": [{"role": "interviewer"|"candidate"|"system", "text": str}],
     "message": str | null}                              # null = produce the opening turn

stdout::

    {"reply": str, "done": bool, "source": "llm" | "deterministic",
     "choices": <StudioChoiceSet> | null, "fallbackReason": str | null,
     "fallbackLang": str | null, "artifact": <CvPolishArtifact|FitArtifact> | null,
     "promptVersion": str}

The opening turn (``message: null``) is ALWAYS deterministic — identical keyless and
keyed — so the first paint never waits on a model. ``--no-llm`` forces the twin for
every turn. A malformed request is answered with the shared ``{error, status, code}``
envelope on stderr (``_cli.emit_error``, code ``invalid_input``, exit 1) so the bridge
maps it to a 400 refusal, never to a 500.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from ._cli import configure_stdio, emit_error, invalid_input
from .jobseeker import KINDS, opening_turn, run_turn

# Re-exported for the tests that pin the prompt versions from the CLI's surface.
from .jobseeker import PROMPT_VERSIONS  # noqa: F401 - public re-export

# One typed exchange including a reasoning model; the bridge kills the child at its
# own budget (JOBSEEKER_DIALOG_TIMEOUT_MS) a little later, so this is the inner bound.
PROVIDER_TIMEOUT_S = 100


def _read_input(path: str | None) -> dict[str, Any]:
    raw = Path(path).read_text(encoding="utf-8") if path else sys.stdin.read()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise invalid_input(f"input is not JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise invalid_input("input must be a JSON object")
    return data


def _resolve_provider(use_case: str) -> Any | None:
    """The configured provider for ``use_case``, or None when nothing can serve —
    the documented keyless dance (a resolution error is an unavailable provider,
    never a failed turn)."""
    try:
        from .llm.registry import resolve_provider

        provider = resolve_provider(use_case, timeout=PROVIDER_TIMEOUT_S)
    except Exception:  # noqa: BLE001 - misconfiguration degrades, it does not crash the dialog
        return None
    if provider is None or not provider.available():
        return None
    return provider


def main(argv: list[str] | None = None) -> int:
    configure_stdio()
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input-json", default=None)
    parser.add_argument("--no-llm", action="store_true")
    args = parser.parse_args(argv)
    try:
        req = _read_input(args.input_json)
        if req.get("kind") not in KINDS:
            raise invalid_input(f"kind must be one of {KINDS}")
        if not isinstance(req.get("profile"), dict):
            raise invalid_input("profile must be an object")
        if req.get("message") is None or not req.get("transcript"):
            result = opening_turn(req)
        else:
            use_case = "cv_polish" if req["kind"] == "cv_polish" else "fit_dialog"
            provider = None if args.no_llm else _resolve_provider(use_case)
            result = run_turn(provider, req)
    except Exception as exc:  # noqa: BLE001 - the envelope is the contract
        return emit_error(exc)
    sys.stdout.write(json.dumps(result, ensure_ascii=False) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
