# Gig sourcing freshness — retiring stale gigs and rescanning valid sources

> **Status: partly built (2026-09-30).** Mechanisms B and C are built for **Freelancer only**
> (`app/_lib/gigs/freshness.ts`, documented in `docs/features/gigs/README.md` "Freshness"): a
> post-scan re-check and a pre-dispatch gate, recording the state in `source_state_json` /
> `freshness_checked_at` rather than the `last_seen_at` pair below. The GitHub/Algora claim
> detection, the disappearance sweep (A) and re-surfacing remain a proposal. It extends the Gigs module
> (`app/_lib/gigs/**`, `docs/features/gigs/README.md`). Grounded in the
> 2026-09-27 oss_bounty training cycle, where **all 31** low-setup OphirPay
> issues were already claimed by competing PRs and nothing detected it before a
> specialist was dispatched — every run was wasted on a gig that could not be won.

## The gap today

The catalog has an identity model but no **freshness** model.

- **Identity is done right.** A listing is keyed on `(workspace, source_id,
  external_key)` — a stable key, never a display field — and `upsertGigFromRaw`
  UPDATES the existing row on re-scan and **preserves a terminal status**
  (`app/_lib/db/gigs.ts`). A re-scan of a declined gig stays declined.
- **Staleness is absent.** `expired` today means "we applied and got no
  response" (`outcome.ts`, `no_response → expired`); `withdrawn` is a manual
  operator action (`app/api/gigs/[id]/route.ts`). Nothing marks a `new` /
  `qualified` gig stale when its issue is **claimed, closed, or has dropped off
  the source**. An unchanged re-scan writes nothing (by design, to keep the
  desk's sort quiet), so there is no "last seen" signal and a listing that
  DISAPPEARED from the source lingers as `new` forever.

The state machine already supports disposal: `new → expired`, `qualified →
expired`, `dispatched → expired` are legal edges, and `expired` is terminal
(`transitions.ts`). What is missing is the logic that DRIVES those edges from
freshness, plus the timestamps to compute freshness from.

## Two questions, held separately

From the registry's `candidate-identity-and-staleness` (recruiting): identity
and staleness are different questions, and the classic failure is answering one
while believing you answered both.

- **Identity** — is this the same listing? The `external_key`. Solved.
- **Staleness** — is this listing still workable (open, unclaimed, present)?
  Unsolved.

Two registry rules shape the rest:

- **What goes stale is the VERDICT, not the evidence**
  (`requirement-edited-since-scored`). A gig's *qualification* — "workable,
  dispatch it" — is a statement about the listing at qualification time. It is
  stale, exactly and detectably, when the **listing changed after it was
  qualified**: a competing PR appeared, the issue closed or was assigned, the
  reward changed. The listing text itself did not become false; the decision to
  dispatch did. This is the basis for the pre-dispatch gate below.
- **Terminal outranks advisory** (`retired-outranks-stale-status-precedence`).
  `expired` / `declined` / `withdrawn` / `sent`-and-resolved are TERMINAL — they
  end the gig's usefulness and have no remedy. `stale` / `not-recently-seen` are
  ADVISORY — they imply "you could still act." A re-observation of a terminal
  gig must **never** resurrect it to `new`. `upsertGigFromRaw` already honours
  this; every new mechanism below must too.

## The model — two timestamps

Add to `gigs`, distinct from `created_at` (first seen) and `updated_at` (content
last changed — the desk's sort key):

| Column | Meaning | Written when |
| --- | --- | --- |
| `last_seen_at` | the listing was last OBSERVED on its source | every scan that re-discovers it, even when nothing changed |
| `freshness_checked_at` | the gig's claim/closure state was last RE-VERIFIED | each per-gig freshness re-check (mechanism B / C) |

`last_seen_at` is the one write an unchanged re-scan must now make — a targeted
`UPDATE last_seen_at` that leaves `updated_at` (and the desk sort) alone. It is
the signal that separates "seen, unchanged" from "gone."

**The `external_key` must be the source's IMMUTABLE id**, so re-ingest recognises
a listing rather than duplicating it and so a tombstone survives a rename: a
GitHub issue's `node_id` (GraphQL global id) or numeric `id`, never `html_url` or
the issue number alone (both change on transfer/rename); an Algora bounty's `id`.
Confirm the `github_bounty` adapter keys on the immutable id before building the
sweep on top of it.

Disposal reuses `expired` (terminal) with an explicit **reason** so the desk and
the operator see WHY, never a silent drop (`sourcing-campaign-honesty`):
`source_dropped`, `claimed`, `closed`, `deadline_passed`.

## Three mechanisms

### A. Disappearance sweep — the listing left the source

**Absence in a scan is never, by itself, a reason to expire.** Filters,
reordering and pagination all drop items that still exist, so a listing missing
from one pass may be alive. Two guards, both required:

- **Complete discover only.** The sweep may consider a source ONLY when this
  scan discovered it COMPLETELY — every page fetched, not stopped by the wall
  budget, an abort, or a `blocked` / `collapsed` / `no_key` pause. `scan.ts`
  already records per-source completion (`skipped` with `wall_budget` /
  `aborted`, the pause codes); a per-source `discover_complete` flag on the
  summary gates the sweep. A source that did not finish a full pass expires
  nothing — otherwise a rate-limit blip retires the whole backlog.
- **Confirm by direct fetch, or by a grace window.** An active gig
  (`new` / `suspect` / `qualified`) whose `last_seen_at` predates this scan is a
  CANDIDATE, not a casualty. Confirm it is gone by **fetching the resource by its
  stable key**: `404` / `410` → `expired (source_dropped)`; `200` with
  `state=closed` or an assignee → `expired (closed)` / `expired (claimed)` (not
  "gone"). Only when a direct fetch is not possible does the fallback apply:
  **N consecutive complete-discover misses past a grace window** (e.g. 3 scans /
  48h) before expiry. The grace window absorbs a transient scan gap so a flaky
  page never tombstones a live gig.

### B. Freshness re-check poller — the issue was claimed or closed

A new poller beside the outcome pollers in `pollers.ts` (which already read
GitHub for `sent` gigs). It runs over ACTIVE gigs (`new` / `qualified`; option
to include `dispatched` to abort a doomed in-flight run) and, per gig, re-reads
the source's claim/closure state through the one GitHub transport
(`repo-snapshot.ts` `githubRead`, keyless at 60 reads/hour, `KP_OFFLINE`
honoured).

The rule, in one line: **claimed = an assignee is set, OR ≥1 open
cross-referencing PR exists, OR the issue is closed.**

- issue **closed** → `expired (closed)` (strongest, but latest);
- an **assignee** set, or an **open PR that cross-references the issue** →
  `expired (claimed)`. The competing open PR is the EARLIEST signal — it appears
  *before* the issue closes, which is what matters when bounties are claimed
  inside 24h. Read it from the issue timeline (`GET
  /repos/{o}/{r}/issues/{n}/timeline`, or GraphQL
  `timelineItems(itemTypes: [CROSS_REFERENCED_EVENT])` whose source is a
  `pull_request`), not from a text match on the body;
- `404` / `410` → `expired (source_dropped)`;
- otherwise stamp `freshness_checked_at` and leave it.

Prioritise oldest-`freshness_checked_at` first, cap reads per tick to the rate
budget, and record a code per gig (never a silent skip). Use **conditional
requests** (`If-None-Match` ETag / `If-Modified-Since`): an authenticated `304`
is free — it does not count against GitHub's primary rate limit — which is what
makes frequent re-checks affordable. This is the mechanism that would have
retired most of the 31 training gigs before any dispatch.

### C. Pre-dispatch freshness gate — the cheapest, highest-value win

Right before `dispatchGigAttempt` claims a gig, one freshness read (mechanism
B's reader for a single gig). If the gig has been **claimed or closed since it
was qualified** (`requirement-edited-since-scored`: listing moved after the
verdict), expire it instead of dispatching — refuse `GIG_STALE` rather than burn
a specialist run. A qualification older than a short freshness TTL is re-checked;
a fresh one dispatches straight through. This alone converts the training
cycle's 31 wasted runs into 31 cheap skips.

## Disposal policy

- **Soft-expire, never hard-delete on staleness.** `expired` is a terminal
  tombstone; `upsertGigFromRaw` preserves it, so a later re-scan cannot re-add
  the listing as `new`. This is what stops a claimed issue from re-appearing on
  every scan.
- **Retention (optional, separate).** A bounded sweep may DELETE `expired` /
  `declined` / `rejected` rows older than a long TTL (e.g. 90 days) purely to
  cap table size — a size concern, not a freshness one, and it must not delete a
  gig that still carries an unresolved outcome the operator wants.
- **Re-surfacing is explicit, never silent** (`silver-medalist-rediscovery` vs
  terminal precedence). Flip a tombstoned gig back to reviewable ONLY on a
  **material state transition** confirmed by a field diff — the issue `reopened`,
  the bounty `amount` increased, the deadline extended, or the competing PR
  closed unmerged (the gig is open again) — gated by a **cooldown** so a
  flapping issue does not thrash the review queue, and stamped with the resurface
  reason. It is a rediscovery the operator sees, or a NEW gig linked to the
  tombstone; never an automatic `expired → qualified` flip on mere reappearance.
  The tombstone stays. (This needs a deliberate new edge; `expired: []` today,
  correctly.)

## Valid sources (2026-09-28 research)

Two API-first pillars, both GitHub-issue-backed, so **one freshness engine**
(timeline events + competing-PR detection) covers both. Everything else is
weaker, closed, or dead.

| Source | Verdict | Access |
| --- | --- | --- |
| **GitHub issues** (bounty-labelled) | **Primary** | Sanctioned REST/GraphQL/webhooks. Authenticate: 5,000 req/hr vs **60/hr unauth**; Search **30 req/min** auth (10 unauth) — the tight limit for discovery. |
| **Algora** | **Primary** | Public REST `GET /api/orgs/{org}/bounties`, cursor pagination, `status` field. The leading OSS-bounty marketplace now; bounties are GitHub issues underneath. |
| **Hacker News** "who is hiring / seeking freelancer" | **Keep (keyless)** | HN Algolia Search API, free, no key — the best keyless freelance-lead source. One top-level comment = one listing; no status field, so freshness is thread-age + `last_seen_at` TTL only. |
| IssueHunt | Low priority | No documented public API; reach the underlying GitHub issues via the GitHub adapter instead. |
| Freelancer.com | Usable, constrained | Official OAuth2 API, but the T&C **cap caching at 24h** and forbid redistribution. Internal sourcing only. |
| **Upwork** | **Do not use** | ToS bans scraping and bulk-copying the job feed **even with API access**; auto-submitting proposals is banned; robots disallows `/jobs/`. |
| **Toptal** | Closed | No public listing API. |
| **Gitcoin bounties** | **Dead** | Sunset; moved to Buidlbox. Do not wire. |
| **Bountysource** | **Dead** | Parent bankruptcy 2023; site down, claims unpaid. Do not wire. |
| Hackathon platforms (Devpost, MLH, …) | Low priority | No first-class listing APIs; prize-based, weak fit for "draft a solution, operator reviews." |

- **manual** (forwarded briefs) has no source to re-poll: freshness is the
  operator's; never auto-expired by A/B, only `deadline_passed` when a deadline
  is set.

## Cadence and incrementality

**Tier the cadence to turnover.** Bounty issues are claimed inside ~24h, so a
daily poll misses most:

- **Hot bounty sources (GitHub, Algora): every 15–60 min.** Reserve the Search
  API (30/min) for **discovery** only; **refresh** known repos through the
  cheaper `GET /repos/{o}/{r}/issues?since={ts}&state=all` and per-gig timeline
  reads.
- **HN threads: hourly to daily.** Back off cold or large sources.
- **Pre-dispatch gate (C): always**, on the one gig being dispatched.

**Incrementality and politeness:**

- **Conditional requests everywhere** (`If-None-Match` / `If-Modified-Since`).
  An authenticated `304` is free against the primary limit — the single biggest
  win for frequent polling.
- **Prefer webhooks** (`issues`, `pull_request`) where a subscription is
  possible → push-based freshness, near-zero polling.
- **Page a STABLE sort** (`sort=created`) and cut incrementally with `since` /
  `updated:` windows. Do **not** deep-paginate `sort=updated` — GitHub reorders
  the list as items change, so a mid-scan page skips and double-counts.
- Honour `Retry-After` / `X-RateLimit-Reset`; exponential backoff with jitter on
  secondary limits; single-flight per host. `politeFetch` and the existing
  GitHub transport (`repo-snapshot.ts`) already carry most of this.

## Honesty

Every retirement states its reason (`source_dropped` / `claimed` / `closed` /
`deadline_passed`) on the gig and in the scan/poll summary, matching the scan's
existing code discipline — never a silent disappearance. A re-check that could
not run (rate budget, `KP_OFFLINE`) records that, and never expires a gig it did
not actually verify.

## Suggested phasing

1. **Columns + pre-dispatch gate (C).** `last_seen_at`, `freshness_checked_at`,
   and the one-read gate before dispatch. Highest value for the least code; it
   directly fixes the training-cycle waste.
2. **Freshness re-check poller (B).** Retires the actionable backlog proactively
   between scans.
3. **Disappearance sweep (A).** Needs the complete-discover guard first.
4. **Retention + re-surfacing.** Optional, once 1–3 are proven.

## Sources

- Code: `app/_lib/gigs/scan.ts`, `pollers.ts`, `dispatch.ts`,
  `sources-catalog.ts`, `transitions.ts`, `app/_lib/db/gigs.ts`;
  `docs/features/gigs/README.md`.
- Registry (recruiting): `candidate-identity-and-staleness`,
  `requirement-edited-since-scored`, `retired-outranks-stale-status-precedence`,
  `sourcing-campaign-honesty`, `silver-medalist-rediscovery`.
- Sourcing research (accessed 2026-09-28):
  GitHub REST rate limits <https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api>;
  Search API <https://docs.github.com/en/rest/search/search>;
  REST best practices (free authenticated 304, stable sort) <https://docs.github.com/rest/guides/best-practices-for-using-the-rest-api>;
  unauthenticated limit change 2025-05-08 <https://github.blog/changelog/2025-05-08-updated-rate-limits-for-unauthenticated-requests/>;
  issue timeline / event types <https://docs.github.com/en/rest/issues/timeline> and <https://docs.github.com/en/rest/using-the-rest-api/issue-event-types>;
  Algora API <https://api.docs.algora.io/bounties>;
  HN Algolia <https://hn.algolia.com/api>;
  Upwork automation ban <https://support.upwork.com/hc/en-us/articles/43342677368467-Use-bots-and-other-automation-properly>;
  Freelancer API terms (24h cache) <https://www.freelancer.com/about/apiterms>;
  Gitcoin bounties sunset <https://support.gitcoin.co/gitcoin-knowledge-base/misc/cgrants-bounties-and-hackathons-sunsetting-faq/whats-happening-to-the-hackathons-and-the-bounties-program>.
  Community-reported (verify before hard-coding): HN ~10k req/hr courtesy limit; IssueHunt has no public API.
