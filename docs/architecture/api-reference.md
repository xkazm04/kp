# API reference — every route, its methods, and who can reach it

The **contract** every handler follows — the response envelope, the auth posture,
the limiter, the Python wire protocol — is
[api-contracts.md](api-contracts.md). Read that before changing a handler. This
file is the **inventory**: what is actually there.

**The table below is generated from the tree.** `npm run api:docs` rewrites it
from `app/api/**/route.ts`; `npm run api:check` fails the build when it and the
tree disagree, and runs in `ci.yml`'s node-quality job on every push. Do not
hand-edit between the markers — the prose around them is yours, the rows are not.

## What each column means, and where it comes from

| Column | Source |
| --- | --- |
| **Route** | the directory under `app/api`, exactly as Next resolves it. `[id]` is a dynamic segment. |
| **Methods** | the handlers the file exports. A method not listed here 405s. |
| **Auth** | **computed by calling `isPublicPath()`** — the same predicate `proxy.ts` uses. Not a second list that agrees with it today. |

`gated` means the fail-closed auth gate in
[`proxy.ts`](../../proxy.ts) requires an operator session before the handler
runs. `public` means it does **not** — and that is emphatically *not* the same as
*unauthenticated*. Nearly every public route here carries its own door:

- **capability tokens** — `/api/schedule/<token>`, `/api/offer/<token>`,
  `/api/status/<token>`, `/api/data/<token>`, `/api/invite/<token>`,
  `/api/skill-profile/<token>/verify`, `/api/agents/report/<token>`. An opaque
  CSPRNG token IS the credential; there is no session. These responses carry an
  explicit field allowlist rather than a store row — see `publicInviteView` in
  `app/api/schedule/[token]/route.ts`.
- **machine callers with a shared secret** — `/api/billing/webhook` (Polar),
  `/api/comms/callback` (constant-time `x-comms-secret`, a ±5-minute timestamp
  and a nonce replay guard), `/api/devcase/inbound`, `/api/channels/inbound/…`.
  These are public because a machine has no session cookie, so the operator gate
  would 401 them before their own auth ever ran.
- **genuinely open** — `/api/health`, `/api/demo` (mints an isolated demo-workspace
  session), `/api/extract-text`, and the `/api/auth/…` and `/api/apply/…` surfaces
  a candidate or a new operator meets before they have a session.

Every open route that spends money or spawns a subprocess additionally carries a
per-IP or per-token `rateLimit()`, and which ones is pinned by
`app/api/rate-limit-contract.test.ts` — adding, moving or re-keying a limiter
means updating that contract deliberately.

The allow-list itself, with the reasoning for each entry, is
[`app/_lib/auth/public-routes.ts`](../../app/_lib/auth/public-routes.ts). It is
**fail-closed**: a route nobody listed stays gated. Read that file before
proposing to add to it.

## What this reference does NOT carry: request and response shapes

A shape belongs with the code that produces it, and no parser should invent one.
The convention this repository follows is that the handler's **header comment**
declares its contract — `app/api/stt/route.ts` is the shape to copy:

```ts
// The host wrapper around the portable STT package (docs/architecture/voice-stt-package.md).
//   GET  /api/stt  -> { providers: SttStatus[], preferred, allowed }   (probe, no transcription)
//   POST /api/stt  multipart: audio=<File>, language?, provider?, model?,
//                  diarize?, redact?, onDevice? -> a transcript as JSON
```

`npm run api:check` counts how many handlers do not do this and prints the number
without failing on it — a note rather than a gate, because seeding a ceiling for
it is a measurement nobody has taken, and a ceiling nobody measured is a number
nobody can defend. Closing that number is the next rung; **when you add a route,
write those two lines.**

The typed schemas that cross the TS/Python boundary are a separate, already-generated
contract: `npm run typecheck` runs `schemas:gen`
(`python -m pipeline.jobfit.codegen`) first, so those cannot drift. See
[the LLM layer](llm.md) and [persistence](persistence.md) for the shapes that
live on the other side of a route.

## The routes

<!-- BEGIN GENERATED ROUTES -->

_206 routes, 271 handlers._

