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
| `KP_SECRET` | Master key that encrypts UI-entered provider API keys at rest (AES-256-GCM), and keys the session HMAC. Use a long random string; rotate it with `KP_SECRET_PREVIOUS` + `npm run secrets:rotate` (below), never by editing it alone. |

Everything else is optional. Provider keys (§5) are **opt-in** — set only the ones
you use; omit the rest to minimise external egress.

### 3b. Sizing the Python engine

The jobfit pipeline is **spawned per request** ([ADR: spawn-per-request](decisions/))
— one CPython interpreter per analyze / match / devcase / JD-build call, ~120–200 MB
resident while it runs. That is cheap per call and unbounded in aggregate, so
`app/_lib/python-runner.ts` admits a fixed number at a time and refuses the overflow
rather than letting a burst starve the Node server every route shares.

| Var | Default | What it does |
|---|---|---|
| `KP_PYTHON_MAX_CONCURRENT` | `4` | Interpreters allowed to run at once, process-wide. Sized for the 2-vCPU floor the Helm chart requests: enough that a recruiter's parallel board actions genuinely overlap, low enough to leave a core for Next and keep worst-case engine memory under ~1 GB. Raise it on a bigger host; `1` makes the engine strictly serial. |
| `KP_PYTHON_QUEUE_WAIT_MS` | `20000` | How long a call waits for a slot before the route answers **503 `ENGINE_BUSY`**. Well inside a normal client deadline; an unbounded queue would only convert an overload into sockets held open past the point their users gave up. |
| `PYTHON_MAX_BUFFER_MB` | `64` | Combined stdout+stderr a child may buffer before it is killed. |
| `PYTHON_CMD` | `python3` (`python` on Windows) | The interpreter. |

Two operational properties to know:

- **Single process, like the rate limiter.** The ceiling counts spawns in *this*
  Node process. A horizontally-scaled deployment multiplies it by the replica
  count; the same swap the rate limiter would need (a shared store behind the same
  function shape) applies here.
- **A killed spawn takes its children with it.** A timeout, an abort, or a
  buffer overrun ends the whole process *tree* — the interpreter plus every
  `claude` / `git` it shelled out to (POSIX: the child leads its own process
  group and the group is signalled; Windows: `taskkill /T /F`). Before this, a
  wedged grandchild survived the kill and held CPU and a provider connection
  until the box was restarted.

### Rotating `KP_SECRET` without an outage

`KP_SECRET` encrypts every credential KP stores: UI-entered provider keys
(`provider_keys`), and — unless you set a dedicated `KP_ATS_SECRET_KEY` — the ATS
webhook secret, ATS/Personas API tokens, calendar tokens, the comms relay secret
and the edge sealing private key. Changing it therefore used to make all of them
undecryptable at once, with re-entering each credential by hand as the only
recovery. The rotation path:

```bash
# 1. Keep the retired secret readable, set the new one, restart.
KP_SECRET_PREVIOUS=<old secret>   # decryption falls back to this
KP_SECRET=<new secret>            # everything NEW is written under this

# 2. Re-encrypt every stored row under the new secret.
npm run secrets:rotate            # add -- --dry-run first to see the counts

# 3. Unset KP_SECRET_PREVIOUS and restart. Rotation done.
```

- `KP_SECRET_PREVIOUS` is **decrypt-only** — no ciphertext is ever written under
  the old key, so the window in step 2 is the only time two secrets are live.
  Treat it as transitional and remove it: it is a second valid key to your
  credential store.
- The script **never rewrites a row it could not read first** (a value we cannot
  decrypt is the only copy of that credential), reports any such row and exits
  non-zero. It skips rows already under the current secret, so an interrupted run
  is simply re-run.
