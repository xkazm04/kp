"""Guard the MAIN analysis cache against silent staleness.

bug-ui-scan-2026-07-09 (pipeline-test-suite-python #2).

The reasoning cache has a cross-language freshness guard (test_prompt_version_sync)
but the far higher-stakes MAIN analysis cache had none. That cache keys only on
``app/_lib/cache-key.ts::PROMPT_VERSION`` + inputs — it never hashes the prompt
text or schema. Its own comment says a dev must MANUALLY bump the version "when
the Gemini prompt, the Pydantic schema, the deterministic pre-pass, or the
taxonomy changes" — all Python-side — yet nothing enforced that bump. A Python
analysis edit with no PROMPT_VERSION bump silently serves STALE cached analyses to
recruiters: wrong results, no error, invisible in CI.

This pins a content hash (a "fingerprint") of the analysis-affecting Python
sources: the Gemini response schema, the full analysis prompt template + rules,
the Pydantic result schema, and the taxonomy. Any change to them flips the
fingerprint and FAILS this test, whose message directs the dev to bump
PROMPT_VERSION (retiring stale caches) and re-record the pin below — turning the
previously-silent staleness bug into a loud, lockstep-forcing red build. Mirrors
the codegen ``--check`` pattern the suite already uses for lesser contracts.
"""

from __future__ import annotations

import hashlib
import inspect
import json
import re
import unittest
from pathlib import Path

from pipeline.jobfit import gemini, models

REPO_ROOT = Path(__file__).resolve().parents[3]
CACHE_KEY_TS = REPO_ROOT / "app" / "_lib" / "cache-key.ts"
TAXONOMY_JSON = REPO_ROOT / "data" / "taxonomy.json"

