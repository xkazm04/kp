"""CLI: a job seeker's own GitHub snapshot -> personal-project skill evidence. Pure, no network.

app/_lib/jobseeker/github.ts reads the seeker's account at LABEL depth (names, descriptions,
primary language, per-repository language bytes, topics, dates; never code). This module
turns that snapshot into evidence items a profile can carry and one aggregate skill list,
under the registry standard recruiting/public-work-evidence-bounding:

- Public work is PERSONAL-PROJECT evidence. Every item carries provenance
  ``personal_project`` (taxonomy.PROVENANCE_WEIGHTS: 0.7), never ``professional``.
- Evidence, never verdicts. The output says what the repositories SHOW. Nothing here says a
  skill is missing; ``corroborates`` only ever says that a claim the seeker already made is
  backed. The merge that consumes this never lowers anything for an absence.
- The budget travels with the result: how many repositories were read, whether the
  per-repository language reads were partial, whether the owner list was cut.

stdin or ``--input-json <path>``::

    {"snapshot": <SeekerGithubSnapshot, camelCase, as github.ts writes it>,
     "claims": [str]}          # the seeker's current CV skill names; may be empty

stdout (exit 0)::

    {"evidence": [{"kind": "project", "title": str, "text": str, "skills": [str],
                   "link": str, "recency": "YYYY-MM" | null,
                   "provenance": "personal_project",
                   "repo": str}],      # the repository NAME (SeekerRepo.name): one account,
                                       # so it is unique, and it is the key the CV joins on
     "skills": [{"skill": str, "termId": str | null, "repos": int,
                 "lastPushedAt": str | null, "corroborates": bool}],
     "budget": {"repos": int, "languageReads": {"planned": int, "read": int},
                "partial": bool, "truncated": bool}}

WHERE A SKILL COMES FROM, per repository (at most SKILLS_PER_REPO, in this order):

1. Its languages: the primary language, plus every language holding at least 10% of the
   repository's bytes when those were read. GitHub's linguist names are mapped to the name a
   CV uses (:data:`_LINGUIST_SURFACE`). Markup, styling, build and shell glue counts only when
   the taxonomy models it as a skill (:data:`_GLUE_LANGUAGES`: a Dockerfile is Docker work, a
   Makefile is not a skill).
2. Its topics, then its name, then its description, read with ``taxonomy.detected_skills``,
   the same primitive the posting structurer uses, so a repository skill and a posting
   requirement name the same term. Four guards stand between a hit and a claim, because
   the taxonomy is multi-industry and its detector was tuned for Czech job-ad prose, while
   repository labels are English identifiers and developer shorthand:

   - Technical terms only (:func:`_is_technical`). "type-safe" is not SAFe, "Redux dispatch"
     is not logistics, "event sourcing" is not HR sourcing, and "Rust ownership" is not a
     soft skill. Repository labels evidence technology, not business domains.
   - Whole words only. The detector tolerates a suffix so that "pythonu" still reads as
     Python. In English that turns "Reactive" into React, "Helmet" into Helm and "SQLite"
     into SQL, so a hit must also stand as a whole token, or as the same concept written
     without separators ("next js" for Next.js).
   - In a DESCRIPTION, a term that is also an everyday English word (:data:`_PROSE_AMBIGUOUS_FORMS`:
     go, node, react, swift...) counts only where it is written as a name: "Written in Go",
     not "how far it can go". Topics are deliberate tags and repository names are
     identifiers, so both take these words as written.
   - "model" is predictive modelling in the taxonomy but a data model or a 3D model in a
     repository's labels. Only a topic says it.

   Role words (engineer, developer, frontend...) are dropped exactly as cv_draft drops them
   from CV claims: they say what a person is, not what they can do.

A repository with no code language at all (an empty repository, an awesome-list, a
README-only placeholder) yields nothing: its labels describe work that is not there.

ONE SPELLING PER SKILL across the whole output, and the seeker's own when they have one.
The taxonomy exposes no display name (a term is an id plus lowercase match forms), so the
spelling is, in order: the seeker's own claim for the same term (so the merge keys the
claim and the evidence alike), GitHub's language name ("TypeScript"), the description's
own casing ("FastAPI"), and last the form that was found. A term is trusted only when the
surface IS one of its forms (:func:`_trusted_term`). ``taxonomy.resolve_term`` also answers
through a compact index where "c#" folds to "c", so it maps "C" and "C++" to C#, and it maps
the Assembly language to the manufacturing skill.

Exit 2 + the ``invalid_input`` envelope when ``snapshot`` is missing or malformed.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from ._cli import configure_stdio, emit_error, invalid_input
from .cv_draft import is_role_word
from .taxonomy import (
    PROVENANCE_WEIGHTS,
    _TERM_BY_ID,
    _compact,
    _compact_fallback_hit,
    contains_whole_token,
    detected_skills,
    normalize_text,
    resolve_term,
)

PROVENANCE = "personal_project"
if PROVENANCE not in PROVENANCE_WEIGHTS:  # pragma: no cover - a taxonomy edit, caught at import
    raise RuntimeError(f"{PROVENANCE!r} has no weight in taxonomy.PROVENANCE_WEIGHTS")

EVIDENCE_CAP = 30
SKILLS_CAP = 40
# The same bound cv_draft puts on one role's skills: a longer stack line is a tag cloud.
SKILLS_PER_REPO = 8
LANGUAGE_SHARE_MIN = 0.10

# GitHub linguist name -> the name a CV (and the taxonomy) uses. Only names that differ.
_LINGUIST_SURFACE: dict[str, str] = {
    "Jupyter Notebook": "Python",
    "Dockerfile": "Docker",
    "HCL": "Terraform",
    "Vue": "Vue.js",
    "Shell": "Bash",
    "PLpgSQL": "PostgreSQL",
    "TSQL": "SQL",
    "PLSQL": "SQL",
}

# Markup, styling, templating, build and shell glue. A share of these is not a skill claim
# unless the taxonomy models the skill (Dockerfile -> Docker, HCL -> Terraform do; Shell ->
# Bash, HTML, CSS and Makefile do not today, and are skipped until it does).
_GLUE_LANGUAGES: frozenset[str] = frozenset({
    "HTML", "CSS", "SCSS", "Sass", "Less", "Stylus", "PostCSS",
    "Makefile", "CMake", "Meson", "Starlark", "Nix", "Procfile", "Dockerfile", "HCL",
    "Shell", "PowerShell", "Batchfile", "Vim Script", "Vim script", "Emacs Lisp",
    "Jinja", "Smarty", "Handlebars", "Mustache", "EJS", "Pug", "Twig", "Blade", "Liquid",
    "Nunjucks", "Mako", "TeX", "Roff", "Markdown", "MDX", "reStructuredText", "AsciiDoc",
    "XSLT", "Rich Text Format",
})

# What makes a taxonomy term TECHNICAL: a vote for one of the two technical role families,
# or a technical category. Data, not a list of ids, so a new taxonomy term is classified by
# the same facts that route it.
_TECH_FAMILIES = frozenset({"software_engineering", "data_ai"})
_TECH_CATEGORIES = frozenset({"programming_language", "framework", "devops", "cloud", "mobile", "testing", "security"})

# Taxonomy forms that are also everyday English words: in a description they count only
# when written as a name (capitalised somewhere), never as the lowercase word.
_PROSE_AMBIGUOUS_FORMS = frozenset({"go", "node", "react", "angular", "swift", "rust", "spring", "spark", "helm"})
# ...and the one whose repository meaning is not the taxonomy's at all: topics only.
_TOPIC_ONLY_FORMS = frozenset({"model"})

# Spelling preference, best first. See the module docstring.
_RANK_CLAIM, _RANK_LANGUAGE, _RANK_AS_WRITTEN, _RANK_FOUND = 0, 1, 2, 3

_SEPARATORS = re.compile(r"[-_]+")
_WS = re.compile(r"\s+")
_YEAR_MONTH = re.compile(r"^(\d{4})-(\d{2})")

Key = tuple[str, str]  # ("term", term_id) or ("name", folded surface): the two never collide


@dataclass(frozen=True)
class _Repo:
    name: str
    link: str
    description: str
    language: str | None
    languages: dict[str, float] | None
    topics: tuple[str, ...]
    pushed_at: str | None
    archived: bool


@dataclass(frozen=True)
class _Hit:
    key: Key
    term_id: str | None
    surface: str
    rank: int


# --- input --------------------------------------------------------------------------------


def _count(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _opt_str(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    s = _WS.sub(" ", value).strip()
    return s or None


def _repo(raw: Any, index: int) -> _Repo:
    where = f"snapshot.repos[{index}]"
    if not isinstance(raw, dict):
        raise invalid_input(f"{where} must be an object")
    name = _opt_str(raw.get("name"))
    link = _opt_str(raw.get("htmlUrl"))
    if not name:
        raise invalid_input(f"{where}.name must be a non-empty string")
    # The link is written onto a CV: it must be the repository's GitHub page.
    if not link or not link.startswith("https://github.com/"):
        raise invalid_input(f"{where}.htmlUrl must be a https://github.com/ URL")
    raw_languages = raw.get("languages")
    languages = (
        {
            lang: float(n)
            for lang, n in raw_languages.items()
            if isinstance(lang, str) and lang.strip() and isinstance(n, (int, float)) and not isinstance(n, bool) and n > 0
        }
        if isinstance(raw_languages, dict)
        else None
    )
    raw_topics = raw.get("topics") if isinstance(raw.get("topics"), list) else []
    topics = tuple(dict.fromkeys(t for t in (_opt_str(x) for x in raw_topics) if t))
    return _Repo(
        name=name,
        link=link,
        description=_opt_str(raw.get("description")) or "",
        language=_opt_str(raw.get("language")),
        languages=languages,
        topics=topics,
        pushed_at=_opt_str(raw.get("pushedAt")),
        archived=raw.get("archived") is True,
    )


def parse_request(req: Any) -> tuple[list[_Repo], list[str], dict[str, int], bool]:
    """(repos, claims, languageReads, truncated) from the request, or invalid_input."""
    if not isinstance(req, dict):
        raise invalid_input("input must be a JSON object")
    snapshot = req.get("snapshot")
    if not isinstance(snapshot, dict):
        raise invalid_input("snapshot must be an object (the SeekerGithubSnapshot github.ts writes)")
    raw_repos = snapshot.get("repos")
    if not isinstance(raw_repos, list):
        raise invalid_input("snapshot.repos must be a list")
    repos = [_repo(raw, i) for i, raw in enumerate(raw_repos)]
    reads = snapshot.get("languageReads")
    if not isinstance(reads, dict) or not _count(reads.get("planned")) or not _count(reads.get("read")):
        raise invalid_input("snapshot.languageReads must be {planned, read} with non-negative integer counts")
    truncated = snapshot.get("truncated")
    if not isinstance(truncated, bool):
        raise invalid_input("snapshot.truncated must be a boolean")
    claims = req.get("claims")
    if claims is None:
        claims = []
    if not isinstance(claims, list):
        raise invalid_input("claims must be a list of strings")
    clean_claims = [c for c in (_opt_str(x) for x in claims) if c]
    return repos, clean_claims, {"planned": reads["planned"], "read": reads["read"]}, truncated


# --- terms --------------------------------------------------------------------------------


def _fold(surface: str) -> str:
    return _WS.sub(" ", normalize_text(surface)).strip()


def _forms(term_id: str) -> list[str]:
    """The term's authored match forms, folded (never the derived Czech feminine forms)."""
    term = _TERM_BY_ID.get(term_id) or {}
    return list(dict.fromkeys(f for f in (_fold(str(m)) for m in term.get("match", ())) if f))


