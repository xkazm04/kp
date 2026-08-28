# ship-loop overlay - kp

Read by `/ship-loop` at the start of every run. Hand-maintained; the loop proposes edits at CPn.
Lifted from the kp copy of ship-loop 1.0 (kp-tuned) when the skill moved to the registry lane (2.1.0).

## Stack
Next.js app + Python service with a shared generated schema step (`schemas:gen`); Vitest unit suites; Python gate; Playwright deterministic e2e (key-gated specs excluded); two UI themes (Studio Light + Spark Dark); self-hostable deploy. Parallel CLI sessions routinely land commits on `main` outside the loop.

## Cadence
milestone

## Ship bar (default answer at CP0)
(ask at CP0 - the kp loop's bar was user-set at Boot; carry it in `state.md`)

## Gates (ordered - run top to bottom, **sequentially** - `schemas:gen` is shared between steps)
| step      | command | ratchet | when / notes |
|-----------|---------|---------|--------------|
| typecheck | `npx tsc --noEmit` | 0 errors | |
| lint      | `npm run lint` | 0 errors | the 373-warning baseline is out of scope |
| unit      | `npm run test:unit` | 0 failed | |
| python    | `npm run test:python:gate` | green | |
| build     | `npm run build` | exits 0 | |
| e2e       | deterministic Playwright e2e (key-gated specs stay out) | green | UI touched; verify new surfaces in **both themes** (Studio Light + Spark Dark, per CLAUDE.md). Test-only diffs may justified-skip - record the justification |
Notes: full `/uat` runs are backlog items (dimension 4), not per-milestone. **Run the gate before any push** - parallel sessions pushing ungated commits to main is the loop's known failure mode (CI red all day at CP7).

## Value journeys

Declared 2026-08-28 (milestone 450d1008 "Stabilized for release", goal 4). Once this
table is non-empty the loop runs a **value ledger above the scorecard**: one readiness
light per journey, every backlog item carries a journey tag, and a milestone is picked
as the next slice of one journey rather than as an unattached item.

| tag | journey | owners (Characters) | docs | what it certifies | light |
|---|---|---|---|---|---|
| **THR** | The thread: JD -> assignment -> candidate applies -> evaluation -> AI interview -> score/decision | Eva (eng hiring lead), Sam (dev candidate) | `uat/journeys/one-thread.md` · `e2e/journey-one-thread.spec.ts` | **one** job id and **one** candidate identity survive all five steps, and the score each step shows is named for the kind it actually is (transfer score is not rendered as a match score) | 🟡 |
| **SCH** | The role-to-schedule journey: first-run wizard -> JD in Library -> self-scheduling invite -> candidate books -> candidate withdraws | Marek (coordinator), Tereza (candidate) | `uat/journeys/interview-schedule-prep.md` (owns `/schedule/[token]`) · `e2e/journey-role-to-schedule.spec.ts` | the flagship deterministic spec: a role reaches a booked interview slot without recruiter involvement, and both terminal states pass axe | 🟡 |

**Lights:** 🟢 the journey's spec is green in the keyless CI subset AND its UAT journey
has an L2 verdict; 🟡 one of those two holds; 🔴 neither. Never set a light from a local
run alone - the CI keyless job is the certifying surface, because a developer box with
`.env.local` keys takes every LLM step off the deterministic path.

### Journey-tag conventions
- Every backlog item gets **exactly one** tag from the table above, or **`-`** when it
  serves no journey (infrastructure, gates, docs, dependency work). `-` is a legitimate
  answer - inventing a journey to host an item is how a value ledger stops meaning
  anything.
- Tags are written as the first token of the item title in `backlog.md`, e.g.
  `[THR] promote joins the real job instead of minting dc-<caseId>`.
- A **milestone** names the journey it advances and which of that journey's steps it
  covers; a milestone that advances no journey says so and justifies itself on the
  scorecard instead.
- A journey is added here only with **both** a `uat/journeys/*.md` (the human-judged
  definition of done) and a deterministic `e2e/*.spec.ts` (the machine-checked one).
  One without the other is a backlog item, not a journey.
- The `uat/` overlay is gitignored and per-machine; the `e2e/` spec is tracked. When
  they disagree, the spec is what CI enforces and the journey is what the product owes.

## Dimensions
| # | name | what it means here |
|---|------|--------------------|
| 1 | Build | |
| 2 | Func(tionality) | honesty vs docs |
| 3 | Tests | unit + python gate |
| 4 | UAT | run as a lens via `/uat` |
| 5 | Billing & LLM value | |
| 6 | Sec(urity) | |
| 7 | UX | both themes |
| 8 | Ops (CI / deploy / self-host) | |
| 9 | Value & market | run as a lens -> `value-case.md` |

## Conventions
- On resume, reconcile against reality before proposing anything: `git status` + branch vs `main` - parallel CLI sessions ship commits outside the loop (it has happened repeatedly; see CP7) and close backlog items out-of-band; premise-check open items.
- Respect foreign in-flight work (`git status` scan; stage only your paths); defer items in another session's hot area with the reason.
- The user pushes; if the loop pushes, only after a green gate.
- State dir: `.claude/ship-loop/` at the repo root (where the kp loop always kept it).

## Lenses
- defaults; dimension 4 lens = `/uat`; dimension 9 lens = the value lens.

## History
- The loop ran Boot->M8 on kp during 2026-07 with no skill definition; the procedure was codified in the personas repo from this repo's precedent and adopted back here as 1.0.
