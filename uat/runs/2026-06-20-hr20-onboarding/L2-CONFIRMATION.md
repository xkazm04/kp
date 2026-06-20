# L2 — live confirmation against the real Gemini engine

**Depth:** L1 across all 20 (done) + **L2 live on a representative subset** (this file).
**Env:** kp dev server `:3005`, `engines:{gemini:true, claudeCli:true}`, seeded `data/kp.sqlite`
(100 jobs / 50 profiles / 50 pipeline / 100 analyses). Driver:
`_l2/drive-analyze-file.mjs` (uploads a CV file, pastes a JD, runs the **real**
`/api/analyze` pipeline, polls the async task to settle). Internal users reach the
authed workspace via the dev gate — no candidate token needed for these surfaces.

## Why these two probes are representative
The 20-Character panel's three P0 themes (taxonomy locked to software; CZK single-
currency comp; "Czech market" reasoning persona) are **universal** — they live in the
shared pipeline, not any one Character's surface. Two real analyses isolate both halves
of the cohort:
- **US ICU Nurse (Sarah Mitchell)** — stands in for every **non-tech** industry
  (healthcare, manufacturing, retail, hospitality, construction, pharma, public sector,
  logistics, nonprofit…): does an off-taxonomy role survive the pipeline?
- **US/SF startup Senior Engineer (Alex Rivera)** — the **best-case, in-taxonomy** role
  (tech-startup, SaaS, fintech, e-commerce tech roles): even on the happy path, is comp
  still CZK + equity-blind?

Each AI analysis settled in **~45s** (well inside the 30–130s budget — **no timeout
finding**; the pipeline speed is a strength).

## Confirmation 1 — taxonomy is forced to `software_engineering` (theme #1) · CONFIRMED live
Real Gemini output for the **RN** (`shots/l2-rn-analyze.png`, `.text.txt`), Job-fit panel
header literally reads **"Senior / Software Engineering"** for a nurse. The model's own
extraction notes:

> "The CV is for a medical professional (RN), but is being parsed into a **tech-oriented
> schema per instructions**. Role family **'software_engineering' is used to satisfy
> schema constraints** despite the medical nature of the profile."
> "No direct experience mentioned with specific trauma-specific **software** beyond Epic EHR"

L1 said the taxonomy is a closed 3-family tech enum (`pipeline/jobfit/taxonomy.py:78`,
`data/taxonomy.json`); L2 shows the live consequence — a nurse evaluated as a software
engineer. **Verdict: confirmed.**

## Confirmation 2 — comp is CZK / Czech-market-anchored, equity-blind (themes #2–#3) · CONFIRMED live
**RN**, "Why this score":
> "…her 'Staff Nurse III' status and certifications justify a salary at the top of the
> senior range in **the Czech market context**."

**SWE** (the in-taxonomy best case — 96/100 match), "Why this score":
> "While his SF-based salary expectations **($180k+) far exceed the standard Czech
> market**, his profile represents the absolute top tier of talent available locally,
> justifying a salary at the very edge of the **165k-185k CZK** range."

The model *correctly reads* the USD CV (`currencyMarkers: USD`) and then **converts the
recommendation to a Czech CZK band anchored to the local market** — exactly the L1
prediction (`pipeline/jobfit/salary_band.py`, `data/salary_benchmarks.json`,
`gemini.py:433` Czech-market prompt). **Equity is absent** from the comp read despite the
JD + CV foregrounding 0.5–1.0% options — confirming the startup-founder's equity finding.
**Verdict: confirmed.** A US/UAE/India/UK HR person receives a CZK number for a USD/AED/
INR/GBP role — worse than no number.

## Net L2 verdict (subset)
Both representative probes reach **L2-conditional/fail** for the same reason L1 found:
the engine and rendering work (fast, clean, self-aware), but the **output domain is
bank/Czech/tech-locked**. The two extremes (out-of-domain RN, in-domain SWE) **both** fail
the comp axis, so the P0 themes are confirmed for the whole cohort, not just one Character.

## Deferred (a fuller L2 would still add)
- The **candidate onboarding token chain** end-to-end (`/onboarding/[token]`) — needs the
  unresolved local token-mint (env.md open Q#3).
- The **solely-automated screen-wave reject** (`actor:"system"`) behavior live
  (Anke/EU-AI-Act, Tasha/veterans, Susan/committee) — a behavioral, not output, probe.
- **Batch/bulk** high-volume flows (Brittany) and **ATS write-back** (Marcus).

Artifacts: `shots/l2-rn-analyze.png` + `.text.txt`, `shots/l2-swe-analyze.png` + `.text.txt`,
CV fixtures + driver under `_l2/`.
