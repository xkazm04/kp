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
(none declared - scorecard alone; dimension 9 via the value lens -> `value-case.md`)

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
