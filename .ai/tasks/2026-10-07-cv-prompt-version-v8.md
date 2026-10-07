# CV analysis: bump PROMPT_VERSION to v8

Date: 2026-10-07 · Charter: accepted-idea-delivery · Feature: cv-analysis-pipeline

Meets the must-address of cv-analysis-pipeline full r2 (head b48a0f25): "Cached analyses stored before the span's change are served unchecked: PROMPT_VERSION was not bumped".

## Reconcile

On main `41e9b3e93` PROMPT_VERSION was `v7-2026-09-23-trust-findings`. No v8 existed.

## Why

`8c424ff41` checks strengths and the explanation against the CV and codes an unverified skill. An analysis cached before it carries none of this, and `lookupPromptCache` serves it for up to `KP_CACHE_TTL_HOURS` (default 24, `app/_lib/cache.ts`) because the key did not change. The fingerprint pin in `test_analysis_prompt_version_sync.py` did not trip, because it does not hash `pipeline.py`, so nothing forced the bump.

## Change

- `app/_lib/cache-key.ts`: `PROMPT_VERSION = "v8-2026-10-07-checked-strengths"` with a v8 comment.
- `app/_lib/cache-key.test.ts`: the version test expects a `v8-` prefix and is named for this bump.
- `pipeline/jobfit/tests/test_analysis_prompt_version_sync.py`: `EXPECTED_PROMPT_VERSION` moved with a NOTE. `EXPECTED_ANALYSIS_FINGERPRINT` is unchanged and the test passes against it.

## Cost

Every analysis cached before this lands misses once and is recomputed (a one-time re-spend, bounded by the 24-hour TTL anyway).

## Known gap

The fingerprint does not cover `pipeline.py`, so the next change there will again not force a bump. Not addressed here (out of the declared paths).
