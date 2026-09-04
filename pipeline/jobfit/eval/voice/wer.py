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


# ---------------------------------------------------------------------------
# Spelled-out numbers -> digits (en + cs), table-driven.
#
# The candidate's speech is SYNTHESIZED from text we wrote ("I led a team of five for three
# years"), while EL's ASR writes numbers as DIGITS ("I led a team of 5 for 3 years"). Every
# number in an utterance was therefore charged as a substitution against a transcript that was
# perfectly correct — a fixed, content-free tax on exactly the utterances a work-history persona
# is full of. Folding both sides to digits makes the comparison about what was heard.
#
# Table-driven so a language is a dict entry, not a code path. Only en/cs are folded — the two
# languages the voice plane can actually speak (tts.VOICES).
# ---------------------------------------------------------------------------

_UNITS_EN: dict[str, int] = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
    "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20,
    "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
}
# Czech, in the gender/case forms a persona line or a TTS script actually uses. ONLY the
# properly-accented spellings are listed: this module treats a dropped diacritic as a REAL ASR
# error ("reky" vs "řeky"), so folding "pet" and "pět" to the same 5 would hide exactly the
# error the rest of the file exists to catch — and "pet"/"set"/"tri" are ordinary English words
# a bare-ASCII table would silently turn into numbers.
_UNITS_CS: dict[str, int] = {
    "nula": 0, "jedna": 1, "jeden": 1, "jedno": 1, "jednu": 1, "dva": 2, "dvě": 2,
    "tři": 3, "čtyři": 4, "pět": 5, "šest": 6, "sedm": 7, "osm": 8, "devět": 9, "deset": 10,
    "jedenáct": 11, "dvanáct": 12, "třináct": 13, "čtrnáct": 14, "patnáct": 15, "šestnáct": 16,
    "sedmnáct": 17, "osmnáct": 18, "devatenáct": 19, "dvacet": 20, "třicet": 30, "čtyřicet": 40,
    "padesát": 50, "šedesát": 60, "sedmdesát": 70, "osmdesát": 80, "devadesát": 90,
}
_NUM_WORDS: dict[str, int] = {**_UNITS_EN, **_UNITS_CS}
# Multipliers: "two hundred" is 2 x 100, not the tokens 2 and 100.
_NUM_SCALES: dict[str, int] = {
    "hundred": 100, "thousand": 1_000, "million": 1_000_000,
    "sto": 100, "stě": 100, "tisíc": 1_000, "tisíce": 1_000, "milión": 1_000_000,
}
# Joiners that sit INSIDE a spelled number and must not break the run ("twenty-five" survives
# tokenization as one token; "sto dvacet" does not need one, but English "and" does).
_NUM_JOINERS: frozenset[str] = frozenset({"and"})


def _fold_numbers(tokens: list[str]) -> list[str]:
    """Collapse runs of number words into their digit form, in place of the words.

    Standard additive/multiplicative reading: ``twenty five`` -> ``25``, ``two hundred`` ->
    ``200``, ``sto dvacet`` -> ``120``. A token that is neither a number word nor a joiner ends
    the run. ``and`` only joins when a number is already open AND another number follows, so an
    ordinary "and" is never eaten."""
    out: list[str] = []
    i = 0
    n = len(tokens)
    while i < n:
        tok = tokens[i]
        # A hyphenated compound ("twenty-five") is one token after normalization.
        parts = tok.split("-") if "-" in tok else [tok]
        if not all(p in _NUM_WORDS or p in _NUM_SCALES for p in parts) or not parts:
            out.append(tok)
            i += 1
            continue
        total = 0      # completed hundreds/thousands groups
        current = 0    # the group being read
        j = i
        while j < n:
            t = tokens[j]
            if t in _NUM_JOINERS:
                # Only a joiner when a number is open and another number follows.
                nxt = tokens[j + 1] if j + 1 < n else None
                if current or total:
                    if nxt and all(p in _NUM_WORDS or p in _NUM_SCALES for p in nxt.split("-")):
                        j += 1
                        continue
                break
            chunk = t.split("-") if "-" in t else [t]
            if not all(p in _NUM_WORDS or p in _NUM_SCALES for p in chunk):
                break
            for p in chunk:
                if p in _NUM_SCALES:
                    scale = _NUM_SCALES[p]
                    if scale >= 1000:
                        total += max(current, 1) * scale
                        current = 0
                    else:
                        current = max(current, 1) * scale
                else:
                    current += _NUM_WORDS[p]
            j += 1
        out.append(str(total + current))
        i = j
    return out


def normalize(text: str) -> list[str]:
    """Lowercase + punctuation-stripped word list, NFC-normalized so composed/decomposed
    diacritics compare equal, with spelled-out en/cs numbers folded to digits
    (:func:`_fold_numbers`) so "five" and "5" are the same word."""
    t = unicodedata.normalize("NFC", (text or "").strip().lower())
    t = _PUNCT.sub(" ", t)
    # ``_PUNCT`` keeps ' and - because they are INTRA-word ("e-mail", "don't"). At a word
    # EDGE they are punctuation, and leaving them standing made them words: a persona line
    # like "sure - I led the migration" carried a token no TTS ever voices, so the ASR was
    # charged a guaranteed deletion (+1 error and +1 ref word) on every such utterance, and
    # a quoted 'yes' scored a substitution against a correctly heard "yes".
    return _fold_numbers([w for w in (tok.strip("'-") for tok in _WS.sub(" ", t).split()) if w])


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
    "hadoop", "pandas", "numpy", "airflow", "dbt",
    "kubernetes", "docker", "terraform", "ansible", "jenkins", "gitlab", "github", "nginx",
    "envoy", "grpc", "graphql",
    "aws", "gcp", "azure", "lambda", "cloudflare", "vercel", "linux",
    "pytorch", "tensorflow", "keras", "huggingface", "langchain", "openai", "gemini", "transformer",
    "embeddings", "embedding", "websocket", "oauth", "prometheus", "grafana",
})
# The literal above is a SET, so a repeated entry changes nothing at runtime and cannot be seen
# in a diff review — "kubernetes" was written three times before anyone noticed. A duplicate is
# a signal the list is being appended to blind, so the source is pinned against repeats in
# test_voice_harness.TestTechTermsSource.
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
