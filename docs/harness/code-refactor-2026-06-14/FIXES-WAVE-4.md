# Code Refactor — Fix Wave 4: Spawn/store envelope extraction

> 3 atomic commits, 4 findings closed (Theme D — the highest structural value). Shared helpers extracted from copy-pasted scaffolding.
> Baseline preserved: tsc 0 → 0 · unit 849 → 849 · python 596 → 596 OK. 0 false positives.

## Commits

| # | Commit | Finding(s) | Consolidation |
|---|---|---|---|
| 1 | `bb719c5` | dev-case-orch #1 (**High**) | `runDevcaseCli<T>()` — collapsed **9** `run*`/`mint*` copies of the devcase-CLI workdir/spawn/exit-check/parse/cleanup envelope into one helper |
| 2 | `2cc3b33` | job-catalog #1 (**High**) | `rankPoolForJob()` (new `recruiter-run.ts`) — collapsed the `recruiter_cli` ranking-spawn boilerplate across **all 4** call sites (candidates route, rediscover, automation-pass, group-eval) |
| 3 | `306a7e7` | data-layer #3 + dev-case-orch #5 | `openStore()` in `db-path.ts` — collapsed the isolated-connection bootstrap (`new Database`+WAL+busy_timeout+memoize) across **12 of 15** stores |

## What was fixed

The three biggest structural wins in the scan:
- **`runDevcaseCli`**: each of the 9 functions kept its exact verb/flags/input via a builder callback (file→flag naming is irregular, e.g. `cands.json`→`--candidates-json`). It also **uniformized signal forwarding** — the report flagged it as inconsistent across the 9; the helper now forwards `signal` to `spawnPython` uniformly. The 5 functions that accepted a `signal` still pass it; the 4 that never did keep their public signature (pass `undefined`) — no caller change, no cancellation-contract change.
- **`rankPoolForJob`**: each site keeps its distinct flags (`weightsLlm`/`embeddings`, nullable `job`) and result-mapping; the helper throws `PipelineError` on non-zero exit so the candidates route still surfaces the CLI status (not a blanket 500).
- **`openStore`**: covered the 12 stores with exact `WAL + busy_timeout=5000` semantics (incl. `db/core.ts`, `db-portability.openForLoad`, `dev-control`, `dev-outcomes`). **Left 3 alone** — `decision-config-store`, `templates-store`, `job-ingest` set WAL **only** (no busy_timeout); adopting `openStore` would change their locking semantics. Correct exclusion per the safety rule.

## Verification

| Gate | Before | After |
|---|---|---|
| tsc --noEmit | 0 | 0 |
| unit (node --test) | 849 | 849 / 0 fail |
| python (unittest) | 596 OK | 596 OK (4 skip) |

## Patterns established (catalogue items 5–6)

5. **Collapse a repeated spawn/IO envelope with a generic helper + a per-call builder callback** — when N call sites share the workdir/spawn/parse/cleanup shell but differ in flags and result-mapping, a `run<X>Cli<T>(buildArgs, parse)` helper removes the shell once and makes cross-cutting fixes (here: uniform signal forwarding) land everywhere at once.
6. **When consolidating a per-store/per-connection bootstrap, exclude any instance with different pragmas/lifecycle** — verbatim-identical copies fold safely into a shared opener; a store that sets WAL-only (vs WAL+busy_timeout) must keep its own bootstrap, or you silently change its locking behavior.

## What remains

Waves 5–9 per INDEX.md. Note: `data-layer #4` (split the 1098-line `core.ts` god-module) is intentionally NOT in this wave — the agent flagged it lower-confidence due to boot-ordering coupling; it will be deferred-with-reason rather than forced.
