# env.md — how to reach a known, reproducible start state (THE per-app file)

This is the only file the `/uat` engine reads for app-specific run mechanics.
Everything below is derived from the codebase; **open questions** are flagged —
resolve them before relying on L2.

## App at a glance

- **What it is:** an AI recruiting / hiring platform aimed at a Czech retail bank
  (seeded with **Česká spořitelna** roles via `pipeline/jobfit/seed_jobs_csas.py`).
  Spans CV analysis & job-fit, candidate↔job matching, JD library, sourcing &
  rediscovery, pipeline board, screening decisions, group-eval/fairness, comms,
  voice + scheduled interviews, offers/onboarding, a dev-hiring extension,
  analytics/calibration, billing, and a guided simulation.
- **Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 ·
  `next-intl` · `better-sqlite3` (local DB) · Python pipeline (`pipeline/jobfit`)
  shelled out from API routes · Gemini (`@google/genai`) for extraction/analysis ·
  OpenAI Realtime / ElevenLabs for voice.
- **Two themes from one codebase:** Studio Light (default) + Spark Dark
  (`[data-theme="dark"]`). Verify surfaces in both where UX is theme-sensitive.

## Run recipe

| Thing | Value |
|---|---|
| Install | `npm install` (Node), `pip install -e .` / project Python env for the pipeline |
| Dev server | `npm run dev` (wraps `next dev` through `scripts/dev-guard.mjs`, which reaps the whole process tree on exit — important on Windows) |
| Port | **Pin :3005** — on 2026-06-19, ports 3000–3004 + 3100 were all busy (many apps running in parallel), so do NOT rely on Next auto-bump. Start kp explicitly: `npm run dev -- -p 3005` (passes `-p 3005` through dev-guard → `next dev`). Set `BASE_URL=http://localhost:3005`. Re-check free ports before each L2 (`Get-NetTCPConnection -State Listen`) — the free port may differ next session. |
| Health check | `GET /api/health` |
| Build | `npm run build` (runs `schemas:gen` first) |
| Stop / recover | Ctrl-C reaps the tree. If wedged (`ECONNREFUSED`, Turbopack "corrupted database" after a `git checkout`): kill the port, delete `.next`, restart, re-poll. |

> **Server lifecycle:** reuse an already-running dev server — do **not** start a
> second instance (the dev-guard's storm breaker may also be armed via
> `dev:inspect`). If none is up, start `npm run dev` in the background and poll
> `/api/health` for 200 before driving.

## Auth — the offline path (the big unlock for authed coverage)

Two layers:

1. **Dev gate (use this for L2 of authed surfaces).** A localStorage flag,
   `kp_dev_authed = "1"`, flips `/` from the public landing to the authed
   workspace dashboard. Dev-only (`NODE_ENV !== "production"`); in prod the gate
   is off and real cookie auth takes over. See `app/_lib/auth/devAuth.ts` and the
   pre-paint bootstrap in `app/layout.tsx` (both hardcode the same key — kept in
   lockstep). **The bundled driver seeds this via `addInitScript` (DEV_AUTH=1,
   the default).**
2. **Real auth:** `/login` → `POST /api/auth/login` (cookie session), with
   multi-workspace tenancy. Not needed for local L2; note it exists.

**Candidate / public surfaces are tokenized** (`/apply/[id]`, `/status/[token]`,
`/schedule/[token]`, `/offer/[token]`, `/onboarding/[token]`, `/data/[token]`,
`/skill/[token]`, `/interview/[token]`, `/devcase/apply/[token]`). To reach these
you need a **valid token** from seeded/created data — set `DEV_AUTH=0` and
navigate with a real token (see *Seeding* for how to mint one). **Open question:**
the cleanest way to obtain a fresh token locally (seed output? an API echo? a
dev-only listing?) — resolve and record here.

## Language (bilingual — this app is tested in BOTH)

`next-intl` with `messages/cs.json` + `messages/en.json`. Target customer is a
Czech bank → **Czech is the primary internal-user language**; the external
buyer/evaluator and the international dev candidate use **English**.

- Locale switch: `LandingLangSwitch` on the marketing pages; in-app switch lives
  in the shell. Driver sets `NEXT_LOCALE` cookie + browser `locale` via `LOCALE=cs|en`.
- **Open question:** the workspace's default locale on a fresh dev session
  (cs or en?) and exactly how the in-app switch persists — confirm at L2 and
  record. The `npm run i18n:check` script + `eslint-plugin-i18next` guard missing
  keys; an untranslated string surfacing in the "wrong" language is a finding.

## Seeding local authed data

SQLite-backed; rich seeders under `pipeline/jobfit/`:

