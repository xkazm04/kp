---
product: "kp (CandiDate / KP studio)"
stack: "self-hostable AI recruiting studio — Next.js 16.3 canary (Cache Components + partialPrefetching) + React 19 + TS + Tailwind 4, better-sqlite3 at data/kp.sqlite, custom HMAC session auth, a per-request-spawned Python jobfit pipeline (pipeline/jobfit), a multi-provider LLM layer that degrades keyless, next-intl across 4 locales"
vault: ["C:/Users/kazda/Documents/Obsidian/kp"]
vault_subdir: Architect
context_map: context-map.json
coverage_context_source: ".personas/contexts.txt"
base_branch: main
worktree_root: .claude/worktrees
active_runs_ledger: ""
knowledge_registry: ../ai-registry
knowledge_domains: [software-engineering, recruiting, localization]
---

# architect overlay — kp

Sits beside `.claude/perfect/config.md` and `.claude/ship-loop/config.md`; the facts below are the
same repo law, stated for a structural scan. `/perfect` walks contexts for product value, `/scan-sweep`
walks them for defects — **`/architect` walks them for structure**: shapes that repeat wrongly across
contexts, and shapes that repeat rightly and deserve a gate.

## Context sources

1. `context-map.json` — 143 contexts / 17 groups, machine authority for area scope and file lists.
   Keys: `filePaths`, `apiRoutes`, `description`. Every tracked `.ts/.tsx/.py/.mjs` file is in exactly
   one context; there is no unmapped remainder.
2. `.claude/CLAUDE.md` — the real rules file (root `CLAUDE.md` + `AGENTS.md` are thin pointers to it).
   Architecture overview, conventions, the gate list.
3. `docs/architecture/decisions/README.md` + the seven ADRs — **read before proposing any structural
   change.** Each record ends with the observation that would reopen it. A finding that re-litigates a
   settled ADR must cite that record's reopening clause or be dropped.
4. `docs/architecture/*.md` — the cross-cutting contracts (llm-provider-layer, workspace-data,
   self-hosting, app-structure, result-caching, localization).
5. `docs/design/README.md` — the dual-theme design system; required before any UI-shaped finding.

**The map and the app disagree — this is the silent-failure case the skill warns about.**
`.personas/contexts.txt` carries the app's 285 registered names (the pre-rescan slug taxonomy);
`context-map.json` carries 143 names from the 2026-08-21 regranulation. Measured overlap:
**6 of 143** (`billing`, `github-analysis`, `candidate-apply`, `brand-theming`, `db-core`,
`background-tasks`). So: **scope work by the map, but write memory-outbox `context` values from
`.personas/contexts.txt` verbatim**, translating by hand (a 143-map context usually spans several
285-set slugs — pick the closest one, or emit one node per slug you actually touched). A map name
written straight through stores a null context and never counts toward coverage, without erroring.
Re-measure this overlap whenever either side is regenerated.

## Area menu

Derived from the context map's groups (17), the eight with the most structural surface:

1. AI & LLM Infrastructure  (14 contexts — provider layer, prompts, python bridge)
2. Job & JD Management      (13)
3. Hiring Pipeline          (10 — the board, transitions, automation)
4. Design System & Shared UI (10 — recipes, primitives, dual theme)
5. Platform Infrastructure  (10 — db, auth, rate limiting, comms transport)
6. Developer Assessment     (9 — devcase)
7. Workspace Shell & Onboarding (9)
8. Candidate Public Surfaces (8 — tokenized routes, the public wire)

## Theme menu

Beyond the built-in nine, kp-specific themes worth a run:

- `keyless-degradation` — every LLM call site's no-key path; is the fallback real, disclosed, tested?
- `tenancy-scoping` — workspace scoping across repositories, per `app/_lib/tenancy.ts`'s fail-closed manifest
- `public-wire` — projections on `[token]` routes; what leaks past the allowlist
- `python-bridge` — the TS↔Python seam (`app/_lib/python-runner.ts`, `schemas:gen` codegen contract)

