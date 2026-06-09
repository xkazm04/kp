# Candidate Profile Builder — UI+Bug combined scan
> Total: 4 findings (0 crit / 2 high / 2 med / 0 low)
> Group: Candidate Analysis & Scoring | Lens mix: 3 bug / 1 ui | Files read: 11

## 1. Deep-link editor open is cancelled by its own param-clear (self-aborting fetch)
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: `app/features/sub_profile/ProfileTab.tsx:48`
- **Scenario**: A recruiter follows the pipeline-drawer deep link `?tab=profile&edit=<candidateId>`. The effect first calls `router.replace(buildUrl({ edit: null }, ...))` to strip the param, then fires `fetch("/api/profile?id=...")`. `router.replace` mutates `useSearchParams()`, whose new identity is a dependency of this very effect, so React re-runs the effect almost immediately — long before the network fetch resolves. The re-run reads `editId === null` and returns early, but on the way in React runs the **previous** run's cleanup (`return () => { alive = false }`), flipping run-1's `alive` to `false`. When run-1's fetch finally resolves, `if (alive)` is false, so neither `setEditor(...)` nor the catch's `setNote(...)` fires.
- **Root cause**: The effect both *writes* a dependency it reads (`params`) and guards its async continuation with an `alive` flag that the dep-change-triggered cleanup tears down. Clearing the URL param and loading the profile are entangled in one effect keyed on `params`, so the cleanup that's meant to guard against unmount/stale-fetch instead reliably aborts the only successful run.
- **Impact**: The primary entry point into the profile editor from the pipeline silently does nothing — no editor, no error banner. The user sees the plain Profile tab and assumes the link is broken. Intermittent only in that it depends on `replace` re-rendering before fetch resolves, which is effectively always true.
- **Fix sketch**: Decouple the param-clear from the load. Read the `edit` id once (e.g. capture it before clearing, or split into two effects: one that records the id into local state and clears the URL, a second keyed on that local id that does the fetch). Do not key the fetch effect on `params`. Alternatively, clear the param *after* the editor opens (in the `.then`), so the in-flight fetch is never the casualty of its own URL rewrite.

## 2. POST/PUT forward unvalidated client JSON to the Python CLI (years coerces to NaN→null silently)
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: validation-gap
- **File**: `app/api/profile/route.ts:89`
- **Scenario**: The handler does `const body = (await request.json()) as {...}` and passes `body.profile ?? {}` / `body.signals ?? {}` straight into `routeAndScore`, which `JSON.stringify`s them into the CLI intake. Nothing checks that `profile` is an object (not a string/array), that `skillClaims`/`evidence` are arrays, or that `yearsExperience` is numeric. The client form normally guards `yearsExperience` (regex at `ProfileEditor.tsx:204`), but the AI-draft path (`applyDraft`) and any direct API caller bypass it. `archetypeScopedProfileFields` does `Number(yearsExperience)` (`ProfileForm.ts:39`) with no `Number.isFinite` guard, so a non-numeric value becomes `NaN`, then `JSON.stringify` turns `NaN` into `null` — the years check silently fails and completeness drops with no error surfaced.
- **Root cause**: The route treats the request body as already-trusted (TS cast, not runtime validation) at a trust boundary, and the only structure/number validation lives in one of several client entry points rather than at the API seam.
- **Impact**: Malformed or adversarial bodies are serialized and fed to the subprocess; the most common real-world symptom is a profile whose completeness/archetype is wrong because a bad `yearsExperience` was coerced to `null` with no signal to the recruiter. Hardening here also protects against shape mismatches that currently rely on the CLI to reject.
- **Fix sketch**: Add a runtime schema validation (zod or a hand parser) for `profile`/`signals` at the top of POST/PUT — reject non-object profiles, non-array claim/evidence lists, and non-finite numeric fields with a 400. Make `archetypeScopedProfileFields` drop `yearsExperience` when `Number()` is not finite instead of emitting `NaN`.

## 3. Skill/evidence rows keyed by array index corrupt focus and identity on insert/delete
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: state-corruption
- **File**: `app/features/sub_profile/ProfileEvidenceColumn.tsx:22`
- **Scenario**: Both lists render `key={i}` (skills at line 22, evidence at line 56) while mutating state by index (`upd(...)`, `filter((_, j) => j !== i)`). When a recruiter removes a middle skill/evidence row, every row after it shifts down one index, but React reconciles by the stable index key — so DOM nodes (and their focus, text selection, and IME composition state) stay put while the data underneath them changes. The recruiter's cursor/selection ends up on a different row than the data they were editing; an in-progress IME composition (e.g. Czech diacritics) can be committed to the wrong field.
- **Root cause**: Index is used as the React key for a reorderable/removable controlled-input list. Index keys are only safe for append-only, never-reordered lists; these are neither.
- **Impact**: Editing-while-removing produces surprising focus jumps and, with IME, can attach typed text to the wrong row — a data-integrity hazard on a form whose entire purpose is faithful evidence capture. Also forces unnecessary re-mounts/re-renders.
- **Fix sketch**: Give each `SkillRow`/`EvidenceRow` a stable client id at creation (e.g. `crypto.randomUUID()`), store it on the row object, and key on it. Then index-based `upd`/`filter` only touch data, and React preserves the correct DOM node per row.

## 4. Result completeness meter uses a 2-tier color while the rest of the app uses 3 tiers
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: visual-inconsistency
- **File**: `app/features/sub_profile/ProfileResultPanel.tsx:29`
- **Scenario**: The completeness `Meter` is toned with `pct >= 70 ? "strong" : "weak"` — a hard binary. Everywhere else, score bars/dials/badges derive tone from the shared `scoreTone()` (`app/_lib/format.ts:337`), which is a 3-tier scale (`strong` / `mid` / `weak`) using the `--color-score-*` tokens. A 55–69% profile here renders in the alarming "weak" red, whereas the same range elsewhere in the product reads as amber "mid". A recruiter comparing a 65%-complete profile against a 65% match score sees two different colors for the same magnitude.
- **Root cause**: This panel re-derives tone with an ad-hoc inline threshold instead of routing through the single source of truth (`scoreTone`), so it can't track the app's tier boundaries or the shared color tokens.
- **Impact**: Inconsistent, slightly misleading severity signaling on a recruiter-facing metric; the binary cutoff over-penalizes mid-range completeness and drifts whenever the shared thresholds change.
- **Fix sketch**: Replace the inline ternary with `tone={scoreTone(pct)}` (or the project's percent-aware equivalent) so the completeness bar uses the same three tiers and `--color-score-*` hues as every other score surface, and re-tones automatically with the rest of the app.
