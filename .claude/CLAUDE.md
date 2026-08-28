# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

kp (CandiDate / KP studio) — a self-hostable recruiting studio: JD library +
AI job-description builds, CV analysis and job-fit scoring, a pipeline board
with automation, candidate self-scheduling, AI voice interviews, work-sample
"devcase" assessments, comms outbox, analytics, and Polar prepaid billing.

Stack, in one breath: **Next 16 (canary) + React 19 + TypeScript**, Tailwind 4,
**better-sqlite3** at `data/kp.sqlite` (override with `KP_DB_PATH`; a fresh DB
self-seeds the demo corpus from `data/seed_*`), custom **HMAC session auth**
(`KP_OPERATOR_PASSWORD` unset = open dev mode; production **fails closed**
unless `KP_ALLOW_OPEN=1`), a spawned **Python jobfit pipeline**
(`pipeline/jobfit/`, launched per request via `app/_lib/python-runner.ts`), a
**multi-provider LLM layer** (`app/_lib/llm-config.ts` ↔
`pipeline/jobfit/llm/capabilities.py`; Claude CLI is the local default, with
Gemini / OpenAI / Azure / OpenRouter adapters) that **degrades gracefully
keyless** — deterministic fallbacks instead of crashes is a product property —
and **next-intl** with 4 locales (`en` default, `cs`, `de`, `fr`; catalogs in
`messages/`).

## Common Commands

```bash
npm run dev                 # dev server via dev-guard (Next allows ONE dev server
                            # per checkout — the lock is .next/dev/lock)
npm run dev:empty           # second, isolated empty-DB dev server (.next-empty + kp-empty.sqlite)
                            # DevInspector is ON here (dev:inspect's env, `-- --no-inspect` opts out)
npm run typecheck           # GOTCHA: runs schemas:gen (python -m pipeline.jobfit.codegen)
                            # BEFORE tsc — Python + repo deps must be installed
npm run lint                # eslint
npm run test:unit           # node:test over app/**/*.test.ts (process isolation)
npm run test:python         # Python unit tests
npm run test:python:gate    # gated Python suite (CI gate)
npm run design:check        # design-token lint (no raw hex outside app/landing/)
npm run i18n:check          # 4-locale message parity gate
npm run test:e2e            # Playwright — boots the dev webServer on :3101
KP_E2E_BASE_URL=http://localhost:3101 npx playwright test <specs>
                            # …against an ALREADY-RUNNING server (skips webServer;
                            # see e2e/journey-role-to-schedule.spec.ts header for
                            # the keyless prod-build invocation)
npm run build               # schemas:gen + next build (safe beside a running dev
                            # server: build cleans .next but preserves cache|dev|lock|trace)
npm run start -- --port N   # prod server; keyless/open deploys need KP_ALLOW_OPEN=1
```

## Architecture Overview

```
app/
├── page.tsx + landing/       # public Spark landing; '/' is gated SERVER-SIDE
│                             # (kp_entered cookie + first-run onboarding wizard)
├── features/shell/           # the ?tab=-driven single-page workspace; tab ids
│                             # live ONCE in app/features/shell/tabs.ts
├── features/{hiring,library,…}/  # feature modules behind the tabs
├── api/                      # route handlers; the public allow-list is
│                             # app/_lib/auth/public-routes.ts; sensitive routes
│                             # re-verify via requireOperator (defense in depth)
├── _lib/                     # domain logic + DB (app/_lib/db/*, repository-style
│                             # modules over better-sqlite3), auth, comms, schedule,
│                             # llm config, rate limiting
├── _components/              # shared primitives + ui/recipes.ts (PANEL, BTN_*, …)
├── schedule/[token], interview/[token], apply/[id], devcase, status/[token]
│                             # PUBLIC tokenized candidate surfaces — capability
│                             # links, never sessions; keep internal ids off the wire
pipeline/jobfit/              # Python side: extraction, scoring, LLM registry,
│                             # codegen (schemas:gen keeps TS/Python schemas in sync)
messages/{en,cs,de,fr}.json   # next-intl catalogs — en is the source of truth
e2e/                          # Playwright; deterministic keyless subset =
                              # journey-role-to-schedule + modal-escape + profile-builder
                              # + app-master-hire (the App-master battle test —
                              # mock Personas bridge, needs KP_OFFLINE=1 and
                              # KP_APP_MASTER_REPO_ROOTS on the SERVER process)
```

Recurring patterns worth imitating: literal-array + derived-union + runtime
guard for closed vocabularies (`tabs.ts`, `i18n/locales.ts`); IMMEDIATE
transactions for read→compute→write (`actOnPipelineEntry`); truthful delivery
claims (`sent`/`queued`/`failed`, never a green lie); per-IP/per-token
`rateLimit()` on every open route that spends money or spawns a subprocess.

## Design system — dual theme (read docs/design/README.md before building UI)

