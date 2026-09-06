"""`seed_jobs.py` — the corpus generator that had no importing test.

342 lines of production code with no test module: the deterministic spec grid every
demo install's job corpus is derived from, the retry/resume loop that decides what a
rate-limited regeneration keeps, and the normalization sibling the TypeScript store
actually seeds from. Nothing pinned any of it, and the parts that matter are exactly
the parts that fail QUIETLY:

  * `build_specs` is documented as deterministic (`seed=42`). If it were not, two
    regenerations would produce different corpora and no run would say so — the
    output is a committed JSON file whose diff nobody reads line by line.
  * `generate(existing=...)` is the resume path. A bug that drops or duplicates the
    already-generated records burns the subscription quota it exists to save.
  * `_stamp` is the guarantee that the controlled dimensions survive whatever the
    model returned — the reason the distribution can be called "balanced" at all.
  * `write_normalized` writes the file the store seeds from; if the raw and the
    normalized siblings can disagree in count, the DB and the corpus diverge.

Every test here is keyless and offline: the Claude CLI is replaced by a scripted
fake provider, so nothing spawns and nothing is spent.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from collections import Counter
from pathlib import Path

from pipeline.jobfit import seed_jobs
from pipeline.jobfit.claude_cli import ClaudeCliError


class _FakeResult:
    """The `.json()` half of a provider result — all `_gen_one` reads."""

    def __init__(self, payload):
        self._payload = payload

    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


class FakeProvider:
    """Scripted stand-in for `ClaudeCliProvider`; records every prompt it is given.

    `available()` is True so `generate` does not `SystemExit`. `complete` pops the
    next scripted item per CALL, so a retry sees the next one — which is how the
    retry assertions below can be exact instead of approximate.
    """

    def __init__(self, script=None, *, default=None):
        self.script = list(script or [])
        self.default = default
        self.prompts: list[str] = []
        self.systems: list[str | None] = []

    def available(self) -> bool:
        return True

    def complete(self, prompt, *, system=None):
        self.prompts.append(prompt)
        self.systems.append(system)
        if self.script:
            item = self.script.pop(0)
        else:
            item = self.default if self.default is not None else {"title": "Role"}
        if isinstance(item, Exception):
            raise item
        return _FakeResult(item)


# Sentinels for the five controlled dimensions. Deliberately values `build_specs`
# can NEVER produce: an earlier draft used plausible ones, and `role_family` happened
# to coincide with the spec's own family — so deleting the stamp line for that field
# left every assertion green. A fixture that agrees with the code proves nothing.
_NOT_A_FAMILY = "wrong_family"
_NOT_A_SENIORITY = "wrong_seniority"
_NOT_A_MODE = "wrong_mode"
_NOT_A_LOCATION = "Nowhere At All"
_NOT_THE_LANGUAGES = ["Klingon"]


def _ad(**over):
    """A minimally-plausible model answer whose five controlled dimensions are all
    WRONG, so `_stamp` overwriting each of them is individually observable."""
    base = {
        "title": "Backend Engineer",
        "company": "Acme",
        "location": _NOT_A_LOCATION,
        "work_mode": _NOT_A_MODE,
        "employment_type": "full_time",
        "seniority": _NOT_A_SENIORITY,
        "role_family": _NOT_A_FAMILY,
        "languages": _NOT_THE_LANGUAGES,
        "min_years_experience": 3,
        "min_education": "bachelor",
        "description": "A team building things.",
        "requirements": [{"skill": "Python", "kind": "must_have", "hardness": "prerequisite"}],
    }
    base.update(over)
    return base


class BuildSpecsTest(unittest.TestCase):
    def test_is_deterministic_for_a_seed(self) -> None:
        self.assertEqual(seed_jobs.build_specs(40), seed_jobs.build_specs(40))
        self.assertEqual(seed_jobs.build_specs(40, seed=7), seed_jobs.build_specs(40, seed=7))

    def test_a_different_seed_gives_a_different_grid(self) -> None:
        # Determinism that ignored the seed would satisfy the test above while making
        # `--seed` a no-op, so the two facts are asserted separately.
        self.assertNotEqual(seed_jobs.build_specs(40), seed_jobs.build_specs(40, seed=7))

    def test_is_a_prefix_relation_in_count(self) -> None:
        # The i-th spec depends only on i, so `--limit 3` validates the SAME three specs
        # a full run would generate. If it did not, a validation batch would prove
        # nothing about the real corpus.
        self.assertEqual(seed_jobs.build_specs(5), seed_jobs.build_specs(60)[:5])

    def test_ids_are_unique_zero_padded_and_ordered(self) -> None:
        specs = seed_jobs.build_specs(150)
        ids = [s["id"] for s in specs]
        self.assertEqual(len(set(ids)), 150)
        self.assertEqual(ids[0], "job-000")
        self.assertEqual(ids[-1], "job-149")
        # Sorted-by-id order is the order `generate` returns records in; a wider index
        # would reorder the corpus on every regeneration and churn the committed diff.
        self.assertEqual(ids, sorted(ids))

    def test_every_controlled_dimension_is_from_its_declared_vocabulary(self) -> None:
        for spec in seed_jobs.build_specs(150):
            with self.subTest(spec=spec["id"]):
                self.assertIn(spec["family"], seed_jobs.FAMILIES)
                self.assertIn(spec["company_type"], seed_jobs.COMPANY_TYPES)
                self.assertIn(spec["work_mode"], ("remote", "hybrid", "onsite"))
                self.assertIn("English", spec["languages"])
                self.assertIsInstance(spec["entry_friendly"], bool)

    def test_remote_specs_carry_the_remote_location_and_others_a_real_city(self) -> None:
        for spec in seed_jobs.build_specs(150):
            with self.subTest(spec=spec["id"]):
                if spec["work_mode"] == "remote":
                    self.assertEqual(spec["location"], "Remote (CZ)")
                else:
                    self.assertIn(spec["location"], seed_jobs.LOCATIONS)

    def test_the_grid_is_balanced_enough_to_demo(self) -> None:
        # The whole point of the weighted grid is a corpus that shows every family and
        # seniority. A weight edit that emptied one would be a silent demo regression.
        specs = seed_jobs.build_specs(150)
        for key, vocabulary in (("family", seed_jobs.FAMILIES), ("work_mode", ("remote", "hybrid", "onsite"))):
            counts = Counter(s[key] for s in specs)
            for value in vocabulary:
                self.assertGreater(counts[value], 0, f"no {key}={value} in a 150-spec grid")
        entry = sum(1 for s in specs if s["entry_friendly"])
        self.assertGreater(entry, 0, "no entry-friendly specs — the early-career demo has nothing to show")
        self.assertLess(entry, len(specs), "every spec is entry-friendly — the senior demo has nothing to show")


class SpecToPromptTest(unittest.TestCase):
    def test_prompt_carries_the_controlled_dimensions(self) -> None:
        spec = seed_jobs.build_specs(1)[0]
        prompt = seed_jobs.spec_to_prompt(spec)
        for value in (spec["family"], spec["seniority"], spec["company_type"], spec["location"]):
            self.assertIn(value, prompt)
        self.assertIn(json.dumps(spec["languages"]), prompt)
        self.assertIn("Output JSON only", prompt)

    def test_entry_and_experienced_specs_get_different_instructions(self) -> None:
        entry = seed_jobs.spec_to_prompt({**seed_jobs.build_specs(1)[0], "entry_friendly": True})
        senior = seed_jobs.spec_to_prompt({**seed_jobs.build_specs(1)[0], "entry_friendly": False})
        self.assertIn("EARLY-CAREER", entry)
        self.assertIn("learnable", entry)
        self.assertNotIn("EARLY-CAREER", senior)
        self.assertIn("experienced role", senior)


class StampTest(unittest.TestCase):
    def test_controlled_dimensions_overwrite_whatever_the_model_said(self) -> None:
        spec = seed_jobs.build_specs(1)[0]
        stamped = seed_jobs._stamp(_ad(), spec)
        self.assertEqual(stamped["id"], spec["id"])
        self.assertEqual(stamped["role_family"], spec["family"])
        self.assertEqual(stamped["seniority"], spec["seniority"])
        self.assertEqual(stamped["work_mode"], spec["work_mode"])
        self.assertEqual(stamped["location"], spec["location"])
        self.assertEqual(stamped["languages"], spec["languages"])
        self.assertEqual(stamped["source"], "synthetic")

    def test_creative_fields_survive_and_the_input_is_not_mutated(self) -> None:
        record = _ad(title="Staff Platform Engineer")
        stamped = seed_jobs._stamp(record, seed_jobs.build_specs(1)[0])
        self.assertEqual(stamped["title"], "Staff Platform Engineer")
        self.assertEqual(stamped["description"], record["description"])
        # `_stamp` copies; the caller's dict keeps the model's own values.
        self.assertEqual(record["role_family"], _NOT_A_FAMILY)

    def test_every_stamped_dimension_is_declared(self) -> None:
        # `_STAMPED` is the module's own list of what it controls; a dimension stamped
        # but not declared makes the distribution claim wider than the constant says.
        stamped = seed_jobs._stamp(_ad(), seed_jobs.build_specs(1)[0])
        for field in seed_jobs._STAMPED:
            self.assertIn(field, stamped)


class GenerateTest(unittest.TestCase):
    def test_returns_stamped_records_in_id_order_with_no_failures(self) -> None:
        provider = FakeProvider(default=_ad())
        records, failures = seed_jobs.generate(5, workers=1, provider=provider)
        self.assertEqual(failures, {})
        self.assertEqual([r["id"] for r in records], ["job-000", "job-001", "job-002", "job-003", "job-004"])
        self.assertEqual(len(provider.prompts), 5)
        self.assertTrue(all(s == seed_jobs._SYSTEM for s in provider.systems))

    def test_limit_generates_only_the_first_n_specs(self) -> None:
        provider = FakeProvider(default=_ad())
        records, _ = seed_jobs.generate(50, workers=1, limit=3, provider=provider)
        self.assertEqual([r["id"] for r in records], ["job-000", "job-001", "job-002"])
        self.assertEqual(len(provider.prompts), 3)

    def test_existing_records_are_skipped_and_merged(self) -> None:
        # The resume path: a rate-limited run is re-run to top up, and the records it
        # already paid for must be neither regenerated nor dropped.
        already = {"job-000": _ad(title="Kept", id="job-000"), "job-002": _ad(title="Also kept", id="job-002")}
        provider = FakeProvider(default=_ad(title="Fresh"))
        records, _ = seed_jobs.generate(4, workers=1, provider=provider, existing=already)
        by_id = {r["id"]: r for r in records}
        self.assertEqual(sorted(by_id), ["job-000", "job-001", "job-002", "job-003"])
        self.assertEqual(by_id["job-000"]["title"], "Kept")
        self.assertEqual(by_id["job-002"]["title"], "Also kept")
        self.assertEqual(by_id["job-001"]["title"], "Fresh")
        self.assertEqual(len(provider.prompts), 2, "a resumed spec was regenerated — that is spend")

    def test_a_transient_cli_error_is_retried_then_succeeds(self) -> None:
        provider = FakeProvider([ClaudeCliError("rate limited"), _ad(title="Second try")])
        records, failures = seed_jobs.generate(1, workers=1, provider=provider, retries=1, backoff=0)
        self.assertEqual(failures, {})
        self.assertEqual(records[0]["title"], "Second try")
        self.assertEqual(len(provider.prompts), 2)

    def test_exhausted_retries_are_counted_by_reason_not_raised(self) -> None:
        # A failed spec must not abort the run: 149 good records are worth keeping, and
        # the reason counter is how the operator learns whether to re-run or fix a key.
        provider = FakeProvider([ClaudeCliError("nope")] * 3)
        records, failures = seed_jobs.generate(1, workers=1, provider=provider, retries=2, backoff=0)
        self.assertEqual(records, [])
        self.assertEqual(sum(failures.values()), 1)
        self.assertEqual(list(failures), ["cli:error"])

    def test_unparseable_and_non_dict_answers_get_their_own_reasons(self) -> None:
        provider = FakeProvider([ValueError("not json"), ["a", "list"]])
        _records, failures = seed_jobs.generate(2, workers=1, provider=provider, retries=0, backoff=0)
        self.assertEqual(sorted(failures), ["not-a-dict", "unparseable-json"])

    def test_an_unavailable_provider_exits_instead_of_generating_nothing(self) -> None:
        provider = FakeProvider(default=_ad())
        provider.available = lambda: False
        with self.assertRaises(SystemExit):
            seed_jobs.generate(1, workers=1, provider=provider)

    def test_a_custom_spec_set_and_prompt_drive_the_run(self) -> None:
        # The seam seed_jobs_csas.py rides: same generate(), different company profile.
        specs = [{"id": "csas-1", "family": "data_ai", "seniority": "senior",
                  "work_mode": "hybrid", "location": "Praha", "company_type": "enterprise/corporate",
                  "languages": ["Czech"], "entry_friendly": False}]
        provider = FakeProvider(default=_ad())
        records, _ = seed_jobs.generate(1, workers=1, provider=provider, specs=specs,
                                        prompt_fn=lambda s: f"CUSTOM {s['id']}")
        self.assertEqual(provider.prompts, ["CUSTOM csas-1"])
        self.assertEqual(records[0]["id"], "csas-1")
        self.assertEqual(records[0]["languages"], ["Czech"])


class WriteNormalizedTest(unittest.TestCase):
    def test_writes_a_sibling_with_one_normalized_record_per_raw_record(self) -> None:
        provider = FakeProvider(default=_ad())
        records, _ = seed_jobs.generate(3, workers=1, provider=provider)
        with tempfile.TemporaryDirectory() as tmp:
            raw = Path(tmp) / "jobs.json"
            raw.write_text(json.dumps(records), encoding="utf-8")
            norm_path = seed_jobs.write_normalized(records, raw)
            self.assertEqual(norm_path.name, "jobs.normalized.json")
            normalized = json.loads(norm_path.read_text(encoding="utf-8"))
        # The store seeds from the sibling; a count that can drift from the raw corpus
        # is a DB that quietly disagrees with the committed file.
        self.assertEqual(len(normalized), len(records))
        for record in normalized:
            self.assertIn("title", record)
            self.assertNotIn(None, record.values(), "exclude_none left a null on the wire")

    def test_normalization_is_deterministic_for_the_same_records(self) -> None:
        provider = FakeProvider(default=_ad())
        records, _ = seed_jobs.generate(3, workers=1, provider=provider)
        with tempfile.TemporaryDirectory() as tmp:
            first = seed_jobs.write_normalized(records, Path(tmp) / "a.json").read_text(encoding="utf-8")
            second = seed_jobs.write_normalized(records, Path(tmp) / "b.json").read_text(encoding="utf-8")
        self.assertEqual(first, second)


class SummarizeTest(unittest.TestCase):
    def test_reports_the_total_and_every_controlled_distribution(self) -> None:
        provider = FakeProvider(default=_ad())
        records, _ = seed_jobs.generate(10, workers=1, provider=provider)
        summary = seed_jobs.summarize(records)
        self.assertIn("total: 10", summary)
        self.assertIn("entry-eligible:", summary)
        for axis in ("role_family", "seniority", "work_mode"):
            self.assertIn(axis, summary)

    def test_an_empty_corpus_summarizes_without_dividing_by_zero(self) -> None:
        self.assertIn("total: 0", seed_jobs.summarize([]))


class RunSeedMainTest(unittest.TestCase):
    def test_dry_run_prints_specs_and_calls_no_provider(self) -> None:
        code = seed_jobs.run_seed_main(
            seed_jobs.build_specs, seed_jobs.spec_to_prompt,
            default_count=5, argv=["--dry-run", "--limit", "2"],
        )
        self.assertEqual(code, 0)

    def test_materialize_without_a_raw_corpus_fails_instead_of_writing_one(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            code = seed_jobs.run_seed_main(
                seed_jobs.build_specs, seed_jobs.spec_to_prompt,
                default_count=5, argv=["--materialize", "--out", str(Path(tmp) / "missing.json")],
            )
        self.assertEqual(code, 1)

    def test_materialize_rewrites_the_normalized_sibling_from_the_raw_file(self) -> None:
        provider = FakeProvider(default=_ad())
        records, _ = seed_jobs.generate(2, workers=1, provider=provider)
        with tempfile.TemporaryDirectory() as tmp:
            raw = Path(tmp) / "jobs.json"
            raw.write_text(json.dumps(records, ensure_ascii=False), encoding="utf-8")
            code = seed_jobs.run_seed_main(
                seed_jobs.build_specs, seed_jobs.spec_to_prompt,
                default_count=2, argv=["--materialize", "--out", str(raw)],
            )
            self.assertEqual(code, 0)
            sibling = raw.with_name("jobs.normalized.json")
            self.assertTrue(sibling.exists())
            self.assertEqual(len(json.loads(sibling.read_text(encoding="utf-8"))), 2)

    def test_the_module_ships_no_runnable_entry_point(self) -> None:
        # Deliberate: running this module directly used to regenerate a GENERIC corpus
        # over data/seed_jobs/*.json. seed_jobs_csas.py owns the runnable main, and the
        # footgun stays removed.
        self.assertFalse(hasattr(seed_jobs, "main"))


if __name__ == "__main__":
    unittest.main()
