# Gigs: real paid work, drafted by specialist agents

A gig is one unit of real paid work found in the world: a security bounty program, a
freelance brief, an ML competition, an open-source bounty. A **specialist agent**,
composed from registry recipes and running in Personas, drafts the work. The
**operator** reviews the draft and sends it under their own account. kp never submits,
bids, comments or pays anywhere by itself. Its outcomes are the external judge's
verdicts, and they are what the KPI measures.

Design record: Spark vault idea `agent-foundry-validation` (2026-09-24). Wire vocabulary:
one file, [`app/_lib/gigs/types.ts`](../../../app/_lib/gigs/types.ts). Every layer
imports from it.

## Entry points

| Surface | Path | Gate |
| --- | --- | --- |
| API | `app/api/gigs/**` | operator-gated by the proxy, `requireOperator` in every handler, `pipeline:write` on every write |
| Scan runner (manual) | `gig_scan` task kind: `app/_lib/tasks.ts` delegates to `app/_lib/late-bound-boot.ts` | enqueued only by `POST /api/gigs/scan` (a server kind, `task-admission.ts`) |
| Sync + outcome pollers | `gig_sync` runner (`late-bound-boot.ts`) and clock job (`instrumentation-node.ts`) | scheduler job `gig_sync`, off by default |
| Scan clock job | scheduler job `gig_scan` (`app/_lib/scheduler-jobs.ts`) | off by default; cannot be armed before one manual scan succeeded |
| Lessons export | `GET/POST /api/gigs/lessons` | operator session, or the `x-kp-automation-token` machine door |
| UI (the Gigs tab) | none yet | lands in the next spark |

## User flows

1. **Sources.** The operator adds an official-API source (`POST /api/gigs/sources`).
   Tier A (`github_bounty`, `algora`) is created enabled. Tier B (`kaggle`,
   `hackerone`, `freelancer_api`, `upwork_api`) is created disabled and paused
   `terms_review` until the operator acknowledges the terms summary the catalog shows
   (`PATCH .../sources/[id] {action:"acknowledge", termsHash}`). The catalog
   (`app/_lib/gigs/sources-catalog.ts`) states each adapter's host, the env var names
   it reads, what it does keyless, and a short summary of the terms and the exposure
   of the account they bind. `termsHash` is sha256 of that summary. When the summary
   changes, a stale acknowledgement is refused (`GIG_SOURCE_TERMS_CHANGED`) and a
   resume needs a fresh acknowledgement (`GIG_SOURCE_TERMS_REQUIRED`).
2. **Scan.** "Scan now" (`POST /api/gigs/scan`) enqueues `gig_scan`: every enabled,
   unpaused source runs through its adapter (`app/_lib/gigs/adapters/`, behind the
   jobseeker `politeFetch` door), every listing goes through the deterministic
   honeypot scan (`suspect.ts`), and every listing still `new` is qualified
   (`qualify.ts`, fixed weights, no model). The operator can also forward a brief by
   hand (`POST /api/gigs`). It gets the same honeypot scan and the same qualification.
3. **Specialists.** `POST /api/gigs/specialists {arena, niche}` composes a spec from
   the arena's recipes (`recipes.ts`, registry first, seed map otherwise) and hires it
   through the shared agent hire path (`mintAndDispatch`). A live specialist for the
   same arena and niche is reused.
4. **Dispatch.** `POST /api/gigs/[id]/dispatch` claims the gig by CAS, creates an
   attempt and POSTs the assignment to Personas. The Personas call runs outside any
   transaction (`dispatch.ts`). The listing text is sent as data (`bodyUntrusted`),
   never as part of the prompt. `gig_sync` pulls the run's state and lands the
   `kp-deliverable` block (`sync.ts`, `deliverable.ts`).
5. **Review.** `POST /api/gigs/attempts/[id]` with `approve`, `revise` (a note is
   required; a new attempt carries it), `discard` (the gig returns to `qualified`) or
   `mark_sent`. **`mark_sent` is refused (422 `GIG_DISCLOSURE_REQUIRED`) unless the
   review ticks the AI-use disclosure item.** The review (checklist ticks, note, time
   spent) is stored on the attempt. Table of moves: `app/_lib/gigs/review.ts`.
6. **Outcome.** `POST /api/gigs/[id]/outcome` records the verdict (`outcome.ts`):
   appended (never updated), gig `sent` becomes `accepted`, `rejected` (a duplicate is
   a rejection) or `expired` (`no_response`: the operator stopped waiting, and
   `expired` does not claim a verdict). The verdict is folded into the source's invalid
   streak, and 5 rejections in a row pause the source (`sourcePaused: true` in the
   answer). One lesson per adopted recipe is queued. A verdict on a gig that is already
   resolved is a correction: it is appended, but moves no status and leaves the streak
   alone.
