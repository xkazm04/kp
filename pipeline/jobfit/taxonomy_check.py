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
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .taxonomy import ROLE_FAMILIES, ROLE_FAMILY_SET, normalize_text

_DATA_DIR = Path(__file__).resolve().parents[2] / "data"
TAXONOMY_PATH = _DATA_DIR / "taxonomy.json"
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
SKILL_COVERAGE_FLOORS: dict[str, int] = {
    "software_engineering": 83,
    "data_ai": 39,
    "product_project": 28,
    "healthcare_clinical": 0,
    "life_sciences_research": 0,
    "skilled_trades": 0,
    "operations_logistics": 40,
    "frontline_service": 0,
    "sales_marketing": 39,
    "finance_accounting": 46,
    "legal_compliance": 0,
    "hr_people": 0,
    "education_academic": 0,
    "creative_design": 0,
    "customer_support": 37,
    "general_professional": 0,
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
            # >=2-surface-form rule for its new bilingual vocabulary.
            if len([f for f in normed if f]) < 2:
                result.warnings.append(f"{where}: single surface form — not bilingual")

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

    @property
    def pct_parents(self) -> float:
        return 100.0 * self.with_parents / self.total_terms if self.total_terms else 0.0

    @property
    def pct_bilingual(self) -> float:
        return 100.0 * self.bilingual / self.total_terms if self.total_terms else 0.0


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
        skill = total = parents = bilingual = 0
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
        rows.append(FamilyCoverage(fam, skill, total, parents, bilingual))
    return rows


def skill_counts_by_family(taxonomy: dict[str, Any]) -> dict[str, int]:
    return {row.family: row.skill_terms for row in coverage_by_family(taxonomy)}


def render_coverage_table(taxonomy: dict[str, Any]) -> str:
    rows = coverage_by_family(taxonomy)
    lines = [
        "| Role family | Skill terms | Total terms | % with parents | Bilingual (>=2 forms) |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for r in rows:
        floor = SKILL_COVERAGE_FLOORS.get(r.family)
        floor_note = f" (floor {floor})" if floor else ""
        lines.append(
            f"| `{r.family}` | {r.skill_terms}{floor_note} | {r.total_terms} "
            f"| {r.pct_parents:.0f}% | {r.bilingual} ({r.pct_bilingual:.0f}%) |"
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
        "distinct surface forms. The `floor N` annotations are the regression "
        "floors enforced by `tests/test_taxonomy_coverage_gate.py`.\n\n"
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