- With `KP_ATS_SECRET_KEY` set, ATS / calendar / edge secrets are keyed on *it*
  and a `KP_SECRET` rotation neither breaks nor touches them — the script says so
  and leaves them alone. Rotating `KP_ATS_SECRET_KEY` itself has no equivalent
  fallback yet; decouple the two keys **before** you need to rotate either.
- **Sessions are not covered.** `KP_SECRET` also keys the session HMAC, so every
  operator is signed out by the rotation and logs in again. That is the intended
  outcome of rotating a secret — but tell your operators before you do it, not
  after.

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
| Sentry | your DSN's ingest host (`*.sentry.io`, or self-hosted) | `SENTRY_DSN` (server) / `NEXT_PUBLIC_SENTRY_DSN` (browser, baked at build) | off | Error reporting (`instrumentation.ts`, error boundaries). Unset ⇒ no init, no SDK load. `KP_OFFLINE=1` skips it even with a DSN set. **Candidate capability tokens are redacted before egress**: both roots install a `beforeSend`/`beforeBreadcrumb` pair that rewrites the segment after a token-bearing prefix (`/schedule/`, `/interview/`, `/status/`, `/offer/`, `/data/`, `/invite/`, `/skill(-profile)/`, `/devcase/apply|session/`, `/agents/report/`, `/channels/inbound/`, and their `/api/` twins) to `[token]`, plus any `?token=`/`?t=` value. Without it a single error on a candidate page shipped a WORKING capability link to a third party — the `/data/<erasureToken>` page most of all. Route shape and non-token query context (`?tab=hiring`, `/jds/<slug>`) are deliberately preserved so traces stay debuggable. Keep the two lists in `instrumentation.ts` and `instrumentation-client.ts` in sync when adding a token surface. |
| Next.js telemetry | `telemetry.nextjs.org` | — | **off** | Disabled by `NEXT_TELEMETRY_DISABLED=1` (set in the image). |
| Your pull sources | whatever `pullUrl` you configured on a receiver | a receiver's `pullUrl` (`PATCH /api/channels/webhooks`) | off | The clock GETs each source per tick to collect leads that arrived while KP was down (§7b). `https` + public host enforced. Clear `pullUrl` ⇒ off. |
| Your edge | your `KP_EDGE_URL` (a Worker in **your** Cloudflare account) | `KP_EDGE_URL` + `KP_EDGE_SECRET` | off | Draining held inbound events + the presence heartbeat (§7b). Unset ⇒ off. |
| Your nudge endpoint | your `KP_NUDGE_TARGET` | `KP_NUDGE_TARGET` | off | Contacted by the **edge**, not by KP — KP only re-publishes the target on each heartbeat. Unset ⇒ never nudged. |

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

## 7b. The always-on edge (optional companion)

_Full design: `docs/concepts/local-first-edge.md`. Operator guide: `edge/README.md`.
Behaviour and contracts: `docs/features/comms/README.md` §11._

A self-hosted install that runs on a **laptop** loses inbound webhooks, candidate
mail and bounce receipts for every hour it is switched off. Two optional
mechanisms close that without moving any decision off your infrastructure:

1. **Pull sources** — a receiver can carry a `pullUrl`; the clock asks it what
   arrived since the last cursor and files it. No third party involved at all.
2. **The edge** — a ~250-line Cloudflare Worker you deploy to **your own**
   account, which accepts those events on your behalf and hands them over on the
   next tick.

What leaves your host when the edge is paired: HMAC-signed `GET /drain`,
`POST /ack` and `POST /heartbeat` calls to the endpoint you configured. Nothing
else — no candidate data is uploaded by KP; the edge only hands data *down*.

What the edge holds: an append-only log that is **deleted as it drains**, one
shared HMAC secret, and (optionally) your public sealing key. It holds no provider
keys, no calendar tokens, no session secret and no database. Publish the sealing
key and stored bodies are AES-256-GCM sealed under a key wrapped to your RSA
public key, whose private half never leaves the host (encrypted at rest under
`KP_SECRET`, like every stored credential).

