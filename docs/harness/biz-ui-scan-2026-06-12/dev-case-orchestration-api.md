# Biz+UI Scan — Dev Case Orchestration & API (2026-06-12)

> Total: 5 (2H/3M/0L)

Prior-scan status check (2026-06-10 feature-scout): findings 1 (candidate apply page, W5-1), 2 (auto outcome feed, W5-2 `recordPipelineOutcome`), 3 (case close-out, W5-3), and 5 (outbox resend, W6-1 `/api/comms/[id]/resend`) are now implemented; findings 4 (policy knobs) and 6 (audit export) remain open but are KNOWN and not re-flagged. Everything below is net-new.

## 1. Preserve contact + locale when promoting a submission into the pipeline
- **Lens**: business_visionary
- **Severity**: High
- **Category**: functionality
- **File**: `app/_lib/devcase-run.ts:581`
- **Scenario**: A candidate applies via the public dev-case page, fills the contact field, gets evaluated, and is promoted. From that moment, every pipeline-side message — interview confirmation, reminder, offer, rejection — is addressed to their free-text *name*, not their email. With a real relay configured (`COMMS_WEBHOOK_URL`), none of these messages can be delivered: the promoted candidate goes silent right after the "we'd like to take it forward" invite.
- **Root cause**: `promoteSubmission` (`app/_lib/devcase-run.ts:581-590`) calls `createPipelineEntry` with only id/label/archetype/jobId/score — it drops `sub.contact` even though the submission carries it and `CreatePipelineInput` explicitly supports `contact` ("stored so downstream comms are deliverable", `app/_lib/db.ts:2647-2649`) and `locale` (`db.ts:2656-2658`). Downstream, `candidateRecipient` falls back to the label (`app/_lib/comms-dispatch.ts:58-64`), every dispatcher localizes via `entry.locale` (`comms-dispatch.ts:109,124`) which is null, and the kp.comm.v1 envelope ships `candidate.email: null` (`app/_lib/comms-envelope.ts:63`).
- **Impact**: The dev-case track's whole payoff — a promoted candidate entering the standard hiring pipeline — breaks at the first downstream touch: undeliverable comms and English messages for Czech candidates. The intake captured the address; the bridge throws it away.
- **Fix sketch**: In `promoteSubmission`, pass `contact: sub.contact ?? null` and `locale: (sub.postingId && lifecycleByPosting(sub.postingId)?.lang) ?? null` (the DEVP5 `lang` column already exists on `dev_lifecycle`, `db.ts:519`); optionally `sourceChannel: posting.channel`. One-call change, mirrors how `apply-intake` threads contact/locale for inbound applicants.

## 2. Render dev-case candidate comms and brief headings in the case's language
- **Lens**: ui_perfectionist
- **Severity**: High
- **Category**: user_benefit
- **File**: `app/_lib/distribution.ts:80`
- **Scenario**: A recruiter runs a Czech-language lifecycle (DEVP5): the case brief, tasks, seed README, and AI-interview narration all come back in Czech. The candidate then receives three emails in English — the intake acknowledgement, the "Next step" invite, and the closure note — and even on the Czech apply page the assignment renders under hard-coded English headings ("Brief", "What you're handed", "Tasks", "~Xh timebox").
- **Root cause**: Three hand-written English templates: acknowledgement (`app/_lib/distribution.ts:80-86`), promote invite (`app/_lib/devcase-orchestrator.ts:260-266`), close-out rejection (`app/api/devcase/lifecycle/[id]/close/route.ts:40-46`). None consult `lc.lang`, while the main pipeline already localizes every dispatch via `commsTranslator(entry.locale)` (`comms-dispatch.ts:109,124`). Separately, `caseToMarkdown` hard-codes its section headings (`app/features/sub_dev/DevHelpers.ts:43-56`), so the localized brief body sits under English scaffolding on the candidate page (page chrome itself is fine — it follows cookie/Accept-Language, `i18n/server.ts`).
- **Impact**: The bilingual promise (core differentiation for the Czech market) breaks exactly at the candidate-visible seams: the LLM artifacts are localized but every deterministic string isn't. Mixed-language comms read as sloppy automation and undercut trust in an adverse-adjacent message (the closure rejection).
- **Fix sketch**: Add `devAck`/`devInvite`/`devClosure` keys to the comms catalog and reuse the `commsTranslator` pattern; thread the language as `lifecycleByPosting(posting.id)?.lang` in `intakeSubmission`, `lc.lang` in the orchestrator's ranked stage and the close route. Give `caseToMarkdown` a headings map keyed by lang (default en) and pass the case lang from the apply page.

