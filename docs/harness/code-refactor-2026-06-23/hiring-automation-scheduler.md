> Total: 6 findings (0c critical, 2h high, 3m medium, 1l low)

## 1. `reject_mode` / `RejectMode` "auto" path is fully dead since AUTO1 was retired
- **Severity**: High
- **Category**: dead-code
- **File**: app/_lib/scheduler-store.ts:71,79,97-100,156-165 (column ADD at :62-66); app/api/automation/schedule/route.ts:49,56-61; app/features/sub_pipeline/SchedulerControl.tsx:29-31,202,317-324
- **Scenario**: AUTO1 ("auto" = apply rejections unattended) was deliberately retired (UAT M6 / GDPR Art. 22). The retirement is now *partial* and the dead "auto" half is still threaded through three layers:
  - `rowToSchedule` (:97-100) ALWAYS returns `rejectMode: "approve"` regardless of the stored column, so `getSchedule` can never report "auto".
  - `setRejectMode(name, mode)` still has the live branch `mode === "auto" ? "auto" : "approve"` (:160) and the `RejectMode = "auto" | "approve"` type (:71) — but grep shows its ONLY caller is the schedule route (:60), which hard-codes `setRejectMode(POLICY_JOB, "approve")` and discards the inbound value entirely (:56-60). So the "auto" arm of the ternary is unreachable.
  - The UI type still declares `rejectMode?: "auto" | "approve"` (SchedulerControl.tsx:31,202) and the comment (:29-30) describes "auto" as a selectable posture, but the control (:321-324) only ever *renders* "approve" as a stated fact and never sends `rejectMode:` (grep: zero `rejectMode:` payloads).
  - Verified: `grep -rn "setRejectMode\|RejectMode\|rejectMode"` — no caller ever supplies/stores/reads "auto".
- **Root cause**: AUTO1 was retired by neutering behavior (coerce-to-approve at read + at the route) instead of removing the now-meaningless mode plumbing, leaving a half-migration.
- **Impact**: A reader (and the fairness/GDPR reviewer) sees a live "auto" code path, type, DB column, and UI prop and reasonably believes unattended auto-reject is still selectable. The `reject_mode` column persists a value nothing reads. High confusion-cost on the single most legally-sensitive automation knob.
- **Fix sketch**: Drop the `mode` parameter from `setRejectMode` (or remove the function + its route call), narrow `RejectMode` to `"approve"` or delete the type, drop the `rejectMode` prop from SchedulerControl, and remove the `body.rejectMode` accept/coerce block in the route. Leave the additive `reject_mode` column migration in place (cheap, harmless) but stop writing it. Keep `rowToSchedule`'s hard-coded `"approve"` and a one-line comment.

## 2. `APPROVAL_KIND_META` registry (+ `APPROVAL_KINDS`, `isApprovalKind`, `ApprovalKindMeta`) is exported but has zero consumers
- **Severity**: High
- **Category**: dead-code
- **File**: app/_lib/approval-kinds.ts:9-16 (APPROVAL_KINDS), :20-27 (ApprovalKindMeta), :32-63 (APPROVAL_KIND_META), :65-67 (isApprovalKind)
- **Scenario**: Whole-repo grep (`*.ts`/`*.tsx`/`*.py`, excluding node_modules/.next) shows `APPROVAL_KIND_META` is referenced ONLY at its own definition; `APPROVAL_KINDS` (the array) and `ApprovalKindMeta` (the type) only at their definitions + internally; `isApprovalKind` only inside `needsHumanDecision` in the same file. The only symbols actually imported elsewhere are the `ApprovalKind` *type* (db/core.ts, db/pipeline.ts) and `needsHumanDecision` (PipelineBoard, PipelineTab, attention.ts). The ~31-line `APPROVAL_KIND_META` documentation map — labels/surfacedBy/resolvedBy per kind — is never read by any UI or producer/consumer despite its docstring claiming "Producers... and consumers... should all agree with this."
- **Root cause**: Built as a "single documented taxonomy" intended to be wired into the Decisions/Schedule surfaces, but only the `ApprovalKind` union and the `needsHumanDecision` predicate were ever consumed; the metadata table is built-but-unwired.
- **Impact**: ~50 of the file's 75 lines are unused exports masquerading as a load-bearing registry. It drifts silently from reality (e.g. the meta describes resolution flows nothing validates against), and invites future readers to "keep it in sync" with no compiler/test enforcement.
- **Fix sketch**: Either (a) delete `APPROVAL_KIND_META`, `ApprovalKindMeta`, and `isApprovalKind`'s public export, keeping only `APPROVAL_KINDS` (needed for the `ApprovalKind` type) + `needsHumanDecision`; or (b) if the doc value is wanted, wire `APPROVAL_KIND_META` into the Decisions UI labels so it earns its keep. Keep `APPROVAL_KINDS`/`ApprovalKind`/`needsHumanDecision` regardless. Confirm no `.md`/script reads it before removal.

