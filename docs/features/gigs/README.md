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
| UI (the Gigs tab) | `?tab=gigs`, `app/features/gigs/GigsTab.tsx` (code-split chunk in `app/features/shell/tabChunks.ts`) | behind the Agents flag `NEXT_PUBLIC_KP_AGENT_HIRING=1`, in both places the Agents tab is gated (the nav spread in `tabs.ts` and Workspace's `?tab=` rejection); tagged "In development" on the surface |

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

## The Gigs tab

Built from the owner's pick of a blind design contest: the "Judgement Queue" layout, with
two borrowings, the always-visible scorecard rail and the margin marks on the draft. Every
read and write goes through the routes below. A failure renders from its `code` through
`useErrorMessage()`, never from the server's `error` string. Strings live under the `gigs`
catalog namespace in all four locales.

1. **Queue (home).** Four count tiles name the judgements owed: drafts to review, suspect
   listings to clear, outcomes to record, new listings to triage. The tiles are also the
   navigation: a tile filters the rail and opens its oldest item. The queue rail groups
   every open item by who acts next (`gigsLogic.ts` `queueKindOf`). Work sitting with the
   agents (a run in flight, a revision not yet dispatched, a failed run) has its own line
   and its own dashed box, and never counts toward the tiles. `J`/`K` move through the
   rail. The keys stand down while a field has focus, a modal is open or a `g` chord is
   in progress.
2. **Desk (a drafted attempt).** A breadcrumb, then a meta row that states each absence
   ("reward not stated", "no deadline stated", "none matched yet"). Then:
   - the **pre-send lint strip**, from `app/_lib/gigs/draft-lint.ts` (below);
   - the **evidence** the agent ran, in three states: passed, failed and **not verified**
     (`passed: null` is never painted as a failure). "No command" is called out as the
     agent's account rather than a run log;
   - the **draft as a numbered galley**. Each line-anchored finding is a **margin mark
     beside its line** with a "noted" tick, and the words it refers to are underlined. A
     second tab shows the listing it answers, as untrusted text (below);
   - the arena **checklist** (`checklists.ts`, labels under `gigs.check.*`; keys `1` to `6`
     toggle it), the **disclosure sentence** as it will go out, the agent's questions, and
     a **revision note** textarea. A revision needs the note: the desk says so inline and
     focuses the field (there is no `window.prompt`).
   - **Approve** stays disabled while any blocker is open, any checklist item is unticked
     or any warn is not marked seen, and its label says which ("Approve (checklist 3/6)").
     Approving sends nothing. The approved card shows a link to the listing and **Mark
     sent**, locked the same way ("Mark sent (checklist 5/6)"). Request a revision and
     discard (with an inline confirm) stay available. Each move sends the review: the
     ticks, the note and the time spent on the card.
   - Ticks and "seen" marks are React state inside the card (`GigsDesk.tsx`). Ticking a
     box re-renders the card, not the tab, so the page keeps its scroll. A tab-level map
     keeps a half-reviewed card's state when the operator steps away and comes back.
3. **Suspect listing.** Its reasons (`gigs.suspectWhy.*`), the untrusted text, and **no
   dispatch control at all**, not even a disabled one. There is only "decline" and "clear
   the flag", the second after ticking "I read the listing and judge it legitimate".
4. **Outcome to record.** What went out (the summary, the disclosure that went with it,
   the review note and review time), then the verdict (accepted, rejected, duplicate, no
   response, each with its outcome mark), an optional amount in its own currency, and the
   judge's own words. After the POST the tab re-reads `/api/gigs/kpi` and says how the rate
   moved ("Rate 2/5 → 3/6, pending 4 → 3"), and names the source when the verdict paused it.
5. **New to triage.** A `new` gig below the qualification bar (its score, the factors, who
   could take it, and a link to hire a specialist for its arena), or a `qualified` gig with
   no run yet ("Dispatch to <specialist>"). Both can be declined.
6. **Board.** Every gig grouped by lifecycle step. All twelve steps are shown, empty ones
   as "none at this step". Search (title, org, tag, id) plus arena and step filters. A row
   opens the gig's record: the listing, every attempt with its cost, every appended verdict
   with its source and the judge's words, "Open in the queue" when someone owes it
   something, and decline or withdraw where `transitions.ts` allows them.
7. **Specialists.** A hire form (arena and niche) and one card per specialist: arena, niche
   and taxonomy family, where its recipes came from (the registry, or the seed map when the
   registry was unavailable), the hired-agent status from Personas, its accepted-of-resolved
   fraction with pending and outcome marks, drafts waiting, cost per accepted, budget,
   connectors, and every adopted recipe as `slug@version`.
8. **Scorecard.** By arena (with an all-arenas row) and by specialist: accepted of resolved,
   pending beside it, the small-sample chip under 10 resolved, a mark per sent draft, cost
   per accepted and the count of runs that never reported a cost. Money won is listed per
   currency with no grand total. The disclosure rate is shown.
9. **Sources.** Each source's tier, running or paused state and why, its rejected streak
   against the limit, and its last run. A tier-B source that is not acknowledged, or whose
   summary changed, shows the catalog's terms summary as written, a link to the original
   terms and the full `termsHash` the acknowledgement records, behind an "I read this
   summary" tick. A source that reads a key names its environment variables (never their
   values) and its keyless behaviour. Every catalog adapter can be added from here.

