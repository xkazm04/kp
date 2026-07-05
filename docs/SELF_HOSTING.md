# Self-hosting KP — run it in your own environment

_Enterprise readiness E4 (docs/ENTERPRISE_READINESS.md §5). This is the deployment
half of the "full control of the data + model layer" ask: run KP on your own
infrastructure (Docker / VPC / on-prem), keep all candidate PII on your host and in
your region, and route every AI call to models you control. It closes the deploy
story tracked as backlog #27._

> **Scope of this increment.** Container packaging + configuration + the complete
> external-egress inventory + the production checklist. Still on the E4 roadmap:
> first-class self-hosted model endpoints (E-SH-5), a Postgres backend for large
> multi-user installs (E-SH-3), a hard offline-enforcement flag (E-SH-4), and the
> **license decision** that governs the right to self-host (E-SH-1, founder + counsel).
> This document tells you *how* to deploy; it does not grant a license.

---

## 1. What you get

One container runs both halves of KP:

- the **Next.js 16 app** (`next start`), and
- its **Python "jobfit" pipeline**, which the app spawns per request (CV parsing,
  analysis, matching) — so the image ships Node 24 **and** Python together.

State is a **single SQLite file** on a mounted volume. There is no external
database, cache, or message broker to operate — back up one file and you have
everything. (For large multi-user installs, a Postgres backend is on the roadmap,
E-SH-3.)

## 2. Quick start (Docker Compose)

```bash
cp .env.example .env
# edit .env — at minimum set KP_OPERATOR_PASSWORD and KP_SECRET (see §3)
docker compose up -d --build
# → http://localhost:3000   (put TLS in front for anything public — §6)
```

`docker compose logs -f kp` to watch boot; the DB schema migrates automatically on
first start. Data persists in the named volume `kp-data` (`/data/kp.sqlite`).

## 3. Required configuration

Two variables are **mandatory for any real deployment**:

| Var | Why it's required |
|---|---|
| `KP_OPERATOR_PASSWORD` | **Unset ⇒ the app runs fully OPEN** — every operator route is reachable with no login (open dev mode, `app/_lib/auth/require-operator.ts`). Set a strong value; the fail-closed edge proxy then gates every non-public route. |
| `KP_SECRET` | Master key that encrypts UI-entered provider API keys at rest (AES-256-GCM). Use a long random string. |

Everything else is optional. Provider keys (§5) are **opt-in** — set only the ones
you use; omit the rest to minimise external egress.

## 4. Data layer & residency

- **Location.** All data lives in the SQLite file at `KP_DB_PATH`
  (`/data/kp.sqlite` in the image), on the `kp-data` volume. Mount that volume on
  storage in **your region** and KP holds no candidate PII anywhere else — the
  simplest possible answer to an EU data-residency requirement.
- **Always set `KP_DB_PATH` to an absolute path** in a deploy. The default is
  derived from the launch directory, so a service/cron launched from elsewhere
  silently opens a *different, empty* database (`app/_lib/db-path.ts`). The image
  pins it for you.
- **WAL mode.** The DB runs in WAL; a boot checkpoint bounds the `-wal` file. Keep
  `kp.sqlite`, `kp.sqlite-wal` and `kp.sqlite-shm` together.
- **Backups.** Snapshot the single file. Either stop the container briefly and copy
  `/data`, or take a consistent online copy with `sqlite3 /data/kp.sqlite ".backup
  /data/backup.sqlite"` (or `npm run db:dump`). Schedule it; test a restore.

## 5. Model layer — keep it under your control

KP is **BYOM (bring your own model)**: every AI call routes to *your* keys and
*your* providers (docs/LLM_PROVIDER_LAYER.md). Nothing is hard-wired to a vendor
you can't swap, and there is no KP-hosted inference in the path.

- Set only the provider keys you intend to use (§5-table below).
- With **no** provider keys set, AI features **degrade to deterministic fallbacks**
  (the same paths that run when a provider is down) — the app stays fully usable,
  just without model-generated text. This is by design: *degrade, not block*.
- **Fully private inference** (Azure OpenAI in your own tenant, vLLM, Ollama) as a
  first-class base-URL setting is the next E4 increment (E-SH-5). Until it lands,
  air-gapped installs run in deterministic mode for AI.

## 6. External egress — the complete inventory (air-gap reference)

Every host KP may contact at runtime, what enables it, and how to switch it off.
**Set none of these and KP makes no outbound calls** (deterministic AI, billing
off). This is the list to hand your security team.

