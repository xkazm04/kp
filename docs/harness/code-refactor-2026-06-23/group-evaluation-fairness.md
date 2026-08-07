> Total: 5 findings (0c critical, 0h high, 2m medium, 3l low)

## 1. Dead payload fields written by the producer but never consumed
- **Severity**: Medium
- **Category**: dead-code
- **File**: app/_lib/group-eval-run.ts:443-484 (fields: `candidateCount`:453, `roleTitle`:444, `advisory`:451, `jobId`:445)
- **Scenario**: `runGroupEval` builds the persisted `payload` with several fields no consumer reads:
  - `candidateCount` — `grep -rn "candidateCount"` returns only the write at group-eval-run.ts:453; it isn't even declared on `GroupEvalPayload` (types.ts), and the one `RoleDecisionRow.tsx:35` hit is an unrelated i18n key `t("candidateCount", …)`.
  - `roleTitle` — the modal receives `roleTitle` as a *prop* (GroupEvalModal.tsx:24, fed from `evalRole.roleTitle` / `g.roleTitle` in DecisionsTab.tsx, never from the payload). `grep -rn "evaluation.roleTitle|payload.roleTitle"` over `app/features` is empty.
  - `advisory` — declared in types.ts:74 and documented as "flags that the topPick is a suggestion", but the modal renders governance solely via `evaluation.governanceNote` (GroupEvalModal.tsx:104). `grep -rn "advisory"` shows no group-eval consumer (only unrelated pipeline/tasks usages).
  - `jobId` — written at line 445, not on the type, and `grep` for `evaluation.jobId|payload.jobId|.jobId` in `app/features/sub_decisions/group-eval` + `GroupEvalModal.tsx` is empty.
- **Root cause**: Payload grew field-by-field across the P1-3 governance and coverage-bookkeeping waves; the producer kept emitting fields whose intended UI either never landed (`advisory`) or was satisfied another way (`roleTitle` via prop, governance via `governanceNote`).
- **Impact**: Persisted blobs carry stale data; readers/maintainers can't tell which fields are load-bearing, and the `advisory`/`roleTitle` type members imply a contract that no code honors.
- **Fix sketch**: Drop `candidateCount` and `jobId` from the written payload (neither is typed or read). For `roleTitle` and `advisory`, either remove the writes + the `roleTitle`/`advisory` members from `GroupEvalPayload` (types.ts), or wire `advisory` into the modal if the suggestion-vs-decision badge is still wanted. Keep `governanceMode`/`governanceNote`/`eligibilityList` — those ARE consumed.

## 2. `dimPercent` duplicates `percentOf` (same scoreBreakdown lookup, two copies)
- **Severity**: Medium
- **Category**: duplication
- **File**: app/_lib/group-eval-run.ts:150-151 (`dimPercent`) and app/features/sub_decisions/group-eval/helpers.ts:12 (`percentOf`)
- **Scenario**: Both are the identical lookup `c.scoreBreakdown?.find((d) => d.key === key)?.percent ?? null` — one on the server `PerCandidate`, one on the client `EvalCandidate`. `grep -rn "dimPercent|percentOf"` confirms `dimPercent` lives only in group-eval-run.ts (3 call sites) and `percentOf` only in the client (helpers + ComparisonTable + ComparisonCells). The two candidate types share the same `scoreBreakdown: ScoreDimension[]` shape (single-sourced from MatchTypes), so the logic is genuinely the same.
- **Root cause**: The skills-matrix percent lookup was needed independently on each side of the server/client boundary and reimplemented rather than shared.
- **Impact**: Two copies of one rule to keep in step if `scoreBreakdown`'s shape or the "missing dim → null" semantics ever change.
- **Fix sketch**: Generic-ify into a single tiny helper, e.g. `percentOf<T extends { scoreBreakdown?: { key: string; percent: number }[] }>(c: T, key: string)` in a boundary-neutral module (helpers.ts is client-only/JSX-free, so it could be imported by the server too), and delete `dimPercent`. Low risk — pure function, well covered by visual use. Only do this if you're comfortable importing a `group-eval/` helper into `_lib`; otherwise leave as-is (acceptable cross-boundary dup).

