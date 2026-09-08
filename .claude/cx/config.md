---
product: "kp (KandiDate / KP studio)"
surfaces: ["studio", "public"]        # studio = the operator workspace behind the gate; public = visitor + candidate pages (landing, signup, tokenized candidate doors)
vault: ["C:/Users/kazda/Documents/Obsidian/kp", "C:/Users/mkdol/Documents/Obsidian/kp"]   # per machine; first existing wins
vault_subdir: Cx
design_doc: docs/design/README.md
screens_source: app/features/shell/tabs.ts   # NAV_GROUPS is the studio inventory; public doors are the app/<dir>/[token]/page.tsx routes listed under ## Screens
executor: opus
stops_per_session: 3
commit_format: "<feat|fix|style>(cx/S<n>): <screen> - <what changed, in the user's words>"   # the repo's commit gate (scripts/release/commit-msg.mjs KNOWN_TYPES) has no `cx` type; the skill's `cx(S<n>):` shape is rejected by the commit-msg hook
---

# cx overlay - kp

Sits beside `.claude/explorer/config.md`, `.claude/perfect/config.md` and `.claude/spark/config.md`
and states the same repo law for a **journey walk**. `/explorer` finds defects, `/architect` finds
structure, `/perfect` builds value; **`/cx` walks the product the way a user does, one screen in one
scenario at a time, and lands the friction fixes.**

## Journeys

Personas are the UAT Characters in `uat/characters/` (read the file before walking their journey;
each carries a language and a bar). The seed below covers the whole customer journey: a buyer
arriving cold, the two operator roles, the candidate, and the coordinator who keeps it running.

- Helena (buyer, `helena-buyer`, en) - evaluate and enter: arrives from a search or a referral, wants to know what this is, what it costs and whether it can be trusted, and to reach a working workspace - success: a workspace she can show her team, and a price she can defend
- Petra (recruiter, `petra-recruiter`, cs) - from a hiring need to a defensible shortlist: opens a role, gets a JD, analyzes CVs, ranks the pool - success: a ranked list with a reason per candidate she could hand to a manager
- Tomáš (hiring manager, `tomas-hiring-manager`, cs) - approve, meet, decide: reviews what the recruiter and the AI propose, approves an advance, gets an interview booked, sees the work sample - success: one approved advance with an interview on the calendar, in under ten minutes of his time
- Tereza (candidate, `tereza-candidate`, cs) - apply and stay informed: applies from a phone, checks where she stands, books a slot, takes the AI interview, reads the offer - success: applied in minutes and never had to ask "what happened to my application"
- Marek (coordinator, `marek-coordinator`, cs) - keep it running truthfully: watches channels, delivery, AI activity and the settings that shape the pipeline - success: nothing is silently stuck and every "sent" is true

## Screens

`id - surface - how to reach it`. Studio tabs are `/?tab=<id>` behind the `kp_entered=1` cookie
(open dev mode: no `KP_OPERATOR_PASSWORD`). Legacy aliases in `LEGACY_TAB_ALIASES`. The sidebar
rail's appearance control flips Studio Light / Spark Dark (`localStorage kp-theme`).

- landing - public - `/` with no `kp_entered` cookie (server-gated in `app/page.tsx`)
- about - public - `/about`; siblings `/trust`, `/privacy`, `/terms`, `/market`
- signup - public - `/signup`; login - `/login`
- first-run wizard - studio - `/?onboarding=1` (single-load escape hatch; otherwise fires once on a fresh DB, `app/_lib/auth/onboarding-gate.ts`)
- overview (pipeline) - studio - `/?tab=pipeline`; `?quick=aging` lands on the aging slice
- channels, decisions, schedule - studio - `/?tab=channels|decisions|schedule`
- jobs, library (job descriptions), intake - studio - `/?tab=jobs|library|intake`; a JD detail page is `/jds/<slug>`
- archetypes, analyze, history, interview (sim), assignments - studio - `/?tab=<id>`; analyze history detail `/history/<slug>`
- analytics, matrix, activity, about - studio - `/?tab=<id>`
- tasks - studio - `/?tab=tasks` (client-only, reached from the sidebar footer)
- settings: organization, branding, billing, models, integrations, workspace, hiring - studio - `/?tab=<id>`
- candidate doors - public - `/apply/<jobId>`, `/apply/<jobId>/quick`, `/status/<token>`, `/schedule/<token>`, `/interview/<token>`, `/offer/<token>`, `/invite/<token>`, `/data/<token>`, `/skill/<token>`, `/devcase/apply/<token>`. Tokens come from the rows in `data/kp.sqlite` (`schedule_invites.token`, `offers`, `pipeline_entries`) or are minted through the studio action that issues them; `uat/env.md` § Seeding lists the seeders. Capture these with `DEV_AUTH=0`.

## Run

- **Server:** reuse the running dev server; never start a second one against the same checkout
  (Next allows ONE per checkout, `.next/dev/lock`). The port is volatile on this box - probe
  `Get-NetTCPConnection -State Listen` and match the `Win32_Process.CommandLine` to
  `kiro\kp\node_modules\next` (2026-09-08: kp on **:3003**; :3000/:3001 are firetv, :3005 pof).
  If none, `npm run dev -- -p 3003` in the background and poll `/api/health` for 200.
