---
product: "kp"
stack: "Next.js (App Router) + TypeScript + React; Python pipeline under pipeline/; next-intl (ICU) catalogs in messages/"
vault: ["C:/Users/kazda/Documents/Obsidian/kp"]
vault_subdir: Spark
context_map: context-map.json
base_branch: main
active_runs_ledger: ""
locale_count: 4
---

# spark overlay - kp

## Vault
`C:/Users/kazda/Documents/Obsidian/kp` exists (it already holds `Perfect/`), so `/spark` writes to
`C:/Users/kazda/Documents/Obsidian/kp/Spark/` and does **not** fall back to `<repo>/.spark/`.
Scaffold `Spark.md`, `ideas/` and `sessions/` there on the first run.

## Context map
`context-map.json` exists at the repo root - use it for Phase 1 targeting. No fallback to top-level
directories is needed here. Verify its provenance on first read
(`node -e "const m=require('./context-map.json');console.log(m.generator,m.generatedAt||m.generated_at)"`)
and say so if it is far behind `git log -1`.

## Gates
- always: `npm run typecheck`, `npm run lint`, `npm run test:unit`
- **before the FIRST package commit of a spark, not at the end:** `node scripts/perf/check-budget.mjs` and the
  full `npm run test:unit`. The budget is usually red on arrival, so compare its finding count and
  `/api/tasks`'s module count with the spark's base commit (`git archive <base> | tar -x` into a scratch dir,
  then run the walker there), never with zero. Learned twice (candidate-jobseeker 2026-09-16, the four
  interview sparks 2026-09-18, which added 20 modules to nearly every route before anyone measured).
