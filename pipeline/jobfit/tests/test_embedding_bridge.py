"""The embedding bridge: opt-in, fail-open, and a no-op for the default path.

What must hold: with NO embedder every score is byte-identical to the keyword
heuristic (rankings stay reproducible offline); with a working embedder the
semantic term replaces the keyword term in score_personal/score_motivation; a
raising or empty-input bridge falls back to the heuristic rather than failing
or zeroing the dimension; embeddings are cached per process.
"""

from __future__ import annotations

import hashlib
import unittest

from pipeline.jobfit.embedding_bridge import _CACHE, MAX_EMBED_BATCH, prewarm, semantic_overlap
from pipeline.jobfit.jobs import normalize_job
from pipeline.jobfit.matching import MatchCandidate, score_job, score_motivation, score_personal
from pipeline.jobfit.recruiter import rank_candidates_for_job

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
        self.batches: list[int] = []  # texts per call, to pin BATCHING (not just caching)

    def _vector(self, text: str) -> list[float]:
        if text in self.vectors:
            return self.vectors[text]
        # Deterministic per-text pseudo-vector so an unmapped text still scores
        # stably — score identity across batched/unbatched must be provable.
        h = hashlib.sha1(text.encode("utf-8")).digest()
        return [1.0, h[0] / 255.0, h[1] / 255.0]

    def embed(self, texts):
        self.calls += 1
        self.batches.append(len(texts))
        if self.fail:
            raise RuntimeError("provider down")
        return [self._vector(t) for t in texts]


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


def _pool(n: int) -> list[tuple[str, MatchCandidate]]:
    """N distinct BAU candidates — each contributes its OWN candidate text plus the
    shared job description, i.e. the 2N single-item round-trips of the old path."""
    return [
        (
            f"c{i}",
            MatchCandidate(
                skills=[f"Flask{i}", "PostgreSQL"],
                traits=["curious"],
                seniority="junior",
                role_family="data_ai",
                languages=["English"],
                archetype="bau",
            ),
        )
        for i in range(n)
    ]


class BatchedPrewarmTest(unittest.TestCase):
    """The pool's texts must go out in ONE embed() call, not one per text — and
    that must not change a single score. Guards against a silent regression to
    per-item calls."""

    def setUp(self):
        _CACHE.clear()

    def test_pool_is_embedded_in_one_call_not_two_per_candidate(self):
        pool = _pool(8)
        stub = _StubEmbedder()
        rank_candidates_for_job(pool, JOB, embedder=stub)
        # 8 candidate texts + 1 shared job description, one round-trip.
        self.assertEqual(stub.calls, 1)
        self.assertEqual(stub.batches, [9])

    def test_scores_are_identical_batched_vs_per_item(self):
        pool = _pool(8)
        batched_stub = _StubEmbedder()
        batched = {r["candidateId"]: r["result"]["total"] for r in rank_candidates_for_job(pool, JOB, embedder=batched_stub)}
        # The pre-batching path: score_job never prewarms, so each candidate pays
        # its own single-item embeds. Same stub vectors => must be the same scores.
        _CACHE.clear()
        per_item_stub = _StubEmbedder()
        per_item = {cid: score_job(cand, JOB, embedder=per_item_stub).total for cid, cand in pool}
        self.assertEqual(batched, per_item)
        self.assertEqual(per_item_stub.calls, 9)  # 8 candidate texts + the JD, one at a time
        self.assertLess(batched_stub.calls, per_item_stub.calls)

    def test_prewarm_only_sends_cache_misses(self):
        stub = _StubEmbedder()
        self.assertEqual(prewarm(["alpha", "beta"], stub), 2)
        self.assertEqual(stub.batches, [2])
        # "alpha" is cached, "  beta  " strips to a cached text, blanks are dropped.
        self.assertEqual(prewarm(["alpha", "  beta  ", "", "   ", "gamma"], stub), 1)
        self.assertEqual(stub.batches, [2, 1])

    def test_prewarm_dedupes_within_one_batch(self):
        stub = _StubEmbedder()
        self.assertEqual(prewarm(["alpha", "alpha", "beta"], stub), 2)
        self.assertEqual(stub.batches, [2])

    def test_prewarm_chunks_to_the_provider_batch_limit(self):
        stub = _StubEmbedder()
        texts = [f"text-{i}" for i in range(MAX_EMBED_BATCH + 3)]
        self.assertEqual(prewarm(texts, stub), MAX_EMBED_BATCH + 3)
        self.assertEqual(stub.batches, [MAX_EMBED_BATCH, 3])

    def test_prewarm_without_provider_is_a_noop(self):
        self.assertEqual(prewarm(["alpha"], None), 0)

    def test_failed_batch_degrades_to_the_per_item_path(self):
        # A batch that raises must not widen the blast radius: nothing is cached,
        # and each candidate still falls back to the keyword heuristic exactly as
        # a single-item failure did before.
        pool = _pool(3)
        failing = _StubEmbedder(fail=True)
        rows = rank_candidates_for_job(pool, JOB, embedder=failing)
        totals = {r["candidateId"]: r["result"]["total"] for r in rows}
        baseline = {cid: score_job(cand, JOB).total for cid, cand in pool}
        self.assertEqual(totals, baseline)

    def test_prewarm_ignores_a_misaligned_response(self):
        class _Short(_StubEmbedder):
            def embed(self, texts):
                super().embed(texts)
                return []  # provider returned fewer vectors than texts

        stub = _Short()
        self.assertEqual(prewarm(["alpha", "beta"], stub), 0)
        self.assertEqual(_CACHE.get(stub, {}), {})  # nothing mis-keyed into the cache


if __name__ == "__main__":
    unittest.main()
