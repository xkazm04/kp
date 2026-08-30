# Change review — what reads a change back

Around 90% of commits here are AI-written. `typecheck`, `lint`, `test:unit`,
`design:check`, `i18n:check` and the Python gate all answer the same question:
*does the result work?* None of them answers the other one: *is this the change
that was asked for?*

That second question used to live entirely in one maintainer's head, which is
fine at ten commits a week and not fine at agent throughput. Two lenses now ask
it mechanically.

| | `constitution-check.mjs` | `agent-review.mjs` |
| --- | --- | --- |
| Kind | deterministic, regex over the diff | LLM judgement over the diff |
| Needs | nothing — no key, no network | `ANTHROPIC_API_KEY`, or the `claude` CLI locally |
| Cost | < 1 second | one model call per change |
| Runs | every push, every PR, and `pre-push` on `main` | every PR, every push to `main`, and `pre-push` on `main` |
| Blocks | yes, on a blocking finding | yes, on a `blocking` finding |
| Catches | gate weakening | intent drift, scope creep, reversed decisions |

Both live in [`scripts/review/`](../../scripts/review) and share one diff parser
(`diff.mjs`). Fixtures: `npm run test:review`.

## Lens 1 — the constitution check (deterministic)

```bash
npm run review:constitution                                   # HEAD~1..HEAD
node scripts/review/constitution-check.mjs --base origin/main --head HEAD
node scripts/review/constitution-check.mjs --json             # machine-readable
```

It looks for the moves that make a gate stop meaning anything — the same set the
App-master programme calls forbidden change classes:

| Rule | Severity | Fires when |
| --- | --- | --- |
| `test-only` | blocking | `.only(` lands in a test file — it silently disables every *other* test there |
| `test-skip` | blocking | a new `describe.skip` / `xit` / `@unittest.skip` / `self.skipTest` |
| `test-deletion` | blocking | a test file is deleted |
| `secret` | blocking | a structurally-valid API key or token is committed outside `.env.example` |
| `tenancy-manifest` | blocking | `CREATE TABLE` in `app/**` without touching `app/_lib/tenancy.ts` |
| `route-auth-posture` | blocking | a **new** `app/api/**/route.ts` that neither calls `requireOperator` nor sits under a `PUBLIC_API_PREFIXES` entry |
| `skip-baseline-raised` | blocking | `KP_SKIP_BASELINE` goes **up** (down is a repair, and passes) |
| `suppression` | note | a new `eslint-disable` / `@ts-expect-error` / `# noqa` / `# type: ignore` |
| `open-route-rate-limit` | note | a new **public** route with no `rateLimit()` call |
| `gate-configuration` | note | the change edits the machinery that judges changes |

Notes never block. They exist so a reviewer sees a category rather than 40 more
lines of diff.

### Waiving a finding

Some of these are legitimately right sometimes — a live-only smoke test really
does need a skip. The waiver is a **commit trailer**, on any commit in the
range:

```
Gate-exemption: the pypdf fixtures are deliberately not in the repo
```

That waives every blocking finding in the range and prints the reason. It is a
sentence in `git log` that a reviewer can read and disagree with — deliberately
not a per-line `// review-ignore` comment, because those get copy-pasted and
then nobody sees them again.

## Lens 2 — the agent review (judgement)

```bash
npm run review:agent                                          # HEAD~1..HEAD
node scripts/review/agent-review.mjs --base origin/main --out review.md
node scripts/review/rubric.mjs                                # print the rubric only
```

The rubric is **not** a generic "good code" prior.
[`rubric.mjs`](../../scripts/review/rubric.mjs) assembles it from this
repository's own written rules at run time:

- the *Important Conventions* section of `.claude/CLAUDE.md` (pathspec commits,
  locale parity, the rate-limit contract, the fail-closed tenancy manifest,
  `maxDuration` being serverless-only, token-route projections),
- the dual-theme design law and the doc-sync obligation from the same file,
- every record in [`docs/architecture/decisions/`](../architecture/decisions/README.md),
  by id, title and status,
