from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from pipeline.jobfit import _cli, winnability_cli
from pipeline.jobfit.jobs import Job, JobRequirement
from pipeline.jobfit.market_config import BERLIN_MARKET, CZECH_MARKET
from pipeline.jobfit.matching import FIT_PROMISING_THRESHOLD, MatchCandidate, ko_filter, score_job
from pipeline.jobfit.winnability import assess_winnability


def _cand(label: str, skills: list[str], **kw) -> MatchCandidate:
    # provenance_default is explicit: the shipped default is now `self_declared`, which
    # discounts an unevidenced claim below the match threshold. Winnability is about
    # which GATES (languages, must-haves, seniority) shrink an otherwise-capable pool,
    # not about the evidence discount, so the synthetic pool is pinned to the
    # professional tier — these are people who demonstrably have the stack.
    kw.setdefault("provenance_default", "professional")
    return MatchCandidate(label=label, skills=skills, role_family="software_engineering", **kw)


def _job(**kw) -> Job:
    base = dict(id="job-1", title="Backend Engineer", company="Acme", location="Prague")
    base.update(kw)
    return Job(**base)


class WinnabilityTest(unittest.TestCase):
    def test_language_gate_is_sole_blocker_and_loosening_recovers_them(self) -> None:
        # Three Python-skilled candidates; only one speaks German.
        pool = [
            _cand("DE", ["python"], languages=["German", "English"]),
            _cand("EN-1", ["python"], languages=["English"]),
            _cand("EN-2", ["python"], languages=["English"]),
        ]
        job = _job(languages=["German"], requirements=[JobRequirement(skill="python")])
        out = assess_winnability(pool, job)
        self.assertEqual(out["poolSize"], 3)
        self.assertEqual(out["eligible"], 1)  # German gate KO's the two English-only
        gate = next(g for g in out["looseGates"] if g["kind"] == "language" and g["value"] == "German")
        self.assertEqual(gate["eligibleDelta"], 2)  # dropping German restores both

    def test_demoting_an_unmet_must_have_raises_the_qualified_count(self) -> None:
        # A senior role that hard-requires Kafka, against a medior backend pool.
        # Three candidates have the core stack (Python) but NOT Kafka, so the Kafka
        # must_have alone drags them below the "promising" bar — they are blocked
        # ONLY by Kafka. A fourth candidate does have Kafka and already qualifies.
        # Demoting Kafka to nice_to_have must lift exactly the three blocked ones,
        # so the qualified pool rises from 1 to 4 (a real, strictly-positive delta).
        pool = [
            _cand("flip1", ["python", "git", "sql"], seniority="medior"),
            _cand("flip2", ["python", "git", "sql"], seniority="medior"),
            _cand("flip3", ["python", "git", "sql"], seniority="medior"),
            _cand("has_kafka", ["python", "kafka", "git"], seniority="medior"),
        ]
        job = _job(
            seniority="senior",
            requirements=[
                JobRequirement(skill="python"),
                JobRequirement(skill="kafka"),  # only `has_kafka` has this
            ],
        )
        out = assess_winnability(pool, job)
        self.assertEqual(out["eligible"], 4)  # all four clear the hard gates
        self.assertEqual(out["qualified"], 1)  # only `has_kafka` reaches the bar while Kafka is a must
        kafka = next(m for m in out["looseMustHaves"] if m["skill"] == "kafka")
        self.assertEqual(kafka["missingAmongEligible"], 3)

        # Independently recount the qualified pool once Kafka is demoted, re-running
        # the SAME production scorer the coach uses, and pin the coach's delta to
        # that real change — NOT to a constant. (The prior RHS `out["qualified"] and
        # 0` short-circuited to 0, silently degrading this to a mere `delta >= 0`.)
        demoted_job = job.model_copy(
            update={
                "requirements": [
                    r.model_copy(update={"kind": "nice_to_have"}) if r.skill == "kafka" else r
                    for r in job.requirements
                ]
            }
        )
        demoted_qualified = sum(
            1
            for c in pool
            if ko_filter(c, demoted_job)[0] and score_job(c, demoted_job).total >= FIT_PROMISING_THRESHOLD
        )
        self.assertEqual(demoted_qualified, 4)  # the three blocked-only-by-Kafka candidates flip in

        # Headline invariant: demoting a must-have nobody has STRICTLY raises the
        # qualified pool, and the reported delta equals the real recomputed change.
        self.assertGreater(kafka["qualifiedDelta"], 0)
        self.assertEqual(kafka["qualifiedDelta"], demoted_qualified - out["qualified"])
        self.assertEqual(kafka["qualifiedDelta"], 3)
        # …and it is the top-ranked lever (largest qualifiedDelta).
        self.assertEqual(out["looseMustHaves"][0]["skill"], "kafka")

    def test_salary_below_market_is_flagged(self) -> None:
        job = _job(role_family="software_engineering", seniority="senior", salary_band=[10000, 20000])
        out = assess_winnability([_cand("c", ["python"])], job)
        self.assertIsNotNone(out["salary"]["marketBand"])
        # A 10k-20k band for a senior engineer sits under any realistic market floor.
        self.assertTrue(out["salary"]["belowMarket"])
        self.assertLess(out["salary"]["topVsMarketFloorPct"], 0)

    def test_salary_verdict_is_silenced_across_a_currency_mismatch(self) -> None:
        # Same below-floor band as test_salary_below_market_is_flagged, but the job
        # is authored for a EUR market while the taxonomy/benchmark bands are CZK.
        # The app does no FX, so the numeric "below market" test is meaningless —
        # the verdict must be honestly ABSENT (None), never a confident-but-wrong
        # "below market" flag, mirroring the TS isSameCurrency guard.
        job = _job(role_family="software_engineering", seniority="senior", salary_band=[10000, 20000])
        out = assess_winnability([_cand("c", ["python"])], job, market=BERLIN_MARKET)
        salary = out["salary"]
        self.assertFalse(salary["currencyComparable"])
        self.assertEqual(salary["jobCurrency"], "EUR")
        self.assertEqual(salary["marketCurrency"], "CZK")
        self.assertIsNone(salary["belowMarket"])
        self.assertNotIn("topVsMarketFloorPct", salary)
        # The market band itself is still reported — only the cross-FX VERDICT is silenced.
        self.assertIsNotNone(salary["marketBand"])

    def test_same_currency_market_still_produces_the_verdict(self) -> None:
        # The default (CZK) market and an explicit CZK market both compare normally,
        # so the guard silences ONLY genuine mismatches, never same-currency ones.
        job = _job(role_family="software_engineering", seniority="senior", salary_band=[10000, 20000])
        out = assess_winnability([_cand("c", ["python"])], job, market=CZECH_MARKET)
        self.assertTrue(out["salary"]["currencyComparable"])
        self.assertTrue(out["salary"]["belowMarket"])
        self.assertLess(out["salary"]["topVsMarketFloorPct"], 0)

    def test_empty_pool_is_zeroed_not_crashed(self) -> None:
        out = assess_winnability([], _job(requirements=[JobRequirement(skill="python")]))
        # Pin each zeroed field explicitly; the prior `assertEqual(out, {**out, ...})`
        # compared the output against a copy of ITSELF, so every key other than the
        # three overridden ones was asserted only `out == out` (a tautology).
        self.assertEqual(out["poolSize"], 0)
        self.assertEqual(out["eligible"], 0)
        self.assertEqual(out["qualified"], 0)
        self.assertEqual(out["looseGates"], [])

    def test_no_false_loosen_suggestion_when_gate_blocks_nobody(self) -> None:
        # Required language everyone speaks → dropping it recovers nobody, so it
        # must not appear as a suggested loosening.
        pool = [_cand("c", ["python"], languages=["English"])]
        job = _job(languages=["English"], requirements=[JobRequirement(skill="python")])
        out = assess_winnability(pool, job)
        self.assertEqual([g for g in out["looseGates"] if g["value"] == "English"], [])


