# In-app onboarding studio — concept

Status: increments 1–2 built (2026-09-06, uncommitted) — engine extracted
(`scripts/onboard-ui/engine.mjs`), loopback-only CORS, fragment hand-off, and
the `/setup/studio` page (`app/features/setup-studio/`). Increments 3–4 remain
proposals. Companion to the standalone installer (`scripts/onboard-ui/`,
`npm run onboard:ui`).

## The idea

Move the onboarding *experience* into the running Next.js app — a special
operator page where the wizard operates with the full design system — while
keeping the standalone page as the bootstrap for machines where the app cannot
boot yet. The standalone installer proved the mechanics (headless Claude CLI
engine on subscription billing, permission cards, secrets that bypass the
model, recon-first journeys); its ceiling is visual: one hand-written CSS file,
no motion library, no themes, no locales. Inside the app we get all of it for
free.

## The constraint that shapes everything

The installer's first job is taking a machine from `git clone` to a booted
app. A page served *by* the app cannot exist before the app boots — no
`node_modules`, no Python deps, no page. So this is a **two-stage hand-off**,
not a replacement:

| Stage | Surface | Covers |
| --- | --- | --- |
| A — bootstrap | standalone page (today's `wizard.html`, kept deliberately plain) | fresh journey up to "boot verify passed" |
| B — studio | in-app page | everything after the app answers `/api/health`: addon, repair, complete journeys; the voice playground; the living capability matrix; the hand-off into workspace setup |

Recon-first classification (v0.3) already tells us which stage a machine
starts in. On a `complete`/`addon` machine — every re-run, most real sessions —
the app is up within the first probe, so Start jumps to the studio almost
immediately. A fresh clone sees the plain page only for the unavoidable
stretch (deps, keys, first boot), then lands in the studio for the rewarding
half. The dramatic-visuals budget goes where users spend repeat time.

## Architecture: keep the engine outside the app

The wizard server (`scripts/onboard-ui/server.mjs`) stays the engine host —
CLI child, permission hook, env-file writes, SSE. The in-app page becomes a
second *face* on the same engine:

- The standalone page hands off by redirecting to
  `<app>/setup/studio#wizard=<port>&t=<token>` (fragment, not query — the
  token must not enter server logs or referrers).
- The studio page opens the same `GET /events` SSE stream and POSTs the same
  `/answer` / `/decision` / `/secret` / `/message` endpoints, cross-origin.
- Server change: a CORS allowlist for the app origin only (derived from the
  `[[wizard:app]]` port), everything else unchanged. The event contract is
  already typed and versioned in `PROTOCOL.md`.

Why not host the engine in a Next.js route handler (the app spawns the CLI the
way `python-runner.ts` spawns Python)? It couples the engine to the process it
is configuring: a repair journey where the app crashes takes the wizard down
with it; env-file writes would come from the process that needs restarting to
read them; and the CLI child would inherit the app's env instead of the
launcher's scrubbed one. The engine module should still be *extracted*
(`scripts/onboard-ui/engine.mjs` with the HTTP shell separate) so hosting it
elsewhere later stays a refactor, not a rewrite.

## What the studio page unlocks

- **Design system**: tokens, `recipes.ts` surfaces, both themes — Studio
  Light default, Spark Dark as the playful option, live-switchable mid-run.
  Framer-motion (the segmented-control motion standard, spring easing in
  dark). Bricolage display face. 4-locale copy via next-intl — the installer
  finally speaks Czech.
- **A living matrix**: the capability matrix stops being rendered markdown
  and becomes a component fed by the same server facts as the Getting-started
  card (`/api/comms/capability` and friends) — always current, not a snapshot,
  and visually the app's own.
- **Voice playground**: embed the `/interview-lab` compare panel rather than a
  single sample button — audition every ready provider by ear, pick voices,
  and the choice writes back through the wizard (`/choice/tts`).
- **Real dynamicity**: probe rows, plan rail and decision cards rendered with
  the app's components and motion; Candi (KandidateMark + the companion step
  register) as the guide persona; small "try it" moments after each unlock
  (a JD build after llm-engine, a sample analysis after gemini).
- **Continuity**: the studio's final step *is* the doorway into
  `SetupOnboardingWizard` (company → team → pipeline → Candi) — capability
  setup and workspace setup become one flow with one visual language.

## Gates and gotchas this must respect

- **Route posture**: the studio page and any helper route are operator
  surfaces — session-gated in team mode (`requireOperator`), never public;
  new API routes owe rows in `docs/architecture/api-reference.md`
  (`npm run api:check`) and rate limiting is not needed for loopback-only
  proxying that stays in the wizard server.
- **i18n parity**: every string in 4 catalogs (`npm run i18n:check`).
- **Design tokens**: no raw hex outside `app/landing/` (`npm run design:check`)
  — the studio uses tokens by construction, which is half the point.
- **Restart honesty**: env writes still need an app restart to take effect;
  the studio must keep the standalone page's honest restart note (the classic
  false "it works" is a server still running pre-write env).
- **Keyless property**: the studio page itself must render keyless (it is a
  face on the wizard, not an LLM feature) and the engine's deterministic
  degradation story is unchanged.

## Increments

1. **Done.** `engine.mjs` extracted from `server.mjs` (parity-proven); CORS
   for loopback origins only; fragment hand-off from the standalone page;
   `hello.replay` rejoin block + `resolved` event for two-face consistency.
2. **Done** (English literals; strings colocated in
   `app/features/setup-studio/copy.ts` for the increment-3 lift).
   `app/setup/studio` + `app/features/setup-studio/`: SSE client, plan rail,
   decision cards, probe rows, voice panel, matrix grid — tokens + recipes,
   framer-motion, both themes.
3. Living matrix (fed by the app's own capability facts) + `/interview-lab`
   compare-panel embed + cs/de/fr catalogs via the i18n lift.
4. Hand-off seam into `SetupOnboardingWizard`; retire the standalone page's
   post-boot phases (it keeps welcome → checks → boot only).