- **before a shared-checkout baseline commit** (the operator's habit): run `npx tsc --noEmit` and hold back any NON-test file whose error is a missing export/module it imports - a half-built production import stops every route compiling; test-only stragglers may go in. Learned 2026-09-24 (agent-foundry-validation).
- when `pipeline/` touched: `npm run test:python`
- when `messages/*.json` or any user-facing string touched: `npm run i18n:check`
- when a Python schema source changed: `npm run schemas:check` (note `typecheck` runs `schemas:gen` first)
- builder: `npm run typecheck` | `npm run lint` (no NEW warnings in files you touched) | the targeted
  slice of `npm run test:unit` | `npm run test:python` if it touched `pipeline/` | `npm run i18n:check`
  if it touched `messages/`
- Gate calibration: gate on *no NEW warnings in files this diff touched*, not on a clean whole-repo lint.
- Not run by `/spark` (slow / keyed): `test:e2e`, `test:eval`, `test:python:gate`. Name them in the
  idea note as an owed follow-up rather than blocking a ship on them.

## Rituals
No live-sessions ledger and no decision-capture ledger exist in this repo - `scripts/active-runs.mjs`
and `scripts/decision-ledger/` are both absent - so **Phase 0 and Phase 6 have no ritual**. Phase 0
still runs `git status` and classifies foreign WIP; Phase 6 still writes the session note and updates
`Spark.md`.

**Phase 5 - translation, before the commit that introduces the keys.** The catalogs are
`messages/{en,cs,de,fr}.json`, source of truth `en` (`LOCALES` in `i18n/locales.ts` is the single
enumerating array), ICU MessageFormat compiled by `scripts/i18n-check.mjs`:
```bash
npm run i18n:check
```
For anything beyond a couple of keys use the `/i18n-translate` skill rather than hand-editing three
catalogs - its repo-specific contract (catalog layout, what a translator may touch, the glossary,
the per-locale style and construction guides) is `docs/i18n/contract.md` plus `docs/i18n/style-*.md`,
`glossary.md` and `constructions-*.md`. Keep key order identical across locales.

## Repo law
Authority: `AGENTS.md` and `CLAUDE.md` at the repo root - paste their digest into every builder brief.
- `npm run typecheck` runs Python codegen (`schemas:gen`) before `tsc`; a generated schema change is a
  Director-applied step, not a builder edit.
- Design tokens are gated by `npm run design:check` (`scripts/design/check-design-tokens.mjs`) - reuse
  the token set, do not introduce raw values.
- Every user-facing string goes through the next-intl catalogs; no hardcoded copy in JSX.
- The Python pipeline (`pipeline/`) and the TS app are separate toolchains: a work package that spans
  both needs both gates named in its acceptance criteria.
- **Two hubs are on nearly every route's import graph: `app/_lib/tasks.ts` and `app/_lib/db/pipeline.ts`**
  (it reaches `stage-hooks.ts`). The perf budget counts dynamic `import()` too. A new task kind's runner, or
  anything heavy either hub must RUN, is registered at boot in `app/_lib/late-bound-boot.ts` and looked up
  through `task-external-runners.ts` / `stage-hooks-invite.ts`; never import it from the hub.

## Wave defaults
- Wave = one AskUserQuestion call, up to 4 questions. Uncapped waves; clarity terminates.
- Perspective checklist: functional scope | data model & persistence | route/API surface | UX flow +
  async/empty/error states | UI + shared-component reuse | i18n (4 locales) | performance | failure
  modes | docs-sync | out-of-scope.

## Question taste
- 2026-08-23 wave1-2: picks Actor over Proposer; live shared state over import-copies; keeps product branding (Candi) over companion-name takeover. Offer the sharper architecture fork in wave 1, not wave 2.
- 2026-08-24 triage r1: answers must not read like a book - short paragraphs + tables/small charts in chat; exclusive panel toggles (never two second-layer panels open); chat window docks LEFT over the nav rail so content stays visible. These are standing UI doctrine for any Chat/Athena surface, not per-spark choices.

- 2026-09-16 candidate-jobseeker: overrides a "mode scalar" recommendation with a SEPARATE ROUTE + thin shell (wants a distinct persona surface, not a re-skinned recruiter shell); answers a supply question with DOCTRINE (dynamic markets per user, owner confirms sources + accepts ToS on the record, build the crawler with politeness, consult the registry) - offer the owner-in-control option explicitly when legal exposure is the trade-off; accepts all four packages again; wants shared mechanisms generalized (scheduler registry) rather than a parallel slot.
- 2026-09-08 intake-studio: chooses the shared-checkout habit (commit EVERYTHING dirty as a baseline) over a scoped baseline commit — do not offer the scoped option first again; keeps existing column order over a "better" reading order (zero relearning wins); on scraping picks "offline now, crawler designed-for later" — offer the deferred-package option whenever ToS/legal exposure is the trade-off. Accepts all four scouted packages when each is buildable; does not want scope trimmed for them.
- 2026-09-18 ai-interview (4 split ideas): answers the biggest forks with DOCTRINE, not picks ("live call confidence, guardrail and leadership role over the conversation"; "two test frameworks, one for users on the exact kit, one for us as a /uat tranche") - re-scope from the doctrine rather than re-asking. Wants shared-method changes LANDED (overrode "registry branch, not merged" with "commit to the registry's main"). Accepts a Director refinement of an override when the option text named the risk ("kit wins everywhere" -> debrief keeps authorship; "run past the cap" -> ask the candidate first). Builds every split idea in sequence in one session.

- 2026-09-24 agent-foundry-validation: picks SCALE every time it is offered - HITL from day one over shadow-first, all four arenas, full v1 build over program-doc-only, auto-merge lessons over propose-only; answers the review-surface question with DOCTRINE that adds instruments (a /contest opus@high vs fable@medium, plus the ai-registry recipes lane). Offer the ambitious option as a real choice with its risk in the option text; do not steer it toward a doc. Accepts a Director refinement that keeps a governance rule intact under an override (lessons auto-commit only to LESSONS.md, which the lane says needs no version bump).

## Skill improvement log
- 2026-09-08 intake-studio: (1) a doc-map entry cannot be pre-seeded ahead of its files — the doc-sync fixture requires every glob root to exist, so the package that creates the file adds the entry. (2) Five Opus builders in ONE checkout (kp's gates don't run in worktrees) worked with disjoint file scopes + a Director pre-seed commit of every shared wire (stub component, catalog keys, error codes, limiter raises); builders reported foreign typecheck noise instead of fixing it. (3) The mass-test package found two real engine bugs on its first two live roles (coercer dropping requirement rows) — run the harness BEFORE polishing the UI that renders its output; the brief's `requirements: []` would have looked like a design choice. (4) A sim over HTTP needs a bench-mode raise on EVERY limiter in the chain (create, message, promote), not just the obvious one. (5) Serial LLM-vs-LLM roles cost ~8 min each; design `--workers` and incremental dumps into a harness from the start, not after the first 40-minute run. (6) Another dev server was already bound to this checkout (.next/dev/lock) — `npm run build` + `next start --port N` with a throwaway KP_DB_PATH is the way to observe a spark's UI without touching the operator's server.
- 2026-09-16 candidate-jobseeker: (1) run `npm run test:unit` FULL and `npm run test:perf` BEFORE the first package commit - kp's tree-wide ratchets (recipes literals, CZK literal, route capability, route tenancy by store NAME, th scope, BYOM use-case scan, import-graph budget) bind any new module and cost three fix commits at the end. (2) The perf budget counts dynamic imports too: a heavy task kind must be registered at boot (task-external-runners.ts), never imported from the task hub. (3) Store function names are matched by TEXT across routes - prefix them with the module (getJobseekerPosting) or a sibling API's routes trip the tenancy ratchet. (4) Measure the perf budget on a CLEAN worktree; the shared working tree carries other sessions' uncommitted work. (5) The first non-root layout needs `npx next typegen` or the stale `.next/types/routes.d.ts` makes the dev validator red. (6) The session rate limit can kill builders mid-flight; SendMessage resume from the transcript loses nothing - keep briefs self-contained so a resumed builder can re-read its own files. (7) Chrome MCP was not connected; headless `@playwright/test` run from the REPO ROOT against `next start` on a throwaway KP_DB_PATH is the observation recipe; the intake studio opens via `?tab=intake&intake=new`. (8) commit-msg hook: subject <= 120 chars and must not end on a dangling word.
- 2026-09-18 ai-interview x4: (1) The Director's own diagnosis read off one simulator transcript was wrong (a "cross-topic" coverage claim was the interviewer asking a topic's question before announcing it); the stricter rule it ordered cut coverage 6/6 -> 2/6 and was withdrawn before commit only because the builder re-ran the situation. A fix brief for a conversational defect must include a re-run of the provoking situation AND a neighbour that never triggers it. (2) The 2026-09-16 perf lessons (test:perf before the first commit; heavy task kinds late-bound) RECURRED: kit and letter runners were imported into the task hub and 20 modules reached nearly every route. A lesson that lives only in this log never reaches a builder brief, so both are now in `## Gates` and `## Repo law`. (3) Builder briefs written as scratchpad FILES (not inline prompts) let two builders run in parallel on disjoint scopes, let the Director amend a brief after reading more code, and survived the weekly model limit killing a wave (relaunch lost nothing). (4) The situation bank's scripted first lines are mostly greetings; reading the bank before briefing the verdicts caught a stimulus rule that would have mislocated most provocations.
- 2026-09-21 journey-analytics: (1) When an operator DEFERS a decision ("we will decide after the contest"), give the deferral an instrument rather than just re-asking later - every contest variant was required to state its behaviour at kp's 1728px frame AND at full viewport, and the answer came back as evidence (5 of 6 said 1728 was enough). (2) `node_modules` was empty on arrival with another session's processes live; ASK before `npm ci` in this shared checkout - it is cheap and the wrong call disrupts someone else. (3) A liveness-rule gap: a scout that reports "no per-row table exists" for a JSON-blob column must also say what the blob's ELEMENTS carry - `role_intakes.transcript_json` turns out to carry a per-turn `at`, so history was derivable all along. (4) Wave options were narrower than the codebase: the surface question offered tab-or-route and the operator chose a full-viewport OVERLAY, for which `OverlayShell.tsx` and `IntakeStudioOverlay.tsx` were already precedents nobody had been asked to look for. (5) A generator that emits both facts and a summary of those facts must DERIVE the summary from its own output - the contest's staged data shipped `phases.screening.present:false` on 22 journeys that carried screening rows, and the winning variant caught it before the Director did.
- 2026-09-24 agent-foundry-validation: (1) the operator's "baseline-commit everything dirty" put another session's HALF-BUILT production import on main (automation-run.ts importing an export a stub never had) - every route stopped compiling and 71 tests could not load; found only when the UI builder could not boot a server. Now in ## Gates. (2) the perf-budget base was misread as 14 because the Director captured `tail -15` of the output; the clean-archive measurement the overlay already prescribes gave 58. Measure the base from `git archive` at Phase 0, full output, before any builder runs - the instruction existed and was skipped. (3) a builder authoring bug-bounty/honeypot recipe content was stopped by a safety classifier mid-run with nothing written; a narrower brief without the security material landed 5 of 8 recipes cleanly - keep security-craft authoring out of bulk content briefs and put it to the operator as its own decision. (4) the blind code-reading judge caught two honesty defects in a variant the host's pixel pass ranked FIRST (unverified evidence painted as failed; the headline rate never moved after recording) - never recommend from the visual pass alone. (5) reading the peer app's management API (not just the scout's summary) turned a planned new bridge payload into one least-privilege scope grant: the scout said "the bridge carries counters only" and missed that /api/execute already existed.
- 2026-09-24 gig-desk-ui correction: a contest winner that arrived as a bare question answer (no operator comment) was built and later disowned by the operator ("I don't remember giving any feedback for the contest"); the UI was rebuilt around A/2. For the owner-decides step of a /contest, restate the pick in the next message and treat an uncommented answer as provisional. Also: a UI builder that finds `.next/dev/lock` held can still verify on `KP_EMPTY=1 KP_DB_PATH=<throwaway> npx next dev --port <free>` (its own .next-empty distDir) - put that in the builder brief.
