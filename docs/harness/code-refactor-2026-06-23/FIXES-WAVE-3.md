# Code Refactor — Fix Wave 3 — Safe dead-code deletion

> 9 atomic commits, 8 High findings closed (1 scoped down to its safe subset; 1 broader removal deferred).
> Baseline preserved: tsc 0 → 0 · JS tests 1019 → 1018 (−1 = the removed dead `isDeadLettered` test) · Python (taxonomy/llm/seed) 147/147 · 0 regressions.

Zero-consumer exports, unreachable branches, and a footgun entry point — verified with repo-wide grep before each delete.

## Commits

| # | Commit | Finding | Files |
|---|---|---|---|
| 1 | `4c9b65a` | hiring-automation #2 | approval-kinds.ts |
| 2 | `6e8ff13` | llm-provider #1 | llm/base.py, anthropic_api.py, openai_api.py |
| 3 | `704f580` | matching-engine #1 | taxonomy.py, test_taxonomy_graph.py |
| 4 | `6572f51` | pipeline-test #1 | tests/_helpers.py |
| 5 | `eaf35d2` | candidate-profile #1 | ProfileEditor.tsx, en.json, cs.json |
| 6 | `69d113a` | communications #1 | comms-status.ts, comms-status.test.ts |
| 7 | `b0536a6` | dev-submissions #1 | DevTypes.ts, page.tsx, LiveWorkSurface.tsx, SeedFiles.tsx (del) |
| 8 | `1608e01` | dev-submissions #2 | api/devcase/seed/[id]/route.ts (del) |
| 9 | `b4d510f` | eval-seed #1 (scoped) | seed_jobs.py |

## What was fixed

1. **APPROVAL_KIND_META** documentation registry (~50 lines) — zero readers; kept the live union + `needsHumanDecision`.
2. **LLMResult.raw** — written by 2/4 adapters, read by none; removed field + both writers.
3. **Taxonomy descendant graph** — `descendants()`/`_DESCENDANTS`/`_CHILDREN`/`_CHILD_EDGES` were test-only; removed (the scorer uses only `_ANCESTORS`).
4. **mk_candidate** test factory — zero callers (deleted; suite-wide adoption deferred).
5. **"duplicate" editor mode** — unreachable; narrowed `EditorMode` + dropped the `headingDuplicate` key (en/cs).
6. **isDeadLettered** — dead helper; every reader hand-rolls `status === "failed"`.
7. **SeedFiles component** — never rendered; moved its `SeedFile` type to DevTypes, repointed imports, pruned 3 orphan i18n keys.
8. **/api/devcase/seed/[id]** — dead, unauthenticated GET exposing seed contents; deleted.
9. **seed_jobs generic `main`** — removed the documented `python -m … seed_jobs` entry point that silently overwrote the ČS corpus.

## Scoped down / deferred (with reason)

- **eval-seed #1 (partial):** the finding wanted `build_specs`/`spec_to_prompt`/`_SYSTEM`/the constants deleted too, but those are **live default fallbacks** of the shared `generate()`/`_gen_one` (the generic profile used when no company override is passed; CSAS overrides them). Removing them needs a core-signature refactor (make `prompt_fn`/`specs` required) — out of scope for a *safe-deletion* wave. The actual hazard (the corpus-overwrite entry point) is gone; the rest is deferred.
- **privacy-consent-provenance #1 (deferred in Wave 2):** never-emitted GDPR `ConsentEventKind` values — a prune-vs-wire compliance decision, not a mechanical deletion.

## Patterns established (catalogue items 8–10)

8. **"Test-only" ≠ deletable blindly — but often is.** A symbol referenced only by its own test (descendant graph, mk_candidate, isDeadLettered's test) is dead *product* code; delete the symbol AND its pinning test together so the suite doesn't lie about coverage.
9. **A default-arg reference keeps a "dead" symbol alive.** Before deleting a function the scan calls dead, grep for it as a *default parameter value* / fallback expression (`prompt_fn=spec_to_prompt`, `x or spec_to_prompt`) — a NameError at import is the tell. Scope the deletion to what's truly unreferenced.
10. **Deleting a route invalidates `.next` generated validators.** After removing an API route, `.next/types/validator.ts` + `.next/dev/types/validator.ts` still import it → 2 stale tsc errors. They're gitignored build artifacts that regenerate; clear them (or rebuild) to get an honest tsc gate — the source is clean.
