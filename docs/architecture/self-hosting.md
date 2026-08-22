# Self-hosting KP — run it in your own environment

_Run KP on your own infrastructure (Docker / VPC / on-prem / your laptop), keep all
candidate PII on your host and in your region, and route every AI call to models you
control._

> **You already have the right to do this.** KP is **AGPL-3.0**
> (`LICENSE`) — self-hosting is the default posture of the product, not a licensed
> concession, and an earlier revision of this page that deferred to an open "license
> decision" is superseded (see `docs/product/enterprise-readiness.md` §5, E-SH-1).
> Two consequences worth stating up front:
>
> - **A self-hosted install is not metered.** No plan, no quotas, no 402s: with no
>   billing provider configured and no billing history, every meter resolves
>   unlimited (`app/_lib/billing/mode.ts`). The Billing tab says so rather than
>   showing you plans you cannot buy.
> - **If you modify KP and offer it to others over a network**, AGPL §13 requires
>   you to offer those users your modified source. Point
>   `NEXT_PUBLIC_SOURCE_REPO_URL` at your fork and the app's own footer links there.
>
> **Still open on the roadmap:** a Postgres backend for large multi-user installs
> (E-SH-3, `docs/architecture/postgres-backend.md`). Container packaging,
> configuration, the external-egress inventory, the production checklist and the
> hard offline flag (§7) are all shipped.

---

## 1. What you get

One container runs both halves of KP:

- the **Next.js 16 app** (`next start`), and
- its **Python "jobfit" pipeline**, which the app spawns per request (CV parsing,
  analysis, matching) — so the image ships Node 24 **and** Python together.

State is a **single SQLite file** on a mounted volume. There is no external
database, cache, or message broker to operate — back up one file and you have
everything. (For large multi-user installs, a Postgres backend is on the roadmap,
E-SH-3 — see `docs/architecture/postgres-backend.md`.)

The image is a **slim standalone build** (~465 MB): Next `output:"standalone"` traces
only the server files + the minimal `node_modules` it actually needs, rather than
shipping the whole source tree and full dependency set.

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
*your* providers (`docs/architecture/llm-provider-layer.md`). Nothing is
hard-wired to a vendor you can't swap, and there is no KP-hosted inference in the
path.

- Set only the provider keys you intend to use (§6 table below).
- With **no** provider keys set, AI features **degrade to deterministic fallbacks**
  (the same paths that run when a provider is down) — the app stays fully usable,
  just without model-generated text. This is by design: *degrade, not block*.

### Fully private inference (self-hosted endpoints)

You can keep **model-generated** AI while nothing leaves your network by pointing
the OpenAI adapter at an **OpenAI-compatible endpoint in your own infrastructure** —
Azure OpenAI in your tenant, **vLLM**, **Ollama**, **LiteLLM**, or an in-VPC proxy:

1. Run your endpoint (e.g. Ollama exposes an OpenAI-compatible API at
   `http://ollama:11434/v1`; vLLM at `http://vllm:8000/v1`).
