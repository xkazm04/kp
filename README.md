# KP — Job Fit & Salary Estimator

Next.js + TypeScript UI backed by a Python analysis pipeline for CV/profile extraction, role-fit scoring, and Czech-market salary estimation. Ships with a code-aware GitHub deep-dive, a SQLite-backed workspace for saved analyses, and a golden-set eval harness used to keep the pipeline calibrated.

The browser uploads a CV/profile to a Next.js API route, which spawns the Python CLI (`python -m pipeline.jobfit.cli`) as a subprocess and consumes its stdout. A deterministic taxonomy pre-pass runs before the LLM and is fed in as structured evidence so Gemini reconciles its judgment with what the rules already detected. Results are validated with a Zod schema generated from the Pydantic models, so the TypeScript UI and Python pipeline cannot drift apart. There is no second long-lived server to manage.

## 1. Quick start - UI

```bash
npm install
pip install -r requirements.txt
npm run dev
```

Open `http://localhost:3000`, upload a PDF / DOCX / TXT / MD profile, optionally attach a job description, company overview, and GitHub profile, then click **Analyze**. Every successful run is auto-saved with a stable slug — open the **Saved analyses** link in the header to find it again.

`python` must be on the `PATH` of whatever process runs `next dev` / `next start`. Override the interpreter with the `PYTHON_CMD` env var if needed (defaults to `python` on Windows, `python3` elsewhere).

### Environment

Create `.env.local` in the project root:

```bash
GEMINI_API_KEY=your_key_here
# Optional — raises GitHub API rate limits and unlocks the GitHub code-aware review
GITHUB_TOKEN=your_token_here
# Optional — interpreter used when spawning the Python pipeline
PYTHON_CMD=python
# Optional — override SQLite path (default: data/kp.sqlite)
KP_DB_PATH=data/kp.sqlite
```

A `GEMINI_API_KEY` is required — the pipeline only ships the Gemini engine. The web UI compares Gemini extraction against a pypdf baseline so reviewers can see how much the LLM recovered from a noisy PDF.

## 2. Quick Start - CLI

The web UI surfaces detail across five tabs. When you only need one slice — a salary check, a job-fit gap list, the keyword-coverage breakdown — the `scripts/` folder ships focused command-line entry points that call the same pipeline (`pipeline.jobfit.service.analyze`) and print well-formatted, color-aware terminal output.

All scripts:

- accept any CV format the UI accepts (PDF, DOCX, TXT, MD);
- read `GEMINI_API_KEY` from `.env.local` / your shell;
- log per-stage progress on stderr (silence with `--quiet`);
- detect a non-TTY stdout and degrade to plain text (or set `NO_COLOR=1`).

Run from the project root:

| Script                   | What it shows                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| `scripts/analyze.py`     | Full overview: profile, score breakdown, salary, strengths/gaps, recommendations.              |
| `scripts/salary.py`      | Salary view: anchor band, final range, company multiplier, grounded market evidence.           |
| `scripts/jobfit.py`      | Job-fit scoring: matching/missing skills, talking points, risk flags, keyword coverage.        |
| `scripts/interview.py`   | Interview pack: questions grouped by bucket with STAR scaffolds.                               |
| `scripts/compare.py`     | Side-by-side comparison of 2+ CV variants against one JD.                                      |

### Common options

```text
cv                  Positional — path to the CV/profile file (or 2+ paths for compare.py).
--jd PATH           Job description file.
--jd-text "…"       Inline job description (use instead of --jd).
--company PATH      Company overview file.
--company-text "…"  Inline company overview.
--grounding         Enable Google Search grounding for live market context.
--quiet             Suppress stage progress on stderr.
NO_COLOR=1          Disable ANSI colors (env var, takes precedence over TTY detection).
```

### Examples

```bash
# Full overview of a CV (no JD, no company).
python scripts/analyze.py samples/profile-fixtures/technical-cv.pdf

# CV vs JD: full overview including the Job-fit preview block.
python scripts/analyze.py samples/profile-fixtures/technical-cv.pdf \
  --jd path/to/jd.txt

# Salary check against a target company.
python scripts/salary.py samples/profile-fixtures/technical-cv.pdf \
  --company-text "Multinational bank in Prague, NIS2 / DORA exposure" \
  --grounding

# Pure job-fit gap analysis (JD required) — includes keyword coverage.
python scripts/jobfit.py samples/profile-fixtures/technical-cv.pdf \
  --jd-text "Senior Python + AWS SRE, English C1, on-call rotation"

# Interview prep, only the experience bucket, no STAR scaffolds.
python scripts/interview.py samples/profile-fixtures/technical-cv.pdf \
  --jd path/to/jd.txt \
  --bucket experience \
  --no-star

# Compare two CV variants against one JD.
python scripts/compare.py \
  samples/profile-fixtures/linkedin-profile.pdf \
  samples/profile-fixtures/technical-cv.pdf \
  --jd path/to/jd.txt

# Pipe results to a file (colors auto-strip when stdout is not a TTY).
python scripts/analyze.py samples/profile-fixtures/technical-cv.pdf > overview.txt
```

