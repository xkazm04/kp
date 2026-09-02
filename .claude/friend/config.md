---
product: "kp (CandiDate / KP studio)"
stack: "self-hostable AI recruiting studio - Next.js 16.3 canary + React 19 + TS + Tailwind 4, better-sqlite3, next-intl across 4 locales, Python jobfit pipeline"
vault: ["C:/Users/kazda/Documents/Obsidian/kp"]
vault_subdir: Friend
context_map: context-map.json
area_source: "context-map.json groups (17); Q1 numeric options map to the eight richest groups listed in .claude/explorer/config.md"
active_runs_ledger: ""
locale_count: 4
---

# friend overlay - kp

Sits beside `.claude/perfect/config.md` and `.claude/explorer/config.md` - same repo law, stated for
the endless single-area companion loop. `/friend` was written for the personas repo; in kp the
constants it hardcodes resolve as follows:

- `.claude/codebase-context.md` (8 groups / 49 contexts) -> `context-map.json` (17 groups / 143
  contexts; keys `file_paths`, `group`, `description` - NOT `filePaths` as the perfect overlay says).
  Q1 menu = the eight groups in the explorer overlay's Area menu; option 1 free text resolves a
  group name, a context name, or a path fragment against the map.
- `.claude/codebase-stack.md` -> `.claude/CLAUDE.md` (the real rules file) + `docs/design/README.md`
  before any UI.
- Vault root -> `vault` above (per-project vaults under `Documents/Obsidian/`); `Friend/` beside
  `Perfect/`, `Explorer/`, `Architect/`. Read `Perfect/directions/*.md` in Phase 1a: it is the
  shipped/rejected direction ledger for this repo and the best "already done" filter.
- Active-runs ledger: none in kp - skip 0b/0d/6a-2.
- Verified mode (`tauri:dev:test` on :17320) does not exist here. `yes` means: `npm run dev`, read
  dev-guard's banner for the live port, drive the surface in BOTH themes and one non-en locale;
  without a browser, SSR-curl the route (`-H "Cookie: NEXT_LOCALE=cs"`) and say which half stayed
  unverified.
- i18n: 4 locales (`messages/{en,cs,de,fr}.json`), not 13; add every key to all four in the same
  commit; `npm run i18n:check` is the gate (keys are typed, so a gap also breaks `typecheck`).
- Tauri/ts-rs/AppError/CATALOG.md sections of Phase 4 do not apply. The reuse rule here is
  `app/_components/ui/recipes.ts` + `app/_components/` primitives; the token rule is the dual-theme
  design system.

## Gates

Per cycle, keyed by what it touched:
- any `.ts/.tsx`: `npm run typecheck` (runs `schemas:gen` first - Python needed) then `npm run lint`
- `app/**` logic: `npm run test:unit` (targeted files allowed: `npm run test:unit -- <file>`)
- UI / styling: `npm run design:check`
- new or changed message keys: `npm run i18n:check`
- `pipeline/**`: `npm run test:python`
- mapped source per `scripts/docs/feature-doc-map.json`: update the doc in the same commit (the
  Stop hook checks)

## Known environment traps

- In a worktree whose `node_modules` is a junction, `test:unit` reports `/api/comms` route failures
  (`request.nextUrl` undefined) that pass on main at the same HEAD. Rerun the failing file on the
  main checkout before treating it as yours.
- `typecheck` rewrites `app/_lib/*.generated.ts`; never stage them from a `/friend` cycle.

## Skill improvement log

- 2026-09-01 - first run (evaluation, Hiring Pipeline). The /perfect `directions/` ledger and the
  vault's rejected directions ("no more board chrome") are the taste signal Phase 1a should load;
  the skill's `Patterns/friend-preferences.md` is empty until session 3-4.