7. **Pollers.** On each `gig_sync`, sent `oss_bounty` work whose deliverable names a
   GitHub pull request is read through `githubRead`: a merged PR records `accepted`, a
   PR closed without merging records `rejected`. Sent `competition` work, once the
   deadline has passed and with a Kaggle key, reads the account's submissions: a
   completed submission with a private score records `accepted` (the entry is on the
   final leaderboard; this says nothing about placing), and all submissions errored
   records `rejected`. Pollers never append a second verdict for one attempt, and an
   unreadable answer is retried rather than read as a verdict (`pollers.ts`).
8. **Lessons.** The registry lander reads `GET /api/gigs/lessons?pending=1` (each
   lesson with the recipe's registry-relative folder from `recipes/index.json`),
   appends the bullets to each recipe's LESSONS.md, commits, then stamps them with
   `POST /api/gigs/lessons {ids}`.

## API surface

| Method | Path | Capability | Rate limit (per IP / 10 min) | Codes |
| --- | --- | --- | --- | --- |
| GET | `/api/gigs` | operator | none | `GIG_INPUT_INVALID` |
| POST | `/api/gigs` | `pipeline:write` | 30 `gigs-forward` | `GIG_INPUT_INVALID` |
| GET | `/api/gigs/[id]` | operator | none | `GIG_NOT_FOUND` |
| PATCH | `/api/gigs/[id]` | `pipeline:write` | 120 `gigs-write` | `GIG_NOT_FOUND`, `GIG_ACTION_NOT_ALLOWED`, `GIG_STATE_CHANGED`, `GIG_INPUT_INVALID` |
| POST | `/api/gigs/[id]/dispatch` | `pipeline:write` | 20 `gigs-dispatch` | `GIG_NOT_FOUND`, `GIG_SUSPECT`, `GIG_NOT_DISPATCHABLE`, `GIG_SPECIALIST_NOT_READY` (409), `GIG_DISPATCH_FAILED` (502) |
| POST | `/api/gigs/[id]/outcome` | `pipeline:write` | 60 `gigs-outcome` | `GIG_NOT_FOUND`, `GIG_ATTEMPT_NOT_FOUND`, `GIG_OUTCOME_NOT_SENT`, `GIG_INPUT_INVALID` |
| GET | `/api/gigs/attempts/[id]` | operator | none | `GIG_ATTEMPT_NOT_FOUND` |
| POST | `/api/gigs/attempts/[id]` | `pipeline:write` | 60 `gigs-review` | `GIG_ATTEMPT_NOT_FOUND`, `GIG_ACTION_NOT_ALLOWED`, `GIG_STATE_CHANGED`, `GIG_DISCLOSURE_REQUIRED` (422), `GIG_REVISION_NOTE_REQUIRED`, plus the dispatch codes on `revise` |
| GET | `/api/gigs/sources` | operator | none | none |
| POST | `/api/gigs/sources` | `pipeline:write` | 60 `gigs-sources-write` | `GIG_INPUT_INVALID`, `GIG_SOURCE_REFUSED` |
| PATCH | `/api/gigs/sources/[id]` | `pipeline:write` | 60 `gigs-sources-write` | `GIG_SOURCE_NOT_FOUND`, `GIG_SOURCE_TERMS_CHANGED`, `GIG_SOURCE_TERMS_REQUIRED`, `GIG_ACTION_NOT_ALLOWED` |
| POST | `/api/gigs/scan` | `pipeline:write` | 6 `gigs-scan` | none (202 + `taskId`) |
| GET | `/api/gigs/specialists` | operator | none | none |
| POST | `/api/gigs/specialists` | `pipeline:write` | 10 `gigs-specialist-hire` (plus the hire tail's own) | `GIG_INPUT_INVALID`, the hire tail's codes |
| GET | `/api/gigs/kpi` | operator | none | none |
| GET | `/api/gigs/lessons` | operator or automation token | none | `GIG_INPUT_INVALID` |
| POST | `/api/gigs/lessons` | `pipeline:write` or automation token | 60 `gigs-lessons-land` | `GIG_INPUT_INVALID` |

Every handler answers store faults with `GIG_STORE_FAILED`. All codes are in
`app/_lib/api-response.ts`, with four catalog entries each under `errors.*`. The
limiters are pinned in `app/api/rate-limit-contract.test.ts`.

| Library module | Role |
| --- | --- |
| `app/_lib/gigs/types.ts` | the wire vocabulary |
| `app/_lib/gigs/transitions.ts` | both state machines as data (`drafted`/`in_review` -> `qualified` added for `discard`) |
| `app/_lib/gigs/adapters/**`, `scan.ts`, `suspect.ts` | official-API acquisition, the honeypot scan, the scan orchestrator |
| `app/_lib/gigs/qualify.ts` | deterministic qualification and specialist match |
| `app/_lib/gigs/recipes.ts`, `specialist.ts`, `checklists.ts` | recipe resolution, specialist composition and hire, per-arena review checklists |
| `app/_lib/gigs/dispatch.ts`, `personas-exec.ts`, `sync.ts`, `deliverable.ts` | Personas dispatch, run sync, deliverable parser |
| `app/_lib/gigs/review.ts` | the review desk's actions |
| `app/_lib/gigs/outcome.ts` | the one verdict path (manual and pollers) |
| `app/_lib/gigs/pollers.ts` | GitHub and Kaggle outcome pollers |
| `app/_lib/gigs/lessons.ts` | deterministic lesson bullets and the feedback scrubber |
| `app/_lib/gigs/kpi.ts` | the pure KPI fold |
| `app/_lib/gigs/sources-catalog.ts` | tiers, hosts, keys, terms summaries and hashes |

## Lessons

`lessons.ts` is pure: the same outcome always gives the same bullets. Each adopted
recipe gets the common bullets:

- `accepted: <arena> work whose evidence included <evidence kinds> and whose checklist had <n>/<m> items ticked`
- `rejected: ...` in the same shape, plus `left unticked before sending: <keys>`
- `rejected as duplicate: check for prior reports before drafting`
- `no response: <arena> work drew no verdict; agree a follow-up window ...`
- `feedback (scrubbed): <text>`, only after scrubbing

Three recipes add one bullet of their own. Opportunity qualification gets the score
and its reward and deadline facts. Pre-send verification gets the evidence counted by
kind with pass/fail. Disclosed proposal writing gets whether the disclosure was ticked.
The scrubber removes URLs, e-mail addresses, @handles, numbers longer than 6 digits,
paths, credential-looking strings, and every form of the org/client name and the
listing title. A bullet names only closed vocabularies (arena, verdict, evidence kinds,
checklist keys), never an account, client, credential or path.

## Data model

Six workspace-scoped tables, DDL in `app/_lib/db/core.ts`. Each is listed in the tenancy
manifest with a colocated `*-tenancy.test.ts`, and each is erasure-exempt because none
holds candidate data:
`gig_sources` (`db/gigs-sources.ts`), `gigs` (`db/gigs.ts`), `gig_specialists`
(`db/gigs-specialists.ts`), `gig_attempts` (`db/gigs-attempts.ts`), `gig_outcomes`
(append-only) and `gig_lessons` (`db/gigs-outcomes.ts`). Every status move is a CAS
under `.immediate()`.

## Keyless behaviour

- `github_bounty` and `freelancer_api` run keyless. `hackerone` falls back to the public
  bounty-targets dataset (programs only, no reward tables). `kaggle` and `upwork_api`
  pause as `no_key` until the operator sets the key.
- Qualification, the honeypot scan, lesson derivation and the KPI are deterministic.
  No model is involved.
- The GitHub poller runs keyless at GitHub's unauthenticated rate. The Kaggle poller does
  nothing without `KAGGLE_USERNAME` + `KAGGLE_KEY`: it makes no request and records no
  verdict.
- With no Personas pairing, dispatch fails with a reason code (`personas_unpaired`), the
  attempt is recorded `failed` and the gig returns to `qualified`.
- Under `KP_OFFLINE` every source and both pollers answer offline before any network
  access.

## Known gaps

- Three arena recipes (the bug-bounty report, the open-source bounty contribution and
  the opportunity qualification) are not in the registry yet. They resolve from the
  seed map in `recipes.ts` at 0.1.0, specialists record `registry: "unavailable"`, and
  their lessons export with `recipePath: null`.
- Personas does not yet grant kp `personas:execute:persona:<id>` when a hire is
  approved. Until it does, a sync's 403 is recorded as `personas_scope_missing`.
- `api.upwork.com/robots.txt` disallows every path and the fetch door obeys it, so
  `upwork_api` ends `failed: robots_disallowed` even with a key. The operator has not
  yet decided whether to change this.
- Algora has no public JSON API. Its bounties arrive through `github_bounty`
  (the "💎 Bounty" label).
- The machine door of `/api/gigs/lessons`, like `/api/agents/hire-from-need`, is not on
  the proxy's public list. On a password-gated deploy, a cookie-less lander is refused
  by the proxy before the token is read.
- The UI (the Gigs tab) lands in the next spark.