**State this honestly to your security team**: the Worker still *sees* an event in
memory as it seals it, and always sees routing metadata (which receiver token,
what size, when). Inbound mail is stored as headers only (sender + subject) — the
body and attachments are never written. If that residual is unacceptable, do not
pair an edge: pull sources alone need no third party, and running the same image
on an always-on host inside your network removes the problem entirely.

**Which option, in one table.** Your machine is off most of the day, and three
things cannot wait for it: an inbound webhook (the sender retries a few times, then
gives up), a candidate email, and a delivery receipt for a bounce. You do not need a
SaaS for that — you need an answering machine.

| You want | What to do | Cost |
| --- | --- | --- |
| **Nothing online** | Nothing. Inbound events reach kp only while it runs, and every surface says so rather than implying otherwise. Outbound messages queue honestly. | free |
| **A source you can poll** (a board API, a mail-to-JSON bridge) | Point a receiver at it: `PATCH /api/channels/webhooks {token, pullUrl}`. The clock asks it what arrived while you were away, on every tick. No cloud, no account. | free |
| **Webhooks + email + "you have mail"** | Deploy the ~250-line Worker in [`edge/`](../../edge/README.md) to **your own** Cloudflare account (`wrangler deploy`), put `KP_EDGE_URL` + `KP_EDGE_SECRET` in `.env.local`, point your sources at it. Candidate mail arrives through Cloudflare Email Routing; a cron nudges you (ntfy, web push, mail) when events are waiting and kp has been quiet. | free on Cloudflare's free plan — Workers, D1, cron and Email Routing all included |
| **Candidate pages up 24/7** | Not yet. See [the concept doc](../concepts/local-first-edge.md) — the edge serving a signed projection is designed and unbuilt. | — |

One shared HMAC secret whose whole power is "may talk to this queue", and an
append-only log that is *deleted* as your install drains it. Publish a sealing key
(Channels → Edge → Enable sealing) and it cannot read what it holds either. It runs
in your Cloudflare account; KP neither hosts it, sees it, nor bills it. Every
decision — eligibility, scoring, replies — still happens on your machine, on your
models.

**Air-gap interaction:** `KP_OFFLINE=1` disables the edge client outright, ahead
of any stored or env configuration (`resolveEdge`). An air-gapped install is
therefore unaffected by anything in this section.

**Region:** Workers run at the edge; D1 takes a location hint. Do not promise
strict data residency for events *in transit* through the edge. Events at rest on
your host remain wherever `KP_DB_PATH` lives (§4).

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
- [ ] `NEXT_PUBLIC_APP_BASE_URL` (+ `NEXT_PUBLIC_SITE_URL`) set to your public
      origin so candidate-facing links and OG metadata resolve correctly.
- [ ] Only the provider keys you actually use are set (§6).
- [ ] Container memory limit set (the pipeline spawns python subprocesses).
- [ ] Runs as non-root (built in, uid 10001); writes only to `/data` and `/tmp`.
- [ ] Health check green (`docker compose ps`).
- [ ] Backups scheduled; upgrade path rehearsed (§10).

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

### Deployment policy — what the chart may never grant

Everything in this section was true by review and enforced by nothing. `helm
template` renders a privileged pod as happily as an unprivileged one and `helm
lint` has no opinion about replica counts, so a chart edit could regress any of
it silently. **`npm run deploy:check`** (`scripts/deploy/check-chart.mjs`) is the
policy: dependency-free, no helm binary and no cluster, running in the
`node-quality` job of `.github/workflows/ci.yml` on every push and pull request.
`npm run test:deploy` is its fixture suite, and each fixture breaks one policy to
prove it fires — the last case runs the shipped chart, so the chart that ships is
the test.