- **A 500 on every route with a parse error in `instrumentation.ts`'s import trace is a STALE
  compile**, not the tree: `instrumentation.ts` is compiled once at boot and does not hot-reload.
  Confirm the file parses now (`ts.createSourceFile(...).parseDiagnostics`), then restart the server.
- **Capture:** the UAT driver is the screenshot tool, already past both auth gates:
  ```bash
  MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:3003 SHOT_DIR="<vault>/Cx/stops" \
    node uat/driver/drive.mjs "/?tab=pipeline" S5-before
  ```
  `DEV_AUTH=0` for public pages (landing, candidate doors), `THEME=dark` for the Spark Dark pass,
  `LOCALE=cs` for a Czech persona's stop, `WIDTH=390 HEIGHT=844` for the candidate's phone.
  Multi-step arrivals (open a drawer, pick a row) use `uat/driver/drive-script.mjs`.
- **A full-page shot of a reveal-on-scroll page lies**: bands whose content animates in on
  IntersectionObserver render as empty color blocks (S1 landing, 2026-09-08). Scroll the page in
  ~500px steps with a short sleep, return to the top, then `snap(name)`; take `snap(name, {full:false})`
  first for the fold as the user actually meets it.
- The server must be NEWER than the commits under review when a stop changed message keys
  (`i18n/request.ts` caches the catalog at first import) - restart before the after-shot.

## Gates

Per stop, keyed by what the executors touched (the full table is in `AGENTS.md`):

- any `.ts`/`.tsx`: `npm run typecheck` (runs `schemas:gen` first - Python must be installed;
  dirty `*.generated.ts` afterwards is the toolchain) then `npm run lint`
- `app/**` logic: `npm run test:unit` (scoped: `node scripts/run-unit-tests.mjs <globs>`)
- any styling: `npm run design:check`
- new or changed message keys: `npm run i18n:check` (4 catalogs, `en` is the source)
- mapped source per `scripts/docs/feature-doc-map.json`: update the doc in the same commit, or
  a `Doc-sync: internal-only - <why>` trailer
- the commit subject is ONE clause under ~70 chars, type from `KNOWN_TYPES`; body carries the story

## Repo law

Authority: `.claude/CLAUDE.md`; `docs/design/README.md` for UI; `node_modules/next/dist/docs/` for Next.

- **This is NOT the Next.js you know** - 16.3 canary with `cacheComponents` + `partialPrefetching`;
  `runtime`/`dynamic` route configs are banned (ADR 0001).
- **Two themes from one codebase.** Studio Light (default, calm editorial: paper, ink, Fraunces) and
  Spark Dark (drawn 2px outlines, sticker shadows, tilt, Bricolage, spring easing). Never hardcode a
  color outside `app/landing/`; brand tokens first (`ink`, `paper`, `steel`, `coral`, `moss`,
  `limewash`, `dial-*`, `score-*`), then the remapped neutrals; `text-white` is theme-relative;
  compose from `app/_components/ui/recipes.ts` (PANEL, CHIP, BTN_*, EYEBROW, FIELD); reuse the
  primitives in `app/_components/` (Modal, Badge, SegmentedControl, Skeleton); fork at the cheapest
  layer (token -> `dark:` recipe variant -> CSS-swapped markup -> `useTheme()` last). A change that
  holds in one theme only is a redo.
- **Every user-facing string goes through next-intl**: the key lands in `messages/en.json` AND
  `cs`/`de`/`fr` in the same change (typed keys - a missing one breaks `tsc` for everyone). The
  server answers a failure with a CODE; the client renders `errors.<CODE>` via `useErrorMessage()`.
- **Pathspec commits only** in this shared checkout: `git add <path> <path>`, never `-A`/`.`/`-u`;
  never `git stash`, `reset --hard` or `checkout --` on files that are not yours; check
  `git diff --cached --stat` before every commit.
- **Keyless is a product property**: a screen that reaches an LLM must be right with no key -
  deterministic fallback, disclosed as such (`honesty` and `provenance` in the heuristics list).
- **Candidate token routes carry a projection, not the row**; public pages are capability links,
  never sessions. Nothing internal on the public wire.
- `context-map.json` scopes edits; the Vibeman ideas backlog (`backlog:idea-*` skills) and the
  "removed - don't re-suggest" notes are vetoes: never re-pitch one from inside a stop.

## Heuristics

Added to the practitioner's list for this product:

| heuristic | the question | evidence |
|---|---|---|
| **keyless truth** | With no API key, does the screen still work, and does it say what it did instead? | the fallback rendered; a "template, not AI-reasoned" label; a spinner that never resolves |
| **the sealed decision** | Where the product's promise is a verified, sealed decision, can the user see who or what decided, and that it is sealed? | provenance line; the seal state; an AI action with no human gate named |
| **Czech first, four locales** | Does the screen read as native in the persona's language, not as translated English? | a raw key on screen; an English fallback in a cs run; a label that changes name between screens |
| **the two registers** | Does the screen hold in Studio Light and Spark Dark - structure, not just color? | the dark shot; a literal color; a component with no drawn outline in dark |
| **phone door** | On a candidate door, does the screen work one-handed on a phone with no account? | 390px shot; taps to done; anything that asks for a login |

## Skill improvement log
- 2026-09-08 (adoption, v1.0.0): the skill's commit shape `cx(S<n>): ...` fails this repo's commit-msg hook (`cx` is not in `KNOWN_TYPES`); the overlay carries `commit_format` instead. Filed as a method lesson in the registry.
