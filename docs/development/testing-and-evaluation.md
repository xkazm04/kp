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