## 3. Require a deliverable contact on the public apply form
- **Lens**: business_visionary
- **Severity**: Medium
- **Category**: user_benefit
- **File**: `app/devcase/apply/[token]/DevApplyForm.tsx:70`
- **Scenario**: An anonymous internet candidate finds the apply link, submits name + repo, and skips the optional contact field. They do great work and get promoted — but the invite is addressed `to: "Jan Novák"` and there is no other channel back to them. The strongest submitter is silently unreachable.
- **Root cause**: The contact input has no `required` attribute and no format validation (`DevApplyForm.tsx:70-78`; name and repo are `required` at lines 68 and 85). The server enforces nothing either: `/api/devcase/inbound` requires only `candidate` and `repoRef` (`app/api/devcase/inbound/route.ts:41-43`). The comms recipient contract then degrades to the free-text name (`comms.ts:20-23`).
- **Impact**: Unlike pipeline candidates (who come from profiles a recruiter can look up), a dev-case submitter's *only* identity is what the form captured. A missing contact converts a successful evaluation into a lost hire — the worst possible funnel leak, invisible until the invite bounces into the outbox addressed to a name.
- **Fix sketch**: On the page form, make contact `required` with `type="email"` (or a light email/phone pattern) and a one-line "this is how we reach you" hint (bilingual via the existing `devApply` namespace). Keep the webhook lenient for external ATS callers, but have `intakeSubmission` flag contact-less submissions (e.g. a `no_contact` note surfaced as a badge in `SubmissionRow`) so the recruiter sees the gap before promoting.

## 4. Stop manual publish from minting duplicate postings the lifecycle can't see
- **Lens**: business_visionary
- **Severity**: Medium
- **Category**: functionality
- **File**: `app/api/devcase/publish/route.ts:14`
- **Scenario**: A recruiter clicks "Publish" on a case in the Dev tab — perhaps a second time to grab a "fresh" link, or on a case a lifecycle already published. Each click mints a brand-new posting + apply token. Candidates submitting on the duplicate token get an ack promising review ("will be reviewed shortly"), but the automation never runs for them: nothing is evaluated, ranked, or promoted unless the recruiter notices and drives each submission by hand.
- **Root cause**: `POST /api/devcase/publish` calls `getAdapter().publish(devCase)` unconditionally (`publish/route.ts:14`), and `createPosting` has no caseId dedup — a hazard the orchestrator documents and guards against *only for its own path* (`devcase-orchestrator.ts:111-118`). The inbound/submit resume trigger resolves the lifecycle strictly via `lifecycleByPosting(postingId)` (`inbound/route.ts:54-55`), which matches only the single `dev_lifecycle.posting_id` (`db.ts:3499-3502`) — any other posting of the same case is invisible to it. The UI caller has no guard either (`app/features/sub_dev/DevTab.tsx:182-189`).
- **Impact**: Two live tokens for one role with different behavior — one automated, one a silent black hole — is exactly the "false ack IS a ghost" failure W5-3 was built to eliminate. (Distinct from the known-deferred late-arrival re-eval: this bites even while the lifecycle is actively `collecting`.)
- **Fix sketch**: In the publish route, return the existing open posting for the caseId when one exists (explicit `force: true` to intentionally mint another channel's posting). Belt-and-braces: in inbound/submit, fall back from `lifecycleByPosting` to a caseId lookup (`posting.caseId` → lifecycle) so any posting of a lifecycle's case resumes it; the close route already aggregates postings by caseId (`close/route.ts:24-26`) — reuse that matching rule.

## 5. Keep manual outcome entries from double-counting against auto-recorded ones
- **Lens**: business_visionary
- **Severity**: Medium
- **Category**: functionality
- **File**: `app/_lib/dev-outcomes.ts:103`
- **Scenario**: A dev-case hire is auto-recorded by the pipeline (W5-2). Three months later the recruiter does what the control room form is now for — records the on-the-job performance rating. The form requires picking an outcome, so they enter "hired, perf 4" for the same person. The store now holds two decided "hired" rows for one candidate; the calibration bands count both, and the recruiter then clicks "Apply suggested → N" on a floor computed over inflated samples.
- **Root cause**: `recordOutcome` is INSERT-only (`dev-outcomes.ts:103-115`) and the `/api/devcase/outcomes` POST does no ref-based dedup (`outcomes/route.ts:47-54`). The idempotency guard exists only inside `recordPipelineOutcome` for its own auto-writes (`dev-outcomes.ts:135`). The control-room form can't even reference the auto row — it has no ref field at all (`app/control/page.tsx:36`, POST body at `:71-79` sends only candidateRef/score/outcome/perf).
- **Impact**: The outcome loop is the subsystem's headline learning feature; the very workflow the auto-feed left to humans (performance enrichment) now corrupts its inputs. With MIN_RESOLVED = 4 and bands that can hold n=1 (`dev-outcomes.ts:223-229`), a single duplicate can flip `predictive` or move `suggestedFloor` a whole tier.
- **Fix sketch**: Make `recordOutcome` upsert when a row with the same `ref` (or, refless, same trimmed `candidateRef` + outcome) exists — update performance/note instead of inserting. In the control room, replace free-text re-entry for known candidates with an "add performance" action on the listed auto-recorded outcomes (they already render in the outcomes table), keeping the free-text form for genuinely off-pipeline outcomes.