| Destination | Host | Enabled by | Default | Purpose / how to disable |
|---|---|---|---|---|
| Google Gemini | `generativelanguage.googleapis.com` | `GEMINI_API_KEY` / `GOOGLE_API_KEY` | off | Flagship CV analysis, salary, match reasoning. Unset ⇒ deterministic fallback. |
| OpenAI | `api.openai.com` | `OPENAI_API_KEY` | off | LLM routing + voice (Realtime). Unset ⇒ off. |
| Anthropic | `api.anthropic.com` | BYOM (`KP_LLM_CONFIG`) | off | Optional LLM routing. Unset ⇒ off. |
| ElevenLabs | `api.elevenlabs.io` | `ELEVENLABS_API_KEY` | off | Voice interviews. Unset ⇒ voice off. |
| GitHub | `api.github.com` | GitHub repo-analysis feature | anon | Candidate repo signal. `GITHUB_TOKEN` only raises rate limits; skip the feature to avoid entirely. |
| Polar | `api.polar.sh`, `sandbox-api.polar.sh` | `POLAR_ACCESS_TOKEN` | off | Billing (Merchant of Record). Unset ⇒ billing routes 503; self-host typically leaves this off. |
| LightTrack | your `LIGHTTRACK_URL` | `LIGHTTRACK_URL` | off | LLM observability (self-hosted sibling). Unset ⇒ off. |
| Next.js telemetry | `telemetry.nextjs.org` | — | **off** | Disabled by `NEXT_TELEMETRY_DISABLED=1` (set in the image). |

KP does **not** fetch fonts, scripts, or styles from a CDN at runtime — assets are
served from the image — so it renders correctly with no internet access.

## 7. Air-gap / offline operation

For a disconnected or egress-restricted install:

1. Set `KP_OPERATOR_PASSWORD` + `KP_SECRET`; leave **all** provider keys and
   `POLAR_ACCESS_TOKEN` / `LIGHTTRACK_URL` unset.
2. KP runs fully offline: pipeline, matching, scheduling, decisions and the whole
   workspace work; AI-generated text falls back to deterministic output.
3. To keep model-generated AI while air-gapped, wait for E-SH-5 (self-hosted
   endpoints) or route a self-hosted OpenAI-compatible gateway once base-URL config
   lands.

A hard `KP_OFFLINE` flag that *refuses* any external call (belt-and-suspenders over
"just don't set keys") is tracked as E-SH-4.

## 8. Production checklist (closes backlog #27)

- [ ] `KP_OPERATOR_PASSWORD` set to a strong value — **else the app is open**.
- [ ] `KP_SECRET` set to a long random string.
- [ ] `KP_DB_PATH` on a persistent, backed-up volume (absolute path); restore tested.
- [ ] TLS terminated by a reverse proxy (Caddy / nginx / Traefik) in front — KP
      speaks plain HTTP on `:3000`.
- [ ] `NEXT_PUBLIC_APP_BASE_URL` (+ `NEXT_PUBLIC_SITE_URL`) set to your public
      origin so candidate-facing links and OG metadata resolve correctly.
- [ ] Only the provider keys you actually use are set (§6).
- [ ] Container memory limit set (the pipeline spawns python subprocesses).
- [ ] Runs as non-root (built in, uid 10001); writes only to `/data` and `/tmp`.
- [ ] Health check green (`docker compose ps`).
- [ ] Backups scheduled; upgrade path rehearsed (§10).

## 9. Build & run without Compose

```bash
docker build -t kp:local .
docker run -d --name kp -p 3000:3000 \
  -v kp-data:/data \
  -e KP_OPERATOR_PASSWORD='change-me' \
  -e KP_SECRET='a-long-random-string' \
  # optional, add only what you use:
  # -e GEMINI_API_KEY=... -e OPENAI_API_KEY=... -e ELEVENLABS_API_KEY=... \
  kp:local
```

Pin an exact Python minor by overriding the base image:
`docker build --build-arg NODE_IMAGE=node:24-bookworm-slim -t kp:local .`
(The image uses Debian's `python3`, 3.11; CI validates 3.12 — the pipeline
supports 3.11+.)

## 10. Upgrades & backups

1. Back up `/data` first (§4).
2. `docker compose pull` (or `--build` for a local rebuild) then
   `docker compose up -d`.
3. The schema migrates on boot (`app/_lib/db/core.ts`). Watch the logs; if a
   migration fails, restore the backup and report.

## 11. Licensing (pending — E-SH-1)

This guide covers *how* to self-host. The **license** under which self-hosting is
granted — a source-available / BSL model that gives you source access and the right
to self-host and audit, vs. a commercial license — is a deliberate decision still
open (docs/ENTERPRISE_READINESS.md §5, E-SH-1; founder + counsel). Confirm your
license terms before deploying in production.

## 12. See also

- `docs/ENTERPRISE_READINESS.md` — the full enterprise roadmap; E4 is §5.
- `docs/LLM_PROVIDER_LAYER.md` — the BYOM model-routing layer.
- `docs/BILLING.md` — Polar billing (leave off for a self-host without billing).
- `.env.example` — every configuration variable, annotated.
