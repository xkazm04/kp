"""Word error rate against the spoken ground truth.

The voice harness synthesizes the candidate's speech from text it chose, so it knows exactly what
was said. WER between that ground truth and the ASR's transcript is therefore a DETERMINISTIC
measure of transcript fidelity — the one thing the text plane and a human vibecheck can never give
us, and the thing the scorecard silently depends on.

Normalization is deliberately conservative: lowercase, strip punctuation, collapse whitespace.
Czech diacritics are PRESERVED — "reky" vs "řeky" is a real ASR error, not a formatting artifact.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

# Keep letters (incl. Czech diacritics), digits and intra-word apostrophes/hyphens; drop the rest.
_PUNCT = re.compile(r"[^\w\s'-]", re.UNICODE)
_WS = re.compile(r"\s+")


def normalize(text: str) -> list[str]:
    """Lowercase + punctuation-stripped word list, NFC-normalized so composed/decomposed
    diacritics compare equal."""
    t = unicodedata.normalize("NFC", (text or "").strip().lower())
    t = _PUNCT.sub(" ", t)
    t = _WS.sub(" ", t).strip()
    return t.split() if t else []


@dataclass(frozen=True)
class WerResult:
    wer: float          # (S + D + I) / N   — can exceed 1.0 when the ASR hallucinates
    substitutions: int
    deletions: int
    insertions: int
    ref_words: int

    @property
    def accuracy(self) -> float:
        return max(0.0, 1.0 - self.wer)


def wer(reference: str, hypothesis: str) -> WerResult:
    """Levenshtein over words, with the standard S/D/I breakdown."""
    ref = normalize(reference)
    hyp = normalize(hypothesis)
    n, m = len(ref), len(hyp)
    if n == 0:
        # Nothing was said: any hypothesis words are pure insertions. WER is undefined (0/0), so
        # report 0.0 for an empty-empty pair and 1.0 when the ASR invented words from silence.
        return WerResult(0.0 if m == 0 else 1.0, 0, 0, m, 0)

    # dp[i][j] = (cost, S, D, I) for ref[:i] vs hyp[:j]
    prev: list[tuple[int, int, int, int]] = [(j, 0, 0, j) for j in range(m + 1)]
    for i in range(1, n + 1):
        cur: list[tuple[int, int, int, int]] = [(i, 0, i, 0)]
        for j in range(1, m + 1):
            if ref[i - 1] == hyp[j - 1]:
                cur.append(prev[j - 1])
                continue
            sub = (prev[j - 1][0] + 1, prev[j - 1][1] + 1, prev[j - 1][2], prev[j - 1][3])
            dele = (prev[j][0] + 1, prev[j][1], prev[j][2] + 1, prev[j][3])
            ins = (cur[j - 1][0] + 1, cur[j - 1][1], cur[j - 1][2], cur[j - 1][3] + 1)
            cur.append(min(sub, dele, ins, key=lambda t: t[0]))
        prev = cur
    cost, s, d, i_ = prev[m]
    return WerResult(cost / n, s, d, i_, n)


def corpus_wer(pairs: list[tuple[str, str]]) -> WerResult:
    """Aggregate WER over (reference, hypothesis) pairs — errors and ref-words pooled, which is the
    standard corpus-level definition (NOT the mean of per-utterance WERs)."""
    S = D = I = N = 0
    for ref, hyp in pairs:
        r = wer(ref, hyp)
        S += r.substitutions
        D += r.deletions
        I += r.insertions
        N += r.ref_words
    return WerResult((S + D + I) / N if N else 0.0, S, D, I, N)


# ---------------------------------------------------------------------------
# Entity fidelity — the V1 finding made the case for this.
#
# The Czech V1 call transcribed "Reactem" as "Rustem" and "PostgreSQL" as "později SQL": a
# FABRICATED skill set the scorecard would then rate. Yet aggregate WER was only 8.3 %, well inside
# any sane budget, because a single substituted noun is low-WER / high-semantic-damage. So the gate
# that actually protects the scorecard is not word-level WER but "did the domain terms the
# candidate SPOKE survive into the transcript".
# ---------------------------------------------------------------------------

# Technology / tool names the scorecard depends on. Prefix-matched so Czech case endings
# ("Reactem", "Dockeru", "Pythonem") resolve to the canonical term. Extensible. Short ambiguous
# words (go, c, r) are deliberately excluded to avoid false positives on ordinary speech.
TECH_TERMS: frozenset[str] = frozenset({
    "python", "java", "javascript", "typescript", "golang", "kotlin", "swift", "scala", "ruby", "php",
    "rust", "elixir", "clojure", "haskell", "perl",
    "react", "angular", "vue", "svelte", "nextjs", "redux", "tailwind", "webpack", "vite",
    "django", "flask", "fastapi", "spring", "express", "rails", "laravel", "dotnet", "nestjs", "symfony",
    "postgresql", "postgres", "mysql", "mariadb", "sqlite", "mongodb", "redis", "cassandra", "dynamodb",
    "elasticsearch", "clickhouse", "snowflake", "bigquery", "kafka", "rabbitmq", "pulsar", "spark",
    "hadoop", "pandas", "numpy", "airflow", "dbt", "kubernetes",
    "docker", "terraform", "ansible", "jenkins", "gitlab", "github", "nginx", "envoy", "grpc", "graphql",
    "aws", "gcp", "azure", "lambda", "cloudflare", "vercel", "linux", "kubernetes",
    "pytorch", "tensorflow", "keras", "huggingface", "langchain", "openai", "gemini", "transformer",
    "embeddings", "embedding", "websocket", "oauth", "kubernetes", "prometheus", "grafana",
})
_TERMS_BY_LEN = sorted(TECH_TERMS, key=len, reverse=True)  # longest prefix wins (javascript before java)
_MAX_INFLECTION = 3  # only a short case ending may follow the stem ("reactem", not "reactionary")


def domain_terms(text: str) -> set[str]:
    """Canonical tech terms actually present in ``text`` (prefix-matched for inflection)."""
    found: set[str] = set()
    for tok in normalize(text):
        if tok in TECH_TERMS:
            found.add(tok)
            continue
        for term in _TERMS_BY_LEN:
            if tok.startswith(term) and (len(tok) - len(term)) <= _MAX_INFLECTION:
                found.add(term)
                break
    return found


@dataclass(frozen=True)
class EntityFidelity:
    recall: float              # fraction of spoken domain terms that survived into the transcript
    missing: tuple[str, ...]   # spoken but NOT heard — corrupted or dropped skills
    total: int                 # domain terms in the reference

    @property
    def ok(self) -> bool:
        return not self.missing


def entity_fidelity(reference: str, hypothesis: str) -> EntityFidelity:
    ref = domain_terms(reference)
    if not ref:
        return EntityFidelity(1.0, (), 0)
    missing = tuple(sorted(ref - domain_terms(hypothesis)))
    return EntityFidelity((len(ref) - len(missing)) / len(ref), missing, len(ref))


def corpus_entity_fidelity(pairs: list[tuple[str, str]]) -> EntityFidelity:
    total = 0
    missing: list[str] = []
    for ref, hyp in pairs:
        r = entity_fidelity(ref, hyp)
        total += r.total
        missing.extend(r.missing)
    return EntityFidelity((total - len(missing)) / total if total else 1.0, tuple(missing), total)
