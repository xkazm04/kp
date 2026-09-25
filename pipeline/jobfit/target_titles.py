"""The seeker's STATED direction, read against a posting title.

A job seeker names the titles they would apply to (``JobseekerPreferences.targetTitles``)
and, optionally, role families (``targetRoleFamilies``). The matcher reads that
direction in the CAREER dimension only (see ``matching.score_career``): it is a
preference fit, never a claim of possession, so nothing here touches skills.

Title matching is deliberately plain and explainable:

* case- and diacritics-folded ("Inženýr" == "inzenyr");
* parentheticals are dropped ("Senior AI Engineer (LLM)", "Tester (m/w/d)");
* seniority words are dropped on BOTH sides (``SENIORITY_WORDS``) — a seeker who says
  "AI Engineer" is looking at "Senior AI Engineer" too, and level is the seniority
  part of the career score's job, not the title's;
* the stated title must occur as a WHOLE-WORD run inside the posting title
  ("AI Engineer" hits "Applied AI Engineer" and "AI/ML Engineer", never "Maintainer");
* a tiny curated alias table (``ALIAS_GROUPS``) treats common synonyms as one
  target. It is small on purpose: every row is a claim that two titles name the same
  job, and a row that is wrong steers a real person's feed. Add a row only for true
  synonyms, never for "related" roles — relatedness is what the role-family state is for.
"""

from __future__ import annotations

import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

from .taxonomy import DEFAULT_FAMILY, ROLE_FAMILY_SET, WORD_RE, classify_role_family

# Level words ignored on both sides of a title comparison.
SENIORITY_WORDS = frozenset({
    "senior", "sr", "snr", "junior", "jr", "medior", "mid", "lead", "principal", "staff",
})

# Synonym groups, shared with the feed adapters' title filter through ONE file
# (target_title_aliases.json) so the fetch-side filter and this matcher can never
# disagree about what counts as the target. The FIRST entry is the canonical form (the
# one whose role family a stated title in the group routes to — "GenAI Engineer" alone
# would classify as software engineering; the group reads it as the AI engineer it
# names). Rows carry the same job in cs/de/fr, so a Czech MPSV or German EURES title
# ("AI vývojář", "KI-Entwickler") reads as the target it is.
_ALIASES_FILE = Path(__file__).with_name("target_title_aliases.json")
ALIAS_GROUPS: tuple[tuple[str, ...], ...] = tuple(
    tuple(group) for group in json.loads(_ALIASES_FILE.read_text(encoding="utf-8"))["groups"]
)

_PARENTHETICAL = re.compile(r"\([^)]*\)|\[[^\]]*\]")


def _fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text or "")
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch)).casefold()


def title_tokens(title: str) -> tuple[str, ...]:
    """A title as the comparison sees it: folded, parentheticals and level words gone."""
    text = _PARENTHETICAL.sub(" ", _fold(title))
    return tuple(t for t in WORD_RE.findall(text) if t not in SENIORITY_WORDS)


def _group_of(tokens: tuple[str, ...]) -> tuple[str, ...] | None:
    for group in ALIAS_GROUPS:
        if any(title_tokens(alias) == tokens for alias in group):
            return group
    return None


@lru_cache(maxsize=256)
def _forms(title: str) -> tuple[tuple[str, ...], ...]:
    """Every token run that counts as a hit for one stated title (itself + its aliases)."""
    own = title_tokens(title)
    if not own:
        return ()
    group = _group_of(own)
    forms = [own]
    if group:
        forms += [f for f in (title_tokens(a) for a in group) if f and f not in forms]
    return tuple(forms)


def _contains_run(haystack: tuple[str, ...], needle: tuple[str, ...]) -> bool:
    k = len(needle)
    return any(haystack[i:i + k] == needle for i in range(len(haystack) - k + 1))


def matched_target_title(posting_title: str, target_titles: list[str] | tuple[str, ...]) -> str | None:
    """The first stated title the posting title matches (the seeker's own wording), or None."""
    posting = title_tokens(posting_title)
    if not posting:
        return None
    for stated in target_titles:
        if any(_contains_run(posting, form) for form in _forms(stated)):
            return stated
    return None


# Role nouns that name a KIND of job, not its subject: "AI Engineer" is about AI, and
# an "AI Consultant" line in a CV is evidence toward it. Used only to find which CV
# lines speak to a target (target_phrases) — never by the matcher's title match.
_ROLE_NOUNS = frozenset({
    "engineer", "developer", "programmer", "analyst", "consultant", "specialist", "manager",
    "architect", "designer", "scientist", "officer", "administrator", "technician", "expert",
    "inzenyr", "vyvojar", "analytik", "konzultant", "specialista",
    "entwickler", "ingenieur", "berater", "developpeur", "analyste",
})


def fold_tokens(text: str) -> tuple[str, ...]:
    """Every word of ``text``, case- and diacritics-folded (nothing dropped)."""
    return tuple(WORD_RE.findall(_fold(text)))


def target_phrases(title: str) -> tuple[tuple[str, ...], ...]:
    """The SUBJECT of a target title and its aliases, as token runs a CV line can
    contain: "AI Engineer" -> ("ai",), ("ml",), ("llm",), ("machine", "learning")…
    A title that is nothing but a role noun yields nothing."""
    out: list[tuple[str, ...]] = []
    for form in _forms(title):
        subject = tuple(t for t in form if t not in _ROLE_NOUNS)
        if subject and subject not in out:
            out.append(subject)
    return tuple(out)


def contains_phrase(tokens: tuple[str, ...], phrases: tuple[tuple[str, ...], ...]) -> bool:
    return any(_contains_run(tokens, p) for p in phrases)


def has_title_form(title: str) -> bool:
    """Whether a stated title leaves anything to match once level words are dropped."""
    return bool(_forms(title))


@lru_cache(maxsize=256)
def _family_of_title(title: str) -> str | None:
    tokens = title_tokens(title)
    if not tokens:
        return None
    group = _group_of(tokens)
    family = classify_role_family([], group[0] if group else title)
    # A signal-free title falls through to the default family; that is "unknown", not
    # a stated direction — reading it as one would make every general posting a hit.
    return None if family == DEFAULT_FAMILY else family


def target_families(target_titles: list[str] | tuple[str, ...], target_role_families: list[str] | tuple[str, ...]) -> list[str]:
    """The families the seeker is heading for: the ones they stated (known families
    only, in their order), then the families their stated titles route to."""
    out: list[str] = []
    for family in target_role_families:
        if family in ROLE_FAMILY_SET and family not in out:
            out.append(family)
    for title in target_titles:
        family = _family_of_title(title)
        if family and family not in out:
            out.append(family)
    return out
