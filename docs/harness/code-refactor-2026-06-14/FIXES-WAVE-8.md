# Code Refactor — Fix Wave 8: Fetch/persist wiring + same-area logic dedup

> 15 atomic commits, 15 findings closed, 1 skipped (Theme H).
> Baseline preserved: tsc 0 → 0 · unit 849 → 849. All AbortSignal/keepalive/single-flight hardening preserved.

## Commits

| Commit | Finding | What |
|---|---|---|
| `f2850ce` | pipeline #2 | `postPipelineAction` (4 call sites; per-caller `expectedStage` CAS kept) |
| `b09e356` | apply #3 | `APPLY_EMAIL_RE` across 4 intake surfaces |
| `8f0d5d4` | apply #4 | intake answers object built once |
| `c8180a1` | apply #5 | inlined redundant `startFresh` |
| `376aa52` | jd-library #4 | `postSave` helper (save + retry) |
| `1111487` | interview-prep #2 | `putProgress` (unmount keepalive flush preserved) |
| `0eccc32` | cv-analysis #2 | `settleAnalysis` shared tail (AbortSignal threaded) |
| `5bc404a` | cv-analysis #3 | `softFail` bail closure (was triplicated) |
| `4d66140` | cv-analysis #4 | `useDropZoneHighlight` hook (dropRouting ownership + guard tests preserved) |
| `fefc2ba` | job-catalog #2 | `ingestOne` (submit + submitBulk; abort threaded) |
| `d67d92b` | github #2 | `firstLine` + `toCommitEntry` mapper (import-free) |
| `ebb6570` | scheduling #2 | `reportLoser` shared CAS-loser path (accept + decline) |
| `23d3e44` | voice #2 | `currentFinalStatus` built once (provider branching unchanged) |
| `1c43802` | analysis #1 | exported `primaryScore` from `comparison.ts`, dropped CompareTab inline copy |
| `90e0b03` | analysis #3 | `parseStoredGithubAnalysis` (API + history); `parseGithubEvidence` untouched |

## Skipped (with reason)

- **github #3** — after #2 single-sourced the snapshot module's commit-subject extraction, the route had only ONE remaining occurrence (no intra-module dup), and a cross-module helper is forbidden (would break `repo-snapshot.ts`'s import-free colocated-test constraint). Matches the finding's own "leave the route as-is" guidance.

## Behavior nuance (intended, documented)

- **analysis #3**: the API read route now schema-validates `github_json` (was raw `JSON.parse`). The finding prescribed this; it's behavior-equivalent for real data (the PATCH writer only persists `githubAnalysisSchema`-valid payloads) and strictly safer on corruption.

## Verification

| Gate | Before | After |
|---|---|---|
| tsc --noEmit | 0 | 0 |
| unit (node --test) | 849 | 849 / 0 fail |

## What remains

Cleanup/dedup tail (Waves 9–11): remaining TS logic dedups, stale comments/over-exports, Python dedups, and documenting the items the subagents flagged as intentional/not-safe-to-change.
