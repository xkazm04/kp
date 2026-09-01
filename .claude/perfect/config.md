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
locale_count: 4   # MEASURED 2026-09-01: messages/{en,cs,de,fr}.json. The "2" was a floor, never counted.
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
- **KNOWN DISAGREEMENT, measured 2026-09-01.** The map was re-scanned on 2026-08-20 at a coarser
  granularity — `285 contexts -> 143`, `provenance.prior_contexts: 285` — and `.personas/contexts.txt`
  still carries the 285-context NAMES. So the map's names and the registered names are now two
  different vocabularies: `role-intake`, `api-role-intake`, `agent-workforce`, `group-eval-ui` and
  `lib-group-eval` are all absent from `contexts.txt`, while the list still holds their predecessors
  (`decisions-group-eval-ui`, `group-eval-shared`). Emit coverage under a registered predecessor when
  one is genuinely the same surface; otherwise emit the map name and say in the session note that it
  counts toward nothing until the app rescans — anchoring to a merely adjacent registered name inflates
  a different context's bar, which is worse than a bar that has not moved.
- **The vault's `QUEUE v2` (untouched-first over 118/285 touched) is DEAD** and must not be resumed as
  written: the re-granularization invalidated the mapping, and a fresh measurement over the last 3000
  commits found **0 of 143 contexts untouched** (coldest 2026-08-20, newest 2026-09-01). Under churn
  this heavy, last-touch is not a queue discriminator; score on opportunity and never-slated-ness.

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
- 2026-09-01 (round 24) **A stale vault must be MEASURED against the tree before it is resumed.** The
  cursor was 29 days and 572 commits old. Two of its carried leads died on contact: the "round-24 lead
  candidate" (`GET /api/schedule` answers 200 with no auth) is BY DESIGN - `proxy.ts` gates every
  non-public path when `KP_OPERATOR_PASSWORD` is set and fail-closes in production, so the finding was
  a dev-mode observation the smoke pass mistook for a defect; and the untouched-first queue died with
  the 285->143 rescan. The re-measured survivor (`recipes-actually-used`: 133 occurrences/95 files ->
  137/98) got STRONGER. Measure each carried claim separately; a stale vault is not uniformly wrong.
- 2026-09-01 The **Director evidence spot-check paid for itself twice in one round**: it refuted a
  scout's `personas_bridge` tenancy claim (already registered in `tenancy.ts` at three sites - a
  direction that would have built a test for a pin that exists), and it upgraded a scout's UX symptom
  into the round's best direction by finding the doctrine the code violates
  (`group-eval-governance.ts` states the escalation rule its own client breaks).
- 2026-09-01 **`.personas/` is gitignored, so a worktree has no outbox** and the coverage nodes went to
  the worktree's own `.personas/`. Worse, the registered-name list is a generation behind the map, so
  new map names anchor to nothing. Both belong in `## Context sources` above; check the name set BEFORE
  writing nodes, not at Wrap.
- 2026-09-01 **Both builder subagents were killed by a session limit before committing, and both had
  done real work.** Lot 1 was complete (Director re-ran every gate and landed it verbatim); lot 3 had
  the pure rule and six tests but no wiring (Director finished it). The salvage-before-assuming-loss
  rule held perfectly. What is missing from the method: the Director should capture the fork-point gate
  result well enough to PROVE a pre-existing failure later - `npm run test:unit | tail -30` masks the
  exit code behind the pipe, and re-proving it afterwards cost a whole detached worktree.