- the recurring patterns the codebase asks you to imitate.

There is no second copy of the rules to drift out of date. Edit `.claude/CLAUDE.md`
or add an ADR and the reviewer's rubric changes with it.

The prompt tells it what the other gates already cover, so it does not spend the
review on formatting, and it reserves `blocking` for a finding that can name the
broken rule *and* cite the line. Everything less certain comes back as a note.

### Backends, in resolution order

1. **`ANTHROPIC_API_KEY`** → the Messages API. This is the CI path.
   `KP_REVIEW_MODEL` overrides the model (default `claude-sonnet-5`).
2. **the `claude` CLI on `PATH`** → the local default provider for this repo, so
   a maintainer gets the same review with no key at all.
3. **neither** → it prints `THE JUDGEMENT LENS DID NOT RUN`, says what was *not*
   reviewed, and exits 0.

Case 3 is the honest one, and worth being explicit about: a green check that
silently means "not reviewed" is worse than a red one. The exit code says *not
blocked*; the output says *not looked at*. The deterministic lens has already
gated the change either way.

**Exit codes:** `0` clean or lens unavailable · `1` a blocking finding · `2` the
lens itself failed (bad key, unparsable reply). `2` is deliberately distinct
from `0` — a reviewer that errors and reports success is exactly the failure
this whole thing exists to avoid.

## Where they run

