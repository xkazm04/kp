"""Real job postings → intake-eval postings (JD-grounded simulation).

The generated bank (``intake_scenarios_gen.py``) covers the market by
CONSTRUCTION — 16 families × seniority × shape, from a hand-written content
table. This module covers it by OBSERVATION: it reads a corpus of real job
descriptions (``data/seed_calibration/jobs.json``, ``data/seed_jobs/jobs.json``,
or any JSON array shaped like them) and turns each posting into the small
record the requestor persona is built from.

Two properties the rest of the harness leans on:

* **Field-shape tolerance.** The two committed corpora disagree about where the
  body lives (``jd_text`` vs ``description`` + a ``requirements[]`` list) and
  whether a family is declared at all. One loader reads both, appends
  ``requirements[]`` to the body as bullets, and fills a missing family through
  the product's own :func:`classify_role_family` rather than guessing.
* **Deterministic stratification.** :func:`stratified_distinct_roles` picks N
  postings with DISTINCT normalized titles, round-robin across role families,
  from a sorted input — so "50 roles from seed_calibration" is the same 50 on
  every machine and every run, which is what makes two runs comparable.

``load_jd_corpus`` is a stable public seam: the recipe-candidate harness (WP5)
imports it. Change its signature only deliberately.
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..taxonomy import classify_role_family

# Body keys, in preference order — the two committed corpora plus the shape the
# job_postings API returns (`bodyText`).
_BODY_KEYS = ("jd_text", "body_text", "bodyText", "description", "body", "text")
_TITLE_KEYS = ("title", "role_title", "name")
_SENIORITY = ("junior", "medior", "senior", "lead")

_SLUG_STRIP = re.compile(r"[^a-z0-9]+")
_WS = re.compile(r"\s+")


@dataclass(frozen=True)
class Posting:
    """One real job description, normalized for the intake simulation."""

    id: str
    title: str
    company: str
    role_family: str
    seniority: str
    lang: str
    body: str


def slugify(title: str) -> str:
    """A filesystem- and scenario-name-safe slug ('Senior Java Engineer' → 'senior-java-engineer')."""
    folded = unicodedata.normalize("NFKD", title or "").encode("ascii", "ignore").decode("ascii")
    return _SLUG_STRIP.sub("-", folded.lower()).strip("-")[:60] or "role"


def normalized_title(title: str) -> str:
    """The key DISTINCT-ness is measured on: case-, accent- and space-insensitive."""
    folded = unicodedata.normalize("NFKD", title or "").encode("ascii", "ignore").decode("ascii")
    return _WS.sub(" ", _SLUG_STRIP.sub(" ", folded.lower())).strip()


def _first(raw: dict, keys: tuple[str, ...]) -> str:
    for key in keys:
        value = raw.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _body_of(raw: dict) -> str:
    body = _first(raw, _BODY_KEYS)
    requirements = raw.get("requirements")
    if isinstance(requirements, list):
        bullets = [f"- {str(r).strip()}" for r in requirements if str(r).strip()]
        if bullets:
            body = (body + "\n\n" + "\n".join(bullets)).strip()
    return body


def _seniority_of(raw: dict, title: str) -> str:
    declared = str(raw.get("seniority") or "").strip().lower()
    if declared in _SENIORITY:
        return declared
    lowered = title.lower()
    for token in ("lead", "senior", "junior"):
        if token in lowered:
            return token
    return "medior"


def _lang_of(raw: dict, default: str) -> str:
    value = raw.get("lang") or raw.get("language")
    if isinstance(value, str) and value.strip():
        return value.strip().lower()[:5]
    return default


def load_jd_corpus(path: str | Path, *, lang: str = "en") -> list[Posting]:
    """Read a JSON corpus of job postings into :class:`Posting` records.

    Accepts a JSON array, or an object carrying the array under ``postings`` /
    ``jobs`` / ``items`` (the shape ``GET /api/job-postings`` returns). A
    posting needs a title and a body; anything missing either is skipped rather
    than silently simulated as an empty role. A missing ``role_family`` is
    filled by the product's own classifier over ``title + body``, so a corpus
    that never declared one still stratifies across families.
    """
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(data, dict):
        for key in ("postings", "jobs", "items", "records"):
            if isinstance(data.get(key), list):
                data = data[key]
                break
    if not isinstance(data, list):
        raise ValueError(f"{path}: expected a JSON array of postings (or an object carrying one)")

    postings: list[Posting] = []
    seen_ids: set[str] = set()
    for index, raw in enumerate(data):
        if not isinstance(raw, dict):
            continue
        title = _first(raw, _TITLE_KEYS)
        body = _body_of(raw)
        if not title or not body:
            continue
        family = str(raw.get("role_family") or raw.get("roleFamily") or "").strip()
        if not family:
            family = classify_role_family([], f"{title}\n{body}")
        identifier = str(raw.get("id") or "").strip() or f"{slugify(title)}-{index:03d}"
        while identifier in seen_ids:  # a corpus may repeat an id; keep them addressable
            identifier = f"{identifier}-x"
        seen_ids.add(identifier)
        postings.append(
            Posting(
                id=identifier,
                title=title,
                company=_first(raw, ("company", "employer", "organization")),
                role_family=family,
                seniority=_seniority_of(raw, title),
                lang=_lang_of(raw, lang),
                body=body,
            )
        )
    return postings


def stratified_distinct_roles(postings: list[Posting], n: int) -> list[Posting]:
    """``n`` postings with distinct titles, round-robin across role families.

    Deterministic by construction: the input is sorted by ``(role_family, id)``
    before anything else happens, the first posting wins a duplicated title, and
    families are visited in sorted order — so the same corpus always yields the
    same selection, on any platform.
    """
    if n <= 0:
        return []
    by_family: dict[str, list[Posting]] = {}
    taken: set[str] = set()
    for posting in sorted(postings, key=lambda p: (p.role_family, p.id)):
        key = normalized_title(posting.title)
        if not key or key in taken:
            continue
        taken.add(key)
        by_family.setdefault(posting.role_family, []).append(posting)

    families = sorted(by_family)
    picked: list[Posting] = []
    cursor = 0
    while len(picked) < n:
        progressed = False
        for family in families:
            bucket = by_family[family]
            if cursor < len(bucket):
                picked.append(bucket[cursor])
                progressed = True
                if len(picked) >= n:
                    break
        if not progressed:
            break  # the corpus is exhausted — report what there was
        cursor += 1
    return picked


def corpus_summary(postings: list[Posting]) -> dict[str, Any]:
    """Counts a report can print without re-walking the corpus."""
    families: dict[str, int] = {}
    for posting in postings:
        families[posting.role_family] = families.get(posting.role_family, 0) + 1
    return {
        "postings": len(postings),
        "families": len(families),
        "by_family": dict(sorted(families.items())),
        "titles": len({normalized_title(p.title) for p in postings}),
    }