### `/api/agents`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/agents` | GET | gated |
| `/api/agents/[id]/refresh` | POST | gated |
| `/api/agents/bridge` | GET, DELETE | gated |
| `/api/agents/catalog` | GET | gated |
| `/api/agents/dispatch` | POST | gated |
| `/api/agents/pair` | POST | gated |
| `/api/agents/report/[token]` | POST | public |

### `/api/analyses`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/analyses` | GET | gated |
| `/api/analyses/[slug]` | GET, PATCH | gated |

### `/api/analytics`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/analytics` | GET | gated |
| `/api/analytics/calibration` | GET | gated |
| `/api/analytics/calibration/apply-threshold` | POST | gated |
| `/api/analytics/calibration/band` | GET | gated |
| `/api/analytics/calibration/threshold-history` | GET | gated |
| `/api/analytics/decisions` | GET | gated |
| `/api/analytics/metric-pack` | GET | gated |
| `/api/analytics/spend` | POST | gated |
| `/api/analytics/targets` | POST | gated |

### `/api/analyze`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/analyze` | POST | gated |

### `/api/apply`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/apply/[id]` | POST | public |
| `/api/apply/[id]/followup` | POST | public |
| `/api/apply/[id]/quick` | POST | public |
| `/api/apply/[id]/session` | POST | public |

### `/api/archetypes`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/archetypes` | GET, POST | gated |
| `/api/archetypes/[id]` | PUT, PATCH | gated |

### `/api/ats`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/ats/candidate/[id]` | GET | gated |
| `/api/ats/config` | GET, POST | gated |
| `/api/ats/connections` | GET, POST, DELETE | gated |
| `/api/ats/deliveries` | GET, POST | gated |
| `/api/ats/test` | POST | gated |

### `/api/attention`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/attention` | GET | gated |

### `/api/auth`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/auth/login` | POST | public |
| `/api/auth/logout` | POST | public |
| `/api/auth/register` | POST | public |
| `/api/auth/switch-workspace` | POST | public |

### `/api/automation`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/automation/[task]` | POST | gated |
| `/api/automation/run` | POST | gated |
| `/api/automation/schedule` | GET, POST | gated |

### `/api/benchmarks`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/benchmarks` | GET | gated |
| `/api/benchmarks/salary` | GET | gated |

### `/api/billing`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/billing` | GET | gated |
| `/api/billing/checkout` | POST | gated |
| `/api/billing/portal` | POST | gated |
| `/api/billing/webhook` | POST | public |

### `/api/brand`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/brand` | GET, PUT | gated |

### `/api/calendar`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/calendar/google` | GET, DELETE | gated |
| `/api/calendar/google/callback` | GET | gated |
| `/api/calendar/google/start` | GET | gated |

### `/api/channels`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/channels/inbound/[token]` | POST | public |
| `/api/channels/webhooks` | GET, POST, PATCH | gated |
| `/api/channels/webhooks/[token]` | DELETE | gated |

### `/api/comms`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/comms` | GET | gated |
| `/api/comms/[id]/resend` | POST | gated |
| `/api/comms/callback` | POST | public |
| `/api/comms/capability` | GET | gated |
| `/api/comms/relay` | GET, POST | gated |
| `/api/comms/relay/test` | POST | gated |

### `/api/companion`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/companion/[id]/message` | POST | gated |
| `/api/companion/brain` | GET, POST | gated |
| `/api/companion/proposals/[id]/resolve` | POST | gated |
| `/api/companion/threads` | GET, POST | gated |

### `/api/compliance`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/compliance` | GET | gated |

### `/api/data`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/data/[token]` | GET, POST | public |

### `/api/decisions`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/decisions/config` | GET, POST | gated |
| `/api/decisions/group-eval` | GET | gated |
| `/api/decisions/jd-freshness` | GET | gated |
| `/api/decisions/peer-context` | GET | gated |
| `/api/decisions/reconsider` | GET | gated |
| `/api/decisions/records` | GET | gated |
| `/api/decisions/screen-wave` | POST | gated |

### `/api/demo`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/demo` | GET | public |

