# Group Evaluation & Fairness — ambiguity-guardian + ui-perfectionist scan

> Total: 6 findings (0 critical, 1 high, 4 medium, 1 low)

## 1. Comparison table crowns column 1 "Lead" even when the server crowned no lead
- **Severity**: High
- **Lens**: ui
- **Category**: false-lead-crown
- **File**: `app/features/sub_decisions/group-eval/ComparisonTable.tsx:181` (with the pill ternary at `ComparisonTable.tsx:33-39`)
- **Scenario**: A role's whole field fails knockout (or is below the min-cohort floor). The server correctly sets `topPick: null`, seals nothing, and the summary says "none pass the role's must-haves — no lead". Yet the enriched comparison table renders `isLead={i === 0}`, so the first column shows a moss Crown "Lead" pill — and because the ternary checks `isLead` first, that candidate's KO pill is suppressed by the very crown that shouldn't exist.
- **Root cause**: `CandidateHeader`'s lead flag is derived from column position, not from the payload's `topPick`/lead identity. The server-side "no lead to crown" cases (all-KO, insufficient sample) never reach the table, and the `isLead ? Lead : koPassed === false ? KO : null` ternary lets the positional crown mask the KO badge.
- **Impact**: A recruiter scanning the table sees a KO-failed (or lone, unrankable) candidate visually crowned as the recommended lead — directly contradicting the summary, the sealed record, and the whole REC-03/min-cohort honesty work. This is a wrong-decision cue in the primary comparison surface.
- **Fix sketch**: Thread the lead identity into `ComparisonTable` (e.g. `leadEntryId={evaluation.topPick ? candidates[0]?.entryId : null}` or pass `evaluation.topPick?.label`) and set `isLead` only when the candidate matches it. Reorder the pill logic so `koPassed === false` always shows the KO pill regardless of position. `GroupEvalModal.tsx:130` already has the payload in hand.

## 2. All-unscored (or tied) fields tint every column as the row winner
- **Severity**: Medium
- **Lens**: ui
- **Category**: leader-tint-sentinel
- **File**: `app/features/sub_decisions/group-eval/ComparisonTable.tsx:92-103` (sentinel at `:191`)
- **Scenario**: A field where no candidate has a fit score (all `score: null`, e.g. ranker failed and no stored matchScores) renders the Overall fit row with a dash in every cell — but every cell also gets the moss "winner" wash, because each unscored candidate maps to the `-1` sentinel and `-1 === Math.max(-1, -1, …)`.
- **Root cause**: `Row` computes `leader = Math.max(...leaderValue)` and marks every candidate equal to it. The `c.score ?? -1` sentinel (`:191`) was meant to stop an unscored candidate from *winning over* a scored one, but when everyone is unscored the sentinel itself becomes the max. Genuine top ties similarly wash multiple columns with no cue that it's a tie.
- **Impact**: The leader tint — the table's "scan straight down the winning column" affordance — asserts that every dash-scored candidate is simultaneously the front-runner, which reads as a rendering bug and undermines trust in the tint everywhere else (must-have coverage 0/0 rows behave the same way).
- **Fix sketch**: Suppress the tint when the computed leader is the sentinel (`leader < 0` for score rows) or when *all* values are equal — e.g. `const isMeaningful = leader != null && candidates.some(c => leaderValue(c) !== leader)`. Optionally render the tint on ties but add a shared-lead cue.

## 3. Lead's "Unique strengths" are matched to a tab by display label, not identity
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: label-identity-keying
- **File**: `app/features/sub_decisions/group-eval/PerCandidateTabs.tsx:114` (source of the gap: `topPick` payload at `app/_lib/group-eval-run.ts:602-612`)
- **Scenario**: Two candidates named "Jan Novák" are compared (the exact duplicate-name case `candIdentity` exists for). The lead's differentiator chips render via `topPick === c.label`, so *both* same-named tabs display "Unique strengths" — including the rival who matched none of them.
- **Root cause**: The whole decide/selection path was deliberately migrated to `candIdentity` (entryId), but `topPick` is persisted with only `{ label, score, why }` — no `entryId` — so the client has nothing better than the non-unique label to match against, and `GroupEvalModal.tsx:139` passes `evaluation.topPick?.label` down.
- **Impact**: A recruiter reading the duplicate-name rival's tab sees the lead's exclusive, role-relevant edge attributed to the wrong person — the precise wrong-person hazard the identity-keying refactor set out to eliminate, surviving in the one payload field it skipped.
- **Fix sketch**: Add `entryId` to the persisted `topPick` (additive, legacy payloads keep label fallback), pass `evaluation.topPick?.entryId ?? evaluation.topPick?.label` to `PerCandidateTabs`, and compare against `candIdentity(c)`. Same additive-fallback pattern already used by `evaluatedIds`/`comparedIds`.

