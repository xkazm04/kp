---
product: "kp (CandiDate / KP studio)"
stack: "self-hostable AI recruiting studio — Next.js 16.3 canary (Cache Components + partialPrefetching) + React 19 + TS + Tailwind 4, better-sqlite3 at data/kp.sqlite, custom HMAC session auth, a per-request-spawned Python jobfit pipeline (pipeline/jobfit), a multi-provider LLM layer that degrades keyless, next-intl across 4 locales"
vault: ["C:/Users/kazda/Documents/Obsidian/kp"]
vault_subdir: Explorer
context_map: context-map.json
coverage_context_source: ".personas/contexts.txt"
active_runs_ledger: ""
---

# explorer overlay — kp

Sits beside `.claude/architect/config.md`, `.claude/perfect/config.md` and
`.claude/ship-loop/config.md` — same repo law, stated for a **daily wander**.
`/architect` walks contexts for structure, `/perfect` for product value,
`/scan-sweep` for defect coverage; **`/explorer` wanders one context and surfaces
10 concrete, anchored items** that a single session can land.

## Context sources

1. `context-map.json` — 143 contexts / 17 groups; machine authority for area scope
   and file lists (`filePaths`, `apiRoutes`, `description`). Every tracked
   `.ts/.tsx/.py/.mjs` file belongs to exactly one context.
2. `.claude/CLAUDE.md` — the real rules file (root `CLAUDE.md` + `AGENTS.md` are thin
   pointers to it): architecture overview, conventions, the gate list.
3. `docs/architecture/decisions/README.md` + the ADRs — a finding that re-litigates a
   settled decision must cite that record's *What would change our mind* clause or be dropped.
4. `docs/design/README.md` — required before any UI-shaped finding (dual theme).

**The map and the app disagree — the silent-failure case the skill warns about.**
`.personas/contexts.txt` holds the app's 285 registered names (pre-rescan slugs);
`context-map.json` holds 143 names from the 2026-08-21 regranulation; measured overlap
is **6 of 143**. So: **scope by the map, write memory-outbox `context` values from
`.personas/contexts.txt` verbatim** (one node per slug actually touched). A map name
written straight through stores a null context and never counts, without erroring.

## Area menu

The context map's 17 groups, the eight richest in wanderable surface:

1. AI & LLM Infrastructure   (14 contexts — provider layer, prompts, python bridge)
2. Job & JD Management       (13)
3. Hiring Pipeline           (10 — board, transitions, automation)
4. Design System & Shared UI (10 — recipes, primitives, dual theme)
5. Platform Infrastructure   (10 — db, auth, rate limiting, comms transport)
6. Developer Assessment      (9 — devcase)
7. Workspace Shell & Onboarding (9)
8. Candidate Public Surfaces (8 — tokenized routes, the public wire)

## Category menu

The built-in eight, plus:

- `keyless` — an LLM call site's no-key path: is the fallback real, disclosed, tested?
  (Degrading keyless is a product property here, not a nicety.)
- `wire` — what a public `[token]` route projects; anything past the field allowlist.

## Gates

Per item, keyed by what it touched (run only what applies — this is a wander, not a release):

- any `.ts`/`.tsx`: `npm run typecheck` then `npm run lint`
- `app/**` logic: `npm run test:unit`
- UI / any styling: `npm run design:check`
- new or changed message keys: `npm run i18n:check`
- `pipeline/**`: `npm run test:python`
- mapped source per `scripts/docs/feature-doc-map.json`: `npm run docs:check`

`npm run typecheck` runs `schemas:gen` (Python) BEFORE tsc — Python and repo deps must be
installed, and it rewrites `app/_lib/*.generated.ts`. Those files being dirty afterwards is
the toolchain, not your change.

## Repo law

Authority: `.claude/CLAUDE.md`; `docs/design/README.md` for UI; `node_modules/next/dist/docs/` for Next.

- **This is NOT the Next.js you know** — 16.3 canary with `cacheComponents` + `partialPrefetching`;
  `runtime`/`dynamic` route configs are banned (ADR 0001).
- **Pathspec commits only.** Parallel agent sessions share this checkout. `git add <path> <path>`,
  never `-A`/`.`/`-u`; never `git stash`, `reset --hard`, or worktree-touching `restore`/`checkout --`
  on foreign work. Verify `git diff --cached --stat` before every commit and unstage strangers.
- **4-locale parity.** A key added to `messages/en.json` lands in `cs`/`de`/`fr` in the same change;
  next-intl keys are typed, so an incomplete catalog breaks `typecheck` for everyone. An item adding
  more than a handful of keys is a session of its own — defer it.
- **Design tokens.** No raw hex/rgba outside `app/landing/`; brand tokens first, then theme-remapped
  neutrals; compose from `app/_components/ui/recipes.ts`; both themes verified.
- **Never `await` inside a `db.transaction()`** — better-sqlite3 transactions are synchronous.
  A read→compute→write either takes `.immediate()` or re-asserts its precondition in the UPDATE's
  `WHERE` plus a `res.changes === 0` skip (`actOnPipelineEntry` is the canonical shape).
