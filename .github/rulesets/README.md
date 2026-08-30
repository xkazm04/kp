# Branch rulesets — the gate, in the tree

`main.json` is the GitHub **ruleset** that gives the checks their teeth: without a
required status check, a workflow that goes red is a notification, not a gate, and
a change can land while the review is still red or still running.

Until this file existed that setting lived only in repository settings —
un-versioned, un-reviewable, and impossible to tell apart from a review that was
never wired at all. `docs/development/change-review.md` said so in as many words.
Now it is a file, it is checked, and it can be re-applied in one command.

## What it requires

Every job that runs on a pull request, named by its **check name** (the job's
`name:`, not its id) — including both review lenses:

- `Constitution (deterministic, blocking)` and `Agent review (judgement)`
  (`.github/workflows/review.yml`)
- the five `ci.yml` jobs
- the four `security.yml` jobs (CodeQL is a matrix, so it contributes two)

Plus `deletion` and `non_fast_forward`: `main` cannot be deleted or force-pushed.

## Why repository admin can bypass

Most changes here reach `main` as a **direct push**, gated by
`.githooks/pre-push` (both review lenses, then typecheck / lint / design / build).
A ruleset's required status checks apply to pushes too, so enforcing them with no
bypass would make the maintainer's normal path impossible — and the realistic
response to that is to disable the ruleset, which is how a gate dies.

So the split is deliberate and it is the whole design:

| Path | Gated by | Bypassable |
| --- | --- | --- |
| direct push to `main` (the maintainer) | `.githooks/pre-push` | `KP_SKIP_GATE=1`, loudly, on stderr |
| pull request (Dependabot, forks, agents, anyone else) | this ruleset | no |

`actor_id: 5` / `actor_type: RepositoryRole` is the **repository admin** role.

## Applying and checking it

```bash
npm run review:gate                 # offline: does this file still agree with the workflows?
npm run review:gate -- --verify     # online: is it actually enforced on the repository?
npm run review:gate -- --apply      # create/update the ruleset from this file
```

`--verify` and `--apply` need `GH_TOKEN` with `administration` scope on the
repository. Without one, `--verify` prints **THE LIVE HALF DID NOT RUN** and exits
0 — the same honesty rule the agent-review lens follows, because a green check
that silently means "not checked" is worse than a red one.

The offline half runs in CI on every push and PR (`ci.yml`, the `node-quality`
job). It fails when a required context here no longer matches a job in a
workflow — which is exactly what a rename would otherwise do silently: the
ruleset would go on requiring a check name that nothing ever reports, GitHub
would wait for it forever or, worse, the renamed job would become un-required
without anyone deciding that.
