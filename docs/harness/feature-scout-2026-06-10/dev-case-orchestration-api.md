# Feature Scout — Dev Case Orchestration & API (2026-06-10)

> Total: 6 (3H/2M/1L)

## 1. Give candidates a real posting page behind the apply token
- **Value**: High
- **Category**: functionality
- **Effort**: M
- **Where**: `app/features/sub_dev/ApplyTokenPill.tsx:27` (+ `app/api/devcase/inbound/route.ts`, `app/api/devcase/seed/[id]/route.ts`, `app/features/sub_dev/DevHelpers.ts` (`caseToMarkdown`), `app/_lib/db.ts` (`getPostingByToken`))
- **Gap**: The "apply link" recruiters copy for candidates is a POST-only JSON webhook URL (`/api/devcase/inbound?token=...`) — opening it in a browser does nothing. There is no candidate-facing surface at all: no case brief, no starter-files download, no submission form. Worse, `GET /api/devcase/seed/[id]` (the materialized starter file tree, "the anti-essay-grading half of the take-home hardening") has **zero callers anywhere** — the seed is generated, persisted, and unreachable by both candidate and recruiter.
- **Proposal**: A public `/case/[token]` page in the proven candidate-surface pattern (`/apply/[id]`, `/schedule/[token]`, `/offer/[token]`): resolve the posting via `getPostingByToken`, render the probe-safe brief with the existing `caseToMarkdown` (probes already structurally excluded), list + download the materialized seed files (per-file or zip), and a name/contact/repo submission form that POSTs to the existing inbound webhook. Build it bilingual (next-intl, commit 7922fbe) like the other candidate surfaces; also drop a small seed-preview panel into `CaseDetail` so the recruiter can finally see what ships.
- **Why users need it**: Today the take-home pipeline is undeliverable end-to-end — a candidate physically cannot read the assignment, get the starter files, or submit without the recruiter hand-crafting a curl command. This is the VOX1-class "built but undeliverable" gap of this subsystem.

## 2. Auto-feed the outcome calibration loop from pipeline terminal events
- **Value**: High
- **Category**: functionality
- **Effort**: S
- **Where**: `app/_lib/devcase-run.ts:552-585` (`promoteSubmission` mints `ds-<subId>` entries with `matchScore = transferScore`), `app/_lib/db.ts:3189` (reject branch of `actOnPipelineEntry`), the Hired claim in the offer flow (`offer-finalize.ts` / `markOfferResponded`), `app/_lib/dev-outcomes.ts:103` (`recordOutcome`), `app/_lib/student-interview.ts:197-201` (`submissionIdFromCandidateId` — the resolver already exists)
- **Gap**: `recordOutcome` is called from exactly one place: the control room's manual form (`app/control/page.tsx:66`) with a free-text candidateRef and a hand-typed predicted score (`ref` is never set, so outcomes are untraceable to submissions). Yet the pipeline already knows the ground truth: a promoted `ds-` entry carries its transferScore and passes through a single transition authority when it's rejected or hired. The calibration engine (bands, monotonicity, floor suggestion) is fully built but starves on double-entry data.
- **Proposal**: At the two terminal transitions (reject in `actOnPipelineEntry`, Hired in the `markOfferResponded` CAS winner), if `submissionIdFromCandidateId(entry.candidateId)` resolves, auto-`recordOutcome({ ref: submissionId, candidateRef: entry.candidateLabel, predictedScore: entry.matchScore, outcome })` plus an audit row. Keep the manual form for performance ratings (only known post-hire) and off-pipeline outcomes; consider upsert-by-ref so a later "perf 4" enriches the auto-recorded hire.
- **Why users need it**: The promote-floor learning loop is the subsystem's headline feature, and right now it only learns if a human re-types what the system already did. Auto-feeding makes calibration real instead of decorative.

## 3. Close the case — lifecycle close-out with candidate wrap-up comms
- **Value**: High
- **Category**: user_benefit
- **Effort**: M
- **Where**: `app/_lib/devcase-orchestrator.ts:58` (`"closed"` is in STAGES but **no code ever writes it**), `app/api/devcase/control/route.ts:8` (TERMINAL already includes it), `app/api/devcase/inbound/route.ts:44-47` (lifecycle resumes only when `stage === "collecting"`), `app/_lib/distribution.ts:80-87` (ack promises "will be reviewed shortly")
- **Gap**: A lifecycle parks at `promoted` forever. Every non-promoted submitter is ghosted — they got an ack promising review, then silence — even though the main pipeline's explicit standard is "queued, never ghosts" (`screen-wave.ts:157` dispatches rejections). Late submissions to a promoted posting are acknowledged, stored, and never evaluated (the inbound resume trigger is collecting-only). Apply tokens never expire, so the black hole accepts forever.
- **Proposal**: A human-gated "Close case" action (route + button in `CaseDetail` and the control room): dispatch a courteous closure comm (kind `rejection`, human-triggered per the adverse-action policy in the orchestrator comments) to all submissions that weren't promoted, flip the lifecycle to `closed`, and mark the posting closed so `inbound` answers a friendly 410 "this role's intake has closed" instead of a false ack. While still open, also let inbound resume evaluation from `ranked`/`promoted` (re-rank with late arrivals) so a strong late submission isn't silently dropped.
- **Why users need it**: Closes the candidate loop the same way Waves 2/8 did for the main pipeline — no ghosting, no false promises — and gives operators an honest terminal state instead of an eternal `promoted`.