- **Rate-limit contract tests pin limiter call sites** (`app/api/rate-limit-contract.test.ts`).
- **Tenancy manifest is fail-closed** (`app/_lib/tenancy.ts`), each table proven by a colocated
  `*-tenancy.test.ts`.
- **Candidate token routes carry a projection, not the row** (`publicInviteView`).
- **`maxDuration` is serverless-only** — self-hosted `next start` does not kill long handlers.
- **Doc-sync in the same change.** A Stop hook runs `scripts/docs/check-doc-sync.mjs`; mapped source
  changed without a doc touch exits 2 — update the doc, or reply once why none is needed.

## Baseline exclusions

- `app/_lib/schemas.generated.ts`, `app/_lib/taxonomy.generated.ts` — rewritten by `schemas:gen` on
  every `typecheck`; never a finding. The dirt is CRLF churn (the Python generator writes CRLF, the
  committed files are LF); when one legitimately changes, `sed -i 's/\r$//'` before staging and the
  diff collapses to the real line.
- `app/landing/` — a fixed art direction, exempt from the token rule by design.
- `docs/_archive/` — superseded, not drift.
- The Vibeman `backlog:idea-*` inventory — already-triaged ideas, not explorer findings.
- Bulk string extraction and bulk token migration — fix-as-you-touch, never a standalone item.

## Smoke

`npm run dev` and read dev-guard's "already running" banner for the live port — the port is volatile
on this box, do not assume `:3000`. Verify UI in BOTH themes (appearance control on the sidebar rail)
and at least one non-`en` locale. Without a browser: `curl` the touched route (add
`-H "Cookie: NEXT_LOCALE=cs"` for locale checks) and grep for the surface's markers, then say plainly
which half stayed unverified.

## Skill improvement log

_(dated one-liners; repo-specific learnings from `/explorer` runs land here)_

- 2026-09-01 — **Print a GATE MATRIX for any route family before reading its members.**
  One loop over `app/api/jobs/[id]/*/route.ts` greping for `jobVisibleToWorkspace` /
  `canWriteJobLifecycle` / `requireOperator` / `rateLimit` showed in a single call that
  `candidates` was the only by-id job route with no gate at all. That asymmetry is
  invisible from inside any one route — all of them read as careful — and it was also
  invisible to the contract test and the feature doc, which each enumerated the same
  four routes. Generalizes to any enumerable family here: routes under a segment,
  stores in `app/_lib/db/`, tabs in `app/features/shell/tabs.ts`.
- 2026-09-01 — **A list hand-maintained INSIDE a contract test is a claim to diff
  against reality.** `lifecycle-signals.test.ts` iterates four route names and
  `rate-limit-contract.test.ts` an array of specs; in both cases this run's finding was
  what the list omits, not what it asserts. Read those arrays as the repo's own
  statement of what it believes about itself.
- 2026-09-01 — **Careful with comments in files a source-level test scans.** Editing a
  stale comment in `app/api/intake/route.ts` to quote the `expensive` marker the
  rate-limit contract pins put that string ABOVE the limiter and failed the ordering
  assertion. This repo has ~6 source-scanning suites (rate-limit-contract,
  lifecycle-signals, *-tenancy, error-message-hygiene, save-ingest-contract,
  authz-parity) — before adding prose to a file one of them reads, check what it greps
  for. Describe the marker; never reproduce it.
- 2026-09-01 — **`npm run test:unit` can be red for the CHECKOUT, not the commit.** Two
  tests this sweep never touched (`decisions-auth`, `pipeline-routes`) failed
  reproducibly in a `.claude/worktrees/` worktree and were green — 4336/4336 — at the
  identical SHA in a fresh worktree under the temp dir, with several ascent loops and
  sibling eval worktrees live on the box. Before bisecting, `git worktree add --detach
  <your-sha>` somewhere isolated and re-run: one run either exonerates the branch or
  proves the bisect is worth starting. And note `git worktree add <branch>` FOLLOWS the
  branch — `main` moved twice mid-investigation here, so a comparison baseline must be
  a SHA.
- 2026-09-01 — **The commit-msg hook rejects `explorer:`.** The skill prescribes
  `explorer: <title>`; the known types are build/chore/ci/deps/docs/feat/fix/perf/
  refactor/security/style/test. Use the repo type that fits the diff and name the sweep
  in the body. (`security(...)` for the two access/spend fixes, `fix(...)`, `docs(...)`,
  `refactor(...)` for the rest.) The hook also rejects a subject that ends on a dangling
  word — write the subject for the diff, not by slicing a sentence.
- 2026-08-29 — **Pick the area from `.claude/scan-history/coverage-2026-08.md` until this
  repo's own explorer coverage has depth.** On a cold vault Phase 2b's staleness score ties
  across all 143 contexts and falls back to file count, which is arbitrary. That reconstructed
  ledger names the three contexts the 2026-08 scan-sweep left with **zero** `fix(...)`
  evidence — `lib-analytics-1`, `ui-primitives-and-ui-puml`, `e2e-suite`. The first of them
  yielded four real bugs on the first pass. Two remain unswept.
