# High Fix Wave 11 — i18n drift (hardcoded English in a bilingual app)

> 4 i18n findings closed (3 High + 1 Medium) in 2 commits. Theme: *deterministic UI chrome
> must localize with the rest of the app.* Baseline preserved: tsc **0**, `next build` ✓,
> unit **1019/1019**, i18n parity (2877 keys, en/cs).

## Commits

| Commit | Findings | Fix |
|---|---|---|
| `891a50d` | cv-analysis (column labels) | The CV/job/company/GitHub column status pills hardcoded "Required" / "Optional" / "N variants" / "N chars". Switched to the **existing** `analyze.*` keys (required / optional / cvVariants / charsCount) — no new strings needed. |
| `f343112` | cv-analysis (progress) + analysis-result (compare, factor chart) | **AnalysisProgress** (the prominent live screen) — stage labels, headlines, "Progress", "Cancel scan" → `analyze.stages.*` + `analyze.*` (the module-level `STAGE_LABEL` became literal-key maps, since next-intl rejects template keys). **FactorChart** axis labels + "Points" tooltip → new `report.factor*` keys. **CompareTab** chrome — title/subtitle, "Recommended", table + component/metric row labels, the four panel headings, empty states, "baseline", "— from" → `report.compare.*` (component rows reuse the `report.factor*` keys). |

## Deferred with reason
- **`comparison.ts` driver-insight prose + merged-recommendation summaries** — these ARE
  deterministic (templated sentences like `"A" leads "B" by N on job-fit score`), but they're
  **generated once at analysis time and cached into the analysis payload** as English strings.
  Localizing them needs a *structured-data refactor* (store the deltas/picks, template the
  sentences at render with the report locale) rather than a translator call. That's a separate
  effort, and leaving generated narrative in English while localizing the chrome is exactly
  kp's established i18n pattern ("localize chrome, keep the generated/LLM narrative as written").
- **JdBuilder market-salary `confidence` rendered raw** (the 5th i18n-tagged finding) — it's
  really a *visual-hierarchy* Medium (the figure has no emphasis), not hardcoded-English drift;
  out of scope for a localization wave.

## Pattern catalogue additions
42. **Reuse the catalog before adding keys.** The column-status labels already existed in the
    `analyze.*` namespace — the bug was the component not using them, not a missing translation.
43. **Module-level label maps can't call `t()`.** Move the lookup into the component and key it
    through a literal-key map (next-intl's key type rejects `t(\`prefix.${id}\`)` template keys).
44. **Localize deterministic chrome; leave cached/generated narrative.** Pre-generated prose
    stored in a payload needs a data-shape change to localize — localize the surrounding chrome
    now and refactor the generator separately.