def _nurse(label: str, skills: list[str], **kw) -> MatchCandidate:
    kw.setdefault("provenance_default", "professional")
    return MatchCandidate(label=label, skills=skills, role_family="healthcare_clinical", **kw)


class NonTechWinnabilityTest(unittest.TestCase):
    """The same winnability contracts on a NON-TECH family.

    Every fixture above is a ``software_engineering`` pool matched against Python
    and Kafka, so the coach's two levers (hard gates, must-have demotion) were only
    ever proven on tech vocabulary. They are family-agnostic; this proves it for
    healthcare_clinical, whose skill graph is the deepest non-tech one (44 skill
    terms, 85% carrying parents).
    """

    def test_language_gate_is_sole_blocker_and_loosening_recovers_them(self) -> None:
        pool = [
            _nurse("DE", ["intensive care"], languages=["German", "English"]),
            _nurse("CZ-1", ["intensive care"], languages=["Czech"]),
            _nurse("CZ-2", ["intensive care"], languages=["Czech"]),
        ]
        job = _job(
            title="Registered Nurse — ICU",
            role_family="healthcare_clinical",
            languages=["German"],
            requirements=[JobRequirement(skill="intensive care")],
        )
        out = assess_winnability(pool, job)
        self.assertEqual(out["poolSize"], 3)
        self.assertEqual(out["eligible"], 1)
        gate = next(g for g in out["looseGates"] if g["kind"] == "language" and g["value"] == "German")
        self.assertEqual(gate["eligibleDelta"], 2)

    def test_demoting_an_unmet_must_have_raises_the_qualified_count(self) -> None:
        # A senior ICU role that hard-requires ventilator management against a pool of
        # medior nurses who have the core stack but not that one skill.
        pool = [
            _nurse("flip1", ["intensive care", "patient care", "triage"], seniority="medior"),
            _nurse("flip2", ["intensive care", "patient care", "triage"], seniority="medior"),
            _nurse("flip3", ["intensive care", "patient care", "triage"], seniority="medior"),
            _nurse("has_vent", ["intensive care", "ventilator management", "patient care"], seniority="medior"),
        ]
        job = _job(
            title="Senior ICU Nurse",
            role_family="healthcare_clinical",
            seniority="senior",
            requirements=[
                JobRequirement(skill="intensive care"),
                JobRequirement(skill="ventilator management"),  # only `has_vent` has this
                JobRequirement(skill="anesthesia"),
            ],
        )
        out = assess_winnability(pool, job)
        self.assertEqual(out["eligible"], 4)  # all four clear the hard gates
        self.assertEqual(out["qualified"], 1)  # only `has_vent` reaches the bar
        lever = next(m for m in out["looseMustHaves"] if m["skill"] == "ventilator management")
        self.assertEqual(lever["missingAmongEligible"], 3)
        # Recount independently through the production scorer, exactly like the tech
        # fixture does, so the coach's delta is pinned to a real change.
        demoted = job.model_copy(
            update={
                "requirements": [
                    r.model_copy(update={"kind": "nice_to_have"})
                    if r.skill == "ventilator management"
                    else r
                    for r in job.requirements
                ]
            }
        )
        demoted_qualified = sum(
            1
            for c in pool
            if ko_filter(c, demoted)[0] and score_job(c, demoted).total >= FIT_PROMISING_THRESHOLD
        )
        self.assertEqual(demoted_qualified, 4)  # the three blocked-only-by-vent flip in
        self.assertGreater(lever["qualifiedDelta"], 0)
        self.assertEqual(lever["qualifiedDelta"], demoted_qualified - out["qualified"])
        self.assertEqual(lever["qualifiedDelta"], 3)

    def test_no_false_loosen_suggestion_when_gate_blocks_nobody(self) -> None:
        pool = [_nurse("c", ["intensive care"], languages=["Czech"])]
        job = _job(
            role_family="healthcare_clinical",
            languages=["Czech"],
            requirements=[JobRequirement(skill="intensive care")],
        )
        out = assess_winnability(pool, job)
        self.assertEqual([g for g in out["looseGates"] if g["value"] == "Czech"], [])


