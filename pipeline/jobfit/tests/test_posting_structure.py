"""posting_structure: six harvested postings → Jobs, deterministically.

Two Czech, two English, one German, one carrying a JSON-LD baseSalary. Pins: the
section-aware must/nice split, work mode from TELECOMMUTE or prose, seniority from
the title only, a salary only when stated (and only comparable in the market's own
currency/period), years and languages when named, and the CLI's batch + exit codes.
"""

from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from pipeline.jobfit import extraction_rules_cli, posting_structure, posting_structure_cli
from pipeline.jobfit.market_config import ACTIVE_MARKET


def raw(**over):
    base = {
        "externalKey": "k", "url": "https://x.example/j/1", "title": "Role", "company": "Firma", "location": "Praha",
        "country": "cz", "workMode": None, "postedAt": None, "salaryText": None, "salary": None, "bodyText": "", "jsonld": None, "lang": None,
    }
    base.update(over)
    return base


CZ_BACKEND = raw(
    title="Backend vývojář (Node.js)",
    location="Brno",
    bodyText=(
        "Hledáme backend vývojáře do týmu platebních služeb.\n"
        "Požadujeme\n"
        "Node.js a TypeScript\n"
        "PostgreSQL\n"
        "3+ roky zkušeností\n"
        "angličtina B2\n"
        "Nabízíme\n"
        "hybridní režim, 2 dny z domova\n"
        "Docker je výhodou\n"
        "Mzda 70 000 – 95 000 Kč měsíčně."
    ),
)

CZ_JUNIOR = raw(
    title="Junior tester / testerka",
    bodyText=(
        "Práce z domova po zaškolení.\n"
        "Co od vás očekáváme\n"
        "Základy SQL, chuť učit se.\n"
        "Výhodou\n"
        "Selenium\n"
        "Nabízíme\n"
        "Hodinová sazba 250 Kč/hod."
    ),
)

EN_SENIOR = raw(
    title="Senior Backend Engineer (Go)",
    location="Prague, Czechia",
    bodyText=(
        "Acme builds payments infrastructure.\n"
        "Requirements\n"
        "5+ years with Go or Java\n"
        "PostgreSQL, Kafka\n"
        "Fluent English; German is a plus\n"
        "Nice to have\n"
        "Kubernetes\n"
        "We offer\n"
        "Hybrid: 2 days a week in the Prague office.\n"
        "Salary €4,500 – €6,000 per month."
    ),
)

EN_REMOTE = raw(
    title="Staff Data Engineer",
    location="Remote - EU",
    bodyText="Remote-first role for the data platform team. Python, Spark, dbt. Compensation 90,000-120,000 EUR per year.",
)

DE_DEV = raw(
    title="Softwareentwickler (m/w/d) Python",
    location="Dresden",
    bodyText=(
        "Wir suchen einen Softwareentwickler für unser Team in Dresden.\n"
        "Anforderungen\n"
        "Python, Django, PostgreSQL\n"
        "3 Jahre Erfahrung\n"
        "Deutsch und Englisch\n"
        "Wir bieten\n"
        "Homeoffice möglich.\n"
        "Gehalt 55.000 – 65.000 € brutto/Jahr."
    ),
)

CZ_ANNUAL = raw(
    title="Finanční analytik",
    location="Praha",
    bodyText=(
        "Analýza rozpočtů a reporting v Excelu.\n"
        "Nabízíme\n"
        "Roční mzda 900 000 – 1 200 000 Kč."
    ),
    salary={"min": 900000, "max": 1200000, "currency": "CZK", "period": "year"},
)

JSONLD_SALARY = raw(
    title="Lead Platform Engineer",
    location="Praha",
    bodyText="Kubernetes, Terraform, AWS. Team lead for six engineers.",
    salary={"min": 150000, "max": 180000, "currency": "CZK", "period": "month"},
    jsonld={"@type": "JobPosting", "jobLocationType": "TELECOMMUTE"},
)


def reqs(job):
    return {r.skill.lower(): r.kind for r in job.requirements}


