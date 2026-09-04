"""Tests for the sourcing campaign pack (Erika gap E1).

Pins the honesty contract (phantom DEFAULT_POLICY fields and blanks are never
advertised; missing facts surface as stable warning codes), the deterministic
fallback's never-empty guarantee, the coerce() trust boundary, and the CLI
envelope. Run: python -m unittest pipeline.jobfit.tests.test_campaign
"""

from __future__ import annotations

import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

from pipeline.jobfit import campaign, campaign_cli
from pipeline.jobfit.campaign import (
    HOOK_TYPES,
    VARIANT_MAX,
    WARN_NO_LOCATION,
    WARN_NO_SALARY,
    WARN_NO_SKILLS,
    draft_campaign_pack,
)
from pipeline.jobfit.jobs import Job
from pipeline.jobfit.market_config import BERLIN_MARKET

URL = "https://hire.example.com/apply/job-1/quick?lang=en"


def _job(**overrides) -> Job:
    base = dict(
        id="job-1",
        title="Frontend Developer",
        company="Acme s.r.o.",
        location="Brno",
        work_mode="hybrid",
        seniority="senior",
        detected_skills=["React", "TypeScript", "Node.js"],
        salary_band=[65000, 95000],
    )
    base.update(overrides)
    return Job(**base)


class _FakeProvider:
    """Stands in for ClaudeCliProvider: canned payload or a raised error."""

    def __init__(self, payload=None, exc: Exception | None = None):
        self._payload = payload
        self._exc = exc
        self.prompt: str | None = None
        self.system: str | None = None

    def complete_json(self, prompt: str, *, system: str | None = None, expected_keys=None):
        self.prompt = prompt
        self.system = system
        if self._exc:
            raise self._exc
        return self._payload


class DeterministicPackTests(unittest.TestCase):
    def test_full_facts_yield_one_variant_per_hook_type(self):
        pack, source = draft_campaign_pack(_job(), lang="en", apply_url=URL)
        self.assertEqual(source, "deterministic")
        self.assertEqual([v["hookType"] for v in pack["variants"]], ["number", "location", "skills", "problem"])
        self.assertEqual(pack["warnings"], [])
        self.assertEqual(pack["applyUrl"], URL)
        for v in pack["variants"]:
            self.assertIn(URL, v["adCopy"], "every ad copy ends with the link CTA")
            for beat in ("hook", "offer", "proof", "cta"):
                self.assertTrue(v["videoScript"][beat], f"beat {beat} must not be empty")

    def test_variant_urls_carry_the_variant_id(self):
        # E5 — each variant's links must attribute back to that exact creative.
        pack, _ = draft_campaign_pack(_job(), lang="en", apply_url=URL)
        for i, v in enumerate(pack["variants"]):
            vid = f"v{i + 1}"
            self.assertEqual(v["variantId"], vid)
            self.assertEqual(v["applyUrl"], f"{URL}&v={vid}")
            self.assertIn(f"{URL}&v={vid}", v["adCopy"])
            self.assertIn(f"{URL}&v={vid}", v["videoScript"]["cta"])
        self.assertEqual(pack["applyUrl"], URL, "the pack keeps the base URL for display")

    def test_no_hook_opens_with_the_company_name(self):
        pack, _ = draft_campaign_pack(_job(), lang="en", apply_url=URL)
        for v in pack["variants"]:
            self.assertFalse(v["hook"].startswith("Acme"), f"hook opens with company: {v['hook']}")

    def test_czech_pack_localizes_cta_and_salary_unit(self):
        pack, _ = draft_campaign_pack(_job(), lang="cs-CZ", apply_url=URL)
        self.assertEqual(pack["language"], "cs")
        number = next(v for v in pack["variants"] if v["hookType"] == "number")
        self.assertIn("Kč/měsíc", number["hook"])
        self.assertIn("30 sekund", number["videoScript"]["cta"])

    def test_phantom_defaults_are_not_advertised(self):
        job = _job(defaulted_fields=["company", "location", "work_mode", "seniority"])
        pack, _ = draft_campaign_pack(job, lang="en", apply_url=URL)
        kinds = [v["hookType"] for v in pack["variants"]]
        self.assertNotIn("location", kinds, "an assumed city must never become a location hook")
        self.assertIn(WARN_NO_LOCATION, pack["warnings"])
        problem = next(v for v in pack["variants"] if v["hookType"] == "problem")
        self.assertNotIn("senior", problem["hook"], "a defaulted seniority must not label the role")

    def test_missing_salary_drops_the_number_hook_and_warns(self):
        pack, _ = draft_campaign_pack(_job(salary_band=[]), lang="en", apply_url=URL)
        self.assertNotIn("number", [v["hookType"] for v in pack["variants"]])
        self.assertIn(WARN_NO_SALARY, pack["warnings"])

    def test_anchored_phantom_band_is_never_advertised_and_warns(self):
        # The ad stated no pay, so normalize_job stamped the taxonomy anchor band
        # and flagged it ("salary_band" phantom): the figure must never reach the
        # copy, and no_salary must fire — same rule as the other phantom fields.
        job = _job(defaulted_fields=["salary_band"])
        pack, _ = draft_campaign_pack(job, lang="en", apply_url=URL)
        self.assertNotIn("number", [v["hookType"] for v in pack["variants"]])
        self.assertIn(WARN_NO_SALARY, pack["warnings"])
        for v in pack["variants"]:
            self.assertNotIn("65 000", v["adCopy"], "the anchor figure leaked into the copy")

    def test_pack_is_never_empty_even_with_no_facts(self):
        job = _job(
            salary_band=[],
            detected_skills=[],
            defaulted_fields=["company", "location", "work_mode", "seniority"],
        )
        pack, _ = draft_campaign_pack(job, lang="en", apply_url="")
        self.assertEqual(len(pack["variants"]), 1)
        self.assertEqual(pack["variants"][0]["hookType"], "problem")
        self.assertEqual(
            sorted(pack["warnings"]), sorted([WARN_NO_SALARY, WARN_NO_LOCATION, WARN_NO_SKILLS])
        )


