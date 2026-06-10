# Feature Scout — Dev Case Studio (UI) (2026-06-10)

> Total: 6 (3H/2M/1L)

(File-list note: `PostingsSection.tsx` / `ApprovedCasesSection.tsx` named in the context no longer exist; the live surfaces are `CasesTable.tsx` + `CaseDetail.tsx`, which were read instead — same drift the 2026-06-08 bug scan recorded.)

## 1. Build the candidate-facing apply page behind the apply token
- **Value**: High
- **Category**: functionality
- **Effort**: M
- **Where**: `app/features/sub_dev/ApplyTokenPill.tsx:27` + `app/api/devcase/inbound/route.ts:12` (+ `app/features/sub_dev/DevHelpers.ts:42` `caseToMarkdown`, `app/api/devcase/seed/[id]/route.ts`, pattern: `app/apply/[id]/ConversationalApply.tsx`)
- **Gap**: The "apply link" the pill copies for candidates is `/api/devcase/inbound?token=…` — a POST-only JSON webhook (the route exports no GET). A candidate opening it in a browser gets a 405/JSON error; there is no human-facing posting page for dev cases anywhere (grep over `**/page.tsx` confirms). The flow is only deliverable through an external ATS that knows the webhook contract.
- **Proposal**: Add `app/devcase/apply/[token]/page.tsx`: resolve the posting via `getPostingByToken`, render the candidate-safe assignment (`caseToMarkdown` is already guaranteed probe-free by construction), offer the materialized starter seed for download (the seed route exists, see #6), and a small form (name, contact, repo URL, notes) that POSTs to the existing inbound webhook — which already triggers ack comms + lifecycle resume. Point `ApplyTokenPill` at the page URL instead of the raw webhook.
- **Why users need it**: Today the shareable artifact dead-ends for any human recipient; this makes the entire automated take-home flow actually usable end-to-end with zero external integration.

## 2. One-click outcome recording from promoted submissions
- **Value**: High
- **Category**: user_benefit
- **Effort**: S
- **Where**: `app/features/sub_dev/EvalPanel.tsx:163-173` (promote footer) + `app/features/sub_dev/SubmissionRow.tsx:54-67` (+ `app/control/page.tsx:36,238-256`, `app/api/devcase/outcomes/route.ts:43-55`)
- **Gap**: The calibration loop (Direction E) only learns from outcomes the recruiter hand-types into the control room — candidateRef and predicted score must be transcribed from memory into free-text inputs. A promoted submission already knows all three (`candidateRef`, `transferScore`, `submission.id` for the schema's `ref` field, which no UI ever populates). Nothing connects the promote moment to the outcome record.
- **Proposal**: On rows where `isPromoted`, render inline outcome buttons (Hired / Rejected / Withdrawn, + perf 1–5 select when hired) that POST `{ref: submission.id, candidateRef, predictedScore: submission.transferScore, outcome}` to `/api/devcase/outcomes`, then show a recorded pill. The control room stays the aggregate calibration view; the data entry moves to where the recruiter already is.
- **Why users need it**: A human-in-the-loop learning loop only converges if recording reality is nearly free — manual transcription means missing or mistyped scores silently starving/biasing the promote-floor calibration.

## 3. Surface autonomy state + pending gates in the Dev tab (link the orphaned control room)
- **Value**: High
- **Category**: user_benefit
- **Effort**: S
- **Where**: `app/features/sub_dev/DevTab.tsx:269-302` (header/tab strip) + `app/control/page.tsx:136` (links out, nothing links in; `app/api/devcase/control/route.ts:23-35`)
- **Gap**: `/control` has zero inbound links app-wide — the kill switch, pending human gates, audit trail and calibration are reachable only by typing the URL. Worse, when autonomy is paused every lifecycle halts (`runLifecycle` returns "halted — automation paused") but the Dev tab shows no trace of it: the studio reads like a hung pipeline, and `LifecycleSection.tsx:13` still promises "No manual steps between".
- **Proposal**: Add a compact status strip to the DevTab header fed by `GET /api/devcase/control` (or derive gates from the already-loaded lifecycles): a running/paused autonomy chip, an "N awaiting your decision" badge, and a Link to `/control`. When paused, show an amber banner ("Automation is paused — lifecycles are holding") with the resume affordance one click away.
- **Why users need it**: The oversight room is the feature's compliance story (the page says so itself); an undiscoverable kill switch defeats it, and an invisible paused state turns a deliberate halt into apparent breakage.

## 4. Outbox: read the message body, filter, and triage failures
- **Value**: Medium
- **Category**: feature
- **Effort**: S
- **Where**: `app/features/sub_dev/OutboxSection.tsx:63-83` + `app/features/sub_dev/DevTypes.ts:102` (+ `app/api/devcase/comms/route.ts:13`, `app/_lib/db.ts:2722-2733,2997-3013`)
- **Gap**: The outbox persists and serves the full message `body`, the `ref` (submission id), and `relayConfigured` — the UI drops all three (`OutboxItem` omits body/ref; the "queued = recorded locally" explainer renders regardless of relay state). There's no kind/status filter, so a dead-lettered rejection must be eyeballed among 50 mixed rows, and there's no way to see what a candidate was actually sent.
- **Proposal**: Extend `OutboxItem` with `body`/`ref`; make rows expandable (or open a modal) showing the exact message text; add kind + status filter chips with a loud "N failed" count; switch the explainer copy on `relayConfigured`. Optionally resolve `ref` to its submission/case for a jump-to link.
- **Why users need it**: "The candidate says they got nothing" and "did the rejection actually send?" are the two questions an outbox exists to answer — today it answers neither without opening SQLite.

## 5. Side-by-side compare for ranked submissions
- **Value**: Medium
- **Category**: feature
- **Effort**: M
- **Where**: `app/features/sub_dev/CaseDetail.tsx:155-170` + `app/features/sub_dev/EvalPanel.tsx:75-79` (patterns: `app/features/sub_jobs/CompareInterviews.tsx`, `app/features/sub_match/JobCompare.tsx`)
- **Gap**: Submissions render as a ranked list of one-at-a-time eval panels; deciding between #1 and #2 means scrolling two long panels and holding five dimension scores in your head. All the comparison data is already client-side in the postings payload — `dimensions[]` is self-describing (label/weight/score), probe outcomes are denormalized, transfer + confidence ride along.
- **Proposal**: A "Compare" toggle on the submissions list: select 2–3 evaluated submissions, render a transposed table — dimensions × candidates with `scoreTone`-tinted cells, a transfer-score row, a probe grid (handled/detected/missed per probe per candidate), and confidence/provenance chips. Pure client, no new fetch, mirroring the established JobCompare/CompareInterviews pattern.
- **Why users need it**: The studio's entire output is a ranking; the final human call is comparative, but the UI only supports serial reading at the exact moment of decision.

## 6. Show the materialized starter seed in CaseDetail
- **Value**: Low
- **Category**: feature
- **Effort**: S
- **Where**: `app/api/devcase/seed/[id]/route.ts:10-16` (zero UI callers) + `app/features/sub_dev/CaseDetail.tsx:81-83`
- **Gap**: The seed route — the concrete `{files: [{path, contents}], note}` starter tree every candidate receives — is a dark capability with no UI caller. The reviewer approving/publishing a case sees only the prose "What you're handed" section, never the actual fixture.
- **Proposal**: A collapsed "Starter tree" panel in CaseDetail that fetches `/api/devcase/seed/[id]` on expand: file list with sizes, click-to-preview contents, and a download via the shared `downloadFile` (export-utils). The same payload then feeds the candidate apply page (#1) so both sides verifiably hand out the identical fixture.
- **Why users need it**: Recruiters currently approve and distribute an assignment without ever seeing the code candidates start from — the one artifact the eval's diff-against-ground-truth model depends on.

---
## Cross-checks performed
- Read `docs/harness/feature-scout-2026-06-08/INDEX.md` + `docs/harness/harness-learnings.md`: none of the 60 prior opportunities touched `sub_dev`/devcase (the 10 contexts covered the main candidate→hire journey); export toolkit (`app/_lib/export-utils.ts`) exists and is reused, not re-proposed (#6 references it). Read `docs/harness/ui-bug-scan-2026-06-08/dev-case-studio-ui.md`: its 4 findings (submit `r.ok` gate, double-promote, chip/rank desync, kill-switch a11y) are defects, all visibly fixed in current code (`SubmissionForm.tsx:25-29`, `SubmissionRow.tsx:30,55,74-76`) — nothing re-proposed.
- Read all 18 files in `app/features/sub_dev/` + `app/control/page.tsx` + all 12 `app/api/devcase/**` routes + `app/_lib/distribution.ts`, `dev-outcomes.ts`, and the relevant slices of `db.ts`/`devcase-run.ts`/`devcase-orchestrator.ts`.
- Grep `devcase/seed` → only `db.ts`/`devcase-run.ts` (producer side); no UI caller (#6 is real). Grep `"/control"`/`href` app-wide → zero inbound links (#3 is real). Grep `devcase/inbound` → only `ApplyTokenPill.tsx:27` emits it; the route exports POST only, so the copied link 405s in a browser (#1 is real; the prior auth-bypass fix W1/947cada is unrelated and intact). Grep `getSubmission`/`rowToSubmission` → `contact`/`notes` persisted; `listOutbox` returns `body`+`ref` and the comms route serves `relayConfigured` — all dropped by `DevTypes.OutboxItem` (#4 is real). `outcomeInputSchema.ref` is never populated by any UI (#2 is real).
- Re-run eval already exists (`SubmissionRow` "Re-evaluate") — deliberately NOT proposed. Dropped a 7th candidate for the 6-cap: i18n parity — `useTranslations|next-intl` has 0 hits in `sub_dev/**` and `app/control/` versus 40+ translated feature files after commit 7922fbe (the Dev studio + control room are the app's last untranslated recruiter surfaces, and #1's candidate-facing page should be built bilingual from day one); worth folding into whichever wave touches these files.
