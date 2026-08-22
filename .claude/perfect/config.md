---
product: "kp"
stack: "an AI-assisted hiring platform (Next.js 16.3 canary with Cache Components + React 19 + TS + Tailwind 4 + better-sqlite3 + next-intl; Python pipeline/ for LLM scoring)"
vault: ["C:/Users/kazda/Documents/Obsidian/kp"]
vault_subdir: Perfect
base_branch: main
wave_size: 3
lot_caps: {}
pool_target: 10
round_shape: round
cooldown_rounds: 2
commit_format: "feat(<context>): <title>"
context_map: context-map.json
active_runs_ledger: ""
locale_count: 2
---

# perfect overlay - kp

First run: create `C:/Users/kazda/Documents/Obsidian/kp` (the user keeps per-project vaults there).
Builds fork from and land on `main`. `round_shape: round`: propose for 1-3 contexts, gate, build that
slate immediately; thin slates keep winning. `locale_count` is a floor - count `messages/*.json`.

Context-map keys in this repo: `filePaths`, `apiRoutes`, `description`. Python (`pipeline/`) needs no
per-worktree install; run python gates from the tree root.

## Gates
- always: `npm run typecheck`, `npm run test:unit`, `npm run lint`
- when `messages/*.json` or user-facing strings touched: `npm run i18n:check`
- when `pipeline/` touched: `npm run test:python`
- slow: none
- builder: `npm run typecheck`, `npm run test:unit` (targeted where possible), `npm run lint`,
  `npm run i18n:check` if strings touched, `npm run test:python` if `pipeline/` touched; report what you
  COULD NOT verify honestly. Only the Director drives live flows, from the main checkout.

## Class B
- `messages/*.json` locale files (add the key to `messages/en.json` AND every other locale; anchored
  insert, never rewrite a file whole; at conflicts re-apply key adds/removes programmatically and run
  `npm run i18n:check`)
- barrel exports

## Class C
- the git index
- `context-map.json`
- generated schemas from `schemas:gen` and generated i18n artifacts (Director regenerates once)

## Repo law
Authority: `docs/design/README.md` for UI; `node_modules/next/dist/docs/` for Next specifics.
- This is NOT the Next.js you know: it's 16.3 canary with `cacheComponents` + `partialPrefetching`.
  Read the relevant guide in `node_modules/next/dist/docs/` before writing Next-specific code;
  `runtime`/`dynamic` route configs are banned.
- Read `docs/design/README.md` before any UI. The app ships TWO themes (Studio Light + Spark Dark) from
  one codebase: never hardcode colors outside `app/landing/`; use brand tokens (ink, paper, steel,
  coral, moss, limewash, dial-*, score-*) and theme-mapped neutrals; compose surfaces from
  `app/_components/ui/recipes.ts` (PANEL, CHIP, BTN_*, EYEBROW, FIELD...); reuse primitives in
  `app/_components/` (Modal, Badge, SegmentedControl, Skeleton) - never hand-roll them. Verify new
  surfaces in BOTH themes before claiming done.
- Every user-facing string goes through next-intl: add the key to `messages/en.json` AND every other
  `messages/*.json` locale; `npm run i18n:check` must pass.
- Respect `context-map.json` scoping; read it before editing.
- Review conventions (Director): dual-theme tokens, `recipes.ts` surfaces, shared primitives in
  `app/_components/`, next-intl keys across ALL locale files, context-map scoping. **Both-themes
  check:** any UI diff must hold in Studio Light AND Spark Dark - look for hardcoded colors outside
  `app/landing/`, missing `dark:` handling in new recipe usage; a diff that only works in one theme is a
  redo, not a merge.
- Doc-sync: user-visible changes update the mapped doc under `docs/` when one exists for that feature
  area.

## Context sources
- `context-map.json` for the queue. Coverage names: `.personas/contexts.txt` (the registered-name list,
  refreshed when the app rescans); fall back to the map name only when that file is absent.

## Smoke
- Visual pass every ~3 rounds, before proposing - both themes, at least one non-en locale. The dev port
  is volatile (`:3000` is Vibeman; kp lands elsewhere) - probe candidate ports for a `<title>` starting
  "KP" rather than assuming.
- Plan B without a browser: SSR `curl` of the touched routes (with `-H "Cookie: NEXT_LOCALE=cs"` for
  locale checks) grepping for the new surface's markers; the interactive half stays owed in the
  `Perfect.md` cursor.

## Opportunity arcs
- Judged from context-map metadata, `docs/*`, and memory. Active arcs: the V2 matching platform,
  enterprise readiness, multi-market unlock.

## Vetoes
- Features already planned elsewhere; "removed - don't re-suggest" notes; the industry-locked finding.
- The Vibeman ideas backlog (many `backlog:idea-*` skills exist) - don't re-pitch one verbatim.

## User taste
- Thin, evidence-honest slates; "near-polished, N small residuals" is a good verdict (the delta re-scout
  is how a fully-dead board facet's revival was confirmed).
- Bugfixes stand alone.

## Skill improvement log
- (migrate the existing entries from `$VAULT/Perfect/config.md` on the first 2.3 run, then append here)