class MarketUnlockTests(unittest.TestCase):
    """The campaign engine's market/currency identity flows from MarketConfig, not
    a hardcoded Czech literal — while the Czech default stays byte-identical."""

    def test_czech_default_salary_unit_is_unchanged(self):
        # Byte-identical to the old hardcoded literal for both languages.
        en = draft_campaign_pack(_job(), lang="en")[0]
        self.assertIn("CZK/month", next(v for v in en["variants"] if v["hookType"] == "number")["hook"])
        cs = draft_campaign_pack(_job(), lang="cs")[0]
        self.assertIn("Kč/měsíc", next(v for v in cs["variants"] if v["hookType"] == "number")["hook"])

    def test_non_czk_market_renders_its_own_unit(self):
        # A EUR market must render its OWN unit — never silently relabel the figure CZK.
        pack = draft_campaign_pack(_job(), lang="en", market=BERLIN_MARKET)[0]
        number = next(v for v in pack["variants"] if v["hookType"] == "number")["hook"]
        self.assertIn("EUR/month", number)
        self.assertNotIn("CZK", number)
        # In the market's home language it uses the native symbol + period word.
        de = draft_campaign_pack(_job(), lang="de", market=BERLIN_MARKET)[0]
        self.assertIn("€/Monat", next(v for v in de["variants"] if v["hookType"] == "number")["hook"])

    def test_system_prompt_carries_the_configured_market(self):
        # The market descriptor drives the LLM system prompt on every generation.
        default = _FakeProvider(payload={"variants": []})
        draft_campaign_pack(_job(), lang="en", provider=default)
        self.assertIn("Czech tech market", default.system)

        berlin = _FakeProvider(payload={"variants": []})
        draft_campaign_pack(_job(), lang="en", provider=berlin, market=BERLIN_MARKET)
        self.assertIn("German tech market", berlin.system)
        self.assertNotIn("Czech", berlin.system)

    def test_german_locale_output_is_native(self):
        pack, _ = draft_campaign_pack(_job(), lang="de", apply_url=URL)
        self.assertEqual(pack["language"], "de")
        problem = next(v for v in pack["variants"] if v["hookType"] == "problem")
        self.assertIn("Suchen Sie Ihre nächste Position", problem["hook"])
        self.assertIn("30 Sekunden", problem["videoScript"]["cta"])
        location = next(v for v in pack["variants"] if v["hookType"] == "location")
        self.assertIn("Wir suchen in", location["hook"])

    def test_french_locale_output_is_native(self):
        pack, _ = draft_campaign_pack(_job(), lang="fr", apply_url=URL)
        self.assertEqual(pack["language"], "fr")
        problem = next(v for v in pack["variants"] if v["hookType"] == "problem")
        self.assertIn("Vous cherchez votre prochain poste", problem["hook"])
        # French typography: a narrow no-break space (U+202F) precedes the '?'.
        self.assertIn(" ?", problem["hook"])
        self.assertIn("30 secondes", problem["videoScript"]["cta"])

    def test_de_and_fr_are_not_silently_collapsed_to_english(self):
        de = draft_campaign_pack(_job(), lang="de")[0]
        fr = draft_campaign_pack(_job(), lang="fr")[0]
        self.assertEqual((de["language"], fr["language"]), ("de", "fr"))


