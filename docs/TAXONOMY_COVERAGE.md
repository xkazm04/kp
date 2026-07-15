# Taxonomy coverage

**Generated file — do not hand-edit.** Regenerate with `python -m pipeline.jobfit.taxonomy_check --write-report` (or `npm run taxonomy:report`).

Per-role-family coverage of `data/taxonomy.json`. A term counts toward every family it votes for; _skill terms_ are those tagged `skill` (the vocabulary `score_skills` and role-family classification consume). `% with parents` is the share of a family's terms carrying a `parents` edge (partial-credit hierarchy); _bilingual_ counts terms with >=2 distinct surface forms. _Bilingual parity_ additionally counts terms flagged `bilingual_exempt` — proper nouns / product, tool and language names (python, docker, kubernetes, tableau) written identically in Czech and English JDs, so they are bilingual-by-nature rather than missing a translation. The flag is explicit per-term (never inferred), so the parity number cannot be gamed by exempting a term that has a real Czech surface. The `floor N` annotations are the regression floors enforced by `tests/test_taxonomy_coverage_gate.py`.

| Role family | Skill terms | Total terms | % with parents | Bilingual (>=2 forms) | Bilingual parity |
| --- | ---: | ---: | ---: | ---: | ---: |
| `software_engineering` | 83 (floor 83) | 83 | 24% | 47 (57%) | 83 +36 exempt (100%) |
| `data_ai` | 38 (floor 38) | 38 | 18% | 21 (55%) | 38 +17 exempt (100%) |
| `product_project` | 28 (floor 28) | 29 | 7% | 25 (86%) | 29 +4 exempt (100%) |
| `healthcare_clinical` | 44 (floor 44) | 47 | 85% | 47 (100%) | 47 (100%) |
| `life_sciences_research` | 38 (floor 38) | 39 | 51% | 39 (100%) | 39 (100%) |
| `skilled_trades` | 40 (floor 40) | 43 | 72% | 43 (100%) | 43 (100%) |
| `operations_logistics` | 40 (floor 40) | 45 | 42% | 45 (100%) | 45 (100%) |
| `frontline_service` | 33 (floor 33) | 37 | 73% | 37 (100%) | 37 (100%) |
| `sales_marketing` | 39 (floor 39) | 41 | 37% | 41 (100%) | 41 (100%) |
| `finance_accounting` | 54 (floor 54) | 57 | 61% | 57 (100%) | 57 (100%) |
| `legal_compliance` | 46 (floor 46) | 48 | 79% | 47 (98%) | 48 +1 exempt (100%) |
| `hr_people` | 48 (floor 48) | 49 | 76% | 49 (100%) | 49 (100%) |
| `education_academic` | 37 (floor 37) | 38 | 82% | 38 (100%) | 38 (100%) |
| `creative_design` | 41 (floor 41) | 43 | 53% | 38 (88%) | 43 +5 exempt (100%) |
| `customer_support` | 37 (floor 37) | 38 | 37% | 38 (100%) | 38 (100%) |
| `general_professional` | 29 (floor 29) | 32 | 22% | 32 (100%) | 32 (100%) |

_Total terms: 676._