| Trigger | What runs | Consequence of a blocking finding |
| --- | --- | --- |
| `git push` targeting `main` ([`.githooks/pre-push`](../../.githooks/pre-push)) | constitution, then the agent review, then typecheck / lint / design / build | the push does not happen |
| pull request ([`review.yml`](../../.github/workflows/review.yml)) | both lenses; the agent review is posted as a PR comment | the `Constitution` / `Agent review` checks go red **and the merge is blocked** — they are required checks |
| push to `main` ([`review.yml`](../../.github/workflows/review.yml)) | both lenses over `HEAD~1..HEAD` | the run goes red on the landed commit |
| **manual** (`workflow_dispatch` on [`review.yml`](../../.github/workflows/review.yml)) | both lenses on any ref, with an optional `base` input | same as a push run |
| any push or PR ([`ci.yml`](../../.github/workflows/ci.yml)) | `npm run test:review` and `npm run test:agent` — the fixtures for all of this, because a tool that judges (or writes) changes has to be judged by something too | CI red |
| an issue labelled `agent:go`, or a `/agent` comment ([`agent-dispatch.yml`](../../.github/workflows/agent-dispatch.yml)) | a model proposes a change; the guard refuses protected paths before anything is written | the run goes red and no branch is pushed — see [Dispatch](#dispatch--an-issue-becomes-a-proposed-change) |
| any push or PR ([`ci.yml`](../../.github/workflows/ci.yml)) | `npm run review:gate` · `npm run security:actions` · `npm run hooks:check` — the three checks that the gate is still *wired* (below) | CI red |

Run the review by hand from the Actions tab (**Review → Run workflow**) after
adding `ANTHROPIC_API_KEY`, after editing `.claude/CLAUDE.md` or an ADR — the
rubric is assembled from them, so the review changes without the diff changing —
or to re-read a commit that landed while the judgement lens was unavailable.

Three details decide whether this is real or decorative:

- **The judgement lens runs on `pre-push`, not only on PRs.** Most changes here
  reach `main` as a direct push; a reviewer that only sees pull requests would
  have been reviewing the exception. Locally it uses the `claude` CLI, so it
  costs no key. `KP_SKIP_AGENT_REVIEW=1` skips just that lens for a mechanical
  push (`KP_SKIP_GATE=1` skips the whole gate) — both say so loudly on stderr.
- **A required status check is what turns a red run into a blocked merge**, and
  that configuration is now a file:
  [`.github/rulesets/main.json`](../../.github/rulesets/README.md). It requires
  both lenses plus every CI and security job, forbids deleting or force-pushing
  `main`, and lets repository admin bypass — because the maintainer's path is the
  direct push, which `pre-push` already gates. Apply or re-apply it with
  `npm run review:gate -- --apply`; `--verify` asks GitHub whether it is really
  enforced and runs in `review.yml` when `GATE_ADMIN_TOKEN` is set.
- **`.github/workflows/ai-review.yml` is gone.** It was a scaffold that ran
  `echo "TODO: invoke the AI review action here"` on every pull request and
  reported a green **AI review** check. That is worse than no review: the whole
  problem this page exists to solve is telling a review that runs from one that
  does not, and a green check that reviewed nothing is the strongest possible
  claim that it did.

## Dispatch — an issue becomes a proposed change

The two lenses read a change back. Nothing here *produced* one until
[`agent-dispatch.yml`](../../.github/workflows/agent-dispatch.yml): agents ran on
the maintainer's laptop, which meant the work could only start where the
maintainer already was.

```bash
# label an issue `agent:go`, or comment `/agent <instruction>` on it
npm run agent:dispatch -- --issue 42 --dry-run      # locally, via the `claude` CLI
node scripts/agent/dispatch.mjs --issue 42 --out proposal.md --paths-out applied.txt
```

[`dispatch.mjs`](../../scripts/agent/dispatch.mjs) runs **two rounds**: round 1
sees the rubric and the file inventory and answers *which files would you need to
read?*; round 2 sees those files and answers with the change, as whole file
contents rather than a patch. A one-round dispatcher writes plausible code against
paths it never opened, which is how these get switched off. Backends resolve in
the same order as lens 2 (`ANTHROPIC_API_KEY` → the `claude` CLI → decline).

The output is a branch and a **draft** pull request, gated by exactly the same
required checks as anyone's change. Four properties are what make that safe, and
each is a mechanism rather than a promise:

| | What holds it | Where it is pinned |
| --- | --- | --- |
| **Who may dispatch** | the workflow asks the API for the *actor's* repository permission and fails below `write` — the person who labelled or commented, never the issue author, so a maintainer can dispatch on a stranger's bug report and the stranger cannot | `assertTrusted()` re-checks it in the script |
| **What may be written** | `PROTECTED_PREFIXES` refuses `.github/workflows`, `.github/rulesets`, `.githooks`, `.claude/` and `scripts/{review,security,hooks,docs,agent}` — an agent dispatched from an issue may not edit the machinery that judges it. No override flag exists | a fixture asserts every lens, hook and workflow in the tree is still inside a protected prefix |
| **Issue text stays data** | title, body and comment reach the script through `env:`, never interpolated into a `run:` line, and the prompt labels them untrusted before quoting them | `taskFromEnv` + the prompt-order fixture |
| **How it lands** | draft PR, both lenses, all of CI, CodeQL, the audits. Nothing is merged and nothing is closed | `.github/rulesets/main.json` |

**Without an `AGENT_PR_TOKEN` secret, no pull request is opened at all.** A PR
opened with the default `GITHUB_TOKEN` triggers no workflows, so an agent-written
change would sit there green because nothing ran — the same failure
`ai-review.yml` was deleted for. In that case the workflow pushes the branch and
says so on the issue. `ANTHROPIC_API_KEY` is likewise required: without it the run
declines on the issue and creates no branch.

Caps and refusals, all with fixtures in `npm run test:agent`: at most 25 files and
240 KB per proposal, no duplicate paths, no test deletions, and a commit subject
held to the same rule the CHANGELOG is cut from (`checkSubject`, imported from the
release machinery rather than copied).

## Keeping the gate wired

A gate stops being one long before anyone deletes it. The three checks below run
in `ci.yml` on every push and PR and cost under a second between them.

| Check | Catches |
| --- | --- |
| `npm run review:gate` ([`gate-check.mjs`](../../scripts/review/gate-check.mjs)) | the ruleset requiring a check name no job reports — rename `Agent review (judgement)` and GitHub waits forever for a check that never arrives, until someone drops the requirement to unblock a PR. Also: an `evaluate`-mode ruleset, a required check that never runs on PRs, a lens that left the required set, a workflow with no jobs |
| `npm run security:actions` ([`check-actions.mjs`](../../scripts/security/check-actions.mjs)) | a workflow with no top-level `permissions:` block, and any **new** action pinned to a mutable tag. A ratchet: the refs that already float are enumerated with why in [`.github/actions-pin-allowlist.json`](../../.github/actions-pin-allowlist.json), so the list can only shrink — and a list that fails to load excuses nothing rather than everything |
| `npm run hooks:check` ([`install.mjs`](../../scripts/hooks/install.mjs)) | a hook that vanished, or one still shelling out to an npm script or file that was renamed away — the shape of drift that leaves `pre-push` running and no longer checking |

`npm run review:gate -- --verify` is the online half: it asks GitHub whether the
ruleset is actually applied. Without a token it prints **THE LIVE HALF DID NOT
RUN** and exits 0, for the same reason lens 2 does.

### Burning the pinning debt down

Nine action references still float on a major tag, three of them inside
`release.yml`'s `publish` job — the one holding `packages: write`,
`id-token: write` and `attestations: write`. Resolving a tag to its commit SHA
requires asking GitHub what the tag points at *right now*; inventing a SHA does
not pin an action, it breaks the workflow. That made the fix
(`npm run security:actions -- --resolve`) a maintainer chore with no owner, which
is exactly why the list survived every session that read it and agreed with it.

[`pin-actions.yml`](../../.github/workflows/pin-actions.yml) now runs it Monday
05:40 UTC and on demand: resolve → re-run the ratchet over the result → prune the
allowlist entries it burned → push a branch → open one pull request. It never
merges. Without a `PIN_PR_TOKEN` PAT it pushes the branch and prints the compare
link rather than opening a PR the default token would leave un-gated.

This does not *freeze* the pins: Dependabot updates a reference in the form it
finds it, so a SHA with a trailing `# vX.Y.Z` comment keeps moving on the weekly
`github-actions` PR stream. Reaching that steady state is the whole job, after
which this workflow has nothing to do — the intended ending, not a fault.

## Known gaps

- The agent review has no memory between PRs: it cannot see that the same note
  was raised and dismissed last week.
- It reviews the diff, not the repository. A change that is wrong only in
  combination with untouched code is out of reach.
- `route-auth-posture` only inspects **new** route files. A route that loses its
  `requireOperator` call in an edit is caught by tests, not here.
- Until `ANTHROPIC_API_KEY` is set in repository secrets, the judgement lens
  reports "did not run" on every CI run. That is visible in the job summary by
  design.
- The dispatch path proposes; it does not iterate. It gets two rounds and one
  attempt — it cannot run the tests, read a failing CI log, or push a fix. A red
  draft PR stays red until a human picks it up. That is deliberate for a first
  version (a loop that fixes its own build is a much larger trust argument than a
  loop that writes once), but it is the honest limit: expect drafts, not merges.
- Dispatch is unmetered. Nothing counts how many issues were dispatched, what
  they cost, or how many drafts were merged versus closed — so the question
  "is this worth its API bill?" currently has no data behind it.
- The ruleset lets **repository admin bypass** the required checks, so on the
  maintainer's own direct pushes the teeth are `.githooks/pre-push`, not GitHub.
  That is deliberate (see [`.github/rulesets/README.md`](../../.github/rulesets/README.md))
  and it is the weakest joint here: `KP_SKIP_GATE=1` is one environment variable
  away, and only stderr and the journal record that it was used.
- `npm run review:gate -- --verify` is only as good as the token it is given.
  Until `GATE_ADMIN_TOKEN` exists in repository secrets, nothing mechanically
  confirms the ruleset is still applied — the offline half only proves the file
  and the workflows agree with each other.
