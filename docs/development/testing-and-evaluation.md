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
npm run test:eval:match   # matching-quality eval (strict)
```

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
