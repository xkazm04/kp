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
        out = source_candidates(role, pool, top_n=8, floor=1)
        ranked = out["candidates"]
        ids = [r["candidateId"] for r in ranked]
        self.assertIn("strong", ids)
        # the strong candidate outranks (or the weak is filtered out by floor/KO)
        if "weak" in ids:
            self.assertGreater(ranked[0]["score"], ranked[-1]["score"])
        self.assertEqual(ids[0], "strong")
        self.assertTrue(all(0 <= r["score"] <= 100 for r in ranked))
        # Everyone parsed fine, so nothing is skipped.
        self.assertEqual(out["skipped"], 0)
        self.assertEqual(out["skippedReasons"], [])

    def test_floor_filters(self):
        role = {"title": "Backend", "seniority": "senior", "roleFamily": "software_engineering", "mustHaves": ["Rust"], "responsibilities": []}
        out = source_candidates(role, [_candidate("c", ["Python"])], floor=99)
        # A floor/KO rejection is "nobody qualified" — the candidate parsed fine, so it is
        # NOT counted as skipped. Empty shortlist + zero skipped == genuine no-match.
        self.assertEqual(out["candidates"], [])
        self.assertEqual(out["skipped"], 0)

    def test_unparseable_candidate_is_counted_not_dropped(self):
        # A candidate whose payload fails CandidateProfileV2 validation must not vanish:
        # it is tracked in `skipped`/`skippedReasons` (reason = the validation error type),
        # so an empty/short shortlist is honest about a pool that partly failed to load.
        role = {"title": "Backend", "seniority": "senior", "roleFamily": "software_engineering", "mustHaves": ["Python", "Django"], "responsibilities": ["APIs"]}
        broken = {"id": "broken", "label": "broken", "archetype": "bau", "payload": {"skillClaims": [{"level": "advanced"}]}}  # SkillClaim.skill is required
        out = source_candidates(role, [_candidate("strong", ["Python", "Django"]), broken], top_n=8, floor=1)
        ids = [r["candidateId"] for r in out["candidates"]]
        self.assertIn("strong", ids)
        self.assertNotIn("broken", ids)
        self.assertEqual(out["skipped"], 1)
        self.assertEqual(out["skippedReasons"], [{"candidateId": "broken", "reason": "ValidationError"}])

    def test_all_fail_to_parse_is_distinguishable_from_no_match(self):
        # The whole point: candidates == [] with skipped > 0 means "pool failed to parse",
        # not "nobody matched".
        role = {"title": "Backend", "seniority": "senior", "roleFamily": "software_engineering", "mustHaves": ["Python"], "responsibilities": []}
        pool = [{"id": f"b{i}", "payload": {"skillClaims": [{"level": "advanced"}]}} for i in range(3)]
        out = source_candidates(role, pool, floor=1)
        self.assertEqual(out["candidates"], [])
        self.assertEqual(out["skipped"], 3)
        self.assertTrue(all(s["reason"] == "ValidationError" for s in out["skippedReasons"]))


if __name__ == "__main__":
    unittest.main()