## Knowledge registry

`../ai-registry` (the path in `.ai/manifest.yaml` `registry.local`). Resolve a subject through
`knowledge/<domain>/index.json` → `subjects["<slug>"].file` — **never** build a path from the slug.
Domains: `software-engineering`, `recruiting`, `localization`.

Theme → governing subject, for the themes this repo actually scans:

| Theme | Subject(s) |
| --- | --- |
| `data-modeling` / persistence | `data-access` (techniques: `row-mapping`, `transactions-and-units-of-work`, `layering-rules`, `repo-testing`, `cross-driver-invariant-parity`), `migrations` |
| `python-bridge`, codegen contract | `codegen` |
| `api-boundary` / `public-wire` | `authorization`, `ipc-contract` |
| `keyless-degradation` | the `llm-agent` subjects; cross-check `cost-metering` |
| `tenancy-scoping` | `authorization`, `audit-logging` |
| `error-handling` | `data-access` § the honesty contract; the `failure-not-empty-success` law |
| build/release, gates | `build-economics`, `ci-execution-trust`, `conformance-checking` |
| a scan of the repo itself | `codebase-scanning`, `concurrent-vcs` |

The laws in `knowledge/software-engineering/_laws.md` are the sharpest instrument here —
`failure-not-empty-success`, `one-authority-per-vocabulary`, `one-validation-door`,
`deletion-is-not-repair`. A finding that cites a law is a deviation from a named standard rather
than a reviewer's opinion, and survives triage on different terms.

**Node applications are thin.** `data-access/applications/` carries `rust--query-construction`,
`rust--row-mapping`, `node--transactions-and-units-of-work` and
`node--cross-driver-invariant-parity` — there is **no `node--row-mapping`**. A kp finding about the
decode seam is therefore a candidate for the `registry` vehicle (7B.d2), not just a local fix.

## Gates

- baseline: `npm run typecheck`, `npm run lint`, `npm run test:unit`
- step: `npm run typecheck`, `npm run test:unit` (targeted where possible), `npm run lint`
- final: `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run design:check`,
  `npm run i18n:check`, `npm run docs:check`; `npm run test:python` when `pipeline/` was touched
- slow (background): `npm run test:e2e`, `npm run build`

`npm run typecheck` runs `schemas:gen` (Python) BEFORE tsc — Python and repo deps must be installed, and
it rewrites `app/_lib/*.generated.ts`, so typecheck again after any build that regenerates them. Those
generated files being dirty in `git status` is normal, not your change.

## Repo law

Authority: `.claude/CLAUDE.md`; `docs/design/README.md` for UI; `node_modules/next/dist/docs/` for Next.

- **This is NOT the Next.js you know** — 16.3 canary with `cacheComponents` + `partialPrefetching`.
  Read the guide in `node_modules/next/dist/docs/` before Next-specific code; `runtime`/`dynamic`
  route configs are banned. (ADR 0001.)
- **Pathspec commits only.** Parallel agent sessions share this checkout. `git add <path> <path>`,
  never `-A`/`.`/`-u`; never `git stash`, `reset --hard`, `restore`, `checkout --` on foreign work.
  Verify `git diff --cached --stat` before every commit and unstage strangers.
- **4-locale parity.** A key added to `messages/en.json` lands in `cs`/`de`/`fr` in the same change;
  next-intl keys are typed, so an incomplete catalog breaks `typecheck` for everyone.
- **Design tokens.** No raw hex/rgba outside `app/landing/`; brand tokens first, then theme-remapped
  neutrals; compose from `app/_components/ui/recipes.ts`; both themes verified. `design:check` is the gate.
- **Rate-limit contract tests pin limiter call sites** (`app/api/rate-limit-contract.test.ts`) — moving
  or re-keying a limiter means updating the contract deliberately, not deleting the assertion.
- **Tenancy manifest is fail-closed** (`app/_lib/tenancy.ts`) — any new persistent table is a reported
  gap until scoped and listed, each proven by a colocated `*-tenancy.test.ts`.
