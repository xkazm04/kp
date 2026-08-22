"""The embedding bridge for the personal/motivation dimension (OPT-IN).

``score_personal`` and ``score_motivation`` are whole-word-overlap heuristics —
matching.py has carried a "lightweight heuristic until the embedding bridge
lands" note since they shipped. This is that bridge: a provider-pluggable
semantic similarity that replaces the keyword-overlap TERM of those scores with
an embedding cosine, so "built REST APIs in Flask" can finally meet an ad that
says "backend services in Python" without sharing a token.

Design constraints, in priority order:

* **Opt-in.** The default scoring path stays deterministic and offline —
  candidate rankings must be reproducible without network access, so nothing
  here runs unless a caller explicitly passes an embedder (recruiter_cli
  ``--embeddings``).
* **Fail-open.** A missing key/SDK, a network error, or an empty text yields
  ``None`` and the caller falls back to the keyword heuristic — semantic
  enrichment must never take scoring down with it.
* **Cached.** Texts are embedded once per process (the job description is
  shared across a whole pool), keyed by content hash.
* **Batched.** ``embed`` takes a LIST, so a pool's texts are warmed in one
  round-trip via ``prewarm`` instead of 2N sequential single-item calls (see
  its docstring). Batching is an optimization only — a failed batch leaves the
  cache untouched and every text still resolves through the old per-item path.
"""

from __future__ import annotations

import hashlib
import math
import os
import time
import weakref
from typing import Any, Protocol


class EmbeddingProvider(Protocol):  # pragma: no cover - structural typing only
    def embed(self, texts: list[str]) -> list[list[float]]: ...


GEMINI_EMBEDDING_MODEL = "gemini-embedding-001"


