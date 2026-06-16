from __future__ import annotations

import unittest

from pipeline.jobfit.jobs import Job, JobRequirement
from pipeline.jobfit.matching import MatchCandidate
from pipeline.jobfit.winnability import assess_winnability


def _cand(label: str, skills: list[str], **kw) -> MatchCandidate:
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
        # Everyone clears the gates (no languages required) but nobody has Kafka,
        # so a Kafka must_have caps the qualified pool. Demoting it should lift it.
        pool = [_cand(f"c{i}", ["python", "django", "postgres", "aws"]) for i in range(4)]
        job = _job(
            requirements=[
                JobRequirement(skill="python"),
                JobRequirement(skill="django"),
                JobRequirement(skill="postgres"),
                JobRequirement(skill="aws"),
                JobRequirement(skill="kafka"),  # nobody has this
            ]
        )
        out = assess_winnability(pool, job)
        self.assertEqual(out["eligible"], 4)
        kafka = next(m for m in out["looseMustHaves"] if m["skill"] == "kafka")
        self.assertEqual(kafka["missingAmongEligible"], 4)
        self.assertGreaterEqual(kafka["qualifiedDelta"], out["qualified"] and 0)
        # Demoting the skill nobody has must not REDUCE qualified, and should be the
        # top-ranked lever (largest qualifiedDelta or most-missing).
        self.assertEqual(out["looseMustHaves"][0]["skill"], "kafka")

    def test_salary_below_market_is_flagged(self) -> None:
        job = _job(role_family="software_engineering", seniority="senior", salary_band=[10000, 20000])
        out = assess_winnability([_cand("c", ["python"])], job)
        self.assertIsNotNone(out["salary"]["marketBand"])
        # A 10k-20k band for a senior engineer sits under any realistic market floor.
        self.assertTrue(out["salary"]["belowMarket"])
        self.assertLess(out["salary"]["topVsMarketFloorPct"], 0)

    def test_empty_pool_is_zeroed_not_crashed(self) -> None:
        out = assess_winnability([], _job(requirements=[JobRequirement(skill="python")]))
        self.assertEqual(out, {**out, "poolSize": 0, "eligible": 0, "qualified": 0})
        self.assertEqual(out["looseGates"], [])

    def test_no_false_loosen_suggestion_when_gate_blocks_nobody(self) -> None:
        # Required language everyone speaks → dropping it recovers nobody, so it
        # must not appear as a suggested loosening.
        pool = [_cand("c", ["python"], languages=["English"])]
        job = _job(languages=["English"], requirements=[JobRequirement(skill="python")])
        out = assess_winnability(pool, job)
        self.assertEqual([g for g in out["looseGates"] if g["value"] == "English"], [])


if __name__ == "__main__":
    unittest.main()
