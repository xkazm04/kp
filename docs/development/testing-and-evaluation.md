# Testing & evaluation

```bash
npm run lint
npm run typecheck         # also regenerates the Zod schema
npm run test:unit         # Node --test over app/**/*.test.ts (no jest/vitest)
npm run test:python       # python -m unittest discover pipeline/jobfit/tests
npm run test:python:gate  # gated runner with skip baseline
npm run test:e2e          # Playwright; Analyze suite auto-skips when no GEMINI_API_KEY
npm run test:eval         # golden-set eval (markdown report)
npm run test:eval:strict  # eval + non-zero exit when thresholds fail
npm run test:eval:match   # matching-quality eval (strict) — KEYLESS
npm run test:eval:automation  # automation reliability, deterministic path — KEYLESS
npm run test:eval:ci      # both of the above; this is the CI gate
npm run bench:gate        # App-master sweep verdict vs the committed baseline
npm run review:constitution   # deterministic gate-integrity pass over the diff
npm run docs:check        # decision-record integrity
npm run test:flake        # fixtures for the flake policy + quarantine register
```

## Which of these are gates, and which are probes

A harness nobody depends on decays: the signal only exists when somebody chooses
to look, and that is exactly the habit that erodes as work speeds up. So the
suites are split by whether a red result is **always** a real regression.

**Gated in CI, on every push and PR** — deterministic, keyless, cheap:

| Suite | Why it can be a gate |
| --- | --- |
| `test:eval:match` | needs no API key by construction; also carries the fairness probes (pedigree exclusion, socioeconomic inclusion, language neutrality, potential monotonicity) |
| `test:eval:automation` | `--no-llm`: the deterministic fallback path plus the hard reliability invariants. Also certifies [ADR 0004](../architecture/decisions/0004-keyless-degradation-is-a-product-property.md) — keyless degradation as a product property |
| `test:bench-driver` | the App-master driver's own node:test fixtures, including the bench baseline↔scenario pinning |
| `test:docs`, `test:review`, `docs:check` | the fixtures behind the doc-sync, ADR and change-review tooling |

**Deliberately on demand** — a red result may just mean a provider had a bad day,
or a live server was not running:

| Suite | Needs |
| --- | --- |
| `test:eval` / `test:eval:strict` | `GEMINI_API_KEY`; skips with exit 0 without one |
| `automation_eval --judge` | a live Claude CLI judge |
| `bench:app-master` | a running kp **and** Personas (or `--stub-personas`) |
| `test:e2e` (full) | provider keys for the Analyze suite |