def _trusted_term(surface: str) -> str | None:
    """``resolve_term`` when the surface IS one of the term's forms, literally or as the same
    concept without separators ("Node JS" -> Node.js), and never through a compact form under
    three characters. That last route is how ``resolve_term`` maps "C" and "C++" to C#."""
    term_id = resolve_term(surface)
    if term_id is None:
        return None
    folded = _fold(surface)
    forms = _forms(term_id)
    if folded in forms:
        return term_id
    compact = _compact(folded)
    if len(compact) >= 3 and compact in {_compact(f) for f in forms}:
        return term_id
    return None


def _is_technical(term_id: str) -> bool:
    term = _TERM_BY_ID.get(term_id) or {}
    votes = term.get("role_family_votes") or {}
    if any((votes.get(family) or 0) > 0 for family in _TECH_FAMILIES):
        return True
    return bool(_TECH_CATEGORIES & set(term.get("categories") or ()))


def _key(term_id: str | None, surface: str) -> Key:
    return ("term", term_id) if term_id else ("name", _fold(surface))


# --- one repository -----------------------------------------------------------------------


def _readable(name: str) -> str:
    """The repository name with its separators as spaces: 'ai-registry' -> 'ai registry'."""
    return _WS.sub(" ", _SEPARATORS.sub(" ", name)).strip() or name