### `/api/devcase`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/devcase` | GET, POST | gated |
| `/api/devcase/comms` | GET | gated |
| `/api/devcase/control` | GET, POST | gated |
| `/api/devcase/feedback` | POST | gated |
| `/api/devcase/inbound` | POST | public |
| `/api/devcase/lifecycle` | GET, POST | gated |
| `/api/devcase/lifecycle/[id]/approve` | POST | gated |
| `/api/devcase/lifecycle/[id]/close` | POST | gated |
| `/api/devcase/lifecycle/[id]/redesign` | POST | gated |
| `/api/devcase/outcomes` | GET, POST | gated |
| `/api/devcase/postings` | GET | gated |
| `/api/devcase/promote` | POST | gated |
| `/api/devcase/publish` | POST | gated |
| `/api/devcase/session` | POST | public |
| `/api/devcase/session/[id]` | GET, POST | public |
| `/api/devcase/session/[id]/chat` | POST | public |
| `/api/devcase/session/[id]/submit` | POST | public |
| `/api/devcase/skill-profile` | POST | gated |
| `/api/devcase/source` | POST | gated |
| `/api/devcase/submit` | POST | gated |

### `/api/edge`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/edge` | GET, POST | gated |
| `/api/edge/drain` | POST | gated |
| `/api/edge/pair` | POST | gated |

### `/api/extract-text`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/extract-text` | POST | public |

### `/api/feedback`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/feedback` | GET, POST | gated |

### `/api/github-analysis`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/github-analysis` | POST | gated |

### `/api/health`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/health` | GET | public |

### `/api/intake`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/intake` | GET, POST | gated |
| `/api/intake/[id]` | GET | gated |
| `/api/intake/[id]/attachments` | POST | gated |
| `/api/intake/[id]/brief` | PATCH | gated |
| `/api/intake/[id]/compose-app-master` | POST | gated |
| `/api/intake/[id]/dossier` | POST | gated |
| `/api/intake/[id]/message` | POST | gated |
| `/api/intake/[id]/promote` | POST | gated |
| `/api/intake/[id]/reopen` | POST | gated |
| `/api/intake/[id]/voice-complete` | POST | gated |
| `/api/intake/[id]/voice-connect` | GET, POST | gated |
| `/api/intake/[id]/voice-turn` | POST | gated |

### `/api/interview`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/interview/by-entry` | GET | gated |
| `/api/interview/compare` | GET | gated |
| `/api/interview/complete` | POST | public |
| `/api/interview/connect` | GET, POST | public |
| `/api/interview/create` | POST | gated |
| `/api/interview/revoke` | POST | gated |
| `/api/interview/sessions` | GET | gated |
| `/api/interview/simulate` | POST | gated |
| `/api/interview/simulate/attach` | POST | gated |

### `/api/interview-prep`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/interview-prep` | GET, POST, PUT, PATCH | gated |
| `/api/interview-prep/scorecard` | POST | gated |

### `/api/invite`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/invite/[token]` | GET, POST | public |

### `/api/jds`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/jds` | GET, POST | gated |
| `/api/jds/[slug]` | GET, PATCH | gated |
| `/api/jds/[slug]/analyses` | GET | gated |
| `/api/jds/[slug]/ingest-job` | POST | gated |
| `/api/jds/[slug]/retry-analysis` | POST | gated |
| `/api/jds/[slug]/revisions` | GET, POST | gated |
| `/api/jds/generate` | POST | gated |
| `/api/jds/save` | POST | gated |

### `/api/jobs`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/jobs` | GET | gated |
| `/api/jobs/[id]` | GET | gated |
| `/api/jobs/[id]/agent-fit` | GET, POST | gated |
| `/api/jobs/[id]/assignments` | GET | gated |
| `/api/jobs/[id]/campaign` | GET, POST | gated |
| `/api/jobs/[id]/candidates` | GET | gated |
| `/api/jobs/[id]/candidates/outreach` | POST | gated |
| `/api/jobs/[id]/close` | POST | gated |
| `/api/jobs/[id]/publish` | POST | gated |
| `/api/jobs/[id]/rediscover` | GET | gated |
| `/api/jobs/[id]/winnability` | GET | gated |
| `/api/jobs/ingest` | POST | gated |
| `/api/jobs/status` | GET | gated |

### `/api/llm`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/llm/activity` | GET | gated |
| `/api/llm/config` | GET, PUT, DELETE | gated |
| `/api/llm/keys` | GET, PUT, DELETE | gated |
| `/api/llm/keys/test` | POST | gated |
| `/api/llm/test` | POST | gated |
| `/api/llm/usage` | GET | gated |

