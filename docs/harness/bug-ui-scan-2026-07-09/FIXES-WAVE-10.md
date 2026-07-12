# Fix Wave 10 — Candidate flows & bug-hunter UI (7 Highs)

> 6 commits (`f331436`, `c83135f`, `5f45bc9`, `b73a497`, `49e8322`, `c168efb`), **7 Highs closed**.
> Baseline preserved: tsc 0 · node unit 1504 → **1530** · python 878 OK · i18n 3239 → **3240** × 4 · `next build` ✓.

## Commits

| Commit | Finding(s) | Fix |
|---|---|---|
| `f331436` | application-intake #1 | Namespace the apply-draft by (jobId, leadToken) + a pure merge where the enrichment KO answers win — a returning lead is no longer wrongly declined. |
| `c83135f` | candidate-onboarding #1, #2 | Both hand-off paths gate on one shared `isEntryHired`; a `cancelRun` revoke purges the run's PII. |
| `5f45bc9` | cv-analysis-workspace #1 | A pure `deriveCollapseDecision` treats a CV error as "not a result", so the error surfaces even when a GitHub run succeeded. |
| `b73a497` | shared-ui #1 | An open `Select` stops Escape/Enter propagation so it doesn't also close/submit the parent dialog. |
| `49e8322` | plans-checkout #2 | The checkout banner is bound to real billing state, not a 5.5 s timer — no false "your plan is now X". |
| `c168efb` | architecture-diagrams #1 | `outputFileTracingIncludes` + Dockerfile copy ship the `.puml` sources into the standalone build. |

## Process note — two stalled agents, finished by hand

Two of the five dispatched agents stalled mid-edit (a stream watchdog, not a usage limit or a
connection drop). One (Select + checkout-banner) had made **zero** edits — its findings were
untouched. The other (onboarding) had written coherent source (`isEntryHired` shared gate,
`cancelRun` purge) but stalled before wiring `cancelRun` into a handler and before any test.

Rather than resume wedged agents, all four affected findings were finished by hand: the
onboarding revoke handler was wired and a real-DB test added; the Select `stopPropagation`
and the checkout-banner state-binding were implemented from scratch. Each was verified
non-vacuous the same way an agent would (invert the fix, watch the test go red). Pattern 19
(triage a stalled agent's partial edits; never inherit them blind) held: the onboarding source
was sound and kept, but its missing wiring + test were the gap that a "looks done" glance would
have shipped.

Two of these fixes hit the `.tsx`-can't-be-unit-tested wall: the bare `node --test` runner strips
`.ts` types but cannot load JSX, so the Select propagation predicate and the checkout-banner
decision were each extracted into a pure `.ts` sibling to make them testable.

## Verification

| Gate | Before | After |
|---|---|---|
| tsc | 0 | 0 |
| node unit | 1504 | **1530** |
| python | 878 OK | 878 OK |
| i18n | 3239 × 4 | 3240 × 4 |
| `next build` | ✓ | ✓ |

## Patterns (catalogue item 28)

28. **A UI fix is only testable if its decision is pure and lives in a `.ts` file.** The bare
    `node --test` runner can't load a `.tsx`. Extract the load-bearing decision (which keys to
    swallow, whether to claim a plan, whether to collapse) into a `.ts` module the component
    imports — the component stays thin, the decision gets a non-vacuous test.

## What remains

Highs: **62 of 66 closed**, **4 open** — all `ui-perfectionist` presentational/a11y items:
app-shell mobile-drawer a11y, branding accent contrast, the landing `/market` choropleth +
mobile topbar, the failed-re-rank ranking wipe, the Jobs-table stale-status refresh, and the
pipeline-board drag keyboard alternative. (Counted as 4 report-slots; some bundle two findings.)