def _substantive(repo: _Repo) -> bool:
    return bool(repo.language) or bool(repo.languages)


def _language_hits(repo: _Repo) -> list[_Hit]:
    names: list[str] = []
    if repo.language:
        names.append(repo.language)
    if repo.languages:
        total = sum(repo.languages.values())
        if total > 0:
            for lang, size in sorted(repo.languages.items(), key=lambda kv: (-kv[1], kv[0])):
                if size / total >= LANGUAGE_SHARE_MIN and lang not in names:
                    names.append(lang)
    hits: list[_Hit] = []
    for lang in names:
        surface = _LINGUIST_SURFACE.get(lang, lang)
        term_id = _trusted_term(surface)
        if term_id is not None and not _is_technical(term_id):
            term_id = None  # the Assembly LANGUAGE is not the manufacturing skill
        if lang in _GLUE_LANGUAGES and term_id is None:
            continue
        if is_role_word(surface):
            continue
        hits.append(_Hit(_key(term_id, surface), term_id, surface, _RANK_LANGUAGE))
    return hits


def _strict_hit(text_n: str, compact_text: str, form: str) -> bool:
    """Whole token, or the same concept written without separators; no suffix tolerance."""
    if contains_whole_token(text_n, form):
        return True
    compact_form = _compact(form)
    return len(compact_form) >= 3 and _compact_fallback_hit(text_n, compact_text, compact_form, allow_inflection=False)


