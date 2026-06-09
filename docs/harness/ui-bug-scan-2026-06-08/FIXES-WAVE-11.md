# UI+Bug Scan — Fix Wave 11: the deferred tail (campaign close, 83/83)

> 5 findings closed (3 Medium, 2 Low) across 5 atomic commits — the involved/edge items
> deferred in Wave 10. **This closes the entire scan: 83 of 83 findings resolved.**
> Baseline preserved: tsc 0 → 0, next build ✓, unit 638 → 638, lint clean.

## Commits

| # | Commit | Finding | Severity | Files |
|---|---|---|---|---|
| 1 | `02574ff` | Markdown drops nested bold/italic | Low | Markdown.tsx |
| 2 | `80e3310` | unbounded pasted JD/company text → argv E2BIG | Medium | api/analyze/route.ts |
| 3 | `70e0d38` | JD template manager: loading indistinguishable from empty | Low | JdTemplateManager.tsx |
| 4 | `fe4e7b6` | focus lost between non-text apply steps | Medium | ConversationalApply.tsx |
| 5 | `e94df25` | sim reset re-orphans rows mid-run | Medium | SimulationProvider.tsx |

## What was fixed

1. **Markdown nested emphasis** — the `[^*]+` inline regex dropped any bold/italic span containing a `*`. `inline()` now scans left-to-right (bold before italic so `**` wins), uses non-greedy `[\s\S]+?` so spans can contain markers, and recurses into bold/italic content. Still React-element output (no `dangerouslySetInnerHTML`).
2. **pasted-text argv cap** — a multi-MB pasted JD/company blob went into one `--job-description-text` argv element, tripping the OS command-line limit (E2BIG, ~32KB on Windows) with a cryptic spawn error. Above 8 KB the text is now spilled to a workdir file and passed as a path (the same route an uploaded JD file uses); normal JDs stay inline.
3. **template loading state** — `templates` started `[]`, so an in-flight/failed fetch looked identical to "loaded zero". It now starts `null` (skeleton while loading) with an explicit empty note for a genuine zero.
4. **apply step focus** — only the free-text input autoFocused, so on every ko/choice/file step focus dropped to `<body>` and keyboard/SR users tabbed from the top. An effect now focuses the first control of a newly-rendered non-text step once it settles.
5. **sim reset re-orphan** — `reset()` set the stop flag then immediately deleted, but the flag is only honored at await checkpoints, so a mutation already in flight (e.g. `/api/sim/inbound`, which creates rows) could land after the delete and re-orphan rows. `start()` now records the run promise and `reset()` awaits it (the in-flight mutation finishes + the run throws `SimStop`) before deleting.

## Verification (before / after)

| Gate | Baseline | After Wave 11 |
|---|---|---|
| tsc --noEmit | 0 errors | 0 errors |
| next build | ✓ | ✓ (Compiled successfully) |
| test:unit | 638 pass | 638 pass |
| eslint (touched files) | — | clean |

## Final campaign status — COMPLETE

| | Count |
|---|---|
| Findings | 83 |
| **Closed (waves 1–11)** | **83** |
| Open | **0** |

| Severity | Total | Closed |
|---|---|---|
| Critical | 3 | 3 |
| High | 27 | 27 |
| Medium | 41 | 41 |
| Low | 12 | 12 |

Every finding from the combined Bug Hunter + UI Perfectionist scan is resolved. Baseline preserved across all 11 waves (tsc 0, next build ✓, unit 638, lint clean). The only outstanding lint note is the **pre-existing** InterviewPrepModal hydration effect (`set-state-in-effect`, lines ~64-67), which predates the scan and was never in its scope.