## 3. Dead `--strengths-json` outreach path in the automation CLI
- **Severity**: Medium
- **Category**: dead-code
- **File**: pipeline/jobfit/automation_cli.py:82 (arg decl), :131 (consumed); usage site app/_lib/automation-run.ts:150-181 (arg build never adds it)
- **Scenario**: The CLI declares `--strengths-json` and the `outreach` branch reads it (:131, falling back to `m.matched_skills`). But the only programmatic caller, `runAutomationTask` in automation-run.ts, builds its arg list at :150-181 and never pushes `--strengths-json` (verified: `grep -rn "strengths-json\|strengths_json"` over `app`/`pipeline` returns only the CLI declaration; the outreach branch at automation-run.ts:270 passes no strengths). So in production outreach always falls through to `m.matched_skills`; the flag is reachable only by a hand-run CLI command.
- **Root cause**: The CLI was modeled on `reasoning_cli.py` and kept a strengths override the TS seam never adopted (outreach instead derives strengths from the match result Python already computes).
- **Impact**: Minor — a documented-but-unused CLI surface area. Low risk, but it implies an integration that doesn't exist and is one more arg to maintain/test.
- **Fix sketch**: If no out-of-band CLI use is intended, drop the `--strengths-json` arg + the `args.strengths_json` read (let outreach always use `m.matched_skills`). If kept for manual/eval use, add a one-line comment noting the TS seam never sets it.

## 4. `markStaleSkip` vs. `applyFairnessVerdict` divergent dry-run handling of stale skips (asymmetry, not shared)
- **Severity**: Medium
- **Category**: duplication
- **File**: app/_lib/automation-pass.ts:39-43 (markStaleSkip), :226-242 (dry-run loop) vs :250-326 (commit loop)
- **Scenario**: The module's stated design (header comment :25-43) is that the dry-run preview and the commit loop share "THE single encoding" so the preview provably matches the commit. `applyFairnessVerdict` achieves this for the fairness downgrade. But the *stale-skip* outcome (`markStaleSkip`) and the *queued-for-approval* outcome only exist in the commit loop; the dry-run loop (:226-242) tallies `advance`/`reject`/`hold` with no stale-skip or queue branch. The dry run therefore can report `summary.advanced += 1` (or `rejected`) for a decision the commit would turn into a stale no-op or a queued hold. This is the opposite of the spec-pinned "preview must match commit" guarantee — and the divergence is exactly because the per-action summary logic is duplicated across the two loops instead of shared the way `applyFairnessVerdict` is.
- **Root cause**: The summary-accumulation logic was inlined separately in each loop; only the fairness verdict got extracted into a shared helper, so subsequent hardening (stale-CAS, queue-for-approval) landed in the commit loop only.
- **Impact**: A dry-run forecast can over-count advances/rejects vs. what the commit will actually do — the same success-theater the `evaluated` counter and the shared `applyFairnessVerdict` were added to prevent. Maintenance: two copies of the per-decision tally to keep in step.
- **Fix sketch**: Extract a small `tallyDecision(d, summary, {preview})` (or a shared per-decision classifier) covering advance/reject(+fairness)/hold AND the queued/stale outcomes, and call it from both loops. At minimum, document in the dry-run loop that stale-CAS and approval-queueing are intentionally not previewed, so the asymmetry is a stated limitation rather than silent drift.

## 5. Repeated "JSON.parse with silent null fallback" helper duplicated in scheduler-store
- **Severity**: Medium
- **Category**: duplication
- **File**: app/_lib/scheduler-store.ts:87-92 (rowToSchedule lastSummary), :293-300 (listRuns `parse`)
- **Scenario**: `rowToSchedule` inlines a `try { JSON.parse(...) } catch { null }` for `last_summary_json` (:87-92); `listRuns` defines a local `parse` closure doing the identical thing (:294-300) and applies it to `summary_json` + `decisions_json`. Three call sites, two hand-rolled copies of the same parse-or-null logic in one file.
- **Root cause**: Each reader grew its own defensive parse rather than a shared module-local helper.
- **Impact**: Low-moderate — small but genuinely duplicated; a change to parse behavior (e.g. logging on malformed JSON) must be made in two places. Consolidation is safe and obviously reduces maintenance.
- **Fix sketch**: Add a module-private `const parseJsonOrNull = (raw: unknown): unknown => { try { return raw ? JSON.parse(raw as string) : null; } catch { return null; } }` and use it in both `rowToSchedule` and `listRuns`.

## 6. Backwards-compatible `INTERVIEW_RUBRIC` alias kept alive only by its own test
- **Severity**: Low
- **Category**: dead-code
- **File**: pipeline/jobfit/automation.py:491-492
- **Scenario**: `INTERVIEW_RUBRIC = INTERVIEW_RUBRICS["experienced"]` is labeled "Backwards-compatible alias". Whole-repo grep for `INTERVIEW_RUBRID\b` shows production code uses only the plural `INTERVIEW_RUBRICS`; the single reference to the singular alias is `pipeline/jobfit/tests/test_interview_rubrics.py:42`, which merely asserts the alias equals `INTERVIEW_RUBRICS["experienced"]` (i.e. the test exists only to validate the otherwise-unused alias). No runtime caller, no TS mirror reads it.
- **Root cause**: Kept after the rubric set went from one flat rubric to a `{experienced, early_career}` dict, for callers that were all migrated to the plural.
- **Impact**: Minimal — a single line plus a self-referential test. Slight clutter; reads as a live compat surface that nothing depends on.
- **Fix sketch**: Remove the alias and the `test_backwards_compatible_alias` assertion (or, if any external/eval script might import it, leave it but drop the "Backwards-compatible" framing and note it's retained for ad-hoc imports only). Low priority.