## 4. Promote the rest of DEV_POLICY to live control knobs
- **Value**: Medium
- **Category**: feature
- **Effort**: S
- **Where**: `app/_lib/devcase-orchestrator.ts:31-36` (`DEV_POLICY`), `app/_lib/dev-control.ts:86-99` (the `promote_floor` getter/setter pattern), `app/control/page.tsx:96-105`
- **Gap**: Only `promoteFloor` is runtime-adjustable; `autoApproveMaxGaps`, `autoApproveMinConfidence`, and `promoteTopN` are compile-time constants. The operator cannot tighten/loosen the auto-approval gate or change the promotion batch size without a redeploy, despite the control room being the designated oversight surface ("tunable like the automation POLICY" per the code comment).
- **Proposal**: Generalize the dev_control key-value accessors (`getPolicyNumber(key)` mirroring `getPromoteFloor`'s clamp + fail-closed style), read the overrides in `gateApproval` and the `ranked` stage, and add a compact "Policy" card to the control room (three bounded numeric fields, each change writing an audit row like `set_promote_floor` does).
- **Why users need it**: The whole point of the autonomy control surface is operator-tunable risk; today two of the three gates that decide "human review or auto-publish" are frozen in source.

## 5. Dead-letter recovery — resend a failed outbox message
- **Value**: Medium
- **Category**: functionality
- **Effort**: S
- **Where**: `app/_lib/comms.ts:53,76-85` (dead-letter is terminal), `app/features/sub_dev/OutboxSection.tsx:20-24` (failed rows render loud but inert), `app/_lib/db.ts:2748,2999` (`dev_outbox` stores the full recipient/subject/body/kind/ref)
- **Gap**: A `failed` message is alerted loudly and then is unrecoverable — after fixing the relay (or its config), there is no way to re-deliver; the candidate simply never receives the invite/ack/closure. `queued` rows similarly can't be flushed once a relay later becomes configured.
- **Proposal**: `POST /api/devcase/comms/[id]/resend` that re-dispatches the stored message through `sendComm` (new outbox row records the retry's own status; audit row `comm_resent`), plus a "Resend" button on failed rows in `OutboxTable` — and on queued rows when `relayConfigured` flips true.
- **Why users need it**: The comms contract treats a dropped candidate-facing message as an incident; an incident without a recovery action just becomes a permanently lost candidate touch.

## 6. Export the autonomy audit trail
- **Value**: Low
- **Category**: feature
- **Effort**: S
- **Where**: `app/control/page.tsx:213-228`, `app/_lib/dev-control.ts:58` (`listAudit(limit = 80)`), `app/_lib/export-utils.ts` (existing `toCsv`/`downloadFile` toolkit)
- **Gap**: The control room positions the audit trail as "the record-keeping a high-risk AI hiring system requires", yet it is view-only, capped at the last 80 rows, and cannot be handed to a reviewer/auditor.
- **Proposal**: An "Export CSV" button on the audit section reusing the Wave-3 export toolkit; support `?limit=` (validated/bounded) on the control GET or a dedicated full-export read so the download isn't truncated at 80.
- **Why users need it**: Compliance reviews of automated hiring decisions happen outside this UI; a one-click CSV makes the immutable log actually usable as evidence.

---
## Cross-checks performed
- Read `docs/harness/feature-scout-2026-06-08/INDEX.md` + `harness-learnings.md` first: the 2026-06-08 scan covered 10 candidate→hire contexts but **never the Dev Case subsystem**; no overlap with VOX/APP/SCH/DEC items (SCH3 offer-expiry ≠ posting close-out; APP3 ack ≠ dev-case acks, which already exist). Bug-hunt W5 covered the dev-case *Python* engine (defects) — all six findings here are features, none defect re-flags.
- Read all 16 context files end-to-end plus consumers: `DevTab.tsx`, `CaseDetail.tsx`, `SubmissionRow.tsx`, `SubmissionForm` (via CaseDetail), `OutboxSection.tsx`, `ApplyTokenPill.tsx`, `EvalPanel` (followups usage), `app/control/page.tsx`, `app/_lib/distribution.ts`, `app/_lib/comms.ts`, `app/api/devcase/seed/[id]/route.ts`, `actOnPipelineEntry` in `db.ts`.
- `grep "devcase/seed"` repo-wide → only docs + the route itself: **zero UI/API callers** for the seed endpoint (finding 1 confirmed dark).
- `grep getPostingByToken` → only `inbound` + `submit` routes; no page resolves the token → no candidate-facing posting page exists (finding 1).
- `grep 'stage: "closed"' / 'closed'` across app → `"closed"` appears in STAGES (`devcase-orchestrator.ts:58`) and TERMINAL (`control/route.ts:8`) but has no writer (finding 3 confirmed; `dispatchRejection` exists but is never used for dev submissions).
- `grep recordOutcome` → sole caller is the control-page manual form; no hook at any pipeline terminal transition; `submissionIdFromCandidateId` resolver already exists + is tested (`student-interview.test.ts:107-109`) (finding 2).
- `grep followups` → `EvalPanel.tsx:130` renders them and `interview-run.ts:147` feeds the debrief interview — followups are NOT dark; deliberately not proposed.
- Verified `docs/DEV_EXTENSION_PLAN.md` / `docs/AUTOMATION_SPEC.md` do not exist (glob); roadmap context taken from `docs/STUDENT_SCORING_CONCEPT.md` references instead.
- Confirmed i18n state: commit `7922fbe` (next-intl 4.13, `messages/en.json` + `cs.json`) — finding 1's page should follow the bilingual convention.
- `dev_outbox` schema stores full body (`db.ts:324-336,2748`) → resend (finding 5) is feasible without new storage.
