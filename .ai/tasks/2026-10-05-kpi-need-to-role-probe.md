# NEED_TO_ROLE — the KPI probe for key goal 2

Stewardship run, branch `autopilot/project-kpi-stewardship-2caf8f67`, cut from local `main` = `739417e75`.
Spec: section 3, item 1 of `.ai/tasks/2026-10-05-kpi-readings-on-buildable-main.md`.

**Reconcile first:** `NEED_TO_ROLE` / `need_to_role` appeared nowhere on `main` except that
note's own proposal. No probe existed, so one was built.

## Reading

```
NEED_TO_ROLE = 12/12     (probe commit 89b3bcd91; scenarios file holds 12)
```

| Stage | Reached → passed | Measured |
| --- | --- | --- |
| `brief` | 12 → 12 | yes — `intake_eval.simulate(None, None, scenario)` (the `--no-llm` path) then `check_dialog(...)["brief_core"]` |
| `rubric` | 12 → 12 | yes — `derive_role_rubric(brief)` is non-empty |
| `jd` | 12 → 12 | yes, **role design only** — see below |

No scenario is incomplete. `failures: []`.

Reproduce (read-only, keyless, no network; the commit field is `git rev-parse HEAD`):

```bash
python -m pipeline.jobfit.eval.need_to_role_probe          # NEED_TO_ROLE = n/N + breakdown
python -m pipeline.jobfit.eval.need_to_role_probe --json   # {value, denominator, commit, stages, failures, unmeasured}
```

`--scenarios PATH` (not in the spec) points at another scenarios file; the tests use it.
No npm script was added, because `package.json` is dirty in the shared checkout.

## How the jd stage was decided

The brief said to look for a keyless JD build Python can call and, if none exists, report
the stage `unmeasured` and not write one. What exists:

- **Python-callable and keyless:** `devcase.analyze.analyze_need(need, None, provider=None)`
  then `devcase.design.design_role(need, analysis, provider=None)`. With no provider both take
  their `deterministic()` branch (`generate_with_fallback`). This is exactly what a keyless JD
  build runs: `app/_lib/jd-build-run.ts` → `devcase_cli design-artifacts --role-only`, which
  returns a `RoleSpec` (title, must-haves, responsibilities, ...).
- **Not Python-callable:** `composeMarkdown`/`composeJdBody` (the Markdown layout) live in
  TypeScript only. No Python composer exists, and none was written.

So the jd stage is **measured, but only as the keyless role design**. The need is projected from
the brief as `runJdBuild` does it (stack = must-have skills, responsibilities = 90-day outcomes
plus responsibilities, graded `statedRequirements`). A draft counts as produced when the
designed role has a title and at least one must-have or responsibility, which is the content
`composeMarkdown` lays out. The probe's output states this and lists `jd_markdown` under
`unmeasured`. If the owner reads "JD draft produced" as the rendered Markdown, the jd stage
should be re-scoped to `unmeasured`; the other two stages are unaffected. That is listed as a
question in the run result.

## What the probe does NOT measure

- **The live hire-from-need route**: `/api/intake/[id]/message` → `promote` → `/api/jds/generate`
  → role-run. Only the engine functions run in-process, deterministically.
- **Any LLM path.** Golden answers are scripted and the agent is the deterministic one, so 12/12
  says the keyless path holds. It says nothing about a real requestor with a real model, and
  nothing about vague answers beyond what the 12 written personas cover.
- **The rendered JD body** (`composeMarkdown`) and the **market-salary band**.
- **Pipeline entry**: nothing is ingested or sourced into a board.
- **Rubric quality**: "non-empty" is the bar, not that the axes are right.

Reading it: `12/12` is a ceiling check on the offline path. It does not measure goal 2 as a
user experiences it. The probe is useful as a regression alarm: it moves when the brief core,
the rubric derivation or the keyless role design breaks for a scenario.

## House rule, and how it is pinned

Missing or unparseable scenarios file, an empty scenario list, a scenario with no name or no
`golden_answers`, or a stage module that fails to import: exit 2, a reason on stderr, **no
number on stdout**. An exception inside a stage for one scenario is that scenario's failure,
named by stage, not a refusal.

## Verification

All run in the worktree at the probe commit.

| Command | Result |
| --- | --- |
| `python -m pytest pipeline/jobfit/tests/test_need_to_role_probe.py pipeline/jobfit/tests/test_intake_eval.py pipeline/jobfit/tests/test_rolerubric.py -q` | **55 passed** |
| — `test_need_to_role_probe.py` alone | 12 passed |
| — `test_intake_eval.py` alone | 36 passed |
| — `test_rolerubric.py` alone | 7 passed |
| `npm run test:eval:intake` | `12/12 personas PASS · 98 checks` |
| probe with every `*_API_KEY` unset (`env -u ...`) | `12/12`, identical |
| `npm run typecheck` | exit 0 |
| `npm run lint` | 0 errors, 50 warnings (all pre-existing, none in files touched here) |
| `npm run test:unit -- 'app/_lib/auth/**/*.test.ts' 'app/api/**/*.test.ts'` | **fails, pre-existing** — see below |
| `npm run docs:check` | not run: `feature-doc-map.json` maps none of the touched files (the only `pipeline/jobfit/eval/` entry is `recipe_candidates.py`) |

Test cases in `test_need_to_role_probe.py`, each written failing first (the module did not
exist, so collection errored) and then made to pass:

- (a) `DenominatorTest`: the denominator equals `len(load_scenarios())` on the real file; the first
  line matches `NEED_TO_ROLE = n/12`; the denominator follows a 3-scenario file.
- (b) `StageAttributionTest`: a scenario whose answers state nothing is incomplete at `brief`
  with a reason; it is named in the text output; the stage table has `brief`/`rubric`/`jd`
  and declares `jd_markdown` unmeasured.
- (c) `MissingInputTest`: missing file, unparseable file, empty file and an unimportable stage
  module each exit non-zero with empty stdout.
- (d) `KeylessNetworkFreeTest`: with `*_API_KEY` removed from `os.environ`, `socket.connect`,
  `create_connection`, `getaddrinfo`, `http.client` connects and `urlopen` all patched to
  raise, the run makes zero calls and still reads 12/12; `resolve_provider` is never called.

### The unit gate is red on main, not on this change

The four failures are the ones `6564fe528` already states for `main`:
`complete-candidate-guard.test.ts` (the CONTROL case), `recording-door.test.ts` (playback,
retention gate) and `recruiter-recording-delete.test.ts` (the deletion case, which that commit
says fails only in the combined run). This change touches no TypeScript, so it cannot have
moved them. I did not fix them.

`npm run typecheck` rewrites three `*.generated.ts` files with CRLF/LF noise only
(`git diff --ignore-all-space` is empty). I restored them, so the branch carries just the two
new Python files and this record.

## Files

- `pipeline/jobfit/eval/need_to_role_probe.py` (new)
- `pipeline/jobfit/tests/test_need_to_role_probe.py` (new)
- `intake_eval.py` is **unchanged**. `simulate` and `check_dialog` were reused as they are;
  `brief_core` is read from `check_dialog`'s result, so no helper had to be exposed.
