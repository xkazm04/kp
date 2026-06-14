# Code Refactor — Fix Wave 5: Constants & error envelopes

> 7 atomic commits, 7 findings closed + 1 correctly skipped (Theme E).
> Baseline preserved: tsc 0 → 0 · unit 849 → 849 · python 596 OK. 0 false positives.

## Commits

| # | Commit | Finding | What |
|---|---|---|---|
| 1 | `ecdb4f8` | demo-sim #2 | 5 `/api/sim/*` routes routed through canonical `jsonError` (preserving status + business messages) |
| 2 | `1b54397` | demo-sim #4 | sim `offer-draft` inline salary sanitization → `normalizeSalaryBand(...) ?? [120000,165000]` |
| 3 | `418b489` | matching #2 | `MATRIX_BANDS` table in import-free `matrix-stats.ts`; `cellClass`/`BAND_FILL`/legend/`STRONG_THRESHOLD`/`BAND_EDGES` all derive from it |
| 4 | `57d223e` | matching #4 | `formatBandCompact()` in `MatchTypes.ts`, used by MatchCard + JobCompare |
| 5 | `ee8e3fc` | job-catalog #3 | `MIN_AD_CHARS` exported from `split-ads.ts`; route's bare `30` replaced |
| 6 | `8ef0ad2` | interview-prep #3 | `MAX_ENTRY_ID_LEN` hoisted into `entries-param.ts`, used by both prep routes |
| 7 | `a138314` | automation #4 | dropped the dead `outreach` key from `DRAFT_EVENT` (outreach has its own branch / `outreach_sent`) + guard comment |

## Decisions of note

- **Error helper standardization (#1)**: chose **`jsonError`** over `safeJsonError` — the sim routes return raw business messages, not SQLite/store internals; `safeJsonError` is correctly reserved for store-backed comms siblings.
- **`MATRIX_BANDS` home (#3)**: the import-free, node-test-covered `matrix-stats.ts` (it already owned `BAND_EDGES`). It stays import-free; the `.tsx` consumers import the table (tsx imports freely). A re-band now changes cell colors AND the legend together.
- **`automation #4`**: only the minimal safe change (drop a dead map key + comment). `AUTOMATION_VERSION` left as-is — no clean single-source derivation, and restructuring the version map would be risky for no clear win.

## Skipped (with reason)

- **`candidate-profile-builder #2` (education vocabulary)** — within TS there is exactly ONE `EDU_LEVELS` array (`ProfileTypes.ts:88`, single consumer). The other copies are cross-language (Python `_EDU_LEVELS`/`gemini.py`/`DRAFT_SCHEMA`) or generated (`schemas.generated.ts`) — out of scope for a same-language TS consolidation, and merging across the TS↔Python boundary isn't possible. The cross-language vocabulary remains drift-tested. No safe TS-only fix exists.

## Verification

| Gate | Before | After |
|---|---|---|
| tsc --noEmit | 0 | 0 |
| unit (node --test) | 849 | 849 / 0 fail |
| python (unittest) | 596 OK | 596 OK (4 skip) |

(A pre-existing flaky test `billing-gate.test.ts` failed once on a full-suite run during the wave but passes on every clean re-run — NOT introduced here.)

## What remains

Waves 6–9 per INDEX.md.