## 4. Lower-fit risk gate `score > 0 && score < 55` — magic threshold, and a genuine 0 escapes the flag
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: magic-threshold-boundary
- **File**: `app/_lib/group-eval-run.ts:479`
- **Scenario**: A candidate the ranker scored 0 (measured, not null — the codebase is scrupulous about that distinction) gets *no* "lower fit — confirm must-haves" watch-out, while a candidate scoring 54 does. Meanwhile nothing explains why 55 is the cliff or how it relates to the fit tiers ("strong"/"promising"/"partial") the same payload carries.
- **Root cause**: `score > 0` was presumably written when 0 meant "unscored"; after REC-03 made unscored `null`, the guard now excludes the *worst measured* candidates from the risk list. The 55 constant is undocumented and independent of the fitTier thresholds, so the two "this candidate is weak" signals can disagree.
- **Impact**: The risk strip — presented as the eval's watch-outs and echoed into the sealed rationale — silently omits exactly the candidates most deserving of a warning, and future maintainers can't tell whether 55 is aligned with, or drifting from, the tier cutoffs.
- **Fix sketch**: Change the guard to `c.score != null && c.score < LOW_FIT_RISK_THRESHOLD` and hoist `55` into a named constant with a comment tying it to (or deliberately distinguishing it from) the fit-tier boundaries — ideally derive it from the same source recruiter_cli uses for `fitTier: "partial"`.

## 5. Persisted eval text is half-localized: comparison narrative honors the org locale, risks/summary/governance notes are hardcoded English
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: mixed-locale-payload
- **File**: `app/_lib/group-eval-run.ts:477-512` (also `app/_lib/group-eval-governance.ts:61-76`)
- **Scenario**: A Czech-locale workspace runs a group eval. The AI comparison headline/keyPoints arrive in Czech (`--lang getWorkspaceDefaultLocale()` at `group-eval-run.ts:238`), and every modal chrome string is translated via next-intl — but the risks strip, the deterministic summary/fallback verdict, `topPick.why`, and the governance banner render baked-in English from the payload.
- **Root cause**: `runGroupCompare` was given the workspace-locale treatment, but the sibling human-facing strings built in the same function (`risks[]`, `deterministicSummary`, `topPick.why`) and `governanceNote()` are string literals with no locale path; nothing documents whether payload text is contractually English or org-language.
- **Impact**: The same modal shows three languages' worth of provenance side by side; the governance note — compliance-critical copy about statutory preferences — is unreadable to a non-English committee. The sealed `rationale` inherits the English summary, so the audit record's language is also implicitly decided, undocumented.
- **Fix sketch**: Decide and document the contract. Cheapest honest fix: move risk/summary/governance rendering client-side — persist structured facts (`{kind:"low_fit", label, score}`, governanceMode) and let next-intl compose the sentences; the sealed rationale can stay English by stated convention. Alternatively thread `getWorkspaceDefaultLocale()` through these builders like the compare CLI already does.

## 6. FairnessPanel trusts parallel-array alignment of a persisted payload — a short `schemes` array crashes the whole modal
- **Severity**: Low
- **Lens**: ambiguity
- **Category**: parallel-array-trust
- **File**: `app/features/sub_decisions/group-eval/FairnessPanel.tsx:98` (also `matrix[i][j]` at `:121`)
- **Scenario**: A saved eval whose `fairness.schemes` (or a `matrix` row) is shorter than `labels` — a legacy payload, or a future ranker emitting a partial matrix — reopens from the store. `fmtScheme(schemes[j])` dereferences `undefined.skills` and the render throws, taking down the entire group-eval modal, not just the fairness section.
- **Root cause**: The type contract says "labels / candidateIds / schemes / own / mean align by index" (`types.ts:10-11`), but the panel renders a *persisted, unvalidated* JSON blob (`getGroupEval` only `JSON.parse`s) and indexes across four arrays with no length guard, while the guard at `:39` checks only `labels` and `matrix` non-emptiness.
- **Impact**: One malformed row in the `group_evals` store makes a role's evaluation permanently unopenable (every reopen re-crashes), and the recruiter loses the comparison table and decide buttons along with the fairness matrix — a disproportionate blast radius for an optional panel.
- **Fix sketch**: Harden the existing degenerate-state guard: bail to the "could not assess" branch when `schemes.length !== labels.length || matrix.length !== labels.length || matrix.some(r => r.length !== labels.length)`. Two lines, and it converts a modal crash into the honest "unavailable" copy the panel already has.