2. Point KP at it with **`OPENAI_BASE_URL`** (and `OPENAI_API_KEY` only if your
   endpoint requires one — vLLM/Ollama usually don't; KP runs keyless against them):

   ```bash
   OPENAI_BASE_URL=http://ollama:11434/v1
   # OPENAI_API_KEY=...   # only if your gateway enforces a key
   ```

3. Route use cases to the `openai` provider in **Settings → Models** (set a specific
   use case, or the `*` wildcard to send *everything* to your endpoint), with the
   model name your endpoint serves (e.g. `llama3.1`, `qwen2.5`).

The base URL can also travel per-provider in `KP_LLM_CONFIG` (`keys.openai.baseUrl`)
if you configure routing by env instead of the DB. Azure OpenAI keeps its own
`endpoint`/`api-version` path (unaffected by `OPENAI_BASE_URL`).

## 6. External egress — the complete inventory (air-gap reference)

Every host KP may contact at runtime, what enables it, and how to switch it off.
**Set none of these and KP makes no outbound calls** (deterministic AI, billing
off). This is the list to hand your security team.

| Destination | Host | Enabled by | Default | Purpose / how to disable |
|---|---|---|---|---|
| Google Gemini | `generativelanguage.googleapis.com` | `GEMINI_API_KEY` / `GOOGLE_API_KEY` | off | Flagship CV analysis, salary, match reasoning. Unset ⇒ deterministic fallback. |
| OpenAI | `api.openai.com` **or your `OPENAI_BASE_URL`** | `OPENAI_API_KEY` / `OPENAI_BASE_URL` | off | LLM routing + voice. Point `OPENAI_BASE_URL` at a self-hosted OpenAI-compatible endpoint (§5) to keep inference in-network. Unset ⇒ off. |
| Anthropic | `api.anthropic.com` | BYOM (`KP_LLM_CONFIG`) | off | Optional LLM routing. Unset ⇒ off. |
| ElevenLabs | `api.elevenlabs.io` | `ELEVENLABS_API_KEY` | off | Voice interviews. Unset ⇒ voice off. Self-hostable via `ELEVENLABS_BASE_URL` (see `.env.example` and `app/_lib/voice/self-hosted.ts`). |
| GitHub | `api.github.com` | GitHub repo-analysis feature | anon | Candidate repo signal. `GITHUB_TOKEN` only raises rate limits; skip the feature to avoid entirely. |
| Polar | `api.polar.sh`, `sandbox-api.polar.sh` | `POLAR_ACCESS_TOKEN` | off | Billing (Merchant of Record). Unset ⇒ billing routes 503; self-host typically leaves this off. See `docs/features/billing/README.md`. |
| LightTrack | your `LIGHTTRACK_URL` | `LIGHTTRACK_URL` | off | LLM observability (self-hosted sibling). Unset ⇒ off. |
| Sentry | your DSN's ingest host (`*.sentry.io`, or self-hosted) | `SENTRY_DSN` (server) / `NEXT_PUBLIC_SENTRY_DSN` (browser, baked at build) | off | Error reporting (`instrumentation.ts`, error boundaries). Unset ⇒ no init, no SDK load. `KP_OFFLINE=1` skips it even with a DSN set. |
| Next.js telemetry | `telemetry.nextjs.org` | — | **off** | Disabled by `NEXT_TELEMETRY_DISABLED=1` (set in the image). |

KP does **not** fetch fonts, scripts, or styles from a CDN at runtime — assets are
served from the image — so it renders correctly with no internet access.

## 7. Air-gap / offline operation

For a disconnected or egress-restricted install:

1. Set `KP_OPERATOR_PASSWORD` + `KP_SECRET`; leave **all** cloud provider keys and
   `POLAR_ACCESS_TOKEN` / `LIGHTTRACK_URL` unset.
2. KP runs fully offline: pipeline, matching, scheduling, decisions and the whole
   workspace work with no outbound calls.
3. **Keep model-generated AI in the air gap** by pointing `OPENAI_BASE_URL` at a
   self-hosted OpenAI-compatible endpoint on your network (vLLM / Ollama / LiteLLM —
   §5) and routing use cases to `openai` in Settings → Models. The only "egress" is
   then to your own in-network endpoint. Without it, AI-generated text falls back to
   deterministic output.

### `KP_OFFLINE` — hard no-egress enforcement

Belt-and-suspenders over "just don't set cloud keys": set **`KP_OFFLINE=1`** and KP
*refuses* every outbound call except loopback and the private endpoints you
explicitly configured. Concretely:

- **App (Node):** a `fetch` guard installed at server startup (`app/_lib/offline.ts`)
  rejects any request whose host isn't allow-listed — so GitHub repo analysis, Polar
  billing, the JS Gemini/OpenAI SDKs, and voice token exchanges are blocked *before
  the socket opens*, even if a key is set by mistake.
- **Pipeline (Python):** cloud LLM engines (Gemini, Anthropic, the Claude CLI, and
  OpenAI **without** a `base_url`) report unavailable → the call falls back to
  deterministic output (`pipeline/jobfit/llm/offline.py`). A self-hosted OpenAI
  endpoint (`OPENAI_BASE_URL`) and Azure (its configured `endpoint`) keep working.
  This covers the two Gemini call sites that bypass the `llm/base` adapters as well:
  `gemini.get_client()` (the flagship multimodal CV analysis + profile extractor —
  the one call that ships the candidate's whole file) and
  `embedding_bridge.GeminiEmbeddingProvider`. Both are enforced **in Python**, not by
  the Node `fetch` guard, which cannot see a spawned subprocess — and they must be,
  because `get_gemini_api_key()` re-reads `.env.local`/`.env`, so clearing the
  variable in the service unit does not clear the key.
- **Billing:** Polar is disabled (billing routes report unconfigured).

The **allowlist** = loopback + the hosts of `OPENAI_BASE_URL`, `AZURE_OPENAI_ENDPOINT`,
`LIGHTTRACK_URL`, `NEXT_PUBLIC_APP_BASE_URL`/`APP_BASE_URL`, `COMMS_WEBHOOK_URL`,
plus any extra hosts in **`KP_OFFLINE_ALLOW_HOSTS`** (comma-separated) for a
same-network gateway.

> This is an **application-level** backstop. For a hard guarantee, still enforce a
> **network egress policy** at the deployment layer (Kubernetes NetworkPolicy /
> firewall / no-egress subnet) — `KP_OFFLINE` complements it, it doesn't replace it.

## 8. Production checklist (closes backlog #27)

- [ ] `KP_OPERATOR_PASSWORD` set to a strong value — **else the app is open**.
- [ ] `KP_SECRET` set to a long random string.
- [ ] `KP_DB_PATH` on a persistent, backed-up volume (absolute path); restore tested.
- [ ] TLS terminated by a reverse proxy (Caddy / nginx / Traefik) in front — KP
      speaks plain HTTP on `:3000`.
- [ ] `KP_TRUSTED_PROXY` set to the number of proxy hops in front of KP (**`1`**
      for a single Caddy / nginx / Traefik) so the public-route rate limits
      (apply, quick-apply, offer, schedule, login) key on the **real** client IP.
      **Unset ⇒ KP ignores `X-Forwarded-For` entirely** (it is client-forgeable,
      so trusting it would let a script mint a fresh throttle bucket per request)
      and every request shares **one** bucket — spoof-proof, but coarse: a burst
      of legitimate applicants behind different IPs can collide on the shared cap.
      Residual: never set it **larger** than the real hop count, or an attacker
      can inject extra `X-Forwarded-For` entries and forge the trusted position.
      (Not yet listed in `.env.example` — see the doc-drift note below.)
- [ ] `NEXT_PUBLIC_APP_BASE_URL` (+ `NEXT_PUBLIC_SITE_URL`) set to your public
      origin so candidate-facing links and OG metadata resolve correctly.
- [ ] Only the provider keys you actually use are set (§6).
- [ ] Container memory limit set (the pipeline spawns python subprocesses).
- [ ] Runs as non-root (built in, uid 10001); writes only to `/data` and `/tmp`.
- [ ] Health check green (`docker compose ps`).
- [ ] Backups scheduled; upgrade path rehearsed (§10).

> **Doc-drift note.** `app/_lib/rate-limit.test.ts` proves `KP_TRUSTED_PROXY` gates
> real behavior today, but it is not documented in `.env.example` — add it there
> alongside `KP_DB_BACKEND`/`KP_OFFLINE` (tracked as a backlog item, not fixed in
> this pass since `.env.example` is outside this doc-restructure's scope).

## 8b. Custom domain & white-label branding (E-BRD-3/4)

KP is white-label. Two layers make it *your* product to your recruiters and their
candidates:

1. **Brand identity (in-app).** Settings → **Branding** sets the display name, a
   primary accent color, and a logo. The accent re-skins the whole workspace **and
   the candidate-facing offer/apply/scheduling pages** (they share the app layout);
   the name + logo replace the KandiDate mark in the sidebars. Stored server-side
   (`brand_settings`), no rebuild needed.

   What is storable is decided in one place, `app/_lib/brand-config.ts`, and is
   enforced on **write and read** — `getBrand()` re-validates the row it loads, so a
   value written by an older build can't keep being served past a rule it predates:
   - *Accent* — `#rgb`/`#rrggbb` only (it is injected into a `<style>`, so anything
     else would be CSS injection), and it must clear **3:1 WCAG contrast** against
     both white button labels and the paper canvas. An illegible accent is refused,
     with the reason shown in the editor, rather than shipped app-wide.
   - *Logo* — an `https://` URL of at most 500 characters, **rejected** (not
     truncated) when longer, so a signed CDN URL can't be stored as a half-signature
     that renders as a broken image. It is browser-loaded from that host with
     `referrerPolicy="no-referrer"`; air-gapped installs should self-host the file.
   - *Display name* — whitespace-collapsed and clamped to 60 characters.
2. **Custom domain.** Point your domain at the reverse proxy in front of KP
   (§8: Caddy / nginx / Traefik terminates TLS and proxies to `:3000`):
   - DNS: a `CNAME` (or `A`/`AAAA`) for `hiring.yourcompany.com` → your proxy host.
   - TLS: let the proxy issue a certificate (Caddy/Traefik do this automatically via
     ACME; with nginx use certbot).
   - Set **`NEXT_PUBLIC_APP_BASE_URL`** and **`NEXT_PUBLIC_SITE_URL`** to
     `https://hiring.yourcompany.com` so candidate links (offer / apply / schedule)
     and OG metadata resolve to your domain, not localhost.

> Per-tenant subdomains (`acme.kp.example.com` resolving to a specific team's brand)
> are a **multi-tenant** feature that depends on the tenancy foundation (shipped —
> see `docs/features/organization/README.md`) — host-based tenant resolution +
> wildcard TLS. The single-deployment custom domain above needs neither.

## 8c. Kubernetes (Helm)

A Helm chart lives at **`deploy/helm/kp`**. Push the image (§9) to your registry, then:

```bash
helm install kp deploy/helm/kp \
  --namespace kp --create-namespace \
  --set image.repository=registry.example.com/kp --set image.tag=0.1.0 \
  --set auth.operatorPassword='change-me' --set auth.secret='a-long-random-string' \
  --set persistence.size=10Gi \
  --set ingress.enabled=true --set ingress.hosts[0].host=hiring.yourcompany.com
```

For production, keep secrets out of Helm values — pre-create a Secret with
`KP_OPERATOR_PASSWORD` / `KP_SECRET` (+ any provider keys) and pass
`--set existingSecret=my-kp-secret`. Provider keys and non-secret config
(`NEXT_PUBLIC_APP_BASE_URL`, `KP_OFFLINE`, `OPENAI_BASE_URL`, …) are `providerKeys` /
`env` values; see `deploy/helm/kp/values.yaml`.

**Single replica by design.** State is one SQLite file on a ReadWriteOnce volume, so
the chart pins `replicas: 1` with the `Recreate` strategy (a rolling update would
briefly run two pods contending for the DB). The `install` **fails** if the operator
password/secret are unset — no accidental open deployment. Multi-replica HA needs the
Postgres backend (`docs/architecture/postgres-backend.md`). Validate a values set
before applying with `helm lint` / `helm template`.

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
open (`docs/product/enterprise-readiness.md` §5, E-SH-1; founder + counsel). Confirm
your license terms before deploying in production.

## 12. See also

- `docs/product/enterprise-readiness.md` — the full enterprise roadmap; E4 is §5.
- `docs/architecture/llm-provider-layer.md` — the BYOM model-routing layer.
- `docs/features/billing/README.md` — Polar billing (leave off for a self-host without billing).
- `.env.example` — every configuration variable, annotated.