# ---- Recorded pins (update BOTH together when the analysis inputs change) -----
#
# EXPECTED_PROMPT_VERSION mirrors the live value in cache-key.ts. When the analysis
# fingerprint below changes you MUST bump PROMPT_VERSION there (so stale caches are
# retired) and update both constants here in the same commit.
# NOTE (Direction 1, matching-engine): the fingerprint was re-recorded when
# data/taxonomy.json gained `family_degree_terms` + `adjacent_domain_signals`.
# The whole-file taxonomy hash is deliberately conservative, so it trips on ANY
# taxonomy edit — but those two keys are read ONLY by the early-career/switcher
# transform (transform.py / transferable.py), never by the Gemini analysis prompt
# or ANALYSIS_RESPONSE_SCHEMA, so no cached analysis output changed. PROMPT_VERSION
# is therefore intentionally NOT bumped (no stale-cache invalidation is warranted).
# NOTE (Direction 2, cv-analysis metering): the fingerprint was re-recorded when
# models.py gained the `RunCost` model + `AnalysisMetadata.run_cost` field. The
# whole-module Pydantic hash is deliberately conservative, so it trips on this
# additive OUTPUT field — but run_cost is a metering-only annotation computed from
# the tokens the run reported (never read by the Gemini prompt or
# ANALYSIS_RESPONSE_SCHEMA), and a prior cached payload simply lacks it (the report
# omits the cost line, no wrong result). No cached analysis output changed, so
# PROMPT_VERSION is intentionally NOT bumped.
# NOTE (matching-engine round 2 — server-authoritative score total): the
# fingerprint was re-recorded when the ScoreBreakdown DOCSTRING in models.py was
# updated to describe the new authority (the persisted total is always the component
# sum; the LLM total is a sanity signal only). The whole-module Pydantic hash is
# deliberately conservative, so it trips on a pure docstring edit — but NO Pydantic
# field, no ANALYSIS_RESPONSE_SCHEMA, and no Gemini prompt changed. The scoring-logic
# change itself lives in pipeline.py, which this fingerprint does not hash and which
# only affects freshly computed analyses; prior cached analyses are intentionally
# served as-is (their divergent totals already display reconciled to the component
# sum via reconcileScoreTotal). So no cached analysis OUTPUT is invalidated and
# PROMPT_VERSION is intentionally NOT bumped.
# NOTE (matching-engine round 2 — data-driven language aliases): the fingerprint was
# re-recorded when data/taxonomy.json gained `language_aliases` (the four language
# buckets moved out of a hardcoded matching.py dict). The whole-file taxonomy hash is
# deliberately conservative, so it trips on ANY taxonomy edit — but language_aliases
# is read ONLY by the KO filter / language-coverage blend (matching._has_language),
# never by the Gemini analysis prompt or ANALYSIS_RESPONSE_SCHEMA, so no cached
# analysis output changed. PROMPT_VERSION is therefore intentionally NOT bumped.
# NOTE (matching-engine round 3 — non-tech skill graph): the taxonomy part of the
# fingerprint was NARROWED from the whole file to only its PROMPT-FEEDING keys
# (`role_families` + `salary_signals` — see _prompt_feeding_taxonomy below). The old
# whole-file hash tripped on every `terms` edit, but the `terms` array feeds the
# analysis prompt only through the deterministic PRE-PASS seeds (detected_skills /
# detected_signals — non-authoritative hints Gemini overrides, and runtime-derived
# from the specific CV so no static pin could ever capture them), plus the transform /
# matching / classification layers — NONE of which is the cached analysis prompt or
# ANALYSIS_RESPONSE_SCHEMA. The ONLY taxonomy DATA embedded verbatim in the prompt is
# the `role_families` description block (via role_family_catalog); `salary_signals` is
# included conservatively as the annotation vocabulary for the signals surfaced to the
# prompt. So authoring skill terms no longer trips this pin (correctly — it cannot
# invalidate a cached analysis), while a change to the prompt-feeding families/signals
# still does. The fingerprint below was re-recorded ONCE for this split; because the
# hashed prompt-feeding content is byte-identical to before, PROMPT_VERSION is NOT
# bumped (no cached analysis output changed).
# NOTE (matching-engine — analyze-emits-honesty-fields): the fingerprint was
# re-recorded when models.py gained JobFitResult's `unproven_skills` /
# `unproven_skill_strength` / `unproven_skill_reason` fields. The whole-module
# Pydantic hash is deliberately conservative, so it trips on these additive OUTPUT
# fields — but they are a DETERMINISTIC post-Gemini cross-check (matching.score_job
# over the JD's detected skills), never read by the Gemini prompt or
# ANALYSIS_RESPONSE_SCHEMA, and they are NULLABLE so a prior cached analysis simply
# lacks them (the analyze report shows no unproven bucket, no wrong result). No
# cached analysis OUTPUT changed, so PROMPT_VERSION is intentionally NOT bumped.
# NOTE (craft-scan 2026-08-20 — soft-signal export): re-recorded when
# SoftSignalPanel.to_interview_checklist stopped tagging every row "RED FLAG" and
# started carrying `detail`. The whole-module Pydantic hash trips on it, but the
# method is a RENDERING of an already-computed panel — no model field, no prompt,
# no ANALYSIS_RESPONSE_SCHEMA entry changed, and the checklist is derived on read
# rather than stored. No cached analysis OUTPUT changed, so PROMPT_VERSION is
# intentionally NOT bumped.
# NOTE (/architect 2026-08-28 — KeywordHit.status made optional): re-recorded when
# `status` on KeywordHit went from a required Literal to `KeywordStatus | None = None`.
# This is a strict WIDENING: every payload valid under the old schema is still valid
# under the new one, so no cached analysis can be invalidated by it — the change only
# stops the schema lying about its own history. `status` was added 2026-06-01, and 50 of
# 121 analyses in the reference DB were written 2026-05-30, two days earlier, with hits
# carrying no status at all; a required enum made every read of those rows a false
# corruption report. keywordCoverage is computed DETERMINISTICALLY in ats.py after the
# model returns — it is not in the Gemini prompt and has no ANALYSIS_RESPONSE_SCHEMA
# entry — so no cached analysis OUTPUT changed and PROMPT_VERSION is intentionally NOT
# bumped. Consumers render the absent state as its own ("not assessed"), never guessing
# a value: guessing "missing" would invent a keyword gap the candidate does not have.
EXPECTED_PROMPT_VERSION = "v5-2026-06-09-lang-cachekey"
EXPECTED_ANALYSIS_FINGERPRINT = "367da913343334a677c49fd85965420a9ab89247752504b18815ad4ab356b327"


def _strip_ts_comments(text: str) -> str:
    # Local copy (kept independent of test_prompt_version_sync so the two files
    # don't couple). Drops // and /* */ comments before the const is extracted.
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    text = re.sub(r"//[^\n]*", "", text)
    return text


def _ts_prompt_version(text: str) -> str:
    match = re.search(r'\bPROMPT_VERSION\s*=\s*["\']([^"\']+)["\']', _strip_ts_comments(text))
    if not match:
        raise AssertionError(f"could not find `PROMPT_VERSION` string literal in {CACHE_KEY_TS}")
    return match.group(1)