- **Candidate token routes carry a projection, not the row** (see `publicInviteView`).
- **`maxDuration` is serverless-only** — self-hosted `next start` does not kill long handlers.
- **Doc-sync in the same change.** A Stop hook runs `scripts/docs/check-doc-sync.mjs`; mapped source
  changed without a doc touch exits 2. Update the doc `scripts/docs/feature-doc-map.json` names, or
  reply once why none is needed.
- Out of scope by default: `app/landing/` art direction, `messages/*.json` beyond parity, generated
  files (`*.generated.ts`, `.next/`), `data/*.sqlite`.

## Docs vehicles

- **`docs/architecture/decisions/NNNN-<slug>.md`** — the primary vehicle for a shipped architect
  decision, and what distinguishes kp from the skill's default: the vault ADR is memory, the repo ADR
  is the artifact other agents will actually read. Follow the README's front-matter shape (`id`,
  `status`, `sources:` real paths, a **What would change our mind** section), add the index row, and
  run `npm run docs:check` — it fails when a `sources:` path stops existing or the index drifts.
- `docs/architecture/<contract>.md` — for a boundary fact rather than a decision.
- `.claude/CLAUDE.md` § Important Conventions — for a project-wide convention every session must load.
  Keep it to the "ones that actually bite" register the section already uses.
- `docs/features/<area>/README.md` — behavior docs; mapped by `scripts/docs/feature-doc-map.json`.

## Lint vehicle

`eslint.config.mjs` (flat config, 207 lines). The repo's own custom-rule idiom is
**`no-restricted-syntax` with an AST selector and a message that explains the rule** (see the block at
line 63) plus `eslint-plugin-i18next` for the string contract — there is no local rule-plugin
directory. Prefer a `no-restricted-syntax` selector; write a real plugin rule only when a selector
genuinely cannot express the invariant, and say so. New rules start at `warn`.

## Test guard vehicle

`node:test` over `app/**/*.test.ts` with process isolation (`npm run test:unit`); `.mjs` script tests
run the same way (`scripts/app-master-bench/*.test.mjs`, `scripts/docs/__tests__/`). Structural guards
belong beside what they guard, and this repo already has the shape: `app/api/rate-limit-contract.test.ts`
(pins limiter call sites), `*-tenancy.test.ts` (proves table scoping). Imitate those, and prefer
extending an existing contract test to adding a parallel one.

ADR 0007 — *a repo law that isn't a gate isn't a law* — is the standing argument for choosing a lint
rule or test guard over prose whenever the invariant is mechanically checkable.

## Smoke

`npm run dev` and read dev-guard's "already running" banner for the live port — the port is volatile on
this box, do not assume `:3000`. Verify UI in BOTH themes (appearance control on the sidebar rail) and
at least one non-`en` locale. Without a browser: `curl` the touched route (add
`-H "Cookie: NEXT_LOCALE=cs"` for locale checks) and grep for the surface's markers, then say plainly
which half stayed unverified.

## Baseline exclusions

- `app/_lib/schemas.generated.ts`, `app/_lib/taxonomy.generated.ts` — rewritten by `schemas:gen` on
  every `typecheck`, so they are dirty in almost every session. Never a finding. **But the dirt is
  only CRLF churn** — the Python generator writes CRLF on Windows while the committed files are LF —
  so a real semantic change to them hides inside a whole-file diff. When one of these legitimately
  changes (a Python model edit), run `sed -i 's/\r$//'` on it before staging and the diff collapses to
  the actual line. Verified 2026-08-28: normalizing reduced a 752-line diff to one line, and left
  `taxonomy.generated.ts` with no diff at all.
- `app/landing/` — a fixed art direction, exempt from the token rule by design.
- `docs/_archive/` — superseded; not current, not a drift finding.
- The Vibeman `backlog:idea-*` inventory — already-triaged ideas, not architect findings.