class WinnabilityCliSkippedTest(unittest.TestCase):
    """bug-ui-scan-2026-07-09 (pipeline-clis-script-bridges #4): a malformed candidate
    must be RECORDED in `skipped` (not silently dropped), so the grade's denominator is
    honest and the UI can flag "N not assessed"."""

    def _run(self, payload: dict, job: dict) -> tuple[int, dict]:
        with tempfile.TemporaryDirectory() as d:
            inp = Path(d) / "in.json"
            jobp = Path(d) / "job.json"
            inp.write_text(json.dumps(payload), encoding="utf-8")
            jobp.write_text(json.dumps(job), encoding="utf-8")
            buf = io.StringIO()
            # Redirect stdout to a StringIO (no .reconfigure) so main() skips its
            # stdio reconfigure guard cleanly and we capture the JSON payload.
            with contextlib.redirect_stdout(buf):
                rc = winnability_cli.main(["--input-json", str(inp), "--job-json", str(jobp)])
            return rc, json.loads(buf.getvalue().strip().splitlines()[-1])

    def test_malformed_candidate_is_recorded_not_silently_dropped(self) -> None:
        job = {"id": "job-1", "title": "Backend Engineer", "company": "Acme", "location": "Prague"}
        payload = {
            "jobId": "job-1",
            "candidates": [
                {"label": "Good", "candidate": {"label": "Good", "skills": ["python"], "role_family": "software_engineering"}},
                # skillClaims must be a list — this profile fails CandidateProfileV2 validation.
                {"id": "bad-1", "label": "Broken CV", "profile": {"skillClaims": "not-a-list"}},
            ],
        }
        rc, out = self._run(payload, job)
        self.assertEqual(rc, 0)
        # The one valid candidate still scored — one bad row didn't poison the batch.
        self.assertEqual(out["poolSize"], 1)
        # The malformed entry is surfaced with id + label + reason (pre-fix: the key
        # didn't exist at all — `out["skipped"]` raised KeyError).
        self.assertEqual(len(out["skipped"]), 1)
        self.assertEqual(out["skipped"][0]["id"], "bad-1")
        self.assertEqual(out["skipped"][0]["label"], "Broken CV")
        self.assertTrue(out["skipped"][0]["reason"])

    def test_all_valid_pool_reports_empty_skipped(self) -> None:
        job = {"id": "job-1", "title": "Backend Engineer", "company": "Acme", "location": "Prague"}
        payload = {
            "jobId": "job-1",
            "candidates": [
                {"label": "A", "candidate": {"label": "A", "skills": ["python"], "role_family": "software_engineering"}},
            ],
        }
        rc, out = self._run(payload, job)
        self.assertEqual(rc, 0)
        self.assertEqual(out["skipped"], [])


