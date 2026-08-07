# Dev Case Authoring & Publishing — bug-hunter + ui-perfectionist scan

> Context: Author developer hiring cases from a role need, orchestrate generation, and publish postings with apply tokens (the Dev tab).
> Files reviewed: 16 of 18
> Total: 5

## 1. A published case's seed/scenario is mutable and read per-request — a resumed lifecycle silently swaps the assignment under candidates mid-flight

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: state-corruption / race-condition
- **File**: `app/_lib/devcase-orchestrator.ts:142-223`, `app/_lib/db/devcase.ts:67-70` (`saveDevCaseSeed`), `app/devcase/apply/[token]/page.tsx:44-59`
- **Scenario**: The orchestrator's `approved` stage publishes (mints the posting + live token) FIRST (lines 154-158), then materializes the scenario and seed and OVERWRITES them in place via `saveDevCaseScenario`/`saveDevCaseSeed`, then advances to `collecting`. If the task dies before the `stage→collecting` write, `reconcile()` re-enqueues it (stage is still `approved`, non-terminal) — publish is skipped (postingId reused), but the seed/scenario are re-materialized and overwritten while the token has been live the whole time. `app/devcase/apply/[token]/page.tsx` reads `getDevCase(posting.caseId).seed` LIVE on every request, so a candidate who opened the case before the resume was handed seed v1; one who opens after gets seed v2 (LLM output is non-deterministic). There is also a window on the very first run where the token is live but the seed is not yet materialized → `seedFiles.length === 0` routes that candidate to the repo-link form instead of the LiveWorkSurface.
- **Root cause**: Publish is made idempotent (postingId reuse) but the seed/scenario materialization is not guarded and is not snapshotted into the posting/session at publish time — the case content the candidate sees is late-bound and re-writable after distribution.
- **Impact**: Two candidates on the same posting can receive different starter materials and even a different submission channel (repo vs live surface). Scores stop being comparable and the audit trail can't say which seed each candidate actually got — the core promise of a work-sample test.
- **Fix sketch**: Snapshot the seed+scenario onto the posting (or session) at publish and read the frozen copy on the apply page. Materialize the seed/scenario BEFORE creating the posting, and guard re-materialization behind "seed already present" so a resume never rewrites a live case.

## 2. Manual approve (`POST /api/devcase`) bypasses the probe-strength audit the lifecycle approve route enforces — no gate, no audit, no separation of duties

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: validation-gap / trust-boundary
- **File**: `app/api/devcase/route.ts:14-35`, `app/features/sub_dev/DevTab.tsx:323-340` (`approve`), contrast `app/api/devcase/lifecycle/[id]/approve/route.ts:56-69`
- **Scenario**: The Define-need → Analyze → Design → **Approve** flow POSTs the designed role+case to `POST /api/devcase`, which calls `saveDevCase` directly and returns. The hardened lifecycle approve route runs `auditProbeStrength(...)` and 422s a `verdict === "none"` case (recording any override in the audit trail). `POST /api/devcase` does NONE of that: a case whose probes can't tell a strong submission from a naive one is saved `status: 'approved'` with no audit row, and the same person who authored it can immediately publish it.
- **Root cause**: The probe-strength gate was added to one of two approve paths. The manual approve is a parallel, un-gated write to the same `dev_cases` table, so the hardening is trivially sidestepped.
- **Impact**: Non-discriminating cases ship to candidates; transfer scores off them are noise and the promote gate ranks at random — with zero record that the gate was skipped. Also defeats separation of duties (author == approver, unaudited).
- **Fix sketch**: Route both approve paths through one server helper that runs `auditProbeStrength` and records the audit row (with the override contract). Make `POST /api/devcase` reject a `none` verdict unless `overrideProbeAudit` is set and logged, exactly like the lifecycle route.

## 3. One-click Publish is irreversible, has no confirmation, and stays enabled on a known-degraded case

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: interaction-correctness / unguarded-destructive-action
- **File**: `app/features/sub_dev/CaseDetail.tsx:96-137`
- **Scenario**: The Publish button (`:119-126`) fires `publish(kase.id)` on a single click with no confirm dialog — it mints a live candidate-facing token and (via the lifecycle) proactively sources real candidates into the pipeline. It is `disabled={published || publishing}` only; the "interview scenario: template probes" and "seed: skeleton only" degraded pills rendered right beside it (`:96-117`) do NOT gate it, so an author publishes a case they've just been told is degraded with one unguarded click. Once `published`, the button reads a disabled "Published" with no unpublish/close affordance on this surface — the action can't be walked back here.
- **Root cause**: A consequential, effectively-irreversible action is treated as a plain button; the degraded-state signal is presentational only and never feeds the guard.
- **Impact**: Accidental or degraded publishes go live to candidates with no confirmation and no in-surface undo — exactly the cases (template probes / skeleton seed) that should not ship.
- **Fix sketch**: Add a confirm step for Publish (summarize what goes live + candidate count sourced). When `scenarioDegraded || seedDegraded`, require an explicit "publish anyway" acknowledgement. Surface a "Close posting" control once published so it's reversible here.

## 4. Server publish has no per-case dedup — concurrent/multi-tab publish mints duplicate live tokens for one case

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race-condition / state-corruption
- **File**: `app/api/devcase/publish/route.ts:7-17`, `app/_lib/db/devcase.ts:410-428` (`createPosting`), `app/features/sub_dev/DevTab.tsx:244-259`
- **Scenario**: `createPosting` always INSERTs a new posting + token; `POST /api/devcase/publish` has no caseId dedup (the orchestrator comment at `devcase-orchestrator.ts:145-152` documents this exact hazard). The only guard is the client `publishingCase` single-flight flag, which is per-tab. Two recruiters (or the same case open in two tabs, or a reload mid-request) each pass their local `published===false` check and POST → two live postings/tokens for one case.
- **Root cause**: Publish idempotency is enforced only in the UI, not at the write boundary; the DB has no uniqueness on (caseId, channel, open-status).
- **Impact**: Duplicate live apply links for one assignment; submissions split across tokens so the case-wide shortlist fragments and the "true #1" ranking is wrong.
- **Fix sketch**: Make publish idempotent server-side — reuse the existing open posting for (caseId, channel) or add a UNIQUE index + `ON CONFLICT DO NOTHING` and return the canonical row, mirroring `createSubmission`'s pattern already in this file.

## 5. CaseDetail previews the brief but never the materialized seed the candidate is actually handed

- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: missing-ui-state / preview
- **File**: `app/features/sub_dev/CaseDetail.tsx:139-142`, `app/devcase/apply/[token]/page.tsx:90-98`
- **Scenario**: CaseDetail renders the candidate-facing brief (`caseToMarkdown`) and the internal probe/rubric panels, but nowhere renders `kase.seed.files` — yet the apply page hands the candidate exactly those files via `LiveWorkSurface`. The author can preview what the candidate reads but not the starter file tree they receive, so a wrong/empty/skeleton-only seed ships unseen (the amber "skeleton only" pill is the only hint, with no way to inspect the actual contents).
- **Root cause**: The "what the candidate sees" preview stops at the prose brief; the materialized seed — the other half of the candidate experience — has no author-facing view.
- **Impact**: Authors can't verify the concrete deliverable before publishing; a bad seed is only discovered from candidate submissions.
- **Fix sketch**: Render a collapsed file-tree preview of `kase.seed.files` (path + first lines) in CaseDetail, reusing the LiveWorkSurface's read-only file view so author and candidate see the same artifact.
