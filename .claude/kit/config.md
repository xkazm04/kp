---
product: "kp"
vault: ["C:/Users/kazda/Documents/Obsidian/kp", "C:/Users/mkdol/Documents/Obsidian/kp"]   # per machine; first existing wins
vault_subdir: Kit
features_root: app                 # app router: routes AND app/features/<group>/<module> live under app/
entry: ""                          # many entries (every page/layout/error/loading/not-found); listed in .claude/kit/s0.json
aliases: "@=."                     # tsconfig paths "@/*" -> "./*"
kit_path: app/_components/kit
doctrine: docs/design/README.md    # section "Composition kit" (parts, measure, density) + docs/design/surface-doctrine.md
batch_builders: 3
contest_seats: ""                  # not needed: the kit was chosen by the style-kit-r2 contest (adopt)
gate_mode: key-decisions
summary_every: 3
---

# kit overlay - kp

Written by `/kit adopt` (kit 0.3.0) on 2026-10-14. The kit was not built by this skill; see the
vault's `Kit/setup/adopt.md` for where it came from and which setup steps were done outside.

## Gates

- builder (changed files): `npm run typecheck` (runs `schemas:gen`, then `tsc --noEmit`) |
  `npm run lint` (no NEW warnings in touched files) | the targeted slice of `npm run test:unit`
  (the style ratchets `app/_components/ui/style-debt.test.ts`, `recipe-debt`, `skeleton-debt`,
  `loading-gap-debt` live there) | `npm run i18n:check` when a string or `messages/*.json` changed
- Director, before the batch commit: `npm run design:check`, the full `npm run test:unit`
- the unit runner does not typecheck: after any TypeScript change run `npx tsc --noEmit` as well
- `npm run build` only when a batch touches server/client boundaries (`'use client'`, server actions)

## Instruments

- Divergence / reachability / join config: `.claude/kit/s0.json` (featuresRoot `app`, `depth:3`,
  systemPrefix `_components`, every app-router page/layout/error/loading/not-found as an entry,
  marketing `landing|about|market` and `api` excluded).
  `node <kit>/scripts/style-divergence.mjs --repo . --config .claude/kit/s0.json --out <scratch>`,
  `node <kit>/scripts/reachability.mjs --repo . --config .claude/kit/s0.json --json > <scratch>/reach.json`,
  `node <kit>/scripts/join.mjs --divergence <scratch>/style-divergence.json --reach <scratch>/reach.json --out <scratch>/inventory.json`.
- The repo's own calibrated divergence index: `npm run style:divergence` (docs/design/instruments.md).
- Shooter (exists): `node scripts/style/shoot.mjs --out <dir> <target>` over `scripts/style/targets.json`
  (sizes 1280x800, 1728x1080, 1440x3200; light and dark; throwaway server over a copy of the data;
  AFTER with `--db <before>/kp-snapshot.sqlite`; pairs with `--pair <before> <after> --out <dir>`).
  Operator page: `docs/design/instruments.md`. A view under judgement sits behind `useKitFlag()` (`?kit=1`).
- Family image: `python <kit>/scripts/family.py`. Kit reference page: none rendering every part
  (owed, see Kit.md); the reference columns are the promoted kit surfaces `channels` and `settings-hiring`.

## Repo law

Authority: `AGENTS.md` and `.claude/CLAUDE.md`; paste their digest into every builder brief.
- UI law: `.claude/rules/ui.md` (compose from the kit; two registers never flattened; type tokens,
  floor 14px; radius named steps; no skeletons; no `title=` tooltips; the ratchets). Never raise a ceiling.
- Shared checkout: commit by pathspec only your own files, never `git add -A`, never stash; check
  `git diff --cached --name-only` before every commit. Conventional commit types only (commit-msg hook);
  the subject is one clause about the change (`npm run commit:check`); never `--no-verify`.
- main has diverged from origin: commit locally, never push/pull/rebase.
- Every user-facing string goes through next-intl catalogs (`messages/{en,cs,de,fr}.json`).
- Out of scope: `app/landing/**`, `/about`, `/market` (marketing).

## Visibility order

Provisional, read from the nav (`app/features/shell/tabs.ts`), awaiting the owner's confirmation:
features/hiring, features/library, features/tools, features/insights, features/settings, then the
candidate token pages (apply, interview, schedule, offer, status, stop, data, devcase, skill, invite),
then /me, then /history and /jds deep links.

## Rituals

None (no live-sessions ledger, no decision-capture ledger in this repo).

## Taste

From the kit-unification spark (Obsidian `Spark/ideas/kit-unification.md`), verbatim:
- "Journey board or hiring pipeline are exmaples of sections where safe approach does not work well,
  graphical dominant and animated ideas would compliment it to better" (Gate K1, 2026-09-25)
- "We need to bring back pipeline with row per role, current view is not practical for large companies
  with dozens role open and thousands of candidates" (2026-09-25): judge at a large customer's scale.
- "Defer porting Journey feature. Keep legacy module and revitalize its UI to fit the kit." (Gate 3)
- "Try always to provide full url to local filepath or server url so I don't need to hunt it each round.
  Start the server if needed" (process)

## Skill improvement log
