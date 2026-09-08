# Recipe candidates from ingested job descriptions

Status: scaffold. `pipeline/jobfit/eval/recipe_candidates.py` post-processes the
`job_postings` corpus into a recipe-candidate digest (`.ai/recipe-candidates.jsonl`
plus a markdown summary) shaped for the AI registry's `/assay` intake. This page
is filled in by the work package that lands the script; until then it exists so
the source → doc map (`scripts/docs/feature-doc-map.json`) names a real file.