def _written(text: str, forms: list[str]) -> list[str]:
    """Every whole-token occurrence of the forms in ``text``, in the author's own casing."""
    out: list[str] = []
    for form in forms:
        parts = [re.escape(p) for p in form.split() if p]
        if not parts:
            continue
        pattern = re.compile(r"(?<!\w)" + r"\s+".join(parts) + r"(?!\w)", re.IGNORECASE)
        out.extend(_WS.sub(" ", m.group(0)) for m in pattern.finditer(text))
    return out


def _label_hits(text: str, source: str) -> list[_Hit]:
    """Taxonomy skills in one label source ("topics", "name" or "description"), guarded."""
    if not text.strip():
        return []
    text_n = normalize_text(text)
    compact_text = _compact(text_n)
    hits: list[_Hit] = []
    for found in detected_skills(text):
        term_id = _trusted_term(found)
        if term_id is None or not _is_technical(term_id) or is_role_word(found):
            continue
        forms = [f for f in _forms(term_id) if _strict_hit(text_n, compact_text, f)]
        if not forms:
            continue  # a suffix-only hit: "Reactive" is not React
        if source != "topics" and set(forms) <= _TOPIC_ONLY_FORMS:
            continue
        written = _written(text, forms) if source != "topics" else []
        named = [w for w in written if w != w.lower()]
        if source == "description" and set(forms) <= _PROSE_AMBIGUOUS_FORMS and not named:
            continue  # "how far it can go" is not Go
        surface, rank = (named[0], _RANK_AS_WRITTEN) if named else (found.strip(), _RANK_FOUND)
        hits.append(_Hit(_key(term_id, found), term_id, surface, rank))
    return hits


def repo_hits(repo: _Repo) -> list[_Hit]:
    """Every skill candidate the repository's labels carry, best source first (not deduped)."""
    if not _substantive(repo):
        return []
    topic_text = "\n".join([*repo.topics, *(t.replace("-", " ") for t in repo.topics if "-" in t)])
    return [
        *_language_hits(repo),
        *_label_hits(topic_text, "topics"),
        *_label_hits(_readable(repo.name), "name"),
        *_label_hits(repo.description, "description"),
    ]


# --- the whole snapshot -------------------------------------------------------------------


def _pushed_sort_key(repo: _Repo) -> tuple[int, float]:
    ts = _timestamp(repo.pushed_at)
    return (1, 0.0) if ts is None else (0, -ts)


