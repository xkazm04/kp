# JD authoring: stated vs added (lite r1 rework)

**Must-address (ai-assisted-jd-authoring lite r1, head 9d98a74f):** "value: The generated JD can
state requirements the brief never made, and the author cannot tell."

**Data-path hole found:** keyless `languages: ["English"]` -> `ingest-job.ts:26` -> `job.languages`
-> `apply.ts:255` `ko_lang` knockout for every applicant.

## What changed
- A `design.py`: `role-design-v5`; fallback and `coerce()` return `languages: []`; grounding rule
  covers responsibilities, niceToHaves, languages. Tests in `test_devcase_design_stated.py`.
- B `jd-build-run.ts`: `statedLanguages` (brief wins; else model languages found in author input).
- C `jd-role-trace.ts`: `traceRoleLines`, `buildRoleTrace`; stored as `analysis_json.roleTrace`
  beside `fallbackReason`.
- D Ledger: `readRoleTrace` + `RoleTraceCard`, 9 `library.tab.roleTrace*` keys in 4 catalogs.
- E failure code: `JD_BUILD_NEED_TOO_SHORT` / `JD_BUILD_TITLE_TOO_SHORT` persisted (shipped inside the
  B commit, not a separate one).

## Trace rule (`overlap-v1`) and known misses
Normalise (NFD, strip marks, lowercase, tokens keep trailing +/#). <=3 tokens: contiguous run in the
input. Longer: >=2 content words and >=60% present. Misses (-> `added`): inflection, translation,
paraphrase. Over-trust (-> `brief`): negation reusing the author's words, substring of an unrelated phrase.

## Questions / not done (out of declared paths)
- `needTextFromBrief` / `DevNeed` do not pass `RoleBrief.languages` to the model; the override in
  `runJdBuild` makes the role right regardless, but the prompt never sees them.
- `pipeline/jobfit/devcase/source.py::role_to_job` still defaults languages to English for dev-case
  sourcing (same invention class); untouched per the brief.
- The marketing copy quoting `role-design-v4` in `messages/*.json` was left as instructed.
