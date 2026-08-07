# Code Refactor — Fix Wave 1 — Latent-bug drifted duplicates

> 6 atomic commits, 7 High findings closed.
> Baseline preserved: tsc 0 → 0 errors · `node --test` 1019 → 1019 passing · 0 regressions.

These are the Highs where a drifted duplicate (or a dead branch) was an *active bug*, not just maintenance cost. Fixed first for best value/risk.

## Commits

| # | Commit | Findings closed | Files |
|---|---|---|---|
| 1 | `8a4b10a` | application-intake #1, github-evidence #1 | apply-intake.ts, **github-handle.ts** (new), github-analysis/route.ts |
| 2 | `7c85d4c` | job-postings #1 | RecruiterCandidates.tsx, JobsTypes.ts |
| 3 | `7b54001` | dev-case-authoring #1 | devcase-run.ts, devcase-orchestrator.ts, devcase/source/route.ts |
| 4 | `150e560` | voice-interview #1 | voice/types.ts, voice/index.ts, VoiceInterview.tsx |
| 5 | `e4fe479` | pipeline-board #1 | PipelineTypes.ts |
| 6 | `d116cfe` | auth-sessions #1 | auth/SignOutButton.tsx |

## What was fixed

1. **Email-shape gate + GitHub-handle parser single-sourced.** `seedLeadPrefillAnswers` re-inlined the email regex instead of the in-file `APPLY_EMAIL_RE` constant; and two GitHub-username parsers had drifted (route required `https://`, apply made it optional → a handle accepted at apply was rejected by the deep-dive). New `app/_lib/github-handle.ts` owns one protocol-optional parser; both sites delegate.
2. **provLabel `observed` bucket.** `JobsTypes.provLabel` was a stale fork missing the highest-trust `observed` provenance, so RecruiterCandidates stamped a passed-live-case skill as amber "academic". Deleted the fork; now uses the canonical `MatchTypes.provLabel` + `enumLabel`.
3. **devcase sourceChannel.** `seedPipelineFromMatches` extracted to own the Accepted-entry write contract incl. `sourceChannel: "devcase"`; the manual "Source DB" route previously omitted the marker. Both call sites now share it.
4. **Voice provider order.** Server `pickDefaultProvider` (OpenAI-first) and the picker (`ElevenLabs`-first) kept inverted copies. Added `VOICE_PROVIDER_ORDER`/`DEFAULT_VOICE_PROVIDER` to voice/types.ts (OpenAI-first, so real interviews are unchanged); both consume it.
5. **Board STAGES.** `PipelineTypes.STAGES` was a hand-maintained copy of canonical `PIPELINE_STAGES`; now a re-export (typed `readonly string[]` to keep call sites compiling).
6. **Sign-out wiring.** `/api/auth/logout` had no caller; the sign-out button only cleared the dev gate. Now POSTs logout first (best-effort) then clears the dev gate — closes the prod sign-out gap and removes the dead-route flag.

## Patterns established (catalogue items 1–4)

1. **Drifted duplicate = latent bug, not just debt.** When the scan says "two copies that already disagree", the divergence is usually an active behaviour bug — fix it first.
2. **Single-source by extracting a pure leaf module.** `app/_lib/github-handle.ts` / `voice/types.ts` constants — a dependency-free `.ts` module both the Next bundle and the bare `node --test` strip runner can load. `allowImportingTsExtensions` + explicit `.ts` imports is the repo convention.
3. **Consolidate the *write contract*, not just the value.** `seedPipelineFromMatches` owns the whole `createPipelineEntry` shape so a field (the origin marker) can't be present on one path and absent on another.
4. **Re-export to single-source a constant** (`STAGES = PIPELINE_STAGES`) but keep the loose type if call sites pass un-narrowed strings — avoids per-site churn while killing the copy.

## What remains (Waves 2–3 of this run)

- **Wave 2** — dead-branch / dead-knob removal (retry-bypass, commit_reflection, reject_mode "auto", consent-event kinds) + dead shared modules (ThemeSplit, DisclosureRow, receiveSubmission, salaryBandError).
- **Wave 3** — safe dead-code deletion (APPROVAL_KIND_META, LLMResult.raw, descendant graph, mk_candidate, "duplicate" editor mode, isDeadLettered, SeedFiles + seed route, seed_jobs generic path).
