"""Phase C — role -> Job conversion + proactive sourcing (deterministic matching)."""

import unittest

from pipeline.jobfit.devcase.source import role_to_job, source_candidates


def _candidate(cid: str, skills: list[str], seniority: str = "senior") -> dict:
    return {
        "id": cid,
        "label": cid,
        "archetype": "bau",
        "payload": {
            "id": cid,
            "displayName": cid,
            "archetype": "bau",
            "roleFamily": "software_engineering",
            "seniority": seniority,
            "yearsExperience": 6,
            "languages": ["English"],
            "skillClaims": [{"skill": s, "level": "advanced", "provenance": "professional"} for s in skills],
            "evidence": [],
        },
    }


class TestSource(unittest.TestCase):
    def test_role_to_job_builds_requirements(self):
        job = role_to_job({"title": "Backend", "seniority": "senior", "roleFamily": "software_engineering", "mustHaves": ["Python", "Django"], "niceToHaves": ["Kafka"]})
        self.assertEqual(job.title, "Backend")
        kinds = {r.kind for r in job.requirements}
        self.assertIn("must_have", kinds)
        self.assertIn("nice_to_have", kinds)

    def test_sourcing_ranks_relevant_candidates(self):
        role = {"title": "Backend", "seniority": "senior", "roleFamily": "software_engineering", "mustHaves": ["Python", "Django"], "responsibilities": ["APIs"]}
        pool = [
            _candidate("strong", ["Python", "Django", "PostgreSQL"]),
            _candidate("weak", ["Figma", "Photoshop"]),
        ]
        ranked = source_candidates(role, pool, top_n=8, floor=1)
        ids = [r["candidateId"] for r in ranked]
        self.assertIn("strong", ids)
        # the strong candidate outranks (or the weak is filtered out by floor/KO)
        if "weak" in ids:
            self.assertGreater(ranked[0]["score"], ranked[-1]["score"])
        self.assertEqual(ids[0], "strong")
        self.assertTrue(all(0 <= r["score"] <= 100 for r in ranked))

    def test_floor_filters(self):
        role = {"title": "Backend", "seniority": "senior", "roleFamily": "software_engineering", "mustHaves": ["Rust"], "responsibilities": []}
        ranked = source_candidates(role, [_candidate("c", ["Python"])], floor=99)
        self.assertEqual(ranked, [])


if __name__ == "__main__":
    unittest.main()
