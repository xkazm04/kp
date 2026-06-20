---
name: cv-analysis-jobfit
promotion: discovery
surfaces: [Analyze tab, Analyze history, "CV Analysis Workspace", "Analysis Result Panels", "CV Extraction & Pipeline Services", "GitHub Evidence & CV Utilities"]
characters: [petra-recruiter, eva-eng-hiring-lead]
language: cs
---

# Analýza jednoho CV proti konkrétní roli

## Goal (in the user's words)
"Vezmu jedno CV a jednu roli. Chci extrakci, odhad mzdy, pokrytí dovedností,
měkké signály a verdikt — a všechno tak, abych to mohla obhájit, ne číslo z klobouku."

## Definition of done (user POV)
- A completed analysis with: extraction, a **salary gauge with a stated basis**,
  job-fit skill coverage (matched + missing tiers), soft signals, and a **verdict**.
- The verdict + salary number are defensible: Petra/Eva would stake their name on
  the basis. **No skill appears that isn't in the CV** (no hallucinated coverage).
- A real JD is in play, so job-fit is against *this* role, not a generic rubric.

## Entry state / preconditions
- Dev gate on → workspace at `/`, Analyze tab.
- A real CV file/paste + a real ČS JD (uploaded, pasted, or picked from the saved
  JD library via the saved-JD picker).
- Gemini key present (extraction + analysis are Gemini-backed); else `scope_note`.

## What L1 must check (structural, code-grounded)
- **Surface model:** the intake (drop/paste/upload CV + JD, report-language select,
  grounding/blind toggles) in `app/features/sub_analyze/AnalyzeForm.tsx` →
  `runAnalysis.ts` → POST `/api/analyze`. Result panels render from
  `app/_components/results/ResultPanel.tsx` (extraction/salary/job-fit/interview/compare tabs).
- **Grounding audit (central):** `/api/analyze/route.ts` carries the **real JD** into
  the run — `jobDescriptionText`/`jobDescriptionFile`/`jdSlug` (`route.ts:34-38`) plus a
  company overview, and a `grounding` flag (`route.ts:33`). Confirm the full CV + the
  real JD reach the Python pipeline (`analyze-run.ts` → `pipeline.jobfit`), not a sample.
  The salary path: is the gauge grounded in `data/salary_benchmarks.json` / the role band,
  or a free-floating LLM guess? (rubric calls thin-context the headline AI defect.)
- **Job-fit honesty:** matched/missing skills come from the deterministic taxonomy
  matcher, not the LLM narration — verify the chips in `results/job-fit/SkillChips.tsx`
  trace to extracted+JD skills, so a "matched" skill can't be invented.
- **GitHub evidence (Eva):** optional `/api/github-analysis` enrichment — confirm it's
  pulled into the same analysis, not a disconnected panel.
- **Reachability:** both Characters reach Analyze (no role gating); history at
  `app/features/sub_history/HistoryTab.tsx` lists prior runs — needs at least one
  saved analysis to be non-empty.

## What L2 must confirm (live-only)
- l2_priority: run a real CV+JD and read every panel. Assert the **salary number cites
  a basis** (band/benchmark, not vibes) and the **verdict references the JD's must-haves**.
- Adversarially check job-fit: every "matched" skill must be findable in the CV text —
  any invented skill is a senior-quality `quality-gap` (blocker if Eva would be embarrassed).
- Latency: a full analysis is a long Python+Gemini task started as a background task
  (`startTask("analyze")`, `route.ts:124`) — it survives navigation; budget **30–130s**
  and confirm the Tasks indicator tracks it. An early timeout = finding.
- Re-run the same CV with the **report-language** override (cs↔en) and confirm the
  narrative comes back in that language and is cache-correct.

## Out of scope / known
- Adding the candidate to the pipeline from the result panel → `pipeline-advance.md`.
- Group/side-by-side comparison of *multiple* candidates → `group-eval-fairness.md`.
- Keyless run: extraction/analysis degrade; tag `scope_note`, judge structure only.
