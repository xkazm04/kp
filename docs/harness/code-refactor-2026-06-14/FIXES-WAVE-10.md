# Code Refactor — Fix Wave 10: Cleanup tail (final)

> 10 atomic commits, 10 findings closed, 2 skipped-with-reason (TS stale-comment/over-export + Python adapter/helper dedups).
> Baseline preserved: tsc 0 → 0 · unit 849 → 849 (stable) · python 596 → 596 OK (4 skip). 0 false positives.

## Commits

| Commit | Finding | What |
|---|---|---|
| `19836dc` | llm-settings #2 | `KEYABLE_PROVIDERS`/`isKeyableProvider` — `claude_cli`-not-keyable rule derived from one place (was 4 hand-coded sites) |
| `c9d3bbc` | llm-settings #3 | dropped surplus `export` on `KP_LLM_CONFIG_ENV` (0 external consumers) |
| `66e9f67` | llm-settings #4 | corrected stale "ships in parallel / 404" Test-button comment (kept defensive branch) |
| `f96ae16` | voice #4 | fixed `scripts/interview.py` `--bucket` docstring + help to real buckets |
| `480a5d0` | workspace-shell #2 | hoisted `KBD` chip class to `recipes.ts` (was repeated 5×) |
| `c0c6a84` | dev-case-py #2 | extracted `provenance.str_list`, imported into 4 devcase modules |
| `d7c1738` | dev-case-py #3 | `provenance.collect_fallback_reasons(...)` — CLI + both eval harnesses delegate |
| `cdd6cf8` | llm-provider #1 | hoisted adapter `available()`/`_resolved_key()` into `TextProvider` base via `_env_keys` + `_import_sdk` (Azure override kept; `_load_env` dispatches via adapter module so per-adapter test patches still bite) |
| `6c1b682` | llm-provider #3 | deduped bench invocation-example docstring (lives only in `bench_cli.py`) |
| `a99b747` | scoring #2 | single-sourced the letter-spacing regex (`_LETTER` + `count_letter_spacing`); verified byte-identical output |

## Skipped (with reason — verify-before-fix outcomes)

- **analysis #4 (console.error → logger)** — `app/_lib/logger.ts` is a domain-specific structured-event logger (typed entries → dedicated `.log` files, no generic error method, uses `console.error` itself). `console.error` is the established convention across 11+ route files. No generic logging convention exists to migrate to → leave the well-commented intentional server logs.
- **automation #3 (`--strengths-json`)** — documented in the canonical CLI invocation table of `docs/AUTOMATION_SPEC.md:171` as part of `outreach`'s signature; a deliberate documented CLI surface, not dead. (The finding itself rated removal "borderline because documented.")

## Notable safety check

- **llm-provider #1** (provider base-class refactor) was a real test-break risk: `_load_env` must dispatch through each adapter's own module so the per-adapter `load_local_env` test patches still apply (`.env` carries `OPENAI_API_KEY` and the SDK is installed, so a naive hoist would have made `available()` return true and broken the gating tests). Verified python 596 OK after.

## Verification

| Gate | Before | After |
|---|---|---|
| tsc --noEmit | 0 | 0 |
| unit (node --test) | 849 | 849 / 0 fail (stable; see flake note in FIXES-WAVE-9) |
| python (unittest) | 596 OK | 596 OK (4 skip) |

## Patterns established (catalogue item 11)

11. **Hoisting per-adapter logic into a base class must preserve the per-adapter test seam.** When several provider adapters share `available()`/key-resolution, factoring it up is safe only if the base dispatches env/SDK lookups *through the concrete adapter's module* — otherwise per-adapter monkeypatch test fixtures stop biting and the gating tests silently pass for the wrong reason. Run the suite that patches each adapter after the hoist.
