"""Job-seeker dialog turns (CV polish, fit) — the process boundary the app spawns.

WP0 pre-seed: fixes the CLI CONTRACT so the TypeScript bridge and the /me pages can
be built while the prompts land in WP2/WP5. Every reply the stub returns is a valid
deterministic turn, so the module is keyless-correct from the first commit
(docs/architecture/decisions/0004-keyless-degradation-is-a-product-property.md).

Contract
--------
stdin or ``--input-json <path>``::

    {"kind": "cv_polish" | "fit",
     "lang": "en" | "cs" | "de" | "fr",
     "profile": <CandidateProfileV2 dict>,
     "preferences": <JobseekerPreferences dict>,
     "cvSourceText": str | null,
     "posting": <posting dict> | null,          # fit only
     "match": <MatchResult dict> | null,        # fit only
     "dismissals": [{"reason": str, "note": str|null, "title": str}],  # taste signal
     "transcript": [{"role": "interviewer"|"candidate"|"system", "text": str}],
     "message": str | null}                      # null = produce the opening turn

stdout::

    {"reply": str, "done": bool, "source": "llm" | "deterministic",
     "choices": <StudioChoiceSet> | null, "fallbackReason": str | null,
     "fallbackLang": str | null, "artifact": <CvPolishArtifact|FitArtifact> | null,
     "promptVersion": str}

Exit 2 + ``{"error": ..., "code": "invalid_input"}`` on a malformed request; the
bridge maps that to a 400 refusal, never to a 500.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any

KINDS = ("cv_polish", "fit")
LANGS = ("en", "cs", "de", "fr")
PROMPT_VERSIONS = {"cv_polish": "cv-polish-v0-stub", "fit": "fit-dialog-v0-stub"}

_OPENING = {
    "cv_polish": {
        "en": "I have your CV. Before I suggest edits: where would you like to work, and what is the lowest monthly pay you would accept?",
        "cs": "Mám vaše CV. Než navrhnu úpravy: kde byste chtěli pracovat a jaká je nejnižší měsíční mzda, kterou byste přijali?",
        "de": "Ich habe Ihren Lebenslauf. Bevor ich Änderungen vorschlage: Wo möchten Sie arbeiten, und was ist das niedrigste Monatsgehalt, das Sie annehmen würden?",
        "fr": "J'ai votre CV. Avant de proposer des modifications : où souhaitez-vous travailler, et quel est le salaire mensuel minimum que vous accepteriez ?",
    },
    "fit": {
        "en": "Let's look at this posting against your profile. Which gap would you like to talk through first?",
        "cs": "Podívejme se na tuto nabídku ve srovnání s vaším profilem. Který rozdíl chcete probrat nejdřív?",
        "de": "Sehen wir uns diese Stelle im Vergleich zu Ihrem Profil an. Welche Lücke möchten Sie zuerst besprechen?",
        "fr": "Regardons cette offre par rapport à votre profil. Quel écart voulez-vous aborder en premier ?",
    },
}


def _fail(msg: str) -> None:
    sys.stdout.write(json.dumps({"error": msg, "code": "invalid_input"}))
    sys.exit(2)


def _read_input(path: str | None) -> dict[str, Any]:
    raw = open(path, encoding="utf-8").read() if path else sys.stdin.read()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:  # noqa: PERF203 - one parse, one message
        _fail(f"input is not JSON: {exc}")
    if not isinstance(data, dict):
        _fail("input must be a JSON object")
    return data


def deterministic_turn(req: dict[str, Any]) -> dict[str, Any]:
    """The keyless twin. WP2/WP5 replace this with the scripted slot-filling flow;
    the stub already honours the contract: never an empty reply, `source` says so."""
    kind = req["kind"]
    lang = req.get("lang") if req.get("lang") in LANGS else "en"
    transcript = req.get("transcript") or []
    message = req.get("message")
    if message is None or not transcript:
        reply = _OPENING[kind][lang]
    else:
        reply = _OPENING[kind][lang]
    return {
        "reply": reply,
        "done": False,
        "source": "deterministic",
        "choices": None,
        "fallbackReason": "stub",
        "fallbackLang": lang,
        "artifact": None,
        "promptVersion": PROMPT_VERSIONS[kind],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input-json", default=None)
    args = parser.parse_args(argv)
    req = _read_input(args.input_json)
    if req.get("kind") not in KINDS:
        _fail(f"kind must be one of {KINDS}")
    if not isinstance(req.get("profile"), dict):
        _fail("profile must be an object")
    sys.stdout.write(json.dumps(deterministic_turn(req), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