### `/api/match`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/match` | POST | gated |
| `/api/match/reasoning` | POST | gated |

### `/api/matrix`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/matrix` | GET | gated |

### `/api/me`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/me/getting-started` | GET | gated |
| `/api/me/onboarding` | POST | gated |

### `/api/offer`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/offer/[token]` | GET, POST | public |

### `/api/ops`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/ops` | GET | gated |

### `/api/org`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/org/invites` | GET, POST | gated |
| `/api/org/invites/[token]` | DELETE | gated |
| `/api/org/members` | GET | gated |
| `/api/org/members/[userId]` | PATCH, DELETE | gated |

### `/api/palette`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/palette/preview` | GET | gated |

### `/api/pipeline`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/pipeline` | GET, POST | gated |
| `/api/pipeline/[id]` | GET, POST | gated |
| `/api/pipeline/[id]/consent` | GET | gated |
| `/api/pipeline/[id]/timeline` | GET | gated |
| `/api/pipeline/batch` | POST | gated |
| `/api/pipeline/command` | POST | gated |
| `/api/pipeline/events` | GET | gated |
| `/api/pipeline/outcomes` | GET, POST | gated |
| `/api/pipeline/stage-impact` | GET | gated |
| `/api/pipeline/stage-migration` | POST | gated |

### `/api/profile`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/profile` | GET, POST, PUT, DELETE | gated |
| `/api/profile/candidates` | GET | gated |
| `/api/profile/draft` | POST | gated |

### `/api/rediscovery`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/rediscovery/alerts` | GET, POST, PATCH | gated |

### `/api/repo-scan`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/repo-scan` | POST | gated |
| `/api/repo-scan/[id]` | GET | gated |

### `/api/schedule`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/schedule` | GET, POST, PATCH | gated |
| `/api/schedule/[token]` | GET, POST | public |
| `/api/schedule/invite` | POST | gated |
| `/api/schedule/invite/bulk` | POST | gated |

### `/api/search`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/search` | GET | gated |

### `/api/sim`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/sim/apply-cv` | POST | gated |
| `/api/sim/inbound` | POST | gated |
| `/api/sim/offer-draft` | POST | gated |
| `/api/sim/offer-link` | GET | gated |
| `/api/sim/reset` | POST | gated |
| `/api/sim/screen-draft` | POST | gated |

### `/api/skill-profile`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/skill-profile/[token]/verify` | GET | public |

### `/api/status`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/status/[token]` | GET | public |
| `/api/status/[token]/decisions` | GET | public |
| `/api/status/[token]/nps` | GET, POST | public |

### `/api/stt`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/stt` | GET, POST | gated |

### `/api/tasks`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/tasks` | GET, POST | gated |
| `/api/tasks/[id]` | GET, DELETE | gated |
| `/api/tasks/[id]/retry` | POST | gated |
| `/api/tasks/history` | GET | gated |
| `/api/tasks/seen` | POST | gated |

### `/api/templates`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/templates` | GET, POST | gated |
| `/api/templates/[id]` | GET, PUT, DELETE | gated |

### `/api/tts`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/tts` | GET, POST | gated |

### `/api/workspace`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/workspace/export` | GET | gated |
| `/api/workspace/import` | POST | gated |

### `/api/workspaces`

| Route | Methods | Auth |
| --- | --- | --- |
| `/api/workspaces` | GET, POST | gated |
| `/api/workspaces/[id]` | PATCH | gated |
| `/api/workspaces/[id]/members/[userId]` | PUT, DELETE | gated |

<!-- END GENERATED ROUTES -->

## Adding a route

1. Create `app/api/<path>/route.ts` and export the handlers.
2. **Declare the contract in the header comment** — the two lines above the
   imports that say what it takes and what it returns.
3. Decide the auth posture deliberately. Gated is the default and the safe one;
   a public route needs an entry in `app/_lib/auth/public-routes.ts` **with the
   reason**, and it needs its own door (a token, a shared secret) because the
   session gate is no longer in front of it.
4. If it spends money or spawns a subprocess, add a `rateLimit()` and update
   `app/api/rate-limit-contract.test.ts`.
5. Run `npm run api:docs` and commit the rewritten table with the route.

Step 5 is not a chore you can forget: `npm run api:check` runs in CI and names
the route it cannot find a row for.
