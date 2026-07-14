# Taxonomy coverage

**Generated file — do not hand-edit.** Regenerate with `python -m pipeline.jobfit.taxonomy_check --write-report` (or `npm run taxonomy:report`).

Per-role-family coverage of `data/taxonomy.json`. A term counts toward every family it votes for; _skill terms_ are those tagged `skill` (the vocabulary `score_skills` and role-family classification consume). `% with parents` is the share of a family's terms carrying a `parents` edge (partial-credit hierarchy); _bilingual_ counts terms with >=2 distinct surface forms. The `floor N` annotations are the regression floors enforced by `tests/test_taxonomy_coverage_gate.py`.

| Role family | Skill terms | Total terms | % with parents | Bilingual (>=2 forms) |
| --- | ---: | ---: | ---: | ---: |
| `software_engineering` | 83 (floor 83) | 83 | 22% | 47 (57%) |
| `data_ai` | 39 (floor 39) | 39 | 18% | 15 (38%) |
| `product_project` | 28 (floor 28) | 29 | 0% | 20 (69%) |
| `healthcare_clinical` | 0 | 3 | 0% | 3 (100%) |
| `life_sciences_research` | 0 | 1 | 0% | 1 (100%) |
| `skilled_trades` | 0 | 3 | 0% | 3 (100%) |
| `operations_logistics` | 40 (floor 40) | 45 | 42% | 45 (100%) |
| `frontline_service` | 0 | 4 | 0% | 4 (100%) |
| `sales_marketing` | 39 (floor 39) | 41 | 37% | 41 (100%) |
| `finance_accounting` | 46 (floor 46) | 49 | 55% | 49 (100%) |
| `legal_compliance` | 0 | 2 | 0% | 2 (100%) |
| `hr_people` | 0 | 1 | 0% | 1 (100%) |
| `education_academic` | 0 | 1 | 0% | 1 (100%) |
| `creative_design` | 0 | 2 | 0% | 2 (100%) |
| `customer_support` | 37 (floor 37) | 38 | 37% | 38 (100%) |
| `general_professional` | 0 | 3 | 0% | 3 (100%) |

_Total terms: 337._