The app ships **two themes from one codebase**: **Studio Light** (default —
calm, editorial; for corporate clients) and **Spark Dark** (experimental —
playful, sticker-sheet, derived from the /landing art direction; for creative
users). `[data-theme="dark"]` on `<html>` re-skins everything through the CSS
variables in `app/globals.css`; `NavRailPreferences` in the sidebar rail flips
it (`app/features/shell/nav/NavRailPreferences.tsx`).

When writing or changing components, always assume **both** themes:

- **Never hardcode colors** (`bg-[#...]`, inline `style` colors, rgba shadows)
  outside `app/landing/` — that directory is a fixed art direction and the only
  exemption. Everything else resolves through tokens. Enforced by
  `npm run design:check` — do not work around it.
- Use brand tokens first (`ink`, `paper`, `steel`, `coral`, `moss`,
  `limewash`, `dial-*`, `score-*`), then the theme-remapped neutrals
  (`white`, `stone-50..400`) and the mapped status shades (`red/amber/green/
  blue` — only shades already listed in the `[data-theme="dark"]` block; add
  the dark value when introducing a new one).
- `text-white` means "surface-colored text on an accent background" — it
  flips dark in dark mode by design.
- Compose recurring surfaces from `app/_components/ui/recipes.ts` (PANEL,
  CHIP, BTN_*, EYEBROW, FIELD…) instead of re-typing Tailwind class strings —
  write once, apply multiple times. Behavioral primitives (Modal, Badge,
  SegmentedControl, Skeleton) live in `app/_components/`.
- The themes differ in **structure**, not just color (Spark Dark: drawn
  outlines, sticker shadows, tilt, Bricolage display face, spring easing).
  Express a theme difference at the cheapest layer that holds it: token →
  `dark:` variant in a recipe (the `dark:` variant follows `data-theme`, not
  the OS) → markup fork via a CSS-swapped component like `SectionTitle`, whose
  dark-only squiggle is just `hidden dark:block` (for arbitrary two-version
  markup use `hidden dark:contents` / `contents dark:hidden` — stock Tailwind;
  there is no `.theme-light-only`/`.theme-dark-only` utility pair, an earlier
  revision of this file named one that does not exist) → behavioral fork via
  `useTheme()` (both in `app/_components/ui/`). Never a JS fork where CSS
  suffices.
- Verify new surfaces in both themes before finishing (the appearance control
  on the sidebar rail).

## Documentation Sync — update the doc in the same change

`docs/` is genre-partitioned and each feature area owns a folder. Read
[`docs/README.md`](../docs/README.md) for the full layout; the short version:

| Directory | Holds |
| --- | --- |
| `docs/features/<area>/` | What is implemented today, one folder per feature area |
| `docs/architecture/` | Cross-cutting contracts (LLM layer, persistence, self-hosting, app structure) |
| `docs/design/` | The dual-theme design system — **read before building UI** |
| `docs/development/` | Eval/calibration harnesses and how to run them |
| `docs/product/` | Market, roadmap, enterprise track |
| `docs/concepts/` | Proposals not yet implemented |
| `docs/_archive/` | Superseded material. Do not treat as current |

**The rule: when you change behavior, update the doc that describes it in the same
change.** A feature doc that names a moved file or a renamed stage is worse than no doc —
that drift is exactly why this tree was reorganized (the design doc had been claiming the
wrong `paper` token for weeks; the pipeline spec still used stage names the code dropped).

### Source → doc coupling

[`scripts/docs/feature-doc-map.json`](../scripts/docs/feature-doc-map.json) maps source
globs to the doc that documents them — e.g. `app/_lib/comms*.ts` + `app/api/comms/**` →
`docs/features/comms/README.md`, `app/_lib/voice/**` + `app/api/interview/**` →
`docs/features/interviews/README.md`.

When you add a feature area, add its entry to that file **in the same change**, or nothing
will watch it.

### The Stop hook

`.claude/settings.json` registers a Stop hook running
`node scripts/docs/check-doc-sync.mjs` before each turn ends. It walks the turn's
transcript for `Edit`/`Write`/`MultiEdit`/`NotebookEdit` calls, drops skip patterns (tests,
generated code, `.claude/`, `app/landing/`, docs themselves), matches the rest against the
map, and **exits 2 naming the affected doc(s)** when mapped source changed and no file
under `docs/features/`, `docs/architecture/`, or `docs/design/` was touched.

When you see the reminder, **either** update the named doc in that turn, **or** reply with
one short sentence — `"internal-only, no doc update needed"` — explaining why. Do not
ignore it silently. The dismiss path is the deliberate trade-off for catching drift
per-session instead of via periodic cleanups.

The hook honors `stop_hook_active`, so it cannot loop. Fixtures:
`node scripts/docs/__tests__/check-doc-sync.test.mjs` (19 checks, no deps) — they also
validate the map itself: every mapped doc must exist and every glob root must resolve.

### Writing a feature doc

Entry points → user flows → API/lib surface table → data model → a **short** Known gaps
section. Cite real paths and verify they exist. State tier/env/dev-flag gating explicitly,
and describe keyless behavior — degrading without API keys is a product property here.
Anything future-looking belongs in `docs/concepts/` or `docs/BACKLOG.md`, not in a feature
doc.

