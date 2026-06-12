# Biz+UI Fix Wave 5 — Honest evidence (dev-case integrity + GitHub→decisions)

> 5 commits, **6 findings closed** (5 High + 1 Medium — studio #1 and orchestration #5 shared the outcome-store root).
> Executed out of INDEX order (user picked Wave 5 before Wave 4). Baseline preserved: tsc 0 → 0, unit 729 → 751 (+22 new), python 523 → 537 OK (+14 new), `next build` ✓, i18n parity 1886 keys.
> Same subagent process as Wave 3: four parallel agents on disjoint file sets + one staggered (db.ts/messages owner); orchestrator verified gates and committed scopes.

## Commits

| # | Commit | Findings closed | Severity | Scope |
|---|--------|-----------------|----------|-------|
| 1 | `992b211` | dev-case-python-engine #2 | High | live_case.py (+5 tests) |
| 2 | `97bcd09` | dev-case-python-engine #1 | High | seed_materializer, interview_scenario, devcase_cli, orchestrator, CaseDetail (+3 tests) |
| 3 | `1312058` | dev-case-studio-ui #1 + dev-case-orchestration-api #5 | High + Medium | dev-outcomes(+8 tests), postings GET, SubmissionRow, control room |
| 4 | `022b8a0` | github-code-analysis #1 | High | automation-run, automation-cache-key(+test), automation.py/_cli (+6 tests) |
| 5 | `089236b` | github-code-analysis #2 | High | apply script + intake, db.ts (github_handle), drawer deep-dive, set_github action (+13 tests) |

## What was fixed (grouped by sub-pattern)

1. **The honesty contract got its missing consumers** (`992b211`, `97bcd09`) — the dev-case engine's provenance machinery (propagated confidence, generate_with_fallback, FALLBACK_REASON_KEY) existed but the two highest-stakes paths ignored it. Observed-skill minting (taxonomy weight 1.0, "earned, not inferred") now refuses below the LOW_CONFIDENCE threshold like its interview sibling, never credits gap-listed must-haves, and credits nothing when no transfer actually matched — killing the `matched or musts` fallback that handed a degraded-provider evaluation every role must-have. And the two generation steps that bypassed the provenance contract (seed materializer, interview scenario) now run through it: degraded output is logged, enveloped, audited distinctly (`seed_skeleton_only`) and badged amber in CaseDetail instead of shipping prose-only seeds to candidates as green.

2. **The calibration loop's inputs stopped corrupting** (`1312058`) — recorded outcomes are server truth on the submission row (postings GET joins the latest outcome by ref), `recordOutcome` upserts instead of blind-INSERTing, and the control room enriches existing auto-recorded rows ("add perf") instead of re-entering them — closing both the re-record-on-remount and the manual-beside-auto double-count that biased `suggestedFloor`.

3. **The repo-signal differentiator became decisive** (`022b8a0`, `089236b`) — the AI screen/prep/scorecard prompts now carry the compact "Public repo evidence" block from the same entry row they always read (with a cache-key axis so refreshed evidence invalidates), and inbound applicants can finally HAVE evidence: an optional GitHub step at apply (validated, normalized, fill-only column) plus a drawer "Run GitHub deep-dive" affordance writing through a new `set_github` pipeline action. Before: the screening gate judged dev candidates on self-reported claims while corroboration sat unused two cards above.

## Verification table

| Gate | Before wave | After wave |
|------|------------|-----------|
| tsc --noEmit | 0 errors | 0 errors |
| node --test unit | 729/729 | 751/751 (+22) |
| python unittest | 523 OK | 537 OK (+14), 4 skipped |
| next build | ✓ | ✓ |
| i18n parity | 1879 keys | 1886 keys (en=cs) |

## Cumulative status (scan 2026-06-12)

**25 / 108 findings closed (19 / 32 Highs)** across waves 1, 2, 3, 5 — 26 fix commits, 0 regressions throughout.

## Patterns established (catalogue additions, items 38–41)

38. **A trust contract needs a consumer audit** — when a module exports confidence/provenance vocabulary, grep WHO reads it at decision points; machinery with zero consumers at the highest-stakes site is worse than none (it reads as covered). The interview path's guard was the template the take-home path never copied.
39. **`x or everything` is never an honest fallback** — a credit/match helper that defaults to the full set when matching fails fabricates evidence; default to NOTHING and return a reason.
40. **Optimistic UI needs a server-truth seed** — any "recorded ✓" pill must hydrate from the persisted row (joined into the list GET), with local state only as the optimistic layer for the click that just landed; component-local success state re-offers the action after every remount.
41. **Evidence belongs in the prompt AND the cache key** — feeding new context into an LLM task without a matching cache axis serves stale verdicts that mask the wiring; serialize once, use the same bytes for both (profileJson precedent).

## What remains

Wave 4 (suggested next): **D — close the loop** (7 Highs): jd_build rehydrate, prep regenerate desync, human-verdict Schedule visibility, voice ending + mid-call revoke, persistent recruiter notes, archetype routing. Then waves 6–9 per the INDEX.
