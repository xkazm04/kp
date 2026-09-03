# Contributing to KandiDate

Thanks for looking. This is a real product that happens to be open source, so the
bar is "would I want to maintain this in three years", not "does it work on my
machine". That cuts both ways: the conventions below exist so your patch gets
merged rather than bikeshedded.

Honest expectations first: this project is maintained by one person plus agents,
and issues are triaged weekly. A clear report or a focused PR moves fast; an
open-ended one waits. Community standards are in
[`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).

## Before you write code

- **Small fix, obvious bug, typo, missing translation** — just open a PR.
- **Bugs and feature requests** — use the issue templates
  ([bug report](./.github/ISSUE_TEMPLATE/bug_report.md),
  [feature request](./.github/ISSUE_TEMPLATE/feature_request.md)). The short
  version: bugs state the deploy mode and your install's capabilities and come
  with a repro; feature requests state the job, not the solution.
- **Anything that changes behaviour, adds a dependency, or touches the pipeline,
  the LLM layer, or billing** — open an issue first and let's agree on the shape.
  A rejected 800-line PR is a bad day for both of us.
- **Security issues** — do not open a public issue. See [`SECURITY.md`](./SECURITY.md).

## Licensing and the CLA

KandiDate is licensed under **AGPL-3.0-only** ([`LICENSE`](./LICENSE)). Two things
follow from that, and it is better to know both up front:

1. **If you run a modified version as a network service, you must offer your
   users its source.** That is the whole point of the AGPL and it is why this
   project can be given away without giving away the ability to sustain it.
2. **Contributions are accepted under a Contributor License Agreement**
   ([`CLA.md`](./CLA.md)). You keep the copyright in your work; you grant the
   maintainer the rights needed to ship it — including under a different licence
   later, which is what makes a commercially-hosted version of this codebase
   possible at all.

If the CLA is a dealbreaker for you, say so in the issue. A patch under
AGPL-only can sometimes still be taken; it just has to be handled deliberately
rather than merged by reflex.

## Development setup

```bash
npm install
pip install -r requirements.txt      # the Python jobfit pipeline
npm run dev                          # one dev server per checkout (the lock is .next/dev/lock)
```

There is no required API key. With none configured the app runs on deterministic
fallbacks and the Claude CLI / Ollama paths — degrading gracefully without keys
is a **product property**, not a dev convenience, so please don't write code that
assumes a provider is present. See the README's "Run it yourself" section.

## The verification gate

Run these before opening a PR. CI runs the same set; a red gate is not a
review comment, it's a blocked merge.

**Which checks actually block a merge is written down, not inferred from the
Actions tab:** [`.github/rulesets/main.json`](./.github/rulesets/main.json) is the
branch ruleset, and [its README](./.github/rulesets/README.md) explains what it
requires and why repository admin can bypass it. `npm run review:gate` verifies
offline, on every push, that each required check still matches a real job — a
renamed job would otherwise un-gate itself silently. How long the pipeline is
allowed to take is declared per job in [`ci-budget.json`](./ci-budget.json) and
measured against the real run by the `Pipeline budget` job, so a gate that gets
slower is a decision somebody makes rather than a number that drifts.

```bash
npm run typecheck        # NOTE: runs Python codegen (schemas:gen) before tsc
npm run test:unit        # node:test over app/**/*.test.ts
npm run test:python:gate # the gated Python suite
npm run lint
npm run design:check     # no raw hex outside app/landing/
npm run i18n:check       # 4-locale message parity
npm run test:e2e         # Playwright
```

## The five conventions that actually bite

1. **4-locale parity.** Every key you add to `messages/en.json` must land in
   `cs`, `de` and `fr` in the same change. next-intl keys are typed, so an
   incomplete catalog is a `tsc` error for everyone, not just a lint warning.
2. **No raw hex outside `app/landing/`.** Everything else resolves through the
   design tokens, because the app ships two themes from one codebase. Read
   [`docs/design/README.md`](./docs/design/README.md) before building UI, and
   verify new surfaces in **both** themes.
3. **Update the doc in the same change.** `docs/` is genre-partitioned and
   [`scripts/docs/feature-doc-map.json`](./scripts/docs/feature-doc-map.json)
   maps source globs to the doc that describes them. A feature doc naming a
   moved file is worse than no doc.
4. **Degrade, don't crash.** When a provider is missing, rate-limited or down,
   the deterministic fallback runs. Never a green lie either: delivery states are
   `sent` / `queued` / `failed`, never optimistic.
5. **Candidate token routes carry a projection, not the row.** Public
   `[token]` surfaces expose an explicit field allowlist. Internal ids never go
   on the wire.

Deeper guidance for automated agents and humans alike lives in
[`.claude/CLAUDE.md`](./.claude/CLAUDE.md).

## Commit and PR style

- **Conventional subjects, and this one is checked.** `type(scope): summary` —
  `feat`, `fix`, `security`, `perf`, `refactor`, `style`, `docs`, `chore`,
  `test`, `ci`, `build`, `deps`, with a trailing `!` for a breaking change.
  [`scripts/release/prepare.mjs`](./scripts/release/prepare.mjs) cuts every
  CHANGELOG section from these prefixes, so a subject without one silently
  vanishes from the release notes an operator upgrades on.
  [`.githooks/commit-msg`](./.githooks/commit-msg) rejects it as you write it
  (installed by `npm install`, which sets `core.hooksPath`), and the
  `commit-convention` job in CI rejects it in the pushed range. Waive an
  individual message on the record with a `Commit-convention-exemption: <why>`
  trailer in the body.
- **The subject is one clause about the change; the session goes in the body.**
  A prefix is not a description, and the same check enforces the shape behind
  it: no second sentence in the subject line, no first person, no
  session-report opener (`Done.`, `Here's what I found`), and no line that
  stops on a word nothing follows (`… one was`) because it was sliced out of a
  longer message. A commit typed `feat` or `fix` whose files are *all*
  documentation, or *all* tests, is rejected on the same grounds — the release
  note would announce a change that does not exist.
  This binds automated lanes hardest, and that is the point: with roughly half
  of the commits here written by an agent, `git log` is the primary record of
  what those agents did. Everything a session wants to narrate — what it
  explored, what it found, what it left out — belongs in the body, which has no
  length limit and which `git log --format=%s` never prints.
- **A stopped session still leaves a tree, and the tree is the subject.** The
  same check rejects a subject that opens on the run's fate — `session timed
  out`, `context limit reached`, `WIP`, `partial work on …`. Those are accurate
  and they are the one kind of true subject a bisecting reader learns nothing
  from, because every commit was written by a session and only these talk about
  it. Name what landed, then say the run was cut short in the body:

  ```
  fix(schedule): reject a confirmed slot outside the invite window

  Two of the four items were left untouched — the comms half needs a decision
  about resend semantics that this run did not have.

  Session-interrupted: 45-minute budget reached after the schedule half
  ```

- **If an agent wrote it, say which one — as trailers.** The vocabulary and both
  its spellings are below; a commit that claims provenance must carry a whole,
  single form of it.
- Present tense, scoped: `feat(billing): unmeter self-hosted installs`.
- One logical change per PR. If your PR needs a "and also" in the description,
  it's probably two PRs.
- Explain **why** in the body. The what is in the diff.
- Stage with pathspecs (`git add <path> <path>`), never `git add -A`. This
  checkout hosts parallel agent sessions and blanket staging picks up work that
  isn't yours.
- Tests are **mandatory** for changes to auth, billing, tenancy, rate limits, or
  the LLM chokepoint (`app/_lib/llm-config.ts` / `pipeline/jobfit/llm/`).
  Elsewhere they're merely a very good idea.
- The [PR template](./.github/PULL_REQUEST_TEMPLATE.md) is the checklist form of
  everything above — gate, docs sync, locale parity, CLA. Fill it honestly.

### Provenance trailers — say who wrote it in a form `git log` can read

The rule above fixes the *subject*. It does not make the record queryable: a
commit body that says "this was produced by an overnight agent run" is honest and
answers nothing, because no two lanes phrase it the same way. Facts that belong
in `git log` go in **trailers**, which git already parses.

**One vocabulary, owned by
[`scripts/agent/provenance.mjs`](./scripts/agent/provenance.mjs).** It used to be
two — a compact one-liner documented here and a four-key block enforced there —
and they collided: `Agent-Provenance:` is an `Agent-*` trailer, so the trailer
this file told an outside lane to write was *rejected* by the `commit-convention`
gate as one undefined key plus four missing ones, while the four-key block the
repository's own dispatch lane emits was invisible to `npm run provenance` and
counted as a human's work. One question does not get two answers.

| Trailer | Shape | Says |
| --- | --- | --- |
| `Agent-Provenance:` | `agent=<name>; model=<id>; lane=<name>; task=<id>` | **the compact spelling.** An automated lane committed this on an agent's behalf. Every pair optional, at least one required. `harness=`, `prompt=` and `run=` are also accepted, under the same value rules as the block below. |
| `Agent-model:` + `Agent-harness:` + `Agent-prompt:` + `Agent-run:` | see below | **the expanded spelling**, for a lane that knows all four. All four or none. |
| `Co-Authored-By:` | `Name <email>` | a second author, agent or human. The one trailer this history already carries throughout. |
| `Ascent-Resolves:` | `<task-id>` | the dispatched task this change closes. |

```
Agent-model: claude-opus-5
Agent-harness: scripts/agent/dispatch.mjs@sha256-1f0c…
Agent-prompt: sha256:9ab3…
Agent-run: https://github.com/xkazm04/kp/actions/runs/123456789
```

`Agent-harness` is `<driver>@<version>` — the path alone is true of every run
that driver ever made, including the ones before the bug you are looking for.
`Agent-prompt` is a digest of the instruction text the run was given (a
hand-written version number stops being true the first time somebody edits a
prompt without bumping it). `Agent-run` is a URL or the literal `local`, and
`local` is a real answer. Those three rules apply identically to `harness=`,
`prompt=` and `run=` in the compact spelling, because it is the same vocabulary.

The point is that provenance becomes a query:

```bash
git log --format='%H %(trailers:key=Agent-model,valueonly)'
npm run provenance                  # the last 20 commits: agent share, models, lanes, tasks
npm run provenance -- --base v0.1.0 --head HEAD --json
```

**Write it from the lane, not from the agent.** The lane that runs `git commit`
is the part that already knows the model, the driver version and the run URL, so
it never depends on an agent remembering: `.github/workflows/agent-dispatch.yml`
renders the block with `node scripts/agent/provenance.mjs` and appends it to the
message file. `--compact` prints the one-liner instead, for a template with room
for a single trailer.

An **absent** trailer is never an error — most commits have no reason to carry
one, and a gate demanding a trailer no lane writes yet would go red on every
automated commit and be bypassed within a day. A trailer that is **present and
malformed** *is* an error, caught by the `commit-convention` job: an empty value,
an `Agent-Provenance:` with no `key=value` pair, a pair or an `Agent-…` key
outside the vocabulary, half of the four-key block, both spellings in one commit,
or a `Co-Authored-By:` with no `<email>`. Those look like a recorded fact and
answer no query, which is worse than the prose they replaced.

If you run an automated lane against this repository, emit one of the two forms.
`npm run provenance` prints how many agent commits are recognisable but not
attributable, and that number is the size of the gap.

## AI-assisted contributions

Welcome — half this codebase was built with agents, so there is no purity test
here. The rules are about ownership, not tooling:

- **You own what you submit.** You ran the verification gate yourself and you
  can explain every line of the diff. "The agent wrote it" is not an answer in
  review.
- **Disclose substantially agent-generated PRs** in the template's AI-assistance
  section. Disclosure costs you nothing; discovering it later costs trust.
- **Drive-by bulk agent PRs are closed without review** — mass refactors,
  dependency churn, style-only sweeps. If an agent found something real, distill
  it into one focused change like anyone else would.

## What is unlikely to be merged

- Changes that make a provider mandatory, or that remove a deterministic fallback.
- New dependencies that duplicate something already in the tree.
- Reformatting passes bundled with logic changes.
- Features that only make sense for the hosted deployment. The hosted product is
  this software plus operations, not this software plus extras; if it can't be
  useful to a self-hoster, it probably belongs in the ops layer. Corollary: if
  the hosted version is ever better than this repository, that is a bug.
- Anything that phones home by default — telemetry, update checks, "anonymous"
  usage pings. A fresh install makes no outbound call the operator didn't
  configure.
