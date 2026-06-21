# High Fix Wave 2 — missing UI states (loading / empty / error / CLS)

> 8 findings across 7 surfaces closed in 3 commits, one mental model: *a surface that's
> loading, filtered-to-empty, or genuinely empty must SAY so — not show a bare line, a
> blank card, or a grid over no rows.* Reuses the shared `Skeleton` / `SkelBar` /
> `ChainEmptyState` primitives.
> Baseline preserved: tsc **0**, `next build` ✓, unit **1019/1019**, i18n parity (2824 keys).

## Commits

| Commit | Surfaces | Fix |
|---|---|---|
| `150043a` | offers, screening-decisions, sourcing (×2) | Replaced bare "Loading…"/spinner lines with shape-reserving skeletons + `aria-busy`: the public **offer page** (high-stakes first paint, was a CLS reflow), the **Decisions** queue (card-grid skeleton), and the **Campaign** + **Rediscover** panels (multi-second LLM/CLI calls that showed one ellipsis). |
| `fe0476b` | jd-authoring | **JdBody** rendered a blank white card (and copied `""` with a success check) for an empty/edited-to-empty JD on the public shareable page — now an explicit "no description yet" placeholder, copy hidden when there's nothing to copy. |
| `a2e45b2` | skill-matrix (×2), candidate-profile | **MatrixTab**: the empty gate checked the raw dataset, so a min-fit/family filter that hid everyone rendered sticky headers over a blank tbody — added a recoverable "no matches → Clear filters" state + a compute skeleton. **MatchTab**: the candidate `<select>` showed "No saved profiles/analyses" during the in-flight fetch — now a disabled `aria-busy` "Loading…" until both option fetches settle. |

## Why these grouped this way
Commit `a2e45b2` bundles MatrixTab + MatchTab because both add keys to the shared
`messages/{en,cs}.json` (the i18n-parity CI gate + `Messages = typeof en` TS gate require
keys to land with their consumers, and the two key-sets can't be split across commits at
file granularity). The other five surfaces needed no new strings (reused `common.loading`,
`jobs.campaign.generating`, `jobs.rediscover.scanning`, or hardcoded-English JdBody) and
stayed grouped by theme.

## Pattern catalogue additions
12. **A loading state is not an empty state.** `list.length === 0` before a fetch resolves
    renders the "nothing here" copy over an in-flight request — gate on a `loaded` flag.
13. **Filter the empty-check on what's RENDERED, not the raw dataset.** A grid whose rows
    are post-filtered must check the filtered length, or strict filters paint a blank body.
14. **Reserve the loaded shape while loading.** A skeleton sized like the real content
    removes the layout shift a bare one-line "Loading…" causes on arrival (CLS).
15. **Empty content needs an explicit placeholder, even on read-only public pages** — a
    blank card reads as broken; and don't offer a copy/share affordance for empty content.

## What remains in this theme
The cluster had ~30 candidates; W1 + W2 took the highest-leverage 14. Still open (their own
waves): CV-add async hashing has no pending state / double-fires (`useAnalyzeForm`),
DevTab/CaseDetail Publish has no in-flight guard (double-submit), TasksTab cancel has no
confirm/pending, analytics Calibration/DecisionRecords error states lack a retry, and the
voice-interview "ending" phase has no spinner — plus the a11y cluster (~25, separate wave).
