"""Authoring harness for ``data/taxonomy.json`` — lint + coverage instrumentation.

``data/taxonomy.json`` is ~176 hand-maintained terms and is the ONLY brake on the
"industry lock": all skill vocabulary lives here, yet nothing measured its shape.
This module is that measurement:

- :func:`lint_taxonomy` structurally validates every term (unique id, non-empty
  match list, per-term unique normalized surface forms, categories from a known
  set, role-family votes to REAL families, parents that resolve to existing term
  ids, salary_signal keys that exist in ``salary_signals``) and returns
  ``(errors, warnings)``. It runs on ANY taxonomy dict — the tests feed it
  synthetic bad terms to prove each defect is caught.
- :func:`coverage_by_family` reports, per role family, the skill-term count,
  total-term count, share of terms carrying ``parents`` edges (partial-credit
  hierarchy) and bilingual coverage (terms with >=2 surface forms).

Run as a CLI::

    python -m pipeline.jobfit.taxonomy_check              # lint + print coverage
    python -m pipeline.jobfit.taxonomy_check --write-report   # regenerate the doc

Exit status is non-zero when the lint finds ERRORS, so it works as a CI gate. The
per-family skill floors in :data:`SKILL_COVERAGE_FLOORS` are asserted by
``tests/test_taxonomy_coverage_gate.py`` so coverage can only grow, never silently
regress.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .taxonomy import ROLE_FAMILIES, ROLE_FAMILY_SET, normalize_text

_DATA_DIR = Path(__file__).resolve().parents[2] / "data"
TAXONOMY_PATH = _DATA_DIR / "taxonomy.json"
_SEED_JOBS_PATH = _DATA_DIR / "seed_jobs" / "jobs.normalized.json"
_SEED_CANDIDATES_PATH = _DATA_DIR / "seed_candidates" / "candidates.json"
_REPO_ROOT = Path(__file__).resolve().parents[2]
COVERAGE_REPORT_PATH = _REPO_ROOT / "docs" / "TAXONOMY_COVERAGE.md"

# The closed vocabulary of `categories`. A term whose category is outside this set
# is a typo or an un-modelled dimension — either way a lint error, so the set is
# explicit rather than derived from the data (which would make every typo "known").
# `skill` is the load-bearing one (drives the skill graph + score_skills); the rest
# are the classifier dimensions (role_title, seniority, education, company_*, …).
KNOWN_CATEGORIES: frozenset[str] = frozenset(
    {
        # Skill graph + finer skill facets.
        "skill",
        "programming_language",
        "framework",
        "devops",
        "cloud",
        "testing",
        "security",
        "compliance",
        "mobile",
        "trait",
        "language",
        # Non-tech skill facets (Direction 2 — the four bank-relevant families).
        "banking",
        "customer_support",
        "sales",
        "operations",
        # Classifier dimensions.
        "company_type",
        "company_modifier",
        "education",
        "seniority",
        "role_title",
    }
)

# Per-family SKILL-term floors. A skill term is one whose `categories` include
# "skill" and which votes for the family. The coverage gate asserts the live count
# never drops below these — Direction 2 RAISES the four bank-relevant families.
# Regenerate the printed numbers with `python -m pipeline.jobfit.taxonomy_check`.
#
# Convention (enforced by tests/test_role_family_parity.py):
#   * A NONZERO floor is an EXACT pin — it must equal the live skill count for that
#     family. The >= gate in test_taxonomy_coverage_gate catches a between-commit
#     REGRESSION; the == guard here forbids silent SLACK, so any commit that changes
#     a built-out family's vocabulary must re-pin its floor in the SAME commit. (This
#     closes the finance_accounting hole: it sat at 46 while the live count was 54,
#     which would have permitted silently deleting 8 finance terms.)
#   * A ZERO floor marks a "not yet built out" family (carrying only cross-voting
#     terms) and is held as a pure minimum — a placeholder, exempt from the == pin so
#     the family can be grown later without a floor bump gating unrelated work. As of
#     phase4 all 16 families are built out, so every floor is now a nonzero exact pin.
SKILL_COVERAGE_FLOORS: dict[str, int] = {
    "software_engineering": 83,
    "data_ai": 38,  # ml merged into machine_learning (one-side-resolves honesty) — one fewer skill term
    "product_project": 28,
    "healthcare_clinical": 44,
    "life_sciences_research": 38,  # phase4 last-families — modelled from zero
    "skilled_trades": 40,
    "operations_logistics": 40,
    "frontline_service": 33,
    "sales_marketing": 39,
    "finance_accounting": 54,  # exact pin re-synced to live (was a slack 46) — guard-the-families
    "legal_compliance": 46,
    "hr_people": 48,
    "education_academic": 37,
    "creative_design": 41,  # phase4 last-families — modelled from zero
    "customer_support": 37,
    "general_professional": 29,  # phase4 last-families — meta-skills at LOW vote weight (0.15)
}


@dataclass
class LintResult:
    """Outcome of :func:`lint_taxonomy`. ``ok`` is true when there are no errors."""

    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


def load_taxonomy(path: Path = TAXONOMY_PATH) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _norm(form: str) -> str:
    return normalize_text(form).strip()


# ---------------------------------------------------------------------------
# Corpus-collision scan.
#
# ``taxonomy.py::_text_contains`` matches a surface form two ways: a precise
# whole-token match, then — only for compact forms of length >= 3 — a spaceless
# fallback ``compact_form in compact_text`` where ``compact_text`` is the ENTIRE
# text with every non-word character stripped (one giant blob). That fallback is
# the industry-lock hazard the 3-char abbreviations are dense with: a surface like
# "dpo" substring-hits inside Czech "odpovídat", and "sox"/"ats"/"sar"/"hris" hit
# ACROSS word boundaries in the compacted blob ("pracovat s lidmi" -> "…ats…").
# Round 4's builder caught "lean" inside "possible and" by hand; this scan does it
# mechanically so new short vocabulary is authored THROUGH the lint, not around it.
#
# A surface COLLIDES against the corpus when its compact form (len >= 3) matches
# via the compact fallback where the precise whole-token path would NOT:
#   * interior/suffix — the compact form sits inside a single corpus word at a
#     NON-prefix position (the "stem"-in-"system" class). A prefix occurrence is
#     exempt: it is the benign Czech-inflection / derivation pattern (python ->
#     "pythonu", audit -> "auditor"), which the compact fallback also fires but
#     which is the same concept, not an unrelated word.
#   * cross-word — the compact form does not occur inside ANY single corpus word,
#     yet appears in a text's fully-compacted blob, so its characters are drawn
#     from two or more concatenated words (sox, ats, hris, sar).
# ---------------------------------------------------------------------------

# Word tokens for the corpus: alphanumeric runs, underscore treated as a separator
# (real ad prose has none; underscores only appear in machine skill-ids we don't
# want to fuse into a false token like "customer_onboarding").
_CORPUS_WORD_RE = re.compile(r"[^\W_]+", re.UNICODE)


def _compact(text: str) -> str:
    # Mirror of taxonomy.py::_compact — strips every non-word char (KEEPS the
    # underscore, exactly as the live matcher's compact_text does), so the blob
    # this scan searches is byte-for-byte what the real fallback searches.
    return re.sub(r"\W+", "", text, flags=re.UNICODE)


@dataclass(frozen=True)
class Corpus:
    """A representative text corpus, prepared once for the collision scan.

    ``word_compacts`` are the distinct compacted single words (for the
    interior/suffix test); ``blobs`` are the per-text fully-compacted strings (for
    the cross-word test). Built from the seeded jobs + candidates by default.
    """

    word_compacts: frozenset[str]
    blobs: tuple[str, ...]


def build_corpus(texts: list[str] | tuple[str, ...]) -> Corpus:
    words: set[str] = set()
    blobs: list[str] = []
    for text in texts:
        n = normalize_text(text or "")
        if not n:
            continue
        blobs.append(_compact(n))
        for w in _CORPUS_WORD_RE.findall(n):
            words.add(w)
    return Corpus(frozenset(words), tuple(blobs))


def _seed_corpus_texts() -> list[str]:
    """Prose drawn from the seeded jobs + candidates (incl. the non-tech slice).

    Missing files degrade to an empty corpus rather than raising, so the scan
    stays runnable in a stripped checkout; the live gate asserts the files exist.
    """
    texts: list[str] = []
    if _SEED_JOBS_PATH.exists():
        for job in json.loads(_SEED_JOBS_PATH.read_text(encoding="utf-8")):
            texts.append(job.get("title", ""))
            texts.append(job.get("description", ""))
            for req in job.get("requirements", []) or []:
                texts.append((req or {}).get("skill", ""))
            texts.extend(job.get("detectedSkills", []) or [])
    if _SEED_CANDIDATES_PATH.exists():
        for cand in json.loads(_SEED_CANDIDATES_PATH.read_text(encoding="utf-8")):
            texts.append(cand.get("displayName", ""))
            texts.append(cand.get("targetRole", ""))
            texts.extend(cand.get("aspirations", []) or [])
            for claim in cand.get("skillClaims", []) or []:
                texts.append((claim or {}).get("skill", ""))
            for ev in cand.get("evidence", []) or []:
                texts.append(ev.get("summary", "") if isinstance(ev, dict) else str(ev))
    return [t for t in texts if t]


def seed_corpus() -> Corpus:
    return build_corpus(_seed_corpus_texts())


@dataclass(frozen=True)
class Collision:
    term_id: str
    surface: str
    compact: str
    kind: str  # "interior" | "cross_word"
    context: str  # the offending corpus word / blob snippet

    def describe(self) -> str:
        return (
            f"{self.term_id}: surface {self.surface!r} (compact {self.compact!r}) "
            f"{self.kind} collision in corpus context {self.context!r}"
        )


def _first_cross_word_context(compact_form: str, blobs: tuple[str, ...]) -> str | None:
    for blob in blobs:
        idx = blob.find(compact_form)
        if idx >= 0:
            lo = max(0, idx - 8)
            hi = min(len(blob), idx + len(compact_form) + 8)
            return blob[lo:hi]
    return None


def scan_corpus_collisions(
    taxonomy: dict[str, Any],
    corpus: Corpus | None = None,
    *,
    term_ids: set[str] | frozenset[str] | None = None,
    categories: tuple[str, ...] | None = ("skill",),
) -> list[Collision]:
    """Every surface form (via its len>=3 compact fallback) that spuriously hits
    the corpus. ``term_ids`` restricts the scan to specific terms (regardless of
    category); otherwise every term carrying one of ``categories`` is scanned
    (pass ``categories=None`` to scan all terms).
    """
    if corpus is None:
        corpus = seed_corpus()
    terms = taxonomy.get("terms") or []
    collisions: list[Collision] = []
    for term in terms:
        tid = term.get("id")
        if term_ids is not None:
            if tid not in term_ids:
                continue
        elif categories is not None and not (set(term.get("categories") or []) & set(categories)):
            continue
        seen: set[str] = set()
        for surface in term.get("match", []) or []:
            if not isinstance(surface, str):
                continue
            cf = _compact(_norm(surface))
            if len(cf) < 3 or cf in seen:
                continue
            seen.add(cf)
            # interior/suffix inside a single word (non-prefix occurrence only).
            interior = next(
                (w for w in corpus.word_compacts if cf in w and not w.startswith(cf)),
                None,
            )
            if interior is not None:
                collisions.append(Collision(str(tid), surface, cf, "interior", interior))
                continue
            # cross-word: a SINGLE-token surface whose compact form is absent from
            # every single corpus word yet present in a blob — so its characters are
            # drawn from two concatenated words (sox <- "espresso xcuitest"). A
            # MULTI-word surface ("customer due diligence") legitimately spans word
            # boundaries in the compacted blob — that is exactly the phrase match the
            # compact fallback exists to make — so it is never a cross-word collision.
            if len(_norm(surface).split()) > 1:
                continue
            if not any(cf in w for w in corpus.word_compacts):
                ctx = _first_cross_word_context(cf, corpus.blobs)
                if ctx is not None:
                    collisions.append(Collision(str(tid), surface, cf, "cross_word", ctx))
    return collisions


def lint_taxonomy(
    taxonomy: dict[str, Any],
    *,
    families: set[str] | frozenset[str] | None = None,
    salary_signal_keys: set[str] | frozenset[str] | None = None,
) -> LintResult:
    """Structurally validate a taxonomy dict; return errors + warnings.

    ``families`` is the set of REAL role families (defaults to the live
    ``ROLE_FAMILY_SET``); ``salary_signal_keys`` defaults to the dict's own
    ``salary_signals`` keys. Passing them explicitly is how the tests validate a
    synthetic taxonomy against a controlled universe.
    """
    if families is None:
        families = ROLE_FAMILY_SET
    if salary_signal_keys is None:
        salary_signal_keys = set(taxonomy.get("salary_signals", {}) or {})

    result = LintResult()
    terms = taxonomy.get("terms")
    if not isinstance(terms, list) or not terms:
        result.errors.append("terms: must be a non-empty list")
        return result

    # First pass: collect ids so parent references can be validated against the
    # full set (a parent may be declared after its child).
    ids: list[str] = [t["id"] for t in terms if isinstance(t, dict) and t.get("id")]
    id_set = set(ids)
    seen_ids: set[str] = set()

    for i, term in enumerate(terms):
        where = f"terms[{i}]"
        if not isinstance(term, dict):
            result.errors.append(f"{where}: must be an object")
            continue

        tid = term.get("id")
        where = f"terms[{i}] (id={tid!r})"
        if not tid or not isinstance(tid, str):
            result.errors.append(f"{where}: missing non-empty string 'id'")
        elif tid in seen_ids:
            result.errors.append(f"{where}: duplicate term id {tid!r}")
        else:
            seen_ids.add(tid)

        match = term.get("match")
        if not isinstance(match, list) or not match:
            result.errors.append(f"{where}: 'match' must be a non-empty list")
            match = []
        else:
            normed: list[str] = []
            for form in match:
                if not isinstance(form, str) or not form.strip():
                    result.errors.append(f"{where}: match form {form!r} is empty / not a string")
                    continue
                normed.append(_norm(form))
            dupes = {f for f in normed if normed.count(f) > 1}
            if dupes:
                result.errors.append(
                    f"{where}: match forms collapse to duplicate normalized value(s) {sorted(dupes)}"
                )
            # Bilingual coverage is a WARNING, not an error: many legitimate terms
            # are proper nouns identical across languages (python, kubernetes). The
            # coverage table quantifies it; Direction 2's own tests enforce the
            # >=2-surface-form rule for its new bilingual vocabulary. A term flagged
            # `bilingual_exempt` declares itself monolingual-by-nature, so it is NOT
            # warned — but a multi-form term carrying the flag is contradictory.
            n_forms = len([f for f in normed if f])
            exempt = term.get("bilingual_exempt")
            if n_forms < 2 and not exempt:
                result.warnings.append(f"{where}: single surface form — not bilingual")
            if exempt is not None and not isinstance(exempt, bool):
                result.errors.append(f"{where}: bilingual_exempt must be a boolean")
            if exempt and n_forms >= 2:
                result.errors.append(
                    f"{where}: bilingual_exempt set on a term with {n_forms} surface forms "
                    "(exemption is only for genuinely monolingual proper nouns)"
                )

        for cat in term.get("categories", []) or []:
            if cat not in KNOWN_CATEGORIES:
                result.errors.append(f"{where}: unknown category {cat!r}")

        for fam in (term.get("role_family_votes") or {}):
            if fam not in families:
                result.errors.append(f"{where}: role_family_votes to unknown family {fam!r}")

        for parent in term.get("parents", []) or []:
            if parent not in id_set:
                result.errors.append(f"{where}: dangling parent {parent!r} (no such term id)")
            if parent == tid:
                result.errors.append(f"{where}: term is its own parent")

        signal = term.get("salary_signal")
        if signal and signal not in salary_signal_keys:
            result.errors.append(
                f"{where}: salary_signal {signal!r} not in salary_signals"
            )

    return result


@dataclass
class FamilyCoverage:
    family: str
    skill_terms: int
    total_terms: int
    with_parents: int
    bilingual: int
    # Terms marked ``bilingual_exempt`` — proper nouns / product & tool / language
    # names that are written identically in Czech and English JDs (python, docker,
    # kubernetes, tableau). They carry a single surface form by nature, so they are
    # bilingual-BY-NATURE rather than missing a translation; the parity metric below
    # counts them as covered. The flag is explicit per-term (never inferred), so no
    # number can be gamed by silently exempting a term that DOES have a Czech surface.
    bilingual_exempt: int = 0

    @property
    def pct_parents(self) -> float:
        return 100.0 * self.with_parents / self.total_terms if self.total_terms else 0.0

    @property
    def pct_bilingual(self) -> float:
        return 100.0 * self.bilingual / self.total_terms if self.total_terms else 0.0

    @property
    def bilingual_parity(self) -> int:
        """Terms at bilingual parity: a real >=2-surface term OR a proper-noun exempt."""
        return self.bilingual + self.bilingual_exempt

    @property
    def pct_parity(self) -> float:
        return 100.0 * self.bilingual_parity / self.total_terms if self.total_terms else 0.0


def coverage_by_family(taxonomy: dict[str, Any]) -> list[FamilyCoverage]:
    """Per-family coverage stats, in benchmark family order.

    A term counts toward every family it votes for. ``skill_terms`` restricts to
    terms carrying the ``skill`` category (the ones ``score_skills`` /
    ``classify_role_family`` actually consume).
    """
    terms = taxonomy.get("terms") or []
    rows: list[FamilyCoverage] = []
    # Preserve benchmark order, then append any vote-only families not in it.
    fam_order = list(ROLE_FAMILIES)
    for t in terms:
        for fam in (t.get("role_family_votes") or {}):
            if fam not in fam_order:
                fam_order.append(fam)
    for fam in fam_order:
        skill = total = parents = bilingual = exempt = 0
        for t in terms:
            if fam not in (t.get("role_family_votes") or {}):
                continue
            total += 1
            if "skill" in (t.get("categories") or []):
                skill += 1
            if t.get("parents"):
                parents += 1
            forms = {_norm(f) for f in t.get("match", []) if isinstance(f, str) and f.strip()}
            if len(forms) >= 2:
                bilingual += 1
            elif t.get("bilingual_exempt"):
                # Monolingual by nature (proper noun) — counts toward parity, not bilingual.
                exempt += 1
        rows.append(FamilyCoverage(fam, skill, total, parents, bilingual, exempt))
    return rows


def skill_counts_by_family(taxonomy: dict[str, Any]) -> dict[str, int]:
    return {row.family: row.skill_terms for row in coverage_by_family(taxonomy)}


def render_coverage_table(taxonomy: dict[str, Any]) -> str:
    rows = coverage_by_family(taxonomy)
    lines = [
        "| Role family | Skill terms | Total terms | % with parents | Bilingual (>=2 forms) | Bilingual parity |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for r in rows:
        floor = SKILL_COVERAGE_FLOORS.get(r.family)
        floor_note = f" (floor {floor})" if floor else ""
        exempt_note = f" +{r.bilingual_exempt} exempt" if r.bilingual_exempt else ""
        lines.append(
            f"| `{r.family}` | {r.skill_terms}{floor_note} | {r.total_terms} "
            f"| {r.pct_parents:.0f}% | {r.bilingual} ({r.pct_bilingual:.0f}%) "
            f"| {r.bilingual_parity}{exempt_note} ({r.pct_parity:.0f}%) |"
        )
    total_terms = len(taxonomy.get("terms") or [])
    lines.append("")
    lines.append(f"_Total terms: {total_terms}._")
    return "\n".join(lines)


def render_coverage_report(taxonomy: dict[str, Any]) -> str:
    return (
        "# Taxonomy coverage\n\n"
        "**Generated file — do not hand-edit.** Regenerate with "
        "`python -m pipeline.jobfit.taxonomy_check --write-report` "
        "(or `npm run taxonomy:report`).\n\n"
        "Per-role-family coverage of `data/taxonomy.json`. A term counts toward "
        "every family it votes for; _skill terms_ are those tagged `skill` (the "
        "vocabulary `score_skills` and role-family classification consume). "
        "`% with parents` is the share of a family's terms carrying a `parents` "
        "edge (partial-credit hierarchy); _bilingual_ counts terms with >=2 "
        "distinct surface forms. _Bilingual parity_ additionally counts terms flagged "
        "`bilingual_exempt` — proper nouns / product, tool and language names "
        "(python, docker, kubernetes, tableau) written identically in Czech and "
        "English JDs, so they are bilingual-by-nature rather than missing a "
        "translation. The flag is explicit per-term (never inferred), so the parity "
        "number cannot be gamed by exempting a term that has a real Czech surface. "
        "The `floor N` annotations are the regression floors enforced by "
        "`tests/test_taxonomy_coverage_gate.py`.\n\n"
        + render_coverage_table(taxonomy)
        + "\n"
    )


def _print_lint(result: LintResult) -> None:
    if result.errors:
        print(f"LINT: {len(result.errors)} error(s):", file=sys.stderr)
        for e in result.errors:
            print(f"  ERROR {e}", file=sys.stderr)
    if result.warnings:
        print(f"LINT: {len(result.warnings)} warning(s).")
    if result.ok and not result.warnings:
        print("LINT: clean.")
    elif result.ok:
        print("LINT: no errors.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Lint + coverage for data/taxonomy.json")
    parser.add_argument(
        "--write-report",
        action="store_true",
        help="regenerate docs/TAXONOMY_COVERAGE.md",
    )
    parser.add_argument(
        "--check-report",
        action="store_true",
        help="fail if docs/TAXONOMY_COVERAGE.md is stale (does not write)",
    )
    args = parser.parse_args(argv)

    taxonomy = load_taxonomy()
    result = lint_taxonomy(taxonomy)
    _print_lint(result)

    # Corpus-collision scan over every skill surface (informational — the live gate
    # in tests/test_taxonomy_check.py scopes the FAIL to the non-tech families whose
    # short abbreviations were authored through it; grandfathered tech terms such as
    # sql-in-postgresql predate the scan).
    collisions = scan_corpus_collisions(taxonomy)
    if collisions:
        print(f"\nCORPUS COLLISIONS: {len(collisions)} skill surface(s) hit the seed corpus:")
        for c in collisions:
            print(f"  {c.describe()}")
    else:
        print("\nCORPUS COLLISIONS: none across skill surfaces.")

    print()
    print(render_coverage_table(taxonomy))

    report = render_coverage_report(taxonomy)
    if args.write_report:
        COVERAGE_REPORT_PATH.write_text(report, encoding="utf-8")
        print(f"\nWrote {COVERAGE_REPORT_PATH}")
    elif args.check_report:
        current = COVERAGE_REPORT_PATH.read_text(encoding="utf-8") if COVERAGE_REPORT_PATH.exists() else ""
        if current != report:
            print(
                "\nERROR: docs/TAXONOMY_COVERAGE.md is stale — run "
                "`python -m pipeline.jobfit.taxonomy_check --write-report`.",
                file=sys.stderr,
            )
            return 1

    return 0 if result.ok else 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