| Policy | What it refuses |
| --- | --- |
| `replicas-not-pinned` | a Deployment that does not pin `replicas: 1` as a **literal** |
| `strategy-not-recreate` | a rolling update, which overlaps two writers for the length of a deploy |
| `security-context-not-applied` | a Deployment that stopped applying `.Values.podSecurityContext` / `.Values.securityContext` |
| `runs-as-root` | `runAsNonRoot` off, or uid 0 |
| `privilege-escalation-allowed` | `allowPrivilegeEscalation` other than `false` |
| `capabilities-not-dropped` | a capability set that does not drop `ALL` |
| `privileged-pod` | `privileged` / `hostNetwork` / `hostPID` / `hostIPC` set true in any template |
| `service-exposed-by-default` | a default `service.type` other than `ClusterIP` |
| `secret-literal-in-values` | a value in `auth.*` or `providerKeys`, or any credential-shaped literal in `values.yaml` |
| `no-memory-limit` | a pod with no memory limit — the Python pipeline spawns subprocesses per request |
| `no-probes` | liveness/readiness declared but not applied, missing, or **both reading one endpoint** |
| `unreviewed-template` | a file in `templates/` that `REVIEWED_TEMPLATES` does not name — or an entry whose file is gone |
| `service-account-token-mounted` | a pod with no `serviceAccountName`, or with a Kubernetes API token projected into it |
| `no-disruption-budget` | no `PodDisruptionBudget`, so `kubectl drain` takes the only replica silently |
| `secret-not-in-rollout-checksum` | pod annotations that hash the ConfigMap but not the Secret |
| `volume-access-mode-shared` | `persistence.accessMode` other than `ReadWriteOnce` |
| `env-contract-drift` | an env key the chart **sets** that `.env.example` does not document |
| `env-contract-dropped` | an env key in `ENV_CONTRACT_REQUIRED` the chart **stopped** setting |
| `secret-renders-empty-instead-of-failing` | a `required` removed from `KP_OPERATOR_PASSWORD` / `KP_SECRET` in the Secret template |
| `open-mode-shipped-on` | a chart that sets `KP_ALLOW_OPEN` truthy, or an `.env.example` that never documents it |

The gate reads **every file in `deploy/helm/kp/templates/`**, not a list of five.
The five named in `CHART_FILES` stay required — a policy that must read the
Deployment cannot be handed "some template", and a missing one is exit 2 — but
the whole-tree rules (`privileged-pod`, `unreviewed-template`) read the
directory, because a template nobody named used to pass every policy silently.

### Probes: two questions, two answers

`readinessProbe` reads **`/api/health`**, which opens the database, verifies the
seeds and judges the scheduler clock by age, returning 503 with the failing
sub-check named. `livenessProbe` is a **TCP connect on the port** and observes
nothing outside the process, and a `startupProbe` suppresses liveness during the
first boot. This asymmetry is deliberate: the router's red means *stop sending
traffic*, the supervisor's red means *restart*, and `/api/health` 503s on
conditions (a stalled automation clock, a degraded DB) where a restart fixes
nothing and, at one replica with `Recreate`, is the outage. `no-probes` enforces
only that the two read **different** endpoints — naming `/api/health` in the
policy would break the day the route moves.

If you run with `KP_EMPTY=1` (a deliberately blank tenant) the health route counts
the empty job catalogue as degraded, so the pod stays `NotReady`. A default
install seeds the catalogue at boot.

### Pod identity, drains, and rotating a secret

The chart ships a **ServiceAccount with no Role, no RoleBinding and no token**:
kp calls no Kubernetes API, so the correct permission set is empty and a projected
API credential in a pod holding candidate PII buys nothing. Both the account and
the pod spec set `automountServiceAccountToken: false`.

A **PodDisruptionBudget** (`podDisruptionBudget.enabled`, default true) with
`minAvailable: 1` over one replica blocks voluntary eviction entirely, so
`kubectl drain` on the node is refused with the budget named instead of quietly
taking the service down. Set it to `false` if you would rather permit drains —
that is a decision to accept the downtime, not a tuning knob.

