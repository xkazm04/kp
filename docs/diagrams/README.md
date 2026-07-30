# Architecture diagrams

PlantUML sources that trace how **kp** works "in the background" for each major use —
both the current single-analysis app (**v1**) and the target **v2** matching platform
with student / early-career support.

These diagrams are the visual companion to [`../_archive/v2-plan.md`](../_archive/v2-plan.md). Read the plan
for the narrative; read these for the data flow.

## Index

| # | File | Kind | What it shows |
|---|------|------|---------------|
| 01 | `01-system-architecture-v1.puml` | Component | The app as it exists today (single CV → single JD → one Gemini call). |
| 02 | `02-system-architecture-v2.puml` | Component | Target v2: job-ad ingestion, matching engine, candidate archetypes, taxonomy graph, stores. |
| 03 | `03-domain-model-v2.puml` | Class | v2 data model: Candidate, Profile (per archetype), Evidence, Job, Requirement, Match, Taxonomy. |
| 04 | `04-bau-candidate-analysis-v1.puml` | Sequence | **Use: analyze one candidate (today's flow).** Browser → API → Python → Gemini → persist → render. |
| 05 | `05-job-ingestion-pipeline.puml` | Activity | **Use: ingest a job ad at scale.** Raw posting → structured requirements → normalize → entry-eligibility. |
| 06 | `06-bau-matching-pipeline.puml` | Sequence | **Use: match an experienced candidate to many jobs.** KO filters → multi-factor scoring → reasoning → rank. |
| 07 | `07-archetype-detection.puml` | Activity | **Use: route a new candidate.** BAU vs Student/Early-career vs Career-switcher. |
| 08 | `08-student-intake.puml` | Activity | **Use: a student builds a profile.** Auto-extract + guided form + confirm; completeness model. |
| 09 | `09-student-transformation.puml` | Activity | **Use: make student data comparable to JDs.** The bridge: evidence → skills+provenance → potential → JD reframe. |
| 10 | `10-student-scoring-reasoning.puml` | Sequence | **Use: score + reason about a student.** Re-weighted dimensions, confidence band, student-specific reasoning. |
| 11 | `11-recruiter-outputs.puml` | Activity | **Use: a recruiter reviews matches.** Archetype-aware cards, provenance, potential, fair-comparison lens. |
| 12 | `12-career-switcher.puml` | Activity | **Bonus use: career-switcher transformation.** Transferable-skills bridge across domains. |

## Rendering

These are plain PlantUML text files. Any of:

```bash
# VS Code: "PlantUML" extension → Alt+D to preview the open file.
# CLI (needs Java + plantuml.jar):
plantuml docs/diagrams/*.puml          # → PNG next to each source
plantuml -tsvg docs/diagrams/*.puml    # → SVG
# No install: paste a file into https://www.plantuml.com/plantuml
```

> Convention: v1 (current) elements are drawn plainly; **v2-new** elements are tagged
> `<<v2>>` and tinted so the diff between "what exists" and "what we build" is visible at a glance.
