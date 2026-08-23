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

## Wave defaults
- Wave = one AskUserQuestion call, up to 4 questions. Uncapped waves; clarity terminates.
- Perspective checklist: functional scope | data model & persistence | route/API surface | UX flow +
  async/empty/error states | UI + shared-component reuse | i18n (4 locales) | performance | failure
  modes | docs-sync | out-of-scope.

## Question taste

## Skill improvement log