class StructurePosting(unittest.TestCase):
    def test_czech_backend_sections_salary_years_language(self):
        job, notes = posting_structure.structure_posting(CZ_BACKEND, job_id="p1")
        self.assertEqual(job.id, "p1")
        self.assertEqual(job.title, "Backend vývojář (Node.js)")
        self.assertEqual(job.location, "Brno")
        self.assertEqual(job.work_mode, "hybrid")
        self.assertEqual(job.role_family, "software_engineering")
        r = reqs(job)
        self.assertEqual(r.get("node.js"), "must_have")
        self.assertEqual(r.get("typescript"), "must_have")
        self.assertEqual(r.get("postgresql"), "must_have")
        self.assertEqual(r.get("docker"), "nice_to_have", "in the Nabízíme block AND marked výhodou")
        self.assertEqual(job.min_years_experience, 3.0)
        self.assertIn("English", job.languages)
        if ACTIVE_MARKET.currency == "CZK":
            self.assertEqual(job.salary_band, [70000, 95000])
            self.assertNotIn("salary_band", job.defaulted_fields, "a stated band is never a phantom")
        self.assertEqual(notes, [])
        self.assertIn("seniority", job.defaulted_fields, "the title names no level → the default is recorded as such")

    def test_czech_junior_remote_hourly_stated_but_never_banded(self):
        job, _ = posting_structure.structure_posting(CZ_JUNIOR)
        self.assertEqual(job.seniority, "junior")
        self.assertEqual(job.work_mode, "remote", "práce z domova")
        r = reqs(job)
        self.assertEqual(r.get("sql"), "must_have")
        self.assertEqual(r.get("selenium"), "nice_to_have")
        self.assertIn("salary_band", job.defaulted_fields, "an hourly figure never becomes a band")
        self.assertEqual(job.salary_period, "hour", "…but the ad DID state its pay, per hour")
        self.assertEqual(job.salary_currency, "CZK")

    def test_english_senior_eur_not_comparable(self):
        job, notes = posting_structure.structure_posting(EN_SENIOR)
        self.assertEqual(job.seniority, "senior")
        self.assertEqual(job.work_mode, "hybrid")
        r = reqs(job)
        self.assertEqual(r.get("go"), "must_have")
        self.assertEqual(r.get("kafka"), "must_have")
        self.assertEqual(r.get("kubernetes"), "nice_to_have")
        self.assertEqual(job.min_years_experience, 5.0)
        self.assertIn("English", job.languages)
        self.assertIn("German", job.languages)
        if ACTIVE_MARKET.currency == "CZK":
            self.assertIn("salary_not_comparable:EUR/month", notes)
            self.assertIn("salary_band", job.defaulted_fields)
            self.assertEqual((job.salary_currency, job.salary_period), ("EUR", "month"),
                             "a currency the market cannot compare still travels on the Job")

    def test_english_remote_yearly(self):
        job, notes = posting_structure.structure_posting(EN_REMOTE)
        self.assertEqual(job.seniority, "lead", "Staff → the lead band")
        self.assertEqual(job.work_mode, "remote")
        self.assertIn("python", reqs(job))
        salary = posting_structure.detect_salary(EN_REMOTE, EN_REMOTE["bodyText"])
        self.assertEqual(salary, {"min": 90000.0, "max": 120000.0, "currency": "EUR", "period": "year"})
        self.assertTrue(any(n.startswith("salary_not_comparable") for n in notes))

    def test_german(self):
        job, _ = posting_structure.structure_posting(DE_DEV)
        self.assertEqual(job.work_mode, "remote", "Homeoffice möglich")
        r = reqs(job)
        self.assertEqual(r.get("python"), "must_have")
        self.assertEqual(r.get("django"), "must_have")
        self.assertEqual(job.min_years_experience, 3.0)
        self.assertIn("German", job.languages)
        self.assertIn("English", job.languages)
        salary = posting_structure.detect_salary(DE_DEV, DE_DEV["bodyText"])
        self.assertEqual(salary["currency"], "EUR")
        self.assertEqual(salary["period"], "year")
        self.assertEqual((salary["min"], salary["max"]), (55000.0, 65000.0), "German thousands separators")

    def test_jsonld_salary_and_telecommute(self):
        job, notes = posting_structure.structure_posting(JSONLD_SALARY)
        self.assertEqual(job.work_mode, "remote", "TELECOMMUTE wins over the office-sounding body")
        self.assertEqual(job.seniority, "lead")
        if ACTIVE_MARKET.currency == "CZK":
            self.assertEqual(job.salary_band, [150000, 180000])
            self.assertNotIn("salary_band", job.defaulted_fields)
        self.assertEqual(notes, [])
        self.assertEqual(job.source, "posting")

    def test_czech_annual_is_banded_x12_keeping_the_stated_period(self):
        """A CZK/year ad is the market's own currency — x12 is arithmetic, not an FX rate,
        so it yields a band (in the market's month) while salary_period keeps "year"."""
        if ACTIVE_MARKET.currency != "CZK" or ACTIVE_MARKET.period != "month":
            self.skipTest("pin is written for the CZK/month product default")
        job, notes = posting_structure.structure_posting(CZ_ANNUAL)
        self.assertEqual(job.salary_band, [75000, 100000], "900 000–1 200 000 CZK/year restated per month")
        self.assertNotIn("salary_band", job.defaulted_fields, "a stated band is never a phantom")
        self.assertEqual((job.salary_currency, job.salary_period), ("CZK", "year"))
        self.assertIn("salary_period_converted:year->month", notes)
        self.assertFalse([n for n in notes if n.startswith("salary_not_comparable")])

    def test_a_monthly_range_wins_over_an_hourly_mention(self):
        job, _ = posting_structure.structure_posting(
            raw(
                title="Operátor",
                bodyText=(
                    "Příplatek za noční směnu 150 Kč/hod nad rámec základní mzdy.\n"
                    "Práce ve třísměnném provozu v moderním výrobním závodě.\n"
                    "Mzda 45 000 – 55 000 Kč měsíčně."
                ),
            )
        )
        self.assertEqual(job.salary_period, "month")
        if ACTIVE_MARKET.currency == "CZK":
            self.assertEqual(job.salary_band, [45000, 55000])

    def test_never_invents(self):
        job, _ = posting_structure.structure_posting(raw(title="Účetní", bodyText="Vedení účetnictví. Znalost Pohody."))
        self.assertIn("salary_band", job.defaulted_fields)
        self.assertIsNone(job.min_years_experience)
        self.assertIsNone(posting_structure.detect_salary(raw(), "we pay well in EUR"), "a currency with no amount is not a salary")
        hourly = posting_structure.detect_salary(raw(), "budget 250 Kč / hod")
        self.assertEqual(hourly, {"min": 250.0, "max": 250.0, "currency": "CZK", "period": "hour"},
                         "an hourly rate is READ (no band is built from it) so the reader is never told 'no pay'")
        self.assertIsNone(posting_structure.detect_seniority("Software Engineer"))
        with self.assertRaises(ValueError):
            posting_structure.structure_posting(raw(title="  "))


