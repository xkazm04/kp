> Total: 5 findings (0c critical, 1h high, 1m medium, 3l low)

## 1. Two hard-coded field-label maps for the same 6 default questionnaire keys
- **Severity**: High
- **Category**: duplication
- **File**: app/features/sub_onboarding/OnboardingTab.tsx:409-416 (`fieldLabels`) + app/onboarding/[token]/page.tsx:21-28 (`FIELD_LABEL`)
- **Scenario**: Both files keep a literal map of the SAME six default questionnaire keys (`preferredName, tshirtSize, dietaryNeeds, equipmentPrefs, emergencyContact, startDateConfirm`) to i18n keys, used to localize the per-template questionnaire fields. The recruiter tab resolves via `t("field.preferredName")` etc.; the candidate page via `t("fieldPreferredName")` etc. Verified the key sets are identical and both originate from `DEFAULT_QUESTIONNAIRE` (onboarding.ts:33-40) — the field list itself is already shared/centralized, but the localization tables are not. Verified via grep `fieldLabels|FIELD_LABEL` (only these two sites) and the en.json blocks (`onboarding.field` and `candidateOnboarding.field*` carry the same six labels twice).
- **Root cause**: The questionnaire moved from a frozen const to per-template data (P1-4), but the "localize the known default keys" logic was copy-pasted into each render surface instead of derived from one source. The two i18n namespaces (`onboarding.field.*` vs `candidateOnboarding.fieldXxx`) make the duplication look intentional.
- **Impact**: Add/rename a default field and you must touch four places (the const, both maps, both en.json + cs.json blocks) or labels silently fall back to the raw authored label on one surface only. Already drifting: `startDateConfirm` reads "Confirmed start date" (recruiter) vs "Confirm your start date" (candidate) in en.json — the maps let those diverge unnoticed.
- **Fix sketch**: Export one canonical `DEFAULT_FIELD_I18N_KEY: Record<string,string>` from `onboarding.ts` (key -> a single i18n key under a shared namespace), and have both components do `messages[map[field.key]] ?? field.label`. Or, minimally, document that the candidate map is intentionally a separate namespace and add a unit test asserting both maps cover exactly `DEFAULT_QUESTIONNAIRE.map(f=>f.key)` so drift is caught.

## 2. Dead type alias `EntryQuestionnaireField`
- **Severity**: Low
- **Category**: dead-code
- **File**: app/_lib/onboarding.ts:44
- **Scenario**: `export type EntryQuestionnaireField = string;` is declared and never referenced anywhere. Confirmed with `grep -rn "EntryQuestionnaireField"` across the whole repo (`*.ts`/`*.tsx`): the only hit is the declaration line itself; the exclusion grep returned no matches (exit 1).
- **Root cause**: Left over from the pre-P1-4 era when questionnaire fields were a fixed union of keys; when fields became free-form data this alias was superseded by `QuestionnaireField`/`string` but not removed.
- **Impact**: Trivial, but it's a misleading public export that implies a constrained field type that no longer exists.
- **Fix sketch**: Delete line 44. No call sites to update.

## 3. Stale comment: candidate page claims fields are "the canonical ENTRY_QUESTIONNAIRE_FIELDS"
- **Severity**: Low
- **Category**: cleanup
- **File**: app/onboarding/[token]/page.tsx:18-20
- **Scenario**: The comment above `FIELD_LABEL` says it is "Driven by the server's `fields` list (the canonical ENTRY_QUESTIONNAIRE_FIELDS) so the two can't drift". As of P1-4 the server sends the run's PER-TEMPLATE questionnaire (`onboarding-candidate.ts:41` -> `detail?.questionnaire`), not `ENTRY_QUESTIONNAIRE_FIELDS`. Confirmed `ENTRY_QUESTIONNAIRE_FIELDS` has no production consumer (grep: only its declaration, this comment, and the test reference it).
- **Root cause**: Comment not updated when the questionnaire became editable per-template data.
- **Impact**: Misleads a future reader into thinking the candidate fields come from a global const; obscures that custom template fields legitimately fall back to `field.label`.
- **Fix sketch**: Reword to: fields come from the run's per-template questionnaire; `FIELD_LABEL` only localizes the known default keys and any other key renders its authored label.

## 4. `ENTRY_QUESTIONNAIRE_FIELDS` is exercised only by its own test
- **Severity**: Low
- **Category**: dead-code
- **File**: app/_lib/onboarding.ts:43 (+ test app/_lib/onboarding.test.ts:82-84)
- **Scenario**: This back-compat export ("some call sites + tests reference these") has no remaining call site. Confirmed via grep across `app/`: production hits are the declaration (line 43) and a stale comment (page.tsx:19, see finding #3); the only real consumer is the test asserting it mirrors `DEFAULT_QUESTIONNAIRE` keys — a tautology now (the export is literally `DEFAULT_QUESTIONNAIRE.map(f=>f.key)`).
- **Root cause**: Kept as a compatibility shim during the const->data migration; the call sites it shimmed were all migrated to per-template data but the export (and its self-referential test) stayed.
- **Impact**: Low — a dead public export plus a test that can never fail. Minor surface area / false sense of coverage.
- **Fix sketch**: If no external/string consumer is planned, drop the export and its test, or downgrade the comment from "some call sites + tests reference these" to "kept for tests only". Verify no dynamic/string usage first (none found).

## 5. `EditableRows` uses array index as React key
- **Severity**: Low
- **Category**: cleanup
- **File**: app/features/sub_onboarding/OnboardingTab.tsx:227
- **Scenario**: The shared task/question editor maps rows with `key={i}` (the array index) over a mutable, reorderable-by-deletion list (`onChange(items.filter((_, j) => j !== i))` at line 238). Deleting a middle row shifts every subsequent index, so React reuses inputs by position rather than identity. The module-level comment (line 211-212) explicitly hoisted this component "so typing doesn't remount the inputs / lose focus" — index keys partially undermine that intent on add/remove.
- **Root cause**: Rows are plain `string[]` with no stable id, so index was the convenient key.
- **Impact**: Low (the list is small and inputs are controlled), but deleting a row can momentarily carry a stale value/cursor into the shifted input. A latent footgun for the very focus-stability the comment cares about.
- **Fix sketch**: Either accept it (small, controlled) or give rows a stable id (`{id, value}[]`) and key on `id`. Keep as Low unless the editor grows; noting it because the surrounding comment signals focus stability was a deliberate goal.
