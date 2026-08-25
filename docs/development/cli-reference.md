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

Seed regeneration and the DB dump/restore commands are in
[`../architecture/workspace-data.md`](../architecture/workspace-data.md); the eval
runners in [testing-and-evaluation.md](testing-and-evaluation.md).