## 3. Architecture

```text
app/
  page.tsx                          Browser UI (analyze + workspace nav)
  layout.tsx                        Fonts and metadata
  globals.css                       Tailwind 4 entrypoint
  analyses/page.tsx                 Saved analyses list (workspace)
  analyses/[slug]/page.tsx          Reload a saved analysis by slug
  jds/page.tsx                      JD library list + save form
  jds/[slug]/page.tsx               JD body + ranked candidates analyzed against it
  matrix/page.tsx                   Candidate × JD pivot view
  api/analyze/route.ts              Multi-variant analysis — one Python process per CV; persists result
  api/analyze/stream/route.ts       Single-CV SSE stream — pipes Python --stream stdout; persists captured result
  api/github-analysis/route.ts      GitHub REST + Gemini code-aware deep-dive
  api/analyses/route.ts             GET — list saved analyses
  api/analyses/[slug]/route.ts      GET — load a single saved analysis
  api/jds/route.ts                  GET — list JDs;  POST — save a JD
  api/jds/[slug]/route.ts           GET — load a single JD
  _components/                      Client-side React components
  _lib/db.ts                        better-sqlite3 wrapper (analyses + jds tables)
  _lib/python-runner.ts             Spawn helper: temp workdir, CLI args, stdout/stderr collection
  _lib/schemas.generated.ts         Zod schema generated from pipeline/jobfit/models.py
pipeline/jobfit/                    Python analysis package
  cli.py                            argparse entry point; --stream emits SSE events on stdout
  service.py                        analyze() — shared entry point used by the CLI
  pipeline.py                       Gemini orchestration; deterministic-evidence pre-pass
  extractors.py                     PDF/DOCX/TXT/MD extraction; Czech repair; language detection
  profiling.py                      Regex fallback profile (only used when Gemini omits a field)
  insights.py                       Company classification, salary multiplier (capped), application strategy
  ats.py                            Keyword coverage helper used by the Job-fit tab
  interview.py                      Interview questions + STAR scaffolds
  gemini.py                         Gemini call; injects evidence + output_language
  taxonomy.py                       Single source of truth for skill / company / education matching
  models.py                         Pydantic source of truth for the result shape
  codegen.py                        Generates app/_lib/schemas.generated.ts
  eval/                             Golden-set eval harness (fixtures + runner)
data/                               salary_benchmarks.json (anchor bands), taxonomy.json
data/kp.sqlite                      Workspace persistence (gitignored)
samples/                            Fixture CV/profile files
e2e/                                Playwright tests across input combinations
```

`pipeline/jobfit/models.py` is the single source of truth for the result shape. `npm run schemas:gen` regenerates `app/_lib/schemas.generated.ts`. The `build` and `typecheck` scripts run it automatically; `npm run schemas:check` validates that the committed file is up to date.

## 4. Pipeline stages

1. `extractors.py` — extracts a pypdf baseline from PDF/DOCX/TXT/MD, repairs Czech encoding artifacts, and detects the dominant language. Used for both the Extraction-tab side-by-side comparison and the bilingual output flag.
2. **Deterministic pre-pass** (`pipeline.py::_build_deterministic_evidence`) — runs `taxonomy.py` over the raw text and the company text to detect: role family, seniority bucket, anchor salary band (looked up in `data/salary_benchmarks.json`), salary signals (cloud / ai / security / devops / leadership / english / german / regulated_industry), surface-form skills, company type, company modifiers. Output is bundled as a JSON evidence block.
3. `gemini.py` — single Gemini call gets the CV bytes plus the evidence block plus the output-language flag and returns the structured analysis: profile, score sub-totals, salary range (anchored to the band), optional job-fit, grounded market evidence. Uses `gemini-3-flash-preview`.
4. `insights.py` — company-type classification, multiplier application (capped at 1.20×), evidence trace.
5. `ats.py` — JD keyword coverage (matched / missing / over-used) consumed by the Job-fit tab.
6. `interview.py` — interview question pack with STAR scaffolds derived from job-fit gaps.
7. `taxonomy.py` — single source of truth for skill matching, role-family classification, company adjustments, education levels, seniority signals. Backed by `data/taxonomy.json` (151 terms, ~30 Czech surface forms, 8 salary signals, 5 company types, 3 modifiers).