# The taxonomy keys whose CONTENT is embedded in / consumed by the analysis prompt.
# `role_families` is the description block role_family_catalog() renders verbatim into
# the prompt; `salary_signals` is the annotation vocabulary for the deterministic
# signals surfaced to it. Deliberately EXCLUDES `terms` (the per-term skill vocabulary
# reaches the prompt only as non-authoritative, CV-derived pre-pass seeds) and the
# transform/matching-only keys (family_degree_terms, adjacent_domain_signals,
# language_aliases, company_*), none of which touch the cached analysis output.
_PROMPT_FEEDING_TAXONOMY_KEYS = ("role_families", "salary_signals")


def _prompt_feeding_taxonomy() -> str:
    """Canonical JSON of the taxonomy subset the analysis prompt actually depends on."""
    taxonomy = json.loads(TAXONOMY_JSON.read_text(encoding="utf-8"))
    subset = {k: taxonomy.get(k) for k in _PROMPT_FEEDING_TAXONOMY_KEYS}
    return json.dumps(subset, sort_keys=True, ensure_ascii=False)


def _analysis_parts() -> list[str]:
    """The exact analysis-affecting sources the cache-key version must track.

    Deliberately conservative: hashing the whole prompt-builder function and the
    whole Pydantic module means an incidental refactor also trips the pin (a cheap
    re-record) — far safer than letting a genuine prompt/schema change slip past.
    """
    return [
        # The response schema the model is instructed to fill (embeds ROLE_FAMILIES,
        # so a taxonomy role-family change flows in here too).
        json.dumps(gemini.ANALYSIS_RESPONSE_SCHEMA, sort_keys=True, ensure_ascii=False),
        # The full analysis prompt template + every scoring/security/credential rule.
        inspect.getsource(gemini.analyze_profile_with_gemini),
        # The Pydantic schema the analysis payload is validated against.
        inspect.getsource(models),
        # ONLY the prompt-feeding taxonomy content (role_families + salary_signals),
        # not the whole file — skill-term authoring must not trip this pin.
        _prompt_feeding_taxonomy(),
    ]


def _hash_parts(parts: list[str]) -> str:
    h = hashlib.sha256()
    for part in parts:
        buf = part.encode("utf-8")
        # Length-frame each part (same anti-collision framing as cache-key.ts) so
        # moving content across a part boundary can't leave the fingerprint stable.
        h.update(len(buf).to_bytes(8, "big"))
        h.update(buf)
    return h.hexdigest()


def _analysis_fingerprint() -> str:
    return _hash_parts(_analysis_parts())


class AnalysisPromptVersionSyncTest(unittest.TestCase):
    def test_prompt_version_pin_matches_cache_key_ts(self) -> None:
        self.assertTrue(CACHE_KEY_TS.exists(), f"missing {CACHE_KEY_TS}")
        live = _ts_prompt_version(CACHE_KEY_TS.read_text(encoding="utf-8"))
        self.assertEqual(
            live,
            EXPECTED_PROMPT_VERSION,
            "cache-key.ts PROMPT_VERSION changed — update EXPECTED_PROMPT_VERSION here "
            "and re-record EXPECTED_ANALYSIS_FINGERPRINT in the same commit.",
        )

    def test_analysis_inputs_match_the_recorded_fingerprint(self) -> None:
        self.assertTrue(TAXONOMY_JSON.exists(), f"missing {TAXONOMY_JSON}")
        actual = _analysis_fingerprint()
        self.assertEqual(
            actual,
            EXPECTED_ANALYSIS_FINGERPRINT,
            "The analysis prompt / Pydantic schema / taxonomy changed but the cache "
            "fingerprint pin did not. This edit invalidates prior cached analyses. "
            "BUMP `PROMPT_VERSION` in app/_lib/cache-key.ts (so stale caches miss), "
            f"then set EXPECTED_ANALYSIS_FINGERPRINT = \"{actual}\" here.",
        )

    def test_fingerprint_is_content_sensitive(self) -> None:
        # Non-vacuity: a single-character change to ANY hashed part must change the
        # fingerprint, so a real prompt/schema/taxonomy drift cannot pass the pin.
        parts = _analysis_parts()
        for idx in range(len(parts)):
            mutated = list(parts)
            mutated[idx] = mutated[idx] + " "
            with self.subTest(part=idx):
                self.assertNotEqual(_hash_parts(parts), _hash_parts(mutated))


if __name__ == "__main__":
    unittest.main()