The bench is the interesting case: it cannot run in CI, but its verdict is still
machine-readable rather than prose. `npm run bench:gate` compares the sweep
against `scripts/app-master-bench/baseline.json` and writes
`bench/app-master/gate.json`, so the next agent reads a file instead of parsing
a commit message. See [app-master](../features/app-master/README.md#the-verdict-lives-in-a-file-not-in-a-commit-body).

The Python suite covers insights rules, PDF parsing quality, the matching engine, the
Claude CLI provider, the automation tasks, fairness gates, and the full devcase module
(analyze/design/source/evaluate/reflect/provenance). Tests that would need a live LLM
are skipped unless enabled (`KP_CLAUDE_CLI_LIVE=1`). Playwright splits into
`e2e/analyze-smoke.spec.ts` (LLM-backed Analyze flow across input combinations, skips
cleanly without a Gemini key, includes a11y checks) and `e2e/profile-builder.spec.ts`
(deterministic build/save round-trip, no API key needed). The deterministic keyless
e2e subset and how to run it against an already-running server are listed in
[`.claude/CLAUDE.md`](../../.claude/CLAUDE.md) under "Common Commands".

## When a test fails once and passes on re-run

799 test files answered with one bit — the exit code. When the suite went red,
nothing in the run distinguished *this test is broken* from *this test failed
once and passes when you press the button again*, so the cheapest available move
for an agent that did not cause the failure was to press the button. That is a
lesson learned once and applied to every red build afterwards, including the real
ones.

`npm run test:unit` now answers the question instead of leaving it open. A second,
machine-readable reporter ([`scripts/test/flake-reporter.mjs`](../../scripts/test/flake-reporter.mjs))
rides alongside node's own — the console output is unchanged — and records which
files failed. Exactly those files are re-run once, in a fresh runner with the
same flags and the same scrubbed environment, and each is labelled:

| Verdict | Means | Blocks? |
| --- | --- | --- |
| `BROKEN` | failed twice | yes, exactly as before |
| `FLAKE` | failed, then **passed** on the immediate re-run | **yes** — see below |
| `QUARANTINE` | declared in [`test-quarantine.json`](../../test-quarantine.json) | no |
| `FAILED … not re-run` | more than 20 files failed, or `KP_FLAKE_RERUN=0` | yes — there is no evidence either way and none is invented |

The block is printed and appended to the GitHub step summary, which is where a
flake gets *recorded* rather than disappearing into "the suite was red and then
it wasn't".

**A flake still fails the build, on purpose.** Retrying until green converts a
flake from a visible cost into an invisible one, and the suite's own sensitivity
falls with nothing reporting it. The two real moves are to fix the test, or to
quarantine it — which is an entry in `test-quarantine.json` carrying a `file`, a
`why`, a `since` and an `expires`, in a commit a reviewer can disagree with.
Re-running is not a decision; quarantining is.

**The register is a ratchet**, on the shared protocol in
[`scripts/lint/ratchet.mjs`](../../scripts/lint/ratchet.mjs) that `ruff.toml` and
`ts-debt.json` already use — so a reader who learned one has learned this one.
The list is empty and the ceiling is **0**, which is the state to keep it in: the
first entry that arrives without someone raising the number is a red build. Three
rules are this register's own, and all three block:

- **dead** — the entry names a file that is not in the tree. A quarantine that
  excuses nothing reads as policy.
- **unexplained** — no `why` (under 20 characters counts as none), or no dates.
- **expired** — `expires` is in the past, or more than 30 days after `since`. A
  quarantine is a loan with a due date; the expiry is what forces the renewal to
  be a decision rather than a thing nobody looked at for a quarter.

The register is validated **before** the suite starts, so a dead or expired entry
is a red build even on a run where nothing fails — which is the only kind of run
those two rot on. The rules themselves are fixture-covered by `npm run test:flake`
([`scripts/test/__tests__/flake-policy.test.mjs`](../../scripts/test/__tests__/flake-policy.test.mjs)),
whose last case runs the policy over the committed register and the real tree.

**What this does not cover.** The Python suite (`test:python:gate`) has its own
pawl — the `KP_SKIP_BASELINE` skip count — and no flake classification; the
Playwright job is a single deterministic keyless subset against a production
build, where a re-run is a whole build. Both are honest gaps rather than
oversights: this covers the suite that is large enough for a flake to hide in.

## Route-handler tests and `next/server`

`npm run test:unit` runs through `scripts/test-alias-loader.mjs`, which teaches Node's
ESM resolver the two TS conveniences the app source uses (the `@/` alias, extensionless
relative imports) so a route handler is loadable in a plain `node --test` process.

One more thing happens there, and it only happens in a **linked checkout** — a git
worktree whose `node_modules` is a junction (Windows) or symlink (POSIX) back to the
primary clone, which is how agent lanes are given a tree. In that layout `next/server`
resolves through two module identities and every named export comes back `undefined`, so
a handler's `NextResponse.json(...)` throws `Cannot read properties of undefined (reading
'json')` before it can answer. It is an environment artefact, not a product bug: the same
tests are green in a normal clone.

So the loader redirects `next/server` to
[`app/_lib/testing/next-server-shim.mjs`](../../app/_lib/testing/next-server-shim.mjs)
**when, and only when, `node_modules` is a link**:

- normal checkouts and CI (which clones) load the real `next/server`, unchanged — a Next
  upgrade that drops an export still fails the suite where it should;
- a worktree lane gets the shim, because there the alternative is not "the real module",
  it is a suite that cannot run at all.

Two consequences worth knowing before you write a route test:

- A plain `import { POST } from "./route.ts"` is fine. The older pattern —
  `register(new URL(".../next-server-hooks.mjs", import.meta.url))` followed by
  `await import("./route.ts")` — still works and is what you want if you need the shim in
  a *normal* checkout too (e.g. to assert on `Set-Cookie` without Next's cookie jar).
- The shim's export surface is a hard dependency, not a nicety: an ESM import of a name it
  does not export is a **link-time SyntaxError**, so a new
  `import { ImageResponse } from "next/server"` would stop unrelated tests loading, in the
  worktree only. `app/_lib/testing/next-server-shim.test.ts` scans `app/**` and `proxy.ts`
  for every name imported from `next/server` and fails if the shim is missing one — it
  runs in `npm run test:unit`, including in a normal checkout where the shim is otherwise
  dormant, which is where that import gets written.

## Eval harness

`pipeline/jobfit/eval/` ships a 14-fixture golden set of synthetic CVs covering the
role × seniority × language matrix plus deliberate edge cases:

- **Core roles**: junior frontend, medior data engineer, senior Python+AI, senior
  DevOps+security, senior PM, Czech-language lead engineer.
- **Edge cases**: senior iOS engineer, PhD-to-industry data scientist, Czech-language
  junior QA, CTO/co-founder (no recent code), career switcher (teaching → backend),
  very short CV, OSVČ freelancer with diverse engagements, COBOL/mainframe legacy
  specialist.

Each fixture is hand-verified (`label`, `expected_role_family`, `expected_seniority`,
`expected_salary_range`, `expected_skills_subset`, optional `expected_education` /
`expected_signals_subset` / `expected_language`). Multi-valued expectations are
supported (e.g., `["data_ai", "software_engineering"]` for genuinely ambiguous AI
engineers). The runner scores every fixture on four axes:

| Metric           | Threshold |
| ---------------- | --------- |
| `role_family`    | 85%       |
| `seniority`      | 70%       |
| `salary_overlap` | 60%       |
| `skill_recall`   | 75%       |

`salary_overlap` is containment-aware — a Gemini range fully inside the expected band
scores 1.0; partial overlaps fall back to IoU. The aggregate report and per-fixture
breakdown print as a markdown table; `--json` swaps in machine-readable output for
CI; `--strict` exits non-zero when any threshold is missed. Use it after every prompt
or taxonomy change to catch drift.

Beyond the golden set: `eval/matching_eval.py` scores the matching engine,
`eval/automation_eval.py` scores the automation tasks
([automation-eval.md](automation-eval.md)), and `devcase/lifecycle_eval.py` hardens
the dev-case design loop (scenario generation, reliability/integrity health checks,
optional LLM design audits — [case-calibration.md](case-calibration.md)).
