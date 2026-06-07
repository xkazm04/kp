"""The embedding bridge: opt-in, fail-open, and a no-op for the default path.

What must hold: with NO embedder every score is byte-identical to the keyword
heuristic (rankings stay reproducible offline); with a working embedder the
semantic term replaces the keyword term in score_personal/score_motivation; a
raising or empty-input bridge falls back to the heuristic rather than failing
or zeroing the dimension; embeddings are cached per process.
"""

from __future__ import annotations

import unittest

from pipeline.jobfit.embedding_bridge import _CACHE, semantic_overlap
from pipeline.jobfit.jobs import normalize_job
from pipeline.jobfit.matching import MatchCandidate, score_job, score_motivation, score_personal

JOB = normalize_job(
    {
        "title": "Analytics Engineer",
        "seniority": "junior",
        "role_family": "data_ai",
        "languages": ["English"],
        "description": "Graduates welcome. Build backend services for reporting in Python.",
        "requirements": [{"skill": "Python", "kind": "must_have", "hardness": "learnable"}],
    }
)

BAU = MatchCandidate(
    skills=["Flask", "PostgreSQL"],
    traits=["curious"],
    seniority="junior",
    role_family="data_ai",
    languages=["English"],
    archetype="bau",
)

STUDENT = MatchCandidate(
    skills=["Python"],
    seniority="junior",
    role_family="data_ai",
    languages=["English"],
    archetype="student",
    potential_score=0.6,
    aspirations=["aiming for data work"],
)


class _StubEmbedder:
    """Maps known texts to fixed vectors; counts calls to prove caching."""

    def __init__(self, vectors: dict[str, list[float]] | None = None, fail: bool = False):
        self.vectors = vectors or {}
        self.fail = fail
        self.calls = 0

    def embed(self, texts):
        self.calls += 1
        if self.fail:
            raise RuntimeError("provider down")
        return [self.vectors.get(t, [1.0, 0.0]) for t in texts]


class SemanticOverlapTest(unittest.TestCase):
    def setUp(self):
        _CACHE.clear()

    def test_no_provider_is_none(self):
        self.assertIsNone(semantic_overlap("a", "b", None))

    def test_blank_text_is_none(self):
        self.assertIsNone(semantic_overlap("  ", "b", _StubEmbedder()))

    def test_provider_error_is_none(self):
        self.assertIsNone(semantic_overlap("a", "b", _StubEmbedder(fail=True)))

    def test_cosine_is_clamped_to_unit_interval(self):
        same = _StubEmbedder({"a": [1.0, 0.0], "b": [1.0, 0.0]})
        self.assertEqual(semantic_overlap("a", "b", same), 1.0)
        orthogonal = _StubEmbedder({"a": [1.0, 0.0], "b": [0.0, 1.0]})
        self.assertEqual(semantic_overlap("a", "b", orthogonal), 0.0)
        opposite = _StubEmbedder({"a": [1.0, 0.0], "b": [-1.0, 0.0]})
        self.assertEqual(semantic_overlap("a", "b", opposite), 0.0)  # negative cos clamps to 0

    def test_embeddings_are_cached_per_text(self):
        stub = _StubEmbedder()
        semantic_overlap("same text", "same text", stub)
        self.assertEqual(stub.calls, 1)  # second lookup served from cache
        semantic_overlap("same text", "other", stub)
        self.assertEqual(stub.calls, 2)  # only the new text embeds


class ScoringIntegrationTest(unittest.TestCase):
    def setUp(self):
        _CACHE.clear()

    def test_default_path_is_unchanged_without_embedder(self):
        self.assertEqual(score_personal(BAU, JOB), score_personal(BAU, JOB, embedder=None))
        self.assertEqual(score_job(BAU, JOB).total, score_job(BAU, JOB, embedder=None).total)

    def test_semantic_term_lifts_a_paraphrase_match(self):
        # "Flask, PostgreSQL" shares no token with the ad — the keyword term is 0.
        baseline = score_personal(BAU, JOB)
        cand_text = " ".join(BAU.traits + BAU.skills)
        job_text = JOB.description or ""
        close = _StubEmbedder({cand_text: [1.0, 0.1], job_text: [1.0, 0.0]})
        lifted = score_personal(BAU, JOB, embedder=close)
        self.assertGreater(lifted, baseline)

    def test_failed_bridge_falls_back_to_the_heuristic(self):
        self.assertEqual(score_personal(BAU, JOB, embedder=_StubEmbedder(fail=True)), score_personal(BAU, JOB))
        self.assertEqual(
            score_motivation(STUDENT, JOB, embedder=_StubEmbedder(fail=True)), score_motivation(STUDENT, JOB)
        )

    def test_motivation_aspiration_term_goes_semantic(self):
        # "aiming for data work" shares no >3-char token with "Analytics Engineer",
        # so the token heuristic scores the aspiration term 0 — the bridge can see it.
        baseline = score_motivation(STUDENT, JOB)
        asp = " ".join(STUDENT.aspirations).casefold()
        target = f"{JOB.title or ''} {JOB.description or ''}"
        close = _StubEmbedder({asp: [1.0, 0.05], target: [1.0, 0.0]})
        lifted = score_motivation(STUDENT, JOB, embedder=close)
        self.assertGreater(lifted, baseline)

    def test_early_career_score_job_threads_the_embedder(self):
        asp = " ".join(STUDENT.aspirations).casefold()
        target = f"{JOB.title or ''} {JOB.description or ''}"
        close = _StubEmbedder({asp: [1.0, 0.05], target: [1.0, 0.0]})
        self.assertGreater(score_job(STUDENT, JOB, embedder=close).total, score_job(STUDENT, JOB).total)


if __name__ == "__main__":
    unittest.main()