class GeminiEmbeddingProvider:
    """Embeddings via the same google-genai SDK + env key the CV extractor uses."""

    def __init__(self, model: str = GEMINI_EMBEDDING_MODEL) -> None:
        self.model = model
        self._client: Any | None = None

    def available(self) -> bool:
        # KP_OFFLINE (E-SH-4): embeddings are a CLOUD call to
        # generativelanguage.googleapis.com made from the spawned Python process, so
        # neither the Node fetch guard nor the llm/base adapter seal covers it.
        # Report unavailable — exactly the contract self-hosting.md §7 states — and
        # the caller stays on the deterministic keyword heuristic.
        from .llm.offline import is_offline  # lazy: keep this leaf module cycle-free

        if is_offline():
            return False
        if not (os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")):
            return False
        try:  # the SDK is an optional dependency of the scoring path
            from google import genai  # noqa: F401
        except ImportError:
            return False
        return True

    def embed(self, texts: list[str]) -> list[list[float]]:
        if self._client is None:
            from google import genai

            self._client = genai.Client()
        started = time.monotonic()
        result = self._client.models.embed_content(model=self.model, contents=texts)
        _meter_embeddings(self.model, result, int((time.monotonic() - started) * 1000))
        return [list(e.values) for e in result.embeddings]


def _meter_embeddings(model: str, result: Any, duration_ms: int) -> None:
    """Route one embeddings call through the shared monitor seam (usage ledger +
    LightTrack), so this opt-in path stops being the one provider call in the app
    with zero observability. Fire-and-forget and fully swallowed — embeddings are
    a fail-open enrichment (``semantic_overlap`` returns ``None`` on any error),
    and metering must never be the thing that changes that. The monitor writes
    the durable ledger only when ``KP_LLM_USAGE_LOG`` is set, so keyless/offline
    runs are untouched. Cost is left to LightTrack's price book — embeddings
    aren't in the completion ``MTOK_PRICES`` table, so we report the tokens +
    latency the embeddings API actually meters and let the server price them."""
    try:
        from .llm import monitor

        # google-genai reports embeddings usage (when present) as a prompt/total
        # token count; an embedding has no output tokens.
        um = getattr(result, "usage_metadata", None)
        input_tokens = 0
        if um is not None:
            input_tokens = int(
                getattr(um, "prompt_token_count", None) or getattr(um, "total_token_count", None) or 0
            )
        monitor.emit_result(
            provider="gemini",
            model=model,
            use_case="embedding",
            usage={"input_tokens": input_tokens, "output_tokens": 0},
            cost_usd=None,
            duration_ms=duration_ms,
        )
    except Exception:
        pass  # metering must never break (or degrade) the fail-open host call


def default_provider() -> GeminiEmbeddingProvider | None:
    """The standard opt-in provider: Gemini when its key + SDK are present, else
    None — callers treat None as "stay on the deterministic heuristic"."""
    provider = GeminiEmbeddingProvider()
    return provider if provider.available() else None


# Process-lifetime embedding cache, keyed PER PROVIDER INSTANCE (different
# providers/models embed differently — one global text→vector map would serve
# one model's vectors for another's request). CLI processes are short-lived (one
# ranking per spawn), so this is per-run memoization — the JD embeds once per
# pool, not once per candidate — rather than a persistent store needing
# invalidation; the weak keying lets a dropped provider's vectors be collected.
_CACHE: "weakref.WeakKeyDictionary[Any, dict[str, list[float]]]" = weakref.WeakKeyDictionary()


def _cache_key(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


# Texts per ``embed`` request. The Gemini embeddings endpoint rejects oversized
# batches (embed_content caps the instances per call), so a pool bigger than this
# is chunked rather than sent as one doomed request. Kept well under the
# documented ceiling because each text here is a whole CV/ad, not a sentence.
MAX_EMBED_BATCH = 100


def prewarm(texts: Any, provider: EmbeddingProvider | None) -> int:
    """Embed a whole pool's texts in ONE call (per ``MAX_EMBED_BATCH`` chunk) and
    fill the per-provider cache, so the subsequent ``semantic_overlap`` calls are
    all cache hits.

    Why: ``_cached_embed`` embeds one text per round-trip, and each candidate
    triggers one ``semantic_overlap`` — a group eval over N candidates paid up to
    2N SEQUENTIAL round-trips for texts that were all known upfront. Callers that
    hold the whole pool (recruiter.rank_candidates_for_job) warm it here first.

    Semantics deliberately match ``semantic_overlap``'s: texts are stripped,
    blanks dropped, duplicates collapsed, and ALREADY-CACHED texts are never
    re-sent — the batch is exactly the cache misses.

    Fail-open, and no wider than the per-item path it replaces: a raising batch
    (or a provider returning the wrong number of vectors) is swallowed and simply
    leaves those texts uncached, so each one falls back to its own single-item
    ``_cached_embed`` — i.e. exactly today's behaviour, per candidate. Warming can
    never take down a pool's scoring. Returns the number of texts newly cached
    (0 = nothing to do, or the provider is unavailable/failing).
    """
    if provider is None:
        return 0
    per_provider = _CACHE.setdefault(provider, {})
    pending: dict[str, str] = {}  # cache key -> text, insertion-ordered, de-duped
    for raw in texts:
        text = (raw or "").strip()
        if not text:
            continue
        key = _cache_key(text)
        if key in per_provider or key in pending:
            continue
        pending[key] = text
    items = list(pending.items())
    warmed = 0
    for start in range(0, len(items), MAX_EMBED_BATCH):
        chunk = items[start : start + MAX_EMBED_BATCH]
        try:
            vectors = provider.embed([text for _key, text in chunk])
        except Exception:
            continue  # fail-open: leave uncached, the per-item path retries/degrades
        if len(vectors) != len(chunk):
            continue  # a misaligned response must not mis-key vectors to texts
        for (key, _text), vector in zip(chunk, vectors):
            per_provider[key] = vector
            warmed += 1
    return warmed


def _cached_embed(text: str, provider: EmbeddingProvider) -> list[float]:
    per_provider = _CACHE.setdefault(provider, {})
    key = _cache_key(text)
    hit = per_provider.get(key)
    if hit is not None:
        return hit
    vector = provider.embed([text])[0]
    per_provider[key] = vector
    return vector


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)


def semantic_overlap(text_a: str, text_b: str, provider: EmbeddingProvider | None) -> float | None:
    """Cosine similarity of the two texts' embeddings, clamped to [0, 1].

    ``None`` — the fail-open signal — when there is no provider, either text is
    blank, or the provider call raises; the caller's keyword heuristic is the
    fallback in every one of those cases.
    """
    if provider is None:
        return None
    a, b = text_a.strip(), text_b.strip()
    if not a or not b:
        return None
    try:
        va = _cached_embed(a, provider)
        vb = _cached_embed(b, provider)
    except Exception:
        return None
    return round(max(0.0, min(1.0, _cosine(va, vb))), 4)
