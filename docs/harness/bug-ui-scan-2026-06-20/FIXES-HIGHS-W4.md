# High Fix Wave 4 — backend silent-failure (Python + Node API/DB)

> 4 findings closed in 4 commits, all **outside the in-progress LLM-metering layer**
> (`pipeline/jobfit/llm/*` left untouched). Theme: *a backend path that swallows a failure,
> miscomputes from bad input, or leaks a resource must surface/guard it.*
> Baseline preserved: tsc **0**, `next build` ✓, unit **1019/1019**, Python devcase **15→18**
> (3 new NaN tests), i18n parity (2824 keys).

## Commits

| Commit | Finding | Fix |
|---|---|---|
| `8277d25` | data-store | The **second ALTER-TABLE loop** in `db/core.ts` used a bare `catch {}`, swallowing corruption/I-O/lock errors and booting a structurally-broken DB. Routed it through the existing `migrateExec` (tolerates only "already applied", re-throws the rest loudly). |
| `0206b7f` | dev-case-pipeline | The score clamps did `max(0, min(1, float(v)))`, but **NaN slips past min/max** (`min(1.0, nan)` → 1.0), so an LLM emitting `NaN` silently maxed confidence/fluency and `timeboxHours` became "~nanh". Added `math.isfinite` guards in `reflect.py`/`analyze.py`/`design.py` → fall back to the deterministic baseline. + NaN/inf tests. |
| `a4611d5` | pipeline-clis | `/api/match`, `/api/profile`, `/api/matrix` spawned Python with **no abort signal**, so an abandoned request orphaned the child to the 600s backstop and skipped `finally→cleanupWorkdir` (temp-dir leak). Threaded `request.signal` into all three (matrix's `GET()` now takes the request). |
| `48306e7` | github-evidence | `githubCacheKey` embedded the **raw, un-normalized JD**, so a trivial variation produced a fresh key and turned each miss into ~31 GitHub calls + a paid Gemini call. The JD is now case/whitespace-folded + length-capped for the KEY only (analysis still uses the raw JD). |

## Deliberately deferred (with reasons)
- **`parsePythonJson` "returns the last JSON object"** — this is a *documented, deliberate*
  design ("robust to trailing chatter"); the finding's trailing-structured-JSON-log
  scenario is hypothetical for the current CLIs, and changing the scan direction risks the
  behavior it was built for. Not worth the regression risk here.
- **`_extract_pdf` per-page swallow** — surfacing "N pages were empty" needs a return-type
  change plumbed into `pipeline.py`'s degrade path; too broad for this wave.
- **`anonymizeProfile` workspace-pinned silent no-op** — latent under the single-tenant
  lock; a clean fail-closed fix needs a cross-workspace existence probe that fights the
  profiles-tenancy guard. Better as a dedicated fix when `KP_MULTI_WORKSPACE` lands.
- **LLM-layer double-billing / timeout-budget Highs** — in the user's uncommitted-then-
  committed metering WIP (`llm/base.py`, adapters, monitor). Left untouched to avoid
  colliding with active work.

## Pattern catalogue additions
19. **A NaN is a valid float that defeats `min`/`max` clamps** — guard with `math.isfinite`
    (or `Number.isFinite`) before clamping numeric input parsed from an LLM/external source.
20. **A reusable loud-fail migrator must be used everywhere** — one bare `catch {}` loop
    beside it silently reintroduces the boot-a-broken-DB bug it was written to prevent.
21. **Forward the request abort signal to every subprocess spawn** — without it an
    abandoned request orphans the child and skips cleanup (temp-dir / process leak).
22. **Normalize cache keys built from free text** — an un-normalized key turns a cache into
    a cost amplifier (each trivial variation = a full expensive recompute).

## What remains in this theme
Backend silent-failure still has open items (their own waves): comms inbound
`received_count` retry inflation + per-process resend dedup (needs a shared store), the
LLM-layer double-billing (in WIP), `_extract_pdf` partial-extraction surfacing, and the
fairness-metric green-theater probes (scoring-correctness, Python).
