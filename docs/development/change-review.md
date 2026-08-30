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
| pull request ([`review.yml`](../../.github/workflows/review.yml)) | both lenses; the agent review is posted as a PR comment | the `Constitution` / `Agent review` checks go red |
| push to `main` ([`review.yml`](../../.github/workflows/review.yml)) | both lenses over `HEAD~1..HEAD` | the run goes red on the landed commit |
| any push or PR ([`ci.yml`](../../.github/workflows/ci.yml)) | `npm run test:review` — the fixtures for both lenses, because a tool that judges changes has to be judged by something too | CI red |

Two details that decide whether this is real or decorative:

- **The judgement lens runs on `pre-push`, not only on PRs.** Most changes here
  reach `main` as a direct push; a reviewer that only sees pull requests would
  have been reviewing the exception. Locally it uses the `claude` CLI, so it
  costs no key. `KP_SKIP_AGENT_REVIEW=1` skips just that lens for a mechanical
  push (`KP_SKIP_GATE=1` skips the whole gate) — both say so loudly on stderr.
- **Branch protection is where the PR path gets its teeth.** The workflow fails
  the run; only a required status check stops a merge. Require
  **`Constitution (deterministic, blocking)`** and **`Agent review (judgement)`**
  on `main`, alongside the CI jobs. That setting lives in repository settings,
  not in this tree — which is exactly why it is written down here.

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
- There is no agent **dispatch** path: nothing here opens a change from an issue
  or a comment. Agents are run locally by the maintainer and their output lands
  through the same gate as anyone's. Reviewing what an agent produced and
  dispatching one are separate problems; only the first is solved here.