- `seed_jobs_csas.py` — the Česká spořitelna job corpus (real target customer).
- `seed_jobs.py` / `seed_candidates.py` / `seed_pipeline.py` — generic jobs,
  candidates, and a populated pipeline.
- `eval/seed_cv_fixtures.py` — renders candidates → CVs and runs **real** Gemini
  analysis into the analyses DB (needs a Gemini key; slow).
- `seed_interview_calendar.py` — interview slots; `seed_analyses.py` — analyses;
  `devcase/seed_materializer.py` — dev-case content.
- DB snapshot helpers: `npm run db:dump` / `npm run db:load`
  (`scripts/db-dump.mjs` / `db-load.mjs`) — capture a known-good state and
  restore it before a run for reproducibility.

> **Reproducible start state (recommended):** load the ČS corpus + a seeded
> pipeline, snapshot with `db:dump`, and `db:load` that snapshot at the top of
> each L2 run so Characters always meet the same data.

## API keys

- **Gemini** (`@google/genai`) powers extraction/analysis; **OpenAI Realtime /
  ElevenLabs** power voice. Keys are managed in-app (`/api/llm/keys`,
  `/api/llm/config`) and/or via env. **AI surfaces will be slow or degraded
  without keys** — an AI journey run keyless is out-of-scope for quality
  findings (note it), but structural L1 still applies. Budget 30–130s per AI call
  at L2; an early client timeout is itself a finding.

## Surface inventory (from the router + context-map.json)

**Authed workspace** (dev-gate on): `/` (tabbed dashboard — the main app),
`/control`. Tabs are defined in `app/features/tabs.ts` / `app/features/Workspace.tsx`.

**Public / marketing:** `/landing`, `/landing/spark`, `/about`, `/login`,
`/diagrams`, `/interview-lab`.

**Public / candidate (tokenized):** `/apply/[id]`, `/apply/[id]/quick`,
`/devcase/apply/[token]`, `/interview/[token]`, `/schedule/[token]`,
`/status/[token]`, `/offer/[token]`, `/onboarding/[token]`, `/data/[token]`,
`/skill/[token]`, `/jds/[slug]`, `/history/[slug]`.

API routes live under `app/api/**` (see `context-map.json` `apiRoutes` per context).

## Required fixtures + preflight (run BEFORE any L2 — a Character with no fixture is untestable, not passing)

Each Character binds to a surface set (see their `Surface binding` + `rubric.md`
reachability). L2 cannot start until that surface has a fixture. Preflight checklist:

| Fixture | For whom | How to create | Verifies |
|---|---|---|---|
| Dev gate seeded | all internal users | driver sets `kp_dev_authed=1` (DEV_AUTH=1) | workspace renders at `/` |
| ČS job corpus + seeded pipeline | Petra, Jana, Marek, Tomáš, Kateřina | `seed_jobs_csas.py` + `seed_pipeline.py`, then `npm run db:dump` snapshot | jobs/board/decisions have real data |
| Seeded analyses | Petra, Eva, Kateřina | `eval/seed_cv_fixtures.py` (needs Gemini key) / `seed_analyses.py` | Analyze + Matrix + calibration populated |
| Dev case + submission | Eva, Sam | `devcase/seed_materializer.py` + create/publish a case | dev workspace + eval have content |
| **Candidate token / public link** | **Tereza, Sam** | mint a real token for `/apply` `/status` `/schedule` `/offer` `/onboarding` `/devcase/apply` — **OPEN QUESTION (see below): nail the local mint path** | the tokenized pages open at all |
| Interview calendar slots | Marek, Tomáš, Tereza | `seed_interview_calendar.py` | scheduling has selectable slots |
| AI keys present | any AI surface | `/api/llm/keys` or env (Gemini / OpenAI / ElevenLabs) | quality (senior-bar) findings are in scope, not `scope_note` |

> **The candidate-token fixture is the single biggest L2 blocker.** Without it,
> Tereza's and Sam's entire journeys are `unreachable`, not failing — resolve the
> mint path (open question #3) before scheduling their L2.

## Open env questions (resolve before/at first L2)

1. ~~Confirm the dev port~~ → **pinned :3005** (3000–3004 busy on 2026-06-19); re-check free ports before each L2 session as the set changes.
2. Confirm fresh-session default locale + how to force cs vs en deterministically.
3. Establish the clean way to mint a candidate **token** locally for the
   tokenized public flows (apply/status/schedule/offer/onboarding/devcase).
4. Decide the canonical seed snapshot (ČS corpus + seeded pipeline) and wire
   `db:load` of it into the run preamble.
5. Confirm which AI keys are present locally (Gemini / OpenAI / ElevenLabs) — it
   bounds which quality (senior-bar) findings are in scope vs `scope_note`.
