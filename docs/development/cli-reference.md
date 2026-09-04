# Command-line reference

When you only need one slice — a salary check, a job-fit gap list, keyword coverage —
`scripts/` ships focused command-line entry points that call the same pipeline
(`pipeline.jobfit.service.analyze`) and print well-formatted, color-aware terminal
output.

All scripts accept any CV format the UI accepts (PDF, DOCX, TXT, MD), read
`GEMINI_API_KEY` from `.env.local` / your shell, log per-stage progress on stderr
(silence with `--quiet`), and degrade to plain text on non-TTY stdout (or set
`NO_COLOR=1`).

| Script | What it shows |
| --- | --- |
| `scripts/analyze.py` | Full overview: profile, score breakdown, salary, strengths/gaps, recommendations |
| `scripts/salary.py` | Salary view: anchor band, final range, company multiplier, grounded market evidence |
| `scripts/jobfit.py` | Job-fit scoring: matching/missing skills, talking points, risk flags, keyword coverage |
| `scripts/interview.py` | Interview pack: questions grouped by bucket with STAR scaffolds |
| `scripts/compare.py` | Side-by-side comparison of 2+ CV variants against one JD |

```text
cv                  Positional — path to the CV/profile file (or 2+ paths for compare.py).
--jd PATH           Job description file.
--jd-text "…"       Inline job description (use instead of --jd).
--company PATH      Company overview file.
--company-text "…"  Inline company overview.
--grounding         Enable Google Search grounding for live market context.
--quiet             Suppress stage progress on stderr.
```

Two invocation forms, both supported from any working directory:

```bash
python scripts/analyze.py samples/sample-cv.txt   # file form
python -m scripts.analyze samples/sample-cv.txt   # module form
```

They differ only in the program name argparse prints. The module form used to
die at import time with `ModuleNotFoundError: No module named '_common'` — under
`-m`, `sys.path[0]` is the repository root rather than `scripts/`, so the shared
helper never resolved. `scripts/__init__.py` puts the directory on the path when
the package is imported; `scripts/_common.py` puts the ROOT on it so
`pipeline.jobfit` resolves. Both forms of every script are run by
`python -m unittest pipeline.jobfit.tests.test_scripts_entrypoints`.

```bash
python scripts/analyze.py samples/sample-cv.txt --jd path/to/jd.txt
python scripts/salary.py samples/sample-cv.txt --company-text "Multinational bank in Prague" --grounding
python scripts/jobfit.py samples/sample-cv.txt --jd-text "Senior Python + AWS SRE, English C1"
```

## Operational CLIs

Beyond the analysis scripts, the Python package ships operational CLIs:

```bash
python -m pipeline.jobfit.cli samples/sample-cv.txt        # core analysis (JSON out)
python -m pipeline.jobfit.automation_cli screen            # HR automation tasks: screen|outreach|rejection|prep|scorecard|rematch|offer|policy-pass
python -m pipeline.jobfit.devcase.devcase_cli              # dev-case lifecycle
python -m pipeline.jobfit.devcase.lifecycle_eval --count 5 # dev-case eval harness (--judge / --audit for LLM passes)
python -m pipeline.jobfit.reasoning_cli                    # match reasoning (Claude CLI)
```

## Operational scripts worth knowing before you need them

| Command | Note |
| --- | --- |
| `npm run db:dump` | Dumps **every** table — password hashes, provider keys, calendar and webhook tokens, the edge sealing private key. It warns on stderr and writes the file `0600`. |
| `npm run db:dump -- --redact` | The shareable dump: schema, row counts and business rows kept, every credential replaced by a `[redacted:…]` marker. Still restores. |
| `npm run db:load -- <dump> --dry-run` | Rehearses a restore — prints the per-table plan, predicts the real exit code (including the no-`--replace` refusal), writes nothing. |
| `npm run market:build` / `market:earnings` | Rebuild the committed Market Pulse snapshot. 20 s per-request timeout; both refuse under `KP_OFFLINE`. Rebuild cadence is sixty days, by hand. |
| `node scripts/perf/devbench.mjs <label>` | Measures what `next dev` costs and compares it to `scripts/perf/devbench-baseline.json`; `--record` moves the baseline. Takes port 3000 for the duration. |

Seed regeneration and the full DB dump/restore semantics are in
[`../architecture/workspace-data.md`](../architecture/workspace-data.md); the eval
runners in [testing-and-evaluation.md](testing-and-evaluation.md); the dev-server
budget in [performance-budget.md](performance-budget.md).