## 5. Testing & evaluation

```bash
npm run lint
npm run typecheck         # also regenerates the Zod schema
npm run test:python       # python -m unittest discover pipeline/jobfit/tests
npm run test:e2e          # Playwright; auto-skips when no GEMINI_API_KEY
npm run test:eval         # golden-set eval (markdown report)
npm run test:eval:strict  # eval + non-zero exit when thresholds fail
```

The unit suite (`pipeline/jobfit/tests/`) covers insights rules and PDF parsing quality. Playwright (`e2e/profile-smoke.spec.ts`) covers four input combinations: CV only, CV + JD, CV + JD + company, CV + JD + company + GitHub. Both suites skip cleanly without a Gemini key.

### Eval harness

`pipeline/jobfit/eval/` ships a 14-fixture golden set of synthetic CVs covering the role × seniority × language matrix plus deliberate edge cases:

- **Core roles**: junior frontend, medior data engineer, senior Python+AI, senior DevOps+security, senior PM, Czech-language lead engineer.
- **Edge cases**: senior iOS engineer, PhD-to-industry data scientist, Czech-language junior QA, CTO/co-founder (no recent code), career switcher (teaching → backend), very short CV, OSVČ freelancer with diverse engagements, COBOL/mainframe legacy specialist.

Each fixture is hand-verified (`label`, `expected_role_family`, `expected_seniority`, `expected_salary_range`, `expected_skills_subset`, optional `expected_education` / `expected_signals_subset` / `expected_language`). Multi-valued expectations are supported (e.g., `["data_ai", "software_engineering"]` for genuinely ambiguous AI engineers). The runner scores every fixture on four axes:

| Metric           | Threshold |
| ---------------- | --------- |
| `role_family`    | 85%       |
| `seniority`      | 70%       |
| `salary_overlap` | 60%       |
| `skill_recall`   | 75%       |

`salary_overlap` is containment-aware — a Gemini range fully inside the expected band scores 1.0; partial overlaps fall back to IoU. The aggregate report and per-fixture breakdown print as a markdown table; `--json` swaps in machine-readable output for CI; `--strict` exits non-zero when any threshold is missed. Use it after every prompt or taxonomy change to catch drift.

Known edge-case behaviors the harness surfaces today: occasional Gemini JSON truncation on Czech short CVs (treated as a fixture error); language-detection ambiguity on mostly-English CVs that contain Czech proper nouns ("Bc. ČVUT"); narrower-than-expected Gemini ranges on niche specialisms (legacy mainframe, PhD pivot) where the public market data is thin.

## 6. Data approach

`data/salary_benchmarks.json` carries role × seniority anchor bands per family (`software_engineering`, `data_ai`, `product_project`). The deterministic pre-pass looks up the band that matches the candidate's detected role family + seniority and feeds it into the Gemini prompt as the *primary* salary anchor; Gemini may adjust ±20% with stronger evidence. `data/taxonomy.json` (151 terms, 8 salary signals, 5 company types) drives skill matching, role classification, education detection, seniority signals, and the company-type multiplier (capped at 1.20×). Both files are editable without changing the API/UI contract.

### Czech salary data (job-board aggregates)