The pod annotations hash the **Secret** as well as the ConfigMap, so
`helm upgrade --set auth.secret=<new>` rolls the pod. Without it the Secret object
changed, the container kept the old value (`envFrom.secretRef` is read once at
start) and `helm` reported success — a rotation that appears to have happened.
**With `existingSecret` the chart renders no Secret and has nothing to hash**: if
you rotate a pre-created Secret, roll the pod yourself
(`kubectl rollout restart deploy/<release>`) or carry your own value in
`podAnnotations`.

The first two and `env-contract-drift` are the ones to understand before editing the chart.
The replica rules are **data integrity, not a scaling preference**: a change that
helpfully wires `replicas: {{ .Values.replicaCount }}` back up reads as a tidy-up
and gives you two writers on one SQLite file. `env-contract-drift` exists because
a release is defined partly by its environment contract
(`docs/architecture/releases.md` §versioning); a key renamed on one side of it is
an upgrade break that shows up on a running install as a setting that quietly
stopped applying, never as a failed deploy.

The env contract runs in BOTH directions, and the reverse half is the expensive
one. A key ADDED to the chart and not to `.env.example` is undocumented
configuration; a key **dropped** from the chart is a setting that silently
stopped applying. `ENV_CONTRACT_REQUIRED` names the three the chart must go on
setting — `KP_DB_PATH`, `KP_OPERATOR_PASSWORD`, `KP_SECRET` — each with what
actually breaks without it. Dropping `KP_DB_PATH` from the ConfigMap fails no
deploy: `app/_lib/db-path.ts` derives a path from the launch directory, so the
pod opens a different, empty database inside its own container layer and loses
every write on the next restart.

`secret-renders-empty-instead-of-failing` guards the guard. `templates/secret.yaml`
wraps both auth values in Helm's `required`, so `helm install` fails with a
message rather than rendering an empty `KP_OPERATOR_PASSWORD` and starting an app
with no login. Deleting one `required` is a two-word edit that leaves the key set,
documented and in the Secret — no other policy here notices it.

`open-mode-shipped-on` covers the flag one layer below that. A production build
refuses to boot with no operator password unless **`KP_ALLOW_OPEN=1`** says the
operator meant it, which makes it the only thing that can undo the `required`
above for a whole release. It is off by default, it is now documented in
`.env.example` and commented out in `values.yaml` with its consequence, and the
policy fails if the chart ever ships it on. Set it only where something else does
the gating — an authenticating proxy, a CI e2e run, an air-gapped box.

Changing a policy is a deliberate edit to `POLICIES` in
`scripts/deploy/check-chart.mjs` with the reason — a line a reviewer can disagree
with. Loosening a value in `values.yaml` until the check goes quiet is the
failure mode it exists to prevent. `ENV_CONTRACT_EXEMPT` is the same shape: an
env key exempt from the contract carries the sentence saying why (today only
`NODE_ENV`, a Node convention the app never reads as configuration).

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

> **Prefer a published image to a local build.** Tagged releases publish
> `ghcr.io/xkazm04/kp:<version>` (plus an immutable `sha-<commit>` tag) with a
> build-provenance attestation. What to pin, what a version number promises, and
> the rollback runbook are in **[releases.md](releases.md)**.

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

- `docs/architecture/candidate-data-flow.md` — the same egress question asked from the
  candidate's side: one CV upload hop by hop, what comes to rest in SQLite, and which
  adapters transmit candidate text. §6 above is indexed by destination; that page is
  indexed by the data.
- `docs/product/enterprise-readiness.md` — the full enterprise roadmap; E4 is §5.
- `docs/architecture/llm-provider-layer.md` — the BYOM model-routing layer.
- `docs/features/billing/README.md` — Polar billing (leave off for a self-host without billing).
- `.env.example` — every configuration variable, annotated.