## 3. `useGroupEval.decide` parameter named `label` but actually receives an identity
- **Severity**: Low
- **Category**: cleanup
- **File**: app/features/sub_decisions/group-eval/useGroupEval.ts:29-37 (also `decided` map keyed as `[label]`)
- **Scenario**: `decide(label, action)` and `if (decided[label])` / `setDecided((d) => ({ ...d, [label]: action }))` all name the key `label`, but every caller passes `candIdentity(c)` (entryId, label fallback): `PerCandidateTabs.tsx:84,91` call `onDecide(candIdentity(c), …)` and read `decided[candIdentity(c)]` (lines 164,192). So the value flowing through is the *identity*, not the display label. The keys are consistent (no bug), but the name lies — and the whole point of the `candIdentity` indirection (types.ts:59-62) is that a duplicate display label must NOT key a decision.
- **Root cause**: Code predates the entryId/`candIdentity` hardening; the parameter wasn't renamed when callers switched from label to identity.
- **Impact**: A maintainer reading `useGroupEval` could reasonably believe decisions are keyed by display label and "fix" a caller to pass `c.label`, reintroducing the exact same-name-collision bug the indirection guards against.
- **Fix sketch**: Rename the param and map key `label` → `identity` in useGroupEval.ts (decide signature, the guard, the setState). Pure rename, no behavior change.

## 4. `PerCandidateTabs.onDecide` signature still typed/named `(label, …)`
- **Severity**: Low
- **Category**: cleanup
- **File**: app/features/sub_decisions/group-eval/PerCandidateTabs.tsx:48 and :149 (also CandidateDetail prop :48)
- **Scenario**: Both `onDecide?: (label: string, action…)` declarations name the first arg `label`, yet the component invokes them with `candIdentity(c)` (lines 84, 91). Same drift as finding 3, on the consuming side. Confirmed via grep: the only `onDecide(...)` call sites in this file pass `candIdentity(c)`.
- **Root cause**: Same as 3 — naming not updated alongside the identity migration.
- **Impact**: Reinforces the misleading "decisions key on label" mental model across the two files that own the decide flow.
- **Fix sketch**: Rename the `label` param to `identity` in the two `onDecide` type signatures (and `CandidateDetail`'s `onDecide`). Keep in sync with finding 3's rename. No behavior change.

## 5. Stale doc comment in useGroupEval describes the OLD (now-fixed) keying
- **Severity**: Low
- **Category**: cleanup
- **File**: app/features/sub_decisions/group-eval/useGroupEval.ts:24-26 (and the `decide` comment block 31-34)
- **Scenario**: The comment on `decided` says "their buttons flip to a result pill" keyed by candidate, and the decide block reasons in terms of a candidate "label" ("already acted this session", "the candidate has left the live pool, onDecide no-ops"). With findings 3/4 the surrounding code keys on identity, so the prose's repeated "label" framing is now inaccurate shorthand. Minor, but it's the same label/identity confusion in human-readable form sitting right next to the code.
- **Root cause**: Comments carried over from the pre-`candIdentity` version.
- **Impact**: Documentation drift; compounds the risk in findings 3/4 that someone "corrects" the code toward label-keying.
- **Fix sketch**: When renaming for finding 3, touch up the adjacent comments to say "identity (entryId, label fallback)" instead of "label". Cosmetic.

---
Note: `LegacyView` (group-eval/LegacyView.tsx) is NOT dead — it is the `enriched === false` fallback rendered at GroupEvalModal.tsx:140 (job-less roles / old saved evals / the simulation's loading payload). `sanity-checks.ts` is also out of scope as "this context's" code — it's a shared analysis-trust module consumed by QualityStrip, analyze-run, provenance-dossier, and db core (verified via grep); it is not group-eval-specific and is fully used.