The **scorecard rail** is visible on every screen: on the right at 2xl widths, as a band
above the content below that. It shows the whole desk's accepted-of-resolved with its
percentage and n, pending counted apart, the small-sample chip, a mark per sent draft, the
fraction per arena and per specialist, money won per currency ("never added together") and
the disclosure rate. It reads the server's fold, re-read after every write that moves an
outcome.

**Untrusted text.** A listing is always plain text in a dashed frame tagged "Untrusted".
Links are text and never followed, and every zero-width or direction-control character
renders as a visible `U+XXXX` marker (`gigsLogic.ts` `revealInvisible`).

**Marks differ by shape, not only colour.** Accepted is a filled disc, rejected a struck
ring, duplicate two rings, no response a dotted ring, pending a dashed ring. Lint
severities do the same: a filled square, an outlined diamond, a circled "i".

### The pre-send lint

`app/_lib/gigs/draft-lint.ts` is pure and client-safe. `lintDraft({ gig, attempt, source,
now })` returns findings `{ id, severity, line, messageKey, params }`, where `line` is the
1-based line of `draftText` (null when the finding is not about a line). Messages live
under `gigs.lint.*`.

| Rule | Severity | Anchored to |
| --- | --- | --- |
| no deliverable came back | blocker | nothing |
| the gig's source is paused `invalid_streak` | blocker | nothing |
| the deadline has passed | blocker | nothing |
| an evidence item failed (`passed: false`) | blocker | the evidence item |
| the deliverable has no disclosure sentence | blocker | nothing |
| the same word twice in a row, or two articles in a row ("the an") | warn | the line |
| the draft mentions money while the listing's reward is null | warn | the line |
| the disclosure sentence is not in the draft text | warn | nothing |
| each question the agent left open | warn | nothing |
| an evidence item has `command: null` | info | the evidence item |
| the run's cost was never reported (null, not $0) | info | nothing |

The two line rules skip fenced code blocks. A blocker keeps Approve disabled until the
facts change (a revision, a resumed source). A warn keeps it disabled until it is marked
seen. Info never gates.

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
| GET | `/api/gigs/kpi` | operator | none | none (the `GigKpi` also carries `moneyWon` per currency and `acceptedWithoutAmount`) |
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
| `app/_lib/gigs/kpi.ts` | the pure KPI fold, including money won per currency (never totalled) from the counted verdicts |
| `app/_lib/gigs/draft-lint.ts` | the pure, client-safe pre-send lint the desk runs |
| `app/features/gigs/gigsLogic.ts` | the tab's pure derivations: the queue, the board grouping, the rate as a fraction, the Approve gate |
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

## Lessons to the registry

Every outcome writes lesson bullets for each recipe the specialist adopted (`gig_lessons`,
`app/_lib/gigs/lessons.ts`). `scripts/gigs/land-lessons.mjs` (`npm run gigs:land-lessons`)
moves them from kp into the registry's recipe `LESSONS.md` files and commits them there
directly, with no pull request.

