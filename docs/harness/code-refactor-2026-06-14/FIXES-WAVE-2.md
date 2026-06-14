# Code Refactor — Fix Wave 2: Python CLI stdio consolidation

> 2 atomic commits, 2 findings closed (Theme B). 10 CLIs routed through the shared `configure_stdio()` helper.
> Baseline preserved: python 596 → 596 OK (4 skip). 0 false positives.

## Commits

| # | Commit | Finding | CLIs |
|---|---|---|---|
| 1 | `6679bd4` | scoring-extraction #1 | `cli.py`, `extract_cli.py` (strict), `market_salary_cli.py` (replace) |
| 2 | `eb6865e` | dev-case-python #1 | `devcase_cli.py` (strict); `lifecycle_eval.py`, `submission_eval.py`, `automation_eval.py`, `matching_eval.py`, `runner.py`, `seed_cv_fixtures.py` (replace) |

## What was fixed

A `configure_stdio()` helper exists in `pipeline/jobfit/_cli.py` to centralize the UTF-8 stdout/stderr reconfigure (guards Czech-diacritic mangling on Windows / cp1250), but ~10 CLIs hand-rolled the block — with live drift: several reconfigured stdout only (leaving stderr at the OS default), and several omitted `errors="replace"`.

**Helper enhancement (behavior-preserving):** `configure_stdio()` reconfigured both streams but had no `errors=` param. Added `errors: str = "strict"` so the 7 `errors="replace"` callers keep their policy without downgrading anyone. The four eval CLIs that previously reconfigured stdout-only now also reconfigure stderr — the report explicitly flagged stdout-only as drift and endorsed this safe superset (adds correct UTF-8 to a stream previously left at OS default; cannot regress).

## Verification

| Gate | Before | After |
|---|---|---|
| python (unittest) | 596 OK (4 skip) | 596 OK (4 skip) |
| import-smoke (10 CLIs + helper) | — | all IMPORT OK |

(The eval/devcase CLIs aren't all unittest-covered, so each was byte-compiled + import-smoke-tested in addition to the suite.)

## Patterns established (catalogue item 3)

3. **A "use the shared helper" finding must check the helper is a true superset before swapping** — here the canonical `configure_stdio()` was missing the `errors="replace"` capability some callers had. The fix was to widen the helper (add an optional param, safe default) rather than downgrade the callers. Consolidation that silently drops a caller's stricter behavior is a regression in disguise.

## What remains

Out-of-scope: ~14 other hand-rolled stdio copies exist elsewhere in the repo (outside the two scanned contexts) — left for a future repo-wide pass. Waves 3–9 per INDEX.md.
