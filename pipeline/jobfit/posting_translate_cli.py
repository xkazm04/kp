"""CLI for translating a role posting into another language (the open-a-role wizard).

    python -m pipeline.jobfit.posting_translate_cli --body-file B --target-lang cs
        [--source-lang en] [--title T] [--no-llm]

Input: --body-file holds the posting as the studio renders it in its SOURCE
language — a Markdown document with headings, bullets and a salary line. It rides
in a FILE, never on argv: a posting is long and argv is world-readable in a
process listing.

Output: {"result": {"body": <markdown>}, "source": "llm"} on stdout when a model
translated it. KEYLESS IS A DECISION, NOT A FAULT: with no provider configured (or
one that fails mid-flight) this exits 0 with {"result": null, "source":
"deterministic", "fallbackReason": "<why>"} — there is NO deterministic twin for a
translation, because a machine that cannot translate must not pretend to. The
caller persists nothing and the posting tab keeps its empty state, which says so.

A translation is the one artifact where inventing is worse than refusing: the
posting is the legal offer a candidate applies against, so the prompt forbids
adding, dropping or softening any requirement, figure or name.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .llm import emit_deterministic, provider_availability, resolve_provider

ERR_INVALID_INPUT = "invalid_input"
ERR_ENGINE = "engine_error"

#: Name each locale in ENGLISH, the language the system prompt itself is written
#: in — naming the target in its own language ("cestina") is one more thing for a
#: small model to misread. Unknown codes fall back to the code itself.
LANGUAGE_NAMES = {
    "en": "English",
    "cs": "Czech",
    "de": "German",
    "fr": "French",
}

SYSTEM_PROMPT = (
    "You are a professional recruitment copywriter who translates job postings between languages. "
    "You translate faithfully and idiomatically, in the register a candidate expects from a company "
    "career page in the target language.\n"
    "Rules you never break:\n"
    "- Preserve the Markdown structure exactly: the same headings, the same bullets, the same order.\n"
    "- Never add, drop, weaken or strengthen a requirement. The posting is what a candidate applies "
    "against, so an invented requirement is a real harm.\n"
    "- Never change a number: salary figures, years of experience, currency units and dates stay as "
    "they are, with only the thousands separator adapted to the target language's convention.\n"
    "- Leave proper nouns, company names, product names and technology names untranslated.\n"
    "- Use the formal register the target language uses to address a stranger.\n"
    "Reply with the translated Markdown document and nothing else: no preamble, no explanation, "
    "no code fence around the whole answer."
)


def language_name(code: str) -> str:
    return LANGUAGE_NAMES.get(code, code)


def build_prompt(body: str, source_lang: str, target_lang: str, title: str) -> str:
    header = f"Translate the job posting below from {language_name(source_lang)} into {language_name(target_lang)}."
    if title.strip():
        header += f'\nThe role is titled "{title.strip()}" in the source language.'
    return f"{header}\n\n---\n{body}\n---"


def _refuse(reason: str) -> int:
    """Report the refusal on stdout as DATA and exit 0.

    A missing provider is not an error condition for the caller: it has a real
    answer to give the recruiter ("no model is configured, so nothing was
    translated"), and an exit code would turn that into a 500. The ledger still
    records the descent so keyless traffic is not invisible.
    """
    emit_deterministic("posting_translate", reason=reason)
    print(json.dumps({"result": None, "source": "deterministic", "fallbackReason": reason}, ensure_ascii=False))
    return 0


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Translate a role posting (LLM; refuses rather than faking it).")
    parser.add_argument("--body-file", type=Path, required=True)
    parser.add_argument("--title", type=str, default="")
    parser.add_argument("--source-lang", type=str, default="en")
    parser.add_argument("--target-lang", type=str, required=True)
    parser.add_argument("--no-llm", action="store_true")
    args = parser.parse_args(argv)

    try:
        body = args.body_file.read_text(encoding="utf-8").strip()
        if not body:
            raise ValueError("--body-file is empty; there is nothing to translate")
        if args.target_lang == args.source_lang:
            raise ValueError("--target-lang equals --source-lang; the posting is already in that language")

        provider = None if args.no_llm else resolve_provider("posting_translate", timeout=120)
        descent = "disabled" if args.no_llm else "no_provider"
        if provider is not None:
            ok, why = provider_availability(provider)
            if not ok:
                provider = None
                descent = why or "no_provider"
        if provider is None:
            return _refuse(descent)

        try:
            completion = provider.complete(
                build_prompt(body, args.source_lang, args.target_lang, args.title),
                system=SYSTEM_PROMPT,
                timeout=120,
            )
        except Exception as exc:  # a provider that passed the gate can still fail mid-flight
            return _refuse(f"llm_error:{type(exc).__name__}")

        translated = (completion.text or "").strip()
        # A model that answered with nothing, or with a token of prose, has not
        # translated a posting. Half the source length is a deliberately loose
        # floor: a Czech rendering of an English ad is shorter, but not by half.
        if len(translated) < max(40, len(body) // 2):
            return _refuse("llm_output_too_short")

        print(json.dumps({"result": {"body": translated}, "source": "llm"}, ensure_ascii=False))
        return 0
    except ValueError as exc:
        print(json.dumps({"error": str(exc), "status": 400, "code": ERR_INVALID_INPUT}, ensure_ascii=False), file=sys.stderr)
        return 2
    except Exception as exc:
        print(json.dumps({"error": str(exc), "status": 500, "code": ERR_ENGINE}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