**Who runs it.** The operator, or a scheduled job on the machine that holds the registry
checkout. It needs no model and no key other than kp's automation token. It reads the queue
from `GET /api/gigs/lessons?pending=1` through the machine door: the header
`x-kp-automation-token` must match `KP_AUTOMATION_TOKEN`, the same door
`POST /api/agents/hire-from-need` uses (`KP_BASE_URL`, default `http://localhost:3000`;
`--workspace <id>` names the tenant). `--from-file <json>` reads the same payload from a
file instead, for offline runs. The registry is found through `--registry <dir>`, then
`AI_REGISTRY_DIR`, then `.ai/manifest.yaml` `registry.local`.

**What it may write.** Only lines appended to an existing `LESSONS.md`. It never creates a
file, never touches `recipe.json`, `RECIPE.md` or `examples/`, and never pushes. A
recipe's folder always comes from `recipes/index.json` and is never built from a slug. A
slug the index does not list (the three seed-only arena recipes today) is skipped as
`not_in_registry` and stays pending in kp. For each recipe, version and date it appends one
block in the lane format:

```markdown
## <version used> - <YYYY-MM-DD> - kp
- <bullet>
```

Before writing, it scrubs each bullet again. The first scrub happened in `lessons.ts`; this
second one is a safety net. A bullet is dropped whole if it holds a URL, an e-mail address,
an @handle, something that looks like a path, or a run of more than six digits. Em and en
dashes become a plain hyphen. A bullet already in the file, word for word, is not added
again. A lesson whose bullets are all already there still counts as landed, so a rerun
after a failed mark fixes itself. A lesson with nothing left after the scrub stays pending.
A `LESSONS.md` that has uncommitted edits from someone else is skipped
(`uncommitted_changes`), so another person's work never ends up in this commit.

**The registry's gate decides.** `node scripts/check-recipes.mjs` runs in the registry
twice. The first run happens before anything is written: if the registry is already red,
the lander writes nothing and exits 1. The second run happens after writing: if it fails,
every file is restored to the exact bytes read before the write (not through
`git checkout` or `git stash`) and the lander exits 1. The commit
(`chore(recipes): land <n> outcome lesson(s) from kp gigs`, with a body listing
`recipe@version` and counts) holds only the `LESSONS.md` files written. If another session
has files staged, the lander commits with `git commit --only -- <its files>`, so those
files stay staged and stay out of the commit. It then reads HEAD back to confirm the commit
holds exactly its own files. After the commit it calls `POST /api/gigs/lessons {ids}` for
exactly the lessons that landed. In `--from-file` mode it does this only when `--mark` is
passed. `--dry-run` prints the blocks and touches nothing; `--no-commit` writes and checks
the files but leaves the commit to a person.

**Why only `LESSONS.md` may skip review.** The registry's recipes lane
(`ai-registry/docs/recipes-lane.md`) splits a recipe into two parts. Adding to
`LESSONS.md` records a run against a version: it needs no version bump, and the lane's
`--since` version check does not count it as a content change. Every other file in the
recipe folder is the method, and changes to the method go through a version bump and
CODEOWNERS review. An outcome lesson is exactly a record of a run: an outside verdict on
work done with a given recipe version. So a direct commit fits the registry's own rules for
this one file and for nothing else. Whether a lesson should change the method is still a
reviewed proposal against `recipe.json`.

Fixtures: `node --test scripts/gigs/__tests__/land-lessons.test.mjs`. It runs 14 cases
against a throwaway git registry in a temp directory. The script is outside
`npm run test:unit`, whose globs do not include `scripts/`, and outside any CI chain.

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
- The tab has no form for forwarding a brief by hand. `POST /api/gigs` does it, and the
  empty Sources screen says so.
- The tab reads at most 1,000 gigs (five pages of the list route, newest-touched first)
  and says when it is showing that window rather than everything.
- Checklist ticks and "seen" marks live in the browser until a move is made. A reload
  before approving starts the card again from the review stored on the attempt (none for a
  fresh draft).
- The lint's two line rules (doubled words, money mentions) read English patterns. A draft
  in another language gets fewer of those findings, not false ones.
- The tier-B terms summary is shown in the language the catalog wrote it in (English),
  because its hash is what the acknowledgement records. The Sources screen says so.
