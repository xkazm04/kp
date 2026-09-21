"""Certification of the recipe-candidate mapper (eval/recipe_candidates.py).

Everything here runs OFFLINE. The heuristic path is the product property under
test: a keyless run must still produce a schema-valid digest, and the schema must
be the thing that stops a connector ID, a long dash or a wrong-sized activity list
from reaching the registry's intake.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from pipeline.jobfit.eval import recipe_candidates as rc

FIXTURES = [
    {
        "id": "fx-eng",
        "title": "Backend engineer",
        "company": "Northwind Systems",
        "role_family": "software_engineering",
        "jd_text": (
            "Responsibilities\n"
            "- Review incoming pull requests and pair with the author on the risky ones\n"
            "- Review the service dashboards in Datadog each morning for error spikes\n"
            "- Triage incoming production incidents raised through Jira and escalate\n"
            "- Maintain the deployment pipeline and keep the release notes current\n"
            "- Write and maintain the SQL migrations the service depends on\n"
        ),
    },
    {
        "id": "fx-fin",
        "title": "Financial analyst",
        "company": "Harbor Capital",
        "role_family": "finance_accounting",
        "jd_text": (
            "What you will do\n"
            "- Prepare the monthly budget variance report for the leadership meeting\n"
            "- Reconcile the ledger against invoices before the budget close\n"
            "- Analyze budget spend by cost center and flag variance above threshold\n"
            "- Maintain the budget forecast model in Excel and keep assumptions logged\n"
        ),
    },
    {
        "id": "fx-sup",
        "title": "Customer support specialist",
        "company": "Bluebird Retail",
        "role_family": "customer_support",
        "jd_text": (
            "The role\n"
            "- Respond to customer tickets within the agreed service window\n"
            "- Resolve customer billing questions and escalate the ones you cannot\n"
            "- Document every customer interaction in the help desk system\n"
            "- Review recurring customer complaints and report the pattern weekly\n"
        ),
    },
]


def _registry() -> rc.Registry:
    """The embedded fallback vocabulary, so no test depends on a checkout."""
    return rc.load_registry(None)


def _posting(pid: str, title: str, family: str, *, company: str = "", body: str = "x") -> rc.Posting:
    return rc.Posting(
        id=pid, title=title, company=company, role_family=family,
        seniority="medior", lang="en", body=body,
    )


def _postings() -> list[rc.Posting]:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "jobs.json"
        path.write_text(json.dumps(FIXTURES), encoding="utf-8")
        return rc.load_jd_corpus(path)


class HeuristicTest(unittest.TestCase):
    def test_every_fixture_yields_a_valid_candidate(self) -> None:
        registry = _registry()
        for posting in _postings():
            with self.subTest(posting=posting.id):
                records = rc.heuristic_candidates(posting, registry)
                self.assertGreaterEqual(len(records), 1)
                self.assertLessEqual(len(records), 4)
                for rec in records:
                    problems = rc.validate_candidate(rec, registry)
                    self.assertEqual(problems, [], f"{rec.get('proposed_slug')}: {problems}")
                    self.assertTrue(rec["from"].endswith(rc.HEURISTIC_SUFFIX))
                    self.assertEqual(rec["confidence"], "low")
                    self.assertEqual(rec["source"], f"jd:{posting.id}")

    def test_evidence_is_verbatim_from_the_body(self) -> None:
        registry = _registry()
        posting = _postings()[0]
        body = posting.body
        for rec in rc.heuristic_candidates(posting, registry):
            for line in rec["evidence"]:
                self.assertIn(line, body)

    def test_named_tools_become_categories_not_ids(self) -> None:
        registry = _registry()
        posting = _postings()[0]
        types = {c for rec in rc.heuristic_candidates(posting, registry)
                 for c in rec["connector_types"]}
        # The JD names Datadog, Jira and SQL. None of those words may appear.
        self.assertTrue(types.issubset(registry.connector_types))
        self.assertFalse(types & rc.CONNECTOR_ID_TELLS)

    def test_company_name_never_becomes_the_theme(self) -> None:
        registry = _registry()
        posting = _posting(
            "fx-org",
            "Claims adjuster",
            "finance_accounting",
            company="Cigna",
            body=(
                "Cigna claims are reviewed daily.\n"
                "Review each Cigna claim against the policy terms and record the decision\n"
                "Review the Cigna claim backlog and escalate anything past its deadline\n"
            ),
        )
        for rec in rc.heuristic_candidates(posting, registry):
            self.assertNotIn("cigna", rec["proposed_slug"])


class DomainTableTest(unittest.TestCase):
    def test_every_kp_role_family_has_a_registry_domain(self) -> None:
        taxonomy = json.loads(
            (rc.REPO_ROOT / "data" / "taxonomy.json").read_text(encoding="utf-8")
        )
        families = set(taxonomy["role_families"])
        self.assertEqual(len(families), 16)
        self.assertEqual(
            families - set(rc.ROLE_FAMILY_TO_DOMAIN),
            set(),
            "a role family with no registry domain routes its whole corpus nowhere",
        )
        self.assertEqual(set(rc.ROLE_FAMILY_TO_DOMAIN) - families, set())

    def test_the_ten_live_domains_are_the_targets(self) -> None:
        self.assertEqual(len(rc.DOMAINS), 10)
        self.assertEqual(set(rc.DOMAINS), set(rc.FALLBACK_TOPICS))


class ValidationTest(unittest.TestCase):
    def _base(self) -> dict:
        registry = _registry()
        rec = rc.heuristic_candidates(_postings()[0], registry)[0]
        self.assertEqual(rc.validate_candidate(rec, registry), [])
        return dict(rec)

    def test_a_long_dash_is_rejected(self) -> None:
        registry = _registry()
        rec = self._base()
        rec["need"] = "Without this the work piles up — late and inconsistent."
        problems = rc.validate_candidate(rec, registry)
        self.assertTrue(any("long dash" in p for p in problems), problems)

    def test_connector_ids_are_rejected(self) -> None:
        registry = _registry()
        for bad in ("plausible", "datadog", "jira", "salesforce", "hubspot", "github"):
            with self.subTest(connector=bad):
                rec = self._base()
                rec["connector_types"] = [bad]
                problems = rc.validate_candidate(rec, registry)
                self.assertTrue(problems, f"{bad} passed validation")
                self.assertTrue(any(bad in p for p in problems), problems)

    def test_desktop_is_banned_even_though_it_is_recorded(self) -> None:
        registry = _registry()
        self.assertIn("desktop", registry.connector_types)
        rec = self._base()
        rec["connector_types"] = ["desktop"]
        problems = rc.validate_candidate(rec, registry)
        self.assertTrue(any("banned" in p for p in problems), problems)

    def test_activity_bounds_and_map_term_floor(self) -> None:
        registry = _registry()
        rec = self._base()
        rec["activity_labels"] = ["Only one"]
        self.assertTrue(rc.validate_candidate(rec, registry))
        rec = self._base()
        rec["map_terms"] = ["one", "two"]
        self.assertTrue(rc.validate_candidate(rec, registry))
        rec = self._base()
        rec["evidence"] = []
        self.assertTrue(rc.validate_candidate(rec, registry))

    def test_unknown_domain_and_topic_are_rejected(self) -> None:
        registry = _registry()
        rec = self._base()
        rec["proposed_domain"] = "aerospace"
        self.assertTrue(rc.validate_candidate(rec, registry))
        rec = self._base()
        rec["proposed_topic"] = "a-topic-that-does-not-exist"
        self.assertTrue(rc.validate_candidate(rec, registry))


class DedupeTest(unittest.TestCase):
    def _rec(self, **over) -> dict:
        rec = {
            "ts": rc._iso_now(),
            "source": "jd:a",
            "sources": ["jd:a"],
            "role_title": "Backend engineer",
            "role_family": "software_engineering",
            "proposed_domain": "software_engineering",
            "proposed_topic": "code-review",
            "proposed_slug": "pull-request-review",
            "proposed_title": "Pull request review",
            "need": "Without this, review debt accrues.",
            "core_action": "Judge which changes need a human read.",
            "output": "A reviewed queue with the reasoning recorded.",
            "activity_labels": ["Collect the open changes", "Judge the risky ones",
                                "Record the decision"],
            "connector_types": ["source_control"],
            "map_terms": ["pull", "request", "review", "code"],
            "evidence": ["Review incoming pull requests"],
            "confidence": "low",
            "from": rc.FROM_ID,
        }
        rec.update(over)
        return rec

    def test_same_slug_merges_sources_and_evidence(self) -> None:
        merged = rc.dedupe([
            self._rec(),
            self._rec(source="jd:b", sources=["jd:b"], evidence=["Review the diff"],
                      confidence="high", need="Without this, defects ship."),
        ])
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["sources"], ["jd:a", "jd:b"])
        self.assertEqual(merged[0]["source"], "jd:a")
        self.assertEqual(merged[0]["evidence"],
                         ["Review incoming pull requests", "Review the diff"])
        # The higher confidence record wins the prose.
        self.assertEqual(merged[0]["confidence"], "high")
        self.assertEqual(merged[0]["need"], "Without this, defects ship.")

    def test_overlapping_map_terms_merge_inside_one_domain(self) -> None:
        merged = rc.dedupe([
            self._rec(),
            self._rec(source="jd:c", sources=["jd:c"], proposed_slug="code-change-review",
                      map_terms=["pull", "request", "review", "changes"]),
        ])
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["sources"], ["jd:a", "jd:c"])

    def test_a_different_domain_never_merges(self) -> None:
        merged = rc.dedupe([
            self._rec(),
            self._rec(source="jd:d", sources=["jd:d"], proposed_domain="data_ai",
                      proposed_topic="data-quality"),
        ])
        self.assertEqual(len(merged), 2)


class CliTest(unittest.TestCase):
    def _corpus(self, tmp: str) -> Path:
        path = Path(tmp) / "jobs.json"
        path.write_text(json.dumps(FIXTURES), encoding="utf-8")
        return path

    def test_no_llm_end_to_end_writes_both_files_and_exits_zero(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            corpus = self._corpus(tmp)
            out = Path(tmp) / "candidates.jsonl"
            summary = Path(tmp) / "candidates.md"
            code = rc.main([
                "--jd-corpus", str(corpus), "--roles", "3", "--no-llm",
                "--out", str(out), "--summary", str(summary),
                "--registry", str(Path(tmp) / "no-registry-here"), "--no-color",
            ])
            self.assertEqual(code, 0)
            self.assertTrue(out.is_file() and summary.is_file())
            records = [json.loads(line) for line in out.read_text(encoding="utf-8").splitlines()]
            self.assertGreaterEqual(len(records), 3)
            text = summary.read_text(encoding="utf-8")
            self.assertIn("embedded fallback", text)
            self.assertIn("Run /assay", text)
            self.assertIn("--domain <d> inside the registry", text)

    def test_limit_is_an_alias_of_roles(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            corpus = self._corpus(tmp)
            out = Path(tmp) / "o.jsonl"
            code = rc.main([
                "--jd-corpus", str(corpus), "--limit", "1", "--no-llm",
                "--out", str(out), "--summary", str(Path(tmp) / "o.md"), "--no-color",
            ])
            self.assertEqual(code, 0)
            sources = {json.loads(line)["source"]
                       for line in out.read_text(encoding="utf-8").splitlines()}
            self.assertEqual(len(sources), 1)

    def test_strict_exits_one_when_a_record_violates_the_schema(self) -> None:
        original = rc._candidates_for_posting

        # The stand-in must keep the real signature so `--strict` sees exactly one
        # injected bad record through the seam it uses in production; the unused
        # parameters are the seam's, hence the suppression on the line below.
        def broken(posting, registry, *, provider):  # noqa: ARG001 - injection seam
            records, note = original(posting, registry, provider=provider)
            bad = dict(records[0])
            bad["connector_types"] = ["datadog"]
            bad["proposed_slug"] = "injected-bad-record"
            return [*records, bad], note

        with tempfile.TemporaryDirectory() as tmp:
            corpus = self._corpus(tmp)
            rc._candidates_for_posting = broken
            try:
                code = rc.main([
                    "--jd-corpus", str(corpus), "--roles", "1", "--no-llm", "--strict",
                    "--out", str(Path(tmp) / "o.jsonl"),
                    "--summary", str(Path(tmp) / "o.md"), "--no-color",
                ])
            finally:
                rc._candidates_for_posting = original
            self.assertEqual(code, 1)
            text = (Path(tmp) / "o.md").read_text(encoding="utf-8")
            self.assertIn("injected-bad-record", text)
            self.assertIn("connector ID", text)
            # Dropped, never repaired: it is not in the digest.
            body = (Path(tmp) / "o.jsonl").read_text(encoding="utf-8")
            self.assertNotIn("injected-bad-record", body)

    def test_a_missing_corpus_is_exit_two(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            code = rc.main([
                "--jd-corpus", str(Path(tmp) / "nope.json"), "--no-llm",
                "--out", str(Path(tmp) / "o.jsonl"), "--summary", str(Path(tmp) / "o.md"),
            ])
            self.assertEqual(code, 2)

    def test_a_nonpositive_role_count_is_exit_two(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            code = rc.main([
                "--jd-corpus", str(self._corpus(tmp)), "--roles", "0", "--no-llm",
                "--out", str(Path(tmp) / "o.jsonl"), "--summary", str(Path(tmp) / "o.md"),
            ])
            self.assertEqual(code, 2)


class RegistryReadTest(unittest.TestCase):
    def test_the_default_registry_path_is_read_or_named_as_absent(self) -> None:
        # The sibling checkout is machine-specific (present on the operator's box,
        # absent in CI), so the test asserts WHICHEVER branch applies rather than
        # skipping: a real checkout is read and yields the live vocabulary; no
        # checkout yields the embedded fallback and the summary header says so.
        path = (rc.REPO_ROOT / rc.DEFAULT_REGISTRY).resolve()
        registry = rc.load_registry(path)
        if path.is_dir():
            self.assertIn(str(path), registry.source)
            self.assertIn("code-review", registry.topics.get("software_engineering", ()))
            self.assertIn("crm", registry.connector_types)
        else:
            self.assertIn("embedded fallback", registry.source)
            self.assertEqual(registry.topics, dict(rc.FALLBACK_TOPICS))

    def test_the_embedded_fallback_says_so(self) -> None:
        registry = rc.load_registry(rc.REPO_ROOT / "definitely-not-a-registry")
        self.assertIn("embedded fallback", registry.source)
        self.assertEqual(registry.topics, dict(rc.FALLBACK_TOPICS))


class StratificationTest(unittest.TestCase):
    """The sampler is WP4's `intake_corpus`; these pin what THIS module needs of it."""

    def test_distinct_titles_are_drawn_across_families(self) -> None:
        postings = [
            _posting(f"a{i}", f"Engineer {i}", "software_engineering") for i in range(5)
        ] + [_posting("f0", "Analyst", "finance_accounting")]
        picked = rc.stratified_distinct_roles(postings, 2)
        self.assertEqual({p.role_family for p in picked},
                         {"software_engineering", "finance_accounting"})

    def test_a_repeated_title_is_taken_once(self) -> None:
        postings = [
            _posting("a", "Backend Engineer", "software_engineering"),
            _posting("b", "backend engineer", "software_engineering"),
        ]
        self.assertEqual(len(rc.stratified_distinct_roles(postings, 5)), 1)


if __name__ == "__main__":
    unittest.main()