- 2026-08-29 — **The auto-seeded context map misfiles some `app/_lib` modules.**
  `lib-analytics-2` contains `distribution.ts` (the devcase distribution seam) and
  `source-repo.ts` (the AGPL source link), neither of which is analytics. Read the file list,
  not the context name, before scoping a sweep — and the map is 255 commits stale as of this
  run.
- 2026-08-29 — **`.personas/contexts.txt` really is the outbox authority.** The analytics
  slugs there (`analytics-funnel-forecast`, `analytics-channel-roi`, `analytics-core-tab`,
  `pipeline-analytics`) share **no** name with the map's `lib-analytics-1` / `lib-analytics-2`.
  One map context maps to several app slugs; emit one node per slug actually touched.
- 2026-08-29 — **Normalize to LF before every `git add`.** This checkout is
  `core.autocrlf`: the committed files are LF, the worktree is CRLF, and editing through
  anything that preserves the working-tree bytes re-commits the WHOLE file (measured: 861
  insertions / 812 deletions for a 20-line change to `puml/parse.ts`). The pathspec
  stage-verify catches a foreign FILE, not a rewritten line ending — read the insertion
  count too. Fix before staging: `python -c "import io;d=io.open(P,'rb').read();io.open(P,'wb').write(d.replace(b'
',b'
'))"`.
  The architect overlay documents this for the `*.generated.ts` files; it applies to **any**
  file edited by a tool that round-trips bytes.
- 2026-08-29 — **`design:check` does NOT enforce the no-raw-hex law.** `.claude/CLAUDE.md`
  says "Never hardcode colors … Enforced by `npm run design:check`". The gate does
  brand.ts↔globals.css lockstep plus Tailwind *shade* parity, and never scans for hex
  literals — 75 sit across `app/`. Treat a raw hex as a finding on its own merits; do not
  assume the gate saw it. Related trap: importing `app/_lib/brand.ts` puts a literal under
  the lockstep rule, which proves it matches its **Studio Light** token and says nothing
  about whether the surface flips. Lockstep is not theming.
- 2026-08-29 — **Read `docs/design/README.md` before forming a UI finding, not after.** It
  already carried the exact rule the puml renderer broke, with a prior sighting — which
  reframed the item from "a bug" to "a second instance of a known trap" and made the doc
  update worth writing.
- 2026-08-29 — **Read `docs/features/<area>/README.md` § Known gaps before wandering.** The
  highest-value item of run 3 was sitting there fully diagnosed, with the remaining edit
  named, written and never done (the metric pack's `certifiable` on a thin sample). This repo
  keeps an honest Known-gaps section per feature area: it is a pre-verified backlog, and
  reading it is Phase 1 work, not a lucky detour in Phase 4.
- 2026-08-29 — **Two standing `/architect` questions this loop keeps re-finding**, both
  ADR 0007's own argument ("a repo law that isn't a gate isn't a law"): `design:check` does
  not enforce the no-raw-hex law `.claude/CLAUDE.md` cites it for (75 literals in `app/`),
  and ~18 bare `localeCompare` sites break a collation rule stated in three separate comments
  (`DecisionRecordsTable`, `useMatrixTab`, `DecisionLogTable`) and enforced nowhere.
  `no-restricted-syntax` is this repo's idiom for both.
- 2026-08-29 — **This repo's tests can only be run through `npm run test:unit`.** A direct
  `node --test <file>` fails on extensionless imports (`ERR_MODULE_NOT_FOUND` on
  `./candidate-nps`) for any module that has them — that is the invocation, not the code.
  Single-file `node --test` still works for modules whose imports are all extension-qualified,
  which is why it looks reliable until it isn't.
- 2026-09-01 — **The commit-msg hook rejects the skill's `explorer:` subject.** `scripts/release/commit-msg.mjs`
  only admits conventional types (`fix`, `feat`, `docs`, `security`, …) and also rejects a subject that
  reads like a report heading ("report a … miss"). Write the subject for the diff — `fix(jobs): …` —
  and put "Surfaced by /explorer (…, item N)" in the body. Three commits bounced before this was clear.
- 2026-09-01 — **A source-guard test can pin the SHAPE of a call, not just its presence.**
  `save-ingest-contract.test.ts` requires `jobId` inside the `insertJob(...)` parentheses; wrapping the
  argument in a helper broke it. Inline the helper call rather than loosen the guard.
- 2026-09-01 — **Two unit tests are red on `main` (c6a63199) and are not this area's:**
  `app/api/decisions/decisions-auth.test.ts` (open-mode reads 500) and
  `app/api/pipeline/pipeline-routes.test.ts` (reject → `/api/comms?entry=` 500,
  `request.nextUrl.searchParams` on a plain Request). Verified on a clean `git archive main`.
- 2026-09-01 — **`scripts/perf/check-budget.mjs` has no `perf-budget.json`** in this checkout, so the
  module-graph budget for the `job-ingest.ts` hub cannot be run; `ci:budget` is a different check.
- 2026-09-01 — **This worktree has no `.personas/`** (it lives only in the main checkout), so the
  memory-outbox step is skipped there; write it from the main checkout if the run is replayed.