def _timestamp(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def _year_month(value: str | None) -> str | None:
    m = _YEAR_MONTH.match(value or "")
    return f"{m.group(1)}-{m.group(2)}" if m and 1 <= int(m.group(2)) <= 12 else None


def derive(repos: list[_Repo], claims: list[str], language_reads: dict[str, int], truncated: bool) -> dict[str, Any]:
    """The CLI's answer for a parsed request. Pure."""
    # Evidence order: live repositories before archived ones, each most recently pushed first.
    ordered = sorted(repos, key=lambda r: (r.archived, *_pushed_sort_key(r)))

    claim_keys: set[Key] = set()
    claim_folds: set[str] = set()
    claim_spelling: dict[Key, str] = {}
    for claim in claims:
        key = _key(_trusted_term(claim), claim)
        claim_keys.add(key)
        claim_folds.add(_fold(claim))
        claim_spelling.setdefault(key, claim)

    spelling: dict[Key, tuple[int, int, str]] = {}  # key -> (rank, first seen, surface)
    chosen: list[tuple[_Repo, list[Key], dict[Key, str | None]]] = []
    seen_order = 0
    for repo in ordered:
        keys: list[Key] = []
        term_of: dict[Key, str | None] = {}
        for hit in repo_hits(repo):
            seen_order += 1
            best = spelling.get(hit.key)
            if best is None or (hit.rank, seen_order) < best[:2]:
                spelling[hit.key] = (hit.rank, seen_order, hit.surface)
            if hit.key not in term_of:
                term_of[hit.key] = hit.term_id
                keys.append(hit.key)
        if keys:
            chosen.append((repo, keys[:SKILLS_PER_REPO], term_of))
        if len(chosen) >= EVIDENCE_CAP:
            break

    def spell(key: Key) -> str:
        return claim_spelling.get(key) or spelling[key][2]

    evidence: list[dict[str, Any]] = []
    tally: dict[Key, dict[str, Any]] = {}
    for repo, keys, term_of in chosen:
        skills = [spell(k) for k in keys]
        stack = "Stack: " + ", ".join(skills)
        evidence.append({
            "kind": "project",
            "title": _readable(repo.name),
            "text": f"{repo.description}\n{stack}" if repo.description else stack,
            "skills": skills,
            "link": repo.link,
            "recency": _year_month(repo.pushed_at),
            "provenance": PROVENANCE,
            "repo": repo.name,
        })
        for k in keys:
            row = tally.setdefault(k, {"termId": term_of[k], "repos": 0, "lastPushedAt": None, "_ts": None})
            row["repos"] += 1
            ts = _timestamp(repo.pushed_at)
            if ts is not None and (row["_ts"] is None or ts > row["_ts"]):
                row["_ts"], row["lastPushedAt"] = ts, repo.pushed_at

    skills_out = sorted(
        tally.items(),
        key=lambda kv: (
            -kv[1]["repos"],
            float("inf") if kv[1]["_ts"] is None else -kv[1]["_ts"],
            _fold(spell(kv[0])),
        ),
    )[:SKILLS_CAP]
    return {
        "evidence": evidence,
        "skills": [
            {
                "skill": spell(k),
                "termId": row["termId"],
                "repos": row["repos"],
                "lastPushedAt": row["lastPushedAt"],
                "corroborates": k in claim_keys or _fold(spell(k)) in claim_folds,
            }
            for k, row in skills_out
        ],
        "budget": {
            "repos": len(repos),
            "languageReads": dict(language_reads),
            "partial": language_reads["read"] < language_reads["planned"],
            "truncated": truncated,
        },
    }


def run(req: Any) -> dict[str, Any]:
    return derive(*parse_request(req))


def _load(path: Path | None) -> Any:
    text = path.read_text(encoding="utf-8") if path else sys.stdin.read()
    return json.loads(text or "{}")


def main(argv: list[str] | None = None) -> int:
    configure_stdio()
    parser = argparse.ArgumentParser(description="Derive personal-project skill evidence from a GitHub snapshot.")
    parser.add_argument("--input-json", type=Path, help="The request JSON. Reads stdin if omitted.")
    args = parser.parse_args(argv)
    try:
        payload = run(_load(args.input_json))
    except json.JSONDecodeError as exc:
        emit_error(invalid_input(f"input is not JSON: {exc}"))
        return 2
    except Exception as exc:  # noqa: BLE001 - the envelope classifies it (CliError keeps its code)
        rc = emit_error(exc)
        return 2 if getattr(exc, "code", None) == "invalid_input" else rc
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
