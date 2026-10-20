# Integration-gate baseline at eceef19e1 (before wave 1)

| Gate | Exit | Note |
| --- | --- | --- |
| tsc --noEmit | 2 | 25 errors, ALL under untracked foreign `kpi-sim/` (not in git; CI never sees it). Judge waves by errors outside kpi-sim/. |
| lint | 1 | 1 error, in `kpi-sim/runs/.../main-tree/...` (same foreign dir). 82 warnings. |
| lint:ts-ratchet | 0 | |
| i18n:check | 0 | 10011 strings per locale |
| design:check | 0 | |
| api:check | 0 | 246 routes |
| docs:check | 0 | |
| test:perf | 1 | PRE-EXISTING: llm-config.ts 322/320 KB, job-ingest.ts 403/400 KB. Judge waves by NEW overage lines. |
| test:unit | 0 | ~72s |