def _run(module, argv):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        try:
            code = module.main(argv)
        except SystemExit as exc:  # the CLIs exit(2) on bad input
            code = exc.code
    return code, out.getvalue(), err.getvalue()


class StructureCli(unittest.TestCase):
    def test_batch_skips_one_bad_posting_and_names_it(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "in.json"
            p.write_text(json.dumps([
                {"id": "a", "raw": CZ_BACKEND},
                {"id": "b", "raw": raw(title="")},
                {"id": "c", "raw": EN_REMOTE},
            ]), encoding="utf-8")
            code, out, _ = _run(posting_structure_cli, ["--input-json", str(p)])
        self.assertEqual(code, 0)
        payload = json.loads(out.strip().splitlines()[-1])
        self.assertEqual([j["id"] for j in payload["jobs"]], ["a", "c"])
        self.assertEqual(payload["jobs"][0]["job"]["title"], "Backend vývojář (Node.js)")
        self.assertTrue(any(n.startswith("b: skipped") for n in payload["notes"]))

    def test_invalid_input_exits_2(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "in.json"
            p.write_text(json.dumps({"not": "a list"}), encoding="utf-8")
            code, _, err = _run(posting_structure_cli, ["--input-json", str(p)])
            self.assertEqual(code, 2)
            self.assertEqual(json.loads(err.strip().splitlines()[-1])["code"], "invalid_input")
            p.write_text("{not json", encoding="utf-8")
            code, _, err = _run(posting_structure_cli, ["--input-json", str(p)])
            self.assertEqual(code, 2)
            self.assertEqual(json.loads(err.strip().splitlines()[-1])["code"], "invalid_input")


LISTING = """
<div class="SearchResults">
  <article class="SearchResultCard"><h2><a href="/rpd/2001001/?searchId=abc" class="SearchResultCard__titleLink" data-jobad-id="2001001">Senior Java Developer</a></h2></article>
  <article class="SearchResultCard"><h2><a href="/rpd/2001002/?searchId=abc" class="SearchResultCard__titleLink" data-jobad-id="2001002">Frontend vývojář</a></h2></article>
  <article class="SearchResultCard"><h2><a href="/rpd/2001003/?searchId=abc" class="SearchResultCard__titleLink" data-jobad-id="2001003">DevOps Engineer</a></h2></article>
  <nav><a href="/prace/praha/?page=2">Další</a><a href="/o-nas">O nás</a></nav>
</div>
"""


class ExtractionRulesCli(unittest.TestCase):
    def test_deterministic_twin_from_the_anchor_group(self):
        rules, reasoning = extraction_rules_cli.deterministic_rules(LISTING)
        fields = [r["field"] for r in rules]
        self.assertEqual(fields, ["externalKey", "url", "title"])
        self.assertEqual(rules[1]["locator"], {"kind": "css", "expr": 'a[href*="/rpd/"]', "attr": "href"})
        self.assertEqual(rules[0]["locator"]["attr"], "data-jobad-id")
        self.assertTrue(all(r["required"] for r in rules))
        self.assertTrue(all(r["cardinality"] == "many" for r in rules))
        self.assertEqual(len(reasoning), 3)
        self.assertEqual(extraction_rules_cli.deterministic_rules("<p>no links</p>")[0], [])

    def test_cli_keyless_answers_deterministic(self):
        from pipeline.jobfit.tests._helpers import env

        with tempfile.TemporaryDirectory() as d, env("KP_LLM_CONFIG", KP_OFFLINE="1"):
            p = Path(d) / "in.json"
            p.write_text(json.dumps({"html": LISTING, "url": "https://www.jobs.example/prace/", "lang": "cs"}), encoding="utf-8")
            code, out, _ = _run(extraction_rules_cli, ["--input-json", str(p)])
        self.assertEqual(code, 0)
        payload = json.loads(out.strip().splitlines()[-1])
        self.assertEqual(payload["source"], "deterministic")
        self.assertIsNotNone(payload["fallbackReason"])
        self.assertEqual([r["field"] for r in payload["rules"]], ["externalKey", "url", "title"])

    def test_cli_invalid_input(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "in.json"
            p.write_text(json.dumps({"html": "", "url": "https://x"}), encoding="utf-8")
            code, _, err = _run(extraction_rules_cli, ["--input-json", str(p)])
            self.assertEqual(code, 2)
            self.assertEqual(json.loads(err.strip().splitlines()[-1])["code"], "invalid_input")

    def test_coerce_rules_keeps_only_the_dsl(self):
        payload = {"rules": [
            {"field": "url", "locator": {"kind": "css", "expr": "a", "attr": "href"}, "cardinality": "many", "pick": "first", "post": ["absUrl", "shout"], "required": False},
            {"field": "title", "locator": {"kind": "xpath", "expr": "//a"}},
            {"field": "url", "locator": {"kind": "css", "expr": "b"}},
            {"field": "company", "locator": {"kind": "regex", "expr": "(x)"}, "cardinality": "one", "pick": "fail"},
        ]}
        rules = extraction_rules_cli._coerce_rules(payload)
        self.assertEqual([r["field"] for r in rules], ["url", "company"])
        self.assertTrue(rules[0]["required"], "url is forced required")
        self.assertEqual(rules[0]["post"], ["absUrl"])
        self.assertEqual(rules[1]["cardinality"], "one")
        self.assertEqual(rules[1]["pick"], "fail")


if __name__ == "__main__":
    unittest.main()