## Important Conventions

The ones that actually bite:

- **Shared checkout, parallel agents — pathspec commits ONLY.** Multiple agent
  sessions work in this checkout concurrently on disjoint files. Stage with
  `git add <path> <path>` (never `-A`/`.`/`-u`), never `git stash` or discard
  work that isn't yours, and before committing check `git diff --cached --stat`
  — if the staged count exceeds what you added, another session pre-staged
  files; `git restore --staged` the strangers first.
- **4-locale message parity.** Every key added to `messages/en.json` must land
  in `cs`/`de`/`fr` in the same change. Enforced by `npm run i18n:check` — do
  not work around it (next-intl keys are also TYPED: a `t("missing.key")` is a
  `tsc` error, so an incomplete catalog breaks `npm run typecheck` for
  everyone).
- **Design tokens:** see the design-system section above (`design:check` is the gate).
- **Never `await` inside a `db.transaction()`.** better-sqlite3 transactions are
  synchronous; an await yields the event loop between BEGIN and COMMIT and the
  atomicity is silently gone — no error, no failing test. Do the slow work (LLM
  call, Python subprocess, fetch) OUTSIDE the transaction and bridge the gap with
  a compare-and-swap on the row you read: `actOnPipelineEntry`
  (`app/_lib/db/pipeline.ts`) is the canonical shape — `.immediate()` plus
  `expectedStage`/`expectedApprovalKind`, so a decision computed during a
  30-second call is safely dropped if the row moved. Enforced at `error` by
  `no-restricted-syntax` in `eslint.config.mjs`.
- **A read→compute→write either locks or re-checks.** The two valid strategies are
  `db.transaction(...).immediate()` (write lock at BEGIN) or a compensating
  precondition in the UPDATE's `WHERE` plus a `res.changes === 0` skip. Pick one
  deliberately; a plain `tx()` whose UPDATE does not re-assert the status its
  SELECT filtered on is a lost update (see `closeEntriesByJobId` /
  `reopenEntriesByJobId` for the wrong and right shapes of the same operation).
- **A one-shot seeder records that it ran** in `seed_marks`, never `COUNT(*) > 0`
  — a row count cannot tell "never seeded" from "seeded, then legitimately
  emptied", and the difference is demo data reappearing in a real install
  (`app/_lib/db/seed-marks.ts`).
- **Rate-limit contract tests pin limiter call sites.**
  `app/api/rate-limit-contract.test.ts` asserts which open/paid routes call
  `rateLimit()` and how — adding, moving, or re-keying a limiter means updating
  the contract test deliberately, not deleting the assertion.
- **Tenancy manifest is fail-closed.** `app/_lib/tenancy.ts` allowlists
  verified workspace-scoped tables (each proven by a colocated
  `*-tenancy.test.ts`) and genuinely-global exempt tables; ANY new persistent
  table is a reported gap until scoped + listed. Don't "fix" the gap by adding
  the table to the exempt list without the reasoning to back it.
- **`maxDuration` is serverless-only.** Self-hosted `next start` does not kill
  long handlers — route-level timeouts (e.g. the extract-text child-process
  timeout) are the real bound; don't rely on the platform.
- **Candidate token routes carry a projection, not the row.** Public
  `[token]` responses expose an explicit field allowlist (see
  `publicInviteView` in `app/api/schedule/[token]/route.ts`) — never serialize
  a store row onto the public wire.

## AI registry (knowledge + skills)

This repo is wired to the organization's AI registry - ONE local checkout, at the path in
`.ai/manifest.yaml` under `registry.local` (default `../ai-registry`).

- **The knowledge is already loaded.** `.claude/rules/ai-registry-*.md` are links to the
  registry's generated rules: the access contract, plus a subject map for every domain in
  `.ai/manifest.yaml` `knowledge.domains`. Rules load in every session, so the corpus is in
  front of you without invoking anything. Before a design, architecture or product decision
  in a covered domain, open the governing subject - resolve it through
  `knowledge/<domain>/index.json` (`subjects["<slug>"].file`), never by building a path from
  a slug. Where this repo falls short of the standard, that is a deviation to record, not a
  reason to lower the standard. `/consult <topic>` does the same read deliberately and logs
  it so the registry can see which knowledge is actually reached for.
- **Shared skills are links, not copies.** Every name in `.ai/manifest.yaml` `skills:` is
  linked from `.claude/skills/<name>` into the registry's lane, so there is exactly one file
  on this machine: editing a shared skill from this repo edits the registry's file, and the
  change is live in every project immediately. Never copy a registry skill in - a real
  directory under `.claude/skills/` is a project-owned skill and must carry its own name.
- **After changing the manifest**, re-link with `node <registry>/scripts/link-registry.mjs`
  (`--check` verifies without writing). Project-specific configuration for a shared skill
  lives in its committed overlay, e.g. `.claude/perfect/config.md`.