class CoerceBoundaryTests(unittest.TestCase):
    def _llm_variant(self, **overrides):
        v = {
            "hookType": "number",
            "hook": "95 000 CZK/month.",
            "adCopy": "95 000 CZK/month. Senior frontend in Brno. Apply in 30 seconds.",
            "videoScript": {"hook": "h", "offer": "o", "proof": "p", "cta": "c"},
        }
        v.update(overrides)
        return v

    def test_valid_llm_payload_passes_through(self):
        provider = _FakeProvider(payload={"variants": [self._llm_variant()]})
        pack, source = draft_campaign_pack(_job(), lang="en", apply_url=URL, provider=provider)
        self.assertEqual(source, "llm")
        self.assertEqual(pack["variants"][0]["hook"], "95 000 CZK/month.")
        # The prompt carries the facts and the playbook constraint.
        self.assertIn("NEVER open with the company name", provider.prompt)
        self.assertIn(URL, provider.prompt)

    def test_off_taxonomy_hook_type_falls_back(self):
        provider = _FakeProvider(payload={"variants": [self._llm_variant(hookType="testimonial")]})
        pack, _ = draft_campaign_pack(_job(), lang="en", provider=provider)
        self.assertEqual(pack["variants"][0]["hookType"], "problem")

    def test_variant_cap_applies_at_the_boundary(self):
        provider = _FakeProvider(payload={"variants": [self._llm_variant() for _ in range(VARIANT_MAX + 5)]})
        pack, _ = draft_campaign_pack(_job(), lang="en", provider=provider)
        self.assertEqual(len(pack["variants"]), VARIANT_MAX)

    def test_junk_payload_falls_back_to_deterministic_content(self):
        provider = _FakeProvider(payload={"variants": [{"hook": "", "adCopy": ""}]})
        pack, source = draft_campaign_pack(_job(), lang="en", apply_url=URL, provider=provider)
        self.assertEqual(source, "llm")  # the call ran; coerce rebuilt the content
        self.assertEqual([v["hookType"] for v in pack["variants"]], ["number", "location", "skills", "problem"])

    def test_provider_error_reports_deterministic_source(self):
        provider = _FakeProvider(exc=RuntimeError("CLI exploded"))
        pack, source = draft_campaign_pack(_job(), lang="en", provider=provider)
        self.assertEqual(source, "deterministic")
        self.assertTrue(pack["variants"])

    def test_hook_taxonomy_is_the_documented_set(self):
        self.assertEqual(HOOK_TYPES, ("number", "location", "problem", "skills"))


class CliTests(unittest.TestCase):
    def _run(self, argv):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = campaign_cli.main(argv)
        return code, out.getvalue(), err.getvalue()

    def test_camelcase_job_record_without_company_or_location(self):
        # A TS JobRecord: camelCase keys, company/location omitted entirely.
        record = {
            "id": "jd-frontend",
            "title": "Frontend Developer",
            "workMode": "remote",
            "seniority": "medior",
            "detectedSkills": ["React", "CSS"],
            "salaryBand": [60000, 80000],
        }
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "job.json"
            p.write_text(json.dumps(record), encoding="utf-8")
            code, out, _ = self._run(["--job-json", str(p), "--lang", "cs", "--apply-url", URL, "--no-llm"])
        self.assertEqual(code, 0)
        payload = json.loads(out)
        self.assertEqual(payload["source"], "deterministic")
        pack = payload["result"]
        self.assertEqual(pack["language"], "cs")
        self.assertEqual(pack["applyUrl"], URL)
        # workMode was stated → location-class hook exists even with no city.
        self.assertIn("location", [v["hookType"] for v in pack["variants"]])

    def test_malformed_job_json_is_a_400(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "job.json"
            p.write_text("[not a job]", encoding="utf-8")
            code, _, err = self._run(["--job-json", str(p), "--no-llm"])
        self.assertEqual(code, 2)
        envelope = json.loads(err.strip().splitlines()[-1])
        self.assertEqual(envelope["status"], 400)
        self.assertEqual(envelope["code"], "invalid_input")

    def test_deterministic_fallback_writes_a_ledger_line(self):
        """Item 22: a keyless (--no-llm) run that serves the deterministic pack
        writes one source:"deterministic" sidecar line — zero tokens/cost, the
        campaign_pack use case — when KP_LLM_USAGE_LOG is set (spawnPython's
        per-spawn sidecar), so template traffic is ledger-visible."""
        record = {"id": "jd-frontend", "title": "Frontend Developer", "salaryBand": [60000, 80000]}
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "job.json"
            p.write_text(json.dumps(record), encoding="utf-8")
            ledger = Path(td) / "usage.ndjson"
            with mock.patch.dict(os.environ, {"KP_LLM_USAGE_LOG": str(ledger)}, clear=False):
                code, out, _ = self._run(["--job-json", str(p), "--no-llm"])
            self.assertEqual(code, 0)
            self.assertEqual(json.loads(out)["source"], "deterministic")
            rows = [json.loads(l) for l in ledger.read_text(encoding="utf-8").splitlines() if l.strip()]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["source"], "deterministic")
        self.assertEqual(rows[0]["provider"], "deterministic")
        self.assertEqual(rows[0]["use_case"], "campaign_pack")
        self.assertEqual(rows[0]["input_tokens"], 0)
        self.assertEqual(rows[0]["cost_usd"], 0.0)


if __name__ == "__main__":
    unittest.main()
