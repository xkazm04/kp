# Code Refactor — Fix Wave 6: i18n label helpers + small type/structure dedup

> 10 atomic commits, 9 findings closed (+1 follow-up extension) (Theme F + small dedup).
> Baseline preserved: tsc 0 → 0 · unit 849 → 849 · python 596 OK. 0 false positives.

## Commits

| # | Commit | Finding | What |
|---|---|---|---|
| 1 | `98ed9d0` | workspace-shell #1 | `navLabel(t, key, fallback)` in `tabs.ts`; both sidebars + palette + shortcuts overlay call it |
| 2 | `87b5e42` | analytics #2 | `kindLabel(t, kind)` in `decision-attribution.ts` (de-snakes unmapped kinds); fixed 3 divergent fallbacks incl. RoiLedger's no-fallback |
| 3 | `0f8553c` | analytics #3 | `labelOr(t, key, fallback)` next to `useEnumLabel`; folded `sourceLabel`/`channelName` |
| 4 | `e1d1f74` | decisions #4 | local reasoning adapter → `Partial<MatchTypes.Reasoning>` (canonical confirmed = MatchTypes) |
| 5 | `e40ba9b` | profile #4 | dropped `export` on `Slot`/`SLOTS`/`SCORING_MODELS`/`EDITABLE_FIELDS`/`readRegistry` (grep-confirmed zero importers); kept tested `validateArchetype` |
| 6 | `d41eae4` (+`bbeac39`) | profile #5 | merged duplicate `splitList` into one `split-list.ts` with a `{ newlines }` option preserving each site's behavior |
| 7 | `37f5a22` | jd-library #1 | `jdJobId(slug)` in `jd-limits.ts`; replaced all 10 `jd-<slug>` interpolations (8 in-scope + 2 opportunistic) |
| 8 | `1e4d727` | jd-library #3 | one pure `marketSalaryLabel` in `salary-band.ts` used by client + server JD bodies |
| 9 | `e2676cd` | billing #4 | added `BillingConfigError` to `index.ts`; repointed 3 deep imports to the barrel |

## What was fixed

The i18n cluster (#1–#3) removed three copies of the `t.has(key) ? t(key) : english` has-fallback idiom that had already drifted (RoiLedger had no fallback at all). The structural cluster single-sourced a load-bearing JD↔Job identity string (`jd-<slug>` hand-built in 10 places — a contract that must not drift), reduced an over-broad export surface, and fixed a barrel contract that was being bypassed because the error class wasn't even exported from the index.

## Verification

| Gate | Before | After |
|---|---|---|
| tsc --noEmit | 0 | 0 |
| unit (node --test) | 849 | 849 / 0 fail |
| python (unittest) | 596 OK | 596 OK (4 skip) |

## Patterns established (catalogue items 7–8)

7. **A has-fallback i18n idiom copy-pasted is a drift channel like any other** — extract `label(t, key, fallback)` once; the copies had already diverged (one dropped the fallback). One helper makes the fallback policy uniform.
8. **`node --test` needs the explicit `.ts` extension on relative imports** — when consolidating a helper, updating a caller's import to the new module must keep the `.ts` suffix, or a bare-`node --test` colocated suite silently fails to load (caught + fixed in `bbeac39`). Re-run the unit suite after any import rewrite.

## What remains

Waves 7–9 per INDEX.md (UI component extraction, fetch/persist wiring, cleanup tail). The remaining themes are larger, so the fix phase will run a few more waves than the original 9 theme-buckets.