- [Platy.cz — Information Technology category](https://www.platy.cz/en/salaryinfo/information-technology) — backend 49–136k, frontend 45–115k, iOS 75–181k, Android 65–150k, DevOps 62–155k, QA manual 38–83k, QA automation 46–107k, security analyst 48–129k, data scientist 56–123k, BI analyst 51–114k, product manager 61–164k. Average IT 81,634 CZK. Used to validate role bands and to size the DevOps/security/mobile salary signals.
- [Platy.cz — Public administration / self-governance](https://www.platy.cz/en/salaryinfo/public-administration-self-governance) — public-admin 80% earn 29.8–65.0k CZK, average 46k. Used to recalibrate the `public sector` company-adjustment factor down from 0.86 to 0.80.
- [Levels.fyi — Software Engineer, Czech Republic](https://www.levels.fyi/t/software-engineer/locations/czech-republic) — average SWE TC 1,480,987 CZK/yr, range 1.1–1.87M; Prague +29% vs CZ average. Cross-check on Platy.cz bands.
- [Glassdoor — Senior Software Engineer, Prague](https://www.glassdoor.com/Salaries/prague-senior-software-engineer-salary-SRCH_IL.0,6_IM989_KO7,31.htm) — senior SWE 1.48–2.19M CZK/yr; junior 740k–1.2M; mid 1.2–1.7M. Cross-check.

### Czech salary guides (recruitment agencies)

- [Hays Czech Republic salary guide](https://www.hays.cz/en/salary-guide) — confirms top in-demand IT skills (cloud, cybersecurity, software development); raw numbers gated. Used as directional context.
- [Grafton Recruitment CZ Salary Guide 2025](https://www.grafton.cz/en/employers/survey-zone/salary-guide-2025) — 11th edition, 350 positions × 8 sectors. Landing page only.
- [Reed Czech Republic 2026 Salary Guide](https://www.reedglobal.cz/en/resources/salary-guide) — landing page only.
- [Cpl CEE 2025 Salary Guide announcement](https://www.cz.cpl.com/en/blog/2025/02/cee-salary-guide-2025-new-report) — covers IT & Tech across CZ/SK/PL. Landing page only.

### Market analyses + premium sizing

- [Kitalent — Prague ICT multinational wage war](https://kitalent.com/article-prague-ict-multinational-wage-war) — senior SWE 100–150k, principal/architect 150–200k, VP Engineering 220–350k, CISO 200–400k; multinational base premium 30–40% vs scaleups; cybersecurity mover premia 25–35%; AI/ML salary inflation 10–12% annual through 2026 vs 6–8% general ICT. Source for `enterprise/corporate` factor revision and for the new `security` salary signal.
- [Nucamp — Top 10 high-paying tech jobs in Czech Republic 2025](https://www.nucamp.co/blog/coding-bootcamp-czech-republic-cze-ranking-the-top-10-highpaying-tech-jobs-in-czech-republic-in-2025) — Data Scientist 650k–1.5M/yr, AI 1.1–2M/yr, ML 850k–1.5M/yr, Cloud up to 1.6M/yr, Cyber 800k–1.5M/yr; AI/ML +20–30% premium; Prague +25% over national. Used to validate `ai`, `cloud`, `security` signals.
- [Nucamp — Most in-demand tech jobs in Czech Republic 2025](https://www.nucamp.co/blog/coding-bootcamp-czech-republic-cze-most-in-demand-tech-job-in-czech-republic-in-2025) — top demand for Python, Java, JS, cloud, cybersecurity, data; 18% market growth for software developer roles; 63% of CZ IT firms struggling to hire. Source for the broad skills additions.
- [MV People Group — European Cybersecurity Salary Guide 2026](https://www.mvpeoplegroup.com/en/insights/cybersecurity-salary-guide-europe-2026) — NIS2/DORA experts EUR 70–107k; CISO EUR 120–197k. Used to add the `security` salary signal and `regulated_industry` modifier.

### Czech press + statistics

- [Expats.cz — Salary leaders: Czechia's best-paying industries and locations](https://www.expats.cz/czech-news/article/salary-leaders-czechia-s-best-paying-industries-and-locations) — private sector growth 7.9% vs public 3.4%; Prague avg 63,106; senior comp tech Prague 90,207 vs Vysočina 64,111; 2025 outlook 5.5–6%.
- [Expats.cz — IT roles offering a good start](https://www.expats.cz/czech-news/article/it-roles-that-offer-good-start-to-career-and-salary) — entry-level IT: security 75k/mo, dev/data 62.5k/mo, PM coordinator 50k/mo. Confirms the startup-vs-large-company entry gap and informs the `startup` factor.
- [Expats.cz — Czech salary guide vs national average](https://www.expats.cz/czech-news/article/czech-salary-guide-do-you-earn-more-than-the-national-average-for-your-industry) — IT industry average ~74k CZK (highest of all industries); backend >80k, top-decile >115k. Cross-check.

### Regulation (drives `regulated_industry` and `security` signals)

- [ICLG — Cybersecurity Laws and Regulations: Czech Republic 2026](https://iclg.com/practice-areas/cybersecurity-laws-and-regulations/czech-republic) — Czech New Cybersecurity Act effective 1 Nov 2025 (NIS2 transposition); DORA from 17 Jan 2025; penalties to CZK 250M.
- [Cybersecurity Hub CZ — NIS2 Ready](https://www.cybersecurityhub.cz/en/opportunities/nis2ready) and [Deloitte CZ — NIS2 directive and the new Cybersecurity Act](https://www.deloitte.com/cz-sk/en/services/consulting/services/nis2-directive-and-the-new-cybersecurity-act.html) — implementation context for the compliance-related salary lift.

### Czech vocabulary + education titles

- [Coderslab — Junior, medior, senior in Czech IT](https://coderslab.cz/cz/blog/jak-se-lisi-junior-medior-senior) — confirms `samostatně` (independently) as the canonical medior signifier. Junior = nováček; senior = 5+ years.
- [Czechitas — Overview of basic IT positions](https://www.czechitas.cz/blog/prehled-zakladnich-it-pozic-s-czechitas) — Czech IT job-title vocabulary: programátor, vývojář, architekt, tester, analytik, datový analytik, projektový/produktový manažer, databázový inženýr, administrátor, konzultant, technická podpora.
- [CzechUniversities — Academic title spelling](https://www.czechuniversities.com/article/list-of-academic-titles-and-their-correct-spelling) — canonical CZ academic titles: Bc., BcA., Mgr., MgA., Ing., Ing. arch., MBA, Ph.D., JUDr., RNDr., MUDr., MVDr., MDDr., PharmDr., DrSc.

### Consulting / Big-4 references (for `agency/consultancy` factor)

- [Salary.com — Deloitte Czech Republic Consultant](https://www.salary.com/research/company/deloitte-czech-republic/consultant-salary) — Deloitte CZ consultant 44–58k/mo. Used to lower the `agency/consultancy` factor from 1.02 to 1.00.

### Sources attempted but gated or unavailable

Hays CZ 2026 PDF, Grafton 2025 PDF, Reed 2026 PDF, Cpl CEE 2025 PDF — all behind download forms; landing pages only. Robert Half does not publish a CZ-specific guide for 2025/2026; their CEE coverage rolls into Manpower/Hays. ČSÚ wage tables were referenced only via Nucamp's summary citing the 18% software-developer growth figure.

---

## 7. Result caching

To avoid re-paying for identical Gemini calls (a common case while iterating on a JD against the same CV), the analyze routes hash the inputs and reuse a cached payload when one is available.

- **Cache key** — SHA-256 of `(PROMPT_VERSION, grounding flag, JD text + JD file bytes, company text + company file bytes, CV bytes)`. Computed in `app/_lib/cache.ts`.
- **Cache store** — `gemini_cache` table in the SQLite workspace DB. Each row carries `payload_json`, `prompt_version`, `created_at`, `expires_at`. Default TTL 24h; override via `KP_CACHE_TTL_HOURS`.
- **Invalidation** — bump `PROMPT_VERSION` in `app/_lib/cache.ts` whenever you edit the Gemini prompt, the Pydantic schema, the deterministic pre-pass, or the taxonomy in a way that should drop old results. Old hashes simply miss the lookup; nothing has to be deleted.
- **Behavior** — on cache hit, the streaming route emits `stage:done` events for all six stages plus the cached `result` event so the UI flashes through the progress bar instantly. Each user-visible run still gets a fresh row in the History tab regardless of cache state, so the workspace timeline remains accurate.
- **Implicit caching** — Gemini's own context caching for repeated content (within short windows, multi-variant runs against the same JD) is opportunistic and free; we don't manage it.

## 8. Logging

Per-request structured JSONL logs help debug pipeline regressions and track token usage without rerunning the full e2e suite.

| File | Written by | One line per |
| --- | --- | --- |
| `tmp/pipeline.log` | `pipeline/jobfit/logger.py` | `analyze_cv()` invocation — request_id, CV path, JD/company flags, total + per-stage durations, Gemini token usage (`prompt_tokens`, `candidate_tokens`, `total_tokens`, `cached_tokens`), error |
| `tmp/analyze.log` | `app/_lib/logger.ts` | `/api/analyze` and `/api/analyze/stream` request — request_id, route, candidate label, JD slug, `cache_hit` flag, duration, saved slug, error |
| `tmp/github.log` | `app/api/github-analysis/route.ts` | `/api/github-analysis` request — request_id, GitHub user, REST repo count, `code_review` status, duration, error |

Logs are append-only JSONL (one JSON object per line) so they're tail-friendly and grep-able. Override the directory with `KP_LOG_DIR`; the default `tmp/` is gitignored.

Set `KP_LOG_PROMPTS=1` for full Gemini prompt + response capture per request to `tmp/prompts/<request_id>-prompt.txt` and `<request_id>-response.txt`. Off by default since these contain CV PII and can be 5–20 KB each. Useful when chasing a "Gemini returned non-JSON output" regression or comparing prompt revisions.