class WinnabilityCliErrorEnvelopeTest(unittest.TestCase):
    """The coach's failure vocabulary.

    Every failure in this CLI used to leave as one bare ``{error, status: 500}`` with no
    ``code`` at all — so "you graded a job the corpus no longer carries" (remedy: pick
    another) and a real engine fault were the same red box, and the missing job read as
    "the engine failed". The codes are now chosen at the raise site, from the shared
    ``_cli.ERROR_CODES``.
    """

    def _run(self, argv: list[str]) -> tuple[int, dict]:
        err = io.StringIO()
        # BOTH streams replaced (neither has .reconfigure): the guarded configure_stdio
        # must skip each on its own — the open-coded pair this CLI used to carry
        # reconfigured stderr unconditionally and died here with an AttributeError.
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
            rc = winnability_cli.main(argv)
        lines = [ln for ln in err.getvalue().splitlines() if ln.strip()]
        return rc, json.loads(lines[-1])

    @contextlib.contextmanager
    def _input(self, payload: dict | str):
        with tempfile.TemporaryDirectory() as d:
            inp = Path(d) / "in.json"
            inp.write_text(payload if isinstance(payload, str) else json.dumps(payload), encoding="utf-8")
            yield str(inp)

    def test_a_job_the_corpus_does_not_carry_is_a_404_not_an_engine_failure(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            jobs = Path(d) / "jobs.json"
            jobs.write_text("[]", encoding="utf-8")
            with self._input({"jobId": "no-such-job", "candidates": []}) as inp:
                rc, env = self._run(["--input-json", inp, "--jobs", str(jobs)])
        self.assertEqual((env["status"], env["code"]), (404, "not_found"))
        self.assertIn("no-such-job", env["error"])
        self.assertEqual(rc, 1)

    def test_a_malformed_input_payload_is_a_400_the_caller_can_fix(self) -> None:
        with self._input("{not json at all") as inp:
            rc, env = self._run(["--input-json", inp])
        self.assertEqual((env["status"], env["code"]), (400, "invalid_input"))
        self.assertEqual(rc, 2, "a client mistake exits 2, matching the rest of the family")

    def test_a_job_record_that_fails_validation_is_a_400(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            jobp = Path(d) / "job.json"
            # `title` must be a string — a partially-ingested draft is the caller's
            # payload, not an engine fault.
            jobp.write_text(json.dumps({"id": "j1", "title": {"oops": True}}), encoding="utf-8")
            with self._input({"jobId": "j1", "candidates": []}) as inp:
                rc, env = self._run(["--input-json", inp, "--job-json", str(jobp)])
        self.assertEqual((env["status"], env["code"]), (400, "invalid_input"))
        self.assertEqual(rc, 2)

    def test_every_code_it_emits_is_in_the_shared_vocabulary(self) -> None:
        # Non-vacuity: a word outside ERROR_CODES resolves to no errors.<CODE> catalog
        # key, so the reader would get the server's raw English in every locale.
        with self._input("{nope") as inp:
            _rc, bad_json = self._run(["--input-json", inp])
        with tempfile.TemporaryDirectory() as d:
            jobs = Path(d) / "jobs.json"
            jobs.write_text("[]", encoding="utf-8")
            with self._input({"jobId": "ghost", "candidates": []}) as inp:
                _rc2, missing = self._run(["--input-json", inp, "--jobs", str(jobs)])
        for env in (bad_json, missing):
            self.assertIn(env["code"], _cli.ERROR_CODES)

    def test_the_envelope_is_one_line_the_bridge_can_parse(self) -> None:
        # parseStderrError reads the LAST line of stderr only.
        with tempfile.TemporaryDirectory() as d:
            jobs = Path(d) / "jobs.json"
            jobs.write_text("[]", encoding="utf-8")
            err = io.StringIO()
            with self._input({"jobId": "ghost", "candidates": []}) as inp:
                with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
                    winnability_cli.main(["--input-json", inp, "--jobs", str(jobs)])
        self.assertEqual(len([ln for ln in err.getvalue().splitlines() if ln.strip()]), 1)


if __name__ == "__main__":
    unittest.main()
