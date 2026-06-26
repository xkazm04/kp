# Pipeline Board & Candidate Drawer — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀2 / 🚀3 | Severity: C1/H2/M2/L0

## 1. Source-of-hire attribution is captured at intake but never reaches the board — origin chip is dead
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: dark capability / unwired feature
- **File**: app/_lib/db/pipeline.ts:298
- **Observation**: `createPipelineEntry` persists `source_channel`, `source_campaign`, and `source_variant` (pipeline.ts:557-562, 580-581) and `rowToEntry` maps them (pipeline.ts:255-256), but the board's `listPipeline()` SELECT (pipeline.ts:298-301) lists its columns explicitly and omits all three. So every board entry arrives with `sourceChannel: null`, which means the drawer's provenance chip `{entry.sourceChannel ? <>· {t("via", …)}</> : null}` (CandidateDrawer.tsx:449-451) NEVER renders for a candidate opened from the board. The richer `source_campaign` / `source_variant` aren't even in the client `Entry` type (PipelineTypes.ts:36-37).
- **Why it matters**: A recruiting SaaS lives and dies on "which channel/campaign produced our hires" (cost-per-hire, source ROI, channel mix). That data is being collected on every inbound apply and then thrown away before it reaches any surface — a textbook kp "built-but-unwired" capability, plus a literal dead UI branch that looks live in code review.
- **Recommendation**: Add `source_channel, source_campaign, source_variant` to the `listPipeline` SELECT, expose campaign/variant on the `Entry` type, and surface a "Source / campaign" line in the drawer (and ideally a board roll-up). Near-zero effort unlocks source-of-hire analytics.
- **Effort**: S

## 2. The drawer's "full candidate timeline" silently truncates via fixed scan caps
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: undocumented assumption / silent edge case
- **File**: app/_lib/candidate-timeline.ts:34
- **Observation**: `candidateTimeline` builds the merged story by scanning only the most recent rows of each store: `ANALYSES_SCAN_LIMIT = 300`, `COMMS_LIMIT = 100`, `INVITES_SCAN_LIMIT = 500` (candidate-timeline.ts:34-36), then filtering by candidate label / entryId in JS (e.g. `listAnalyses(ANALYSES_SCAN_LIMIT)` at line 45). Nothing tells the caller the window was hit. A candidate whose analysis/invite/comm is older than those newest-N rows across the *whole workspace* simply has those chapters vanish from their drawer — no "older history not shown", no indication.
- **Why it matters**: The drawer's stated promise is the candidate's *complete* story (file header c6524f2f). On a busy instance 300 recent analyses is a few days of volume, so long-lived or re-engaged candidates silently show a partial timeline — and a recruiter reasonably reads "no offer chapter" as "no offer happened." Wrong context drives wrong hiring decisions. The magic numbers also carry no rationale for why those three values differ.
- **Recommendation**: Query these store-side by `entryId`/label (indexed) instead of scan-then-filter, or at minimum detect truncation and render a "history may be incomplete" marker. Document why each cap is what it is.
- **Effort**: M

## 3. Privacy posture is half-applied: the feed is anonymized, but full PII (incl. private recruiter notes) is served unauthenticated
- **Lens**: 🚀 Business
- **Severity**: Critical
- **Category**: trust / GDPR risk · undocumented trade-off
- **File**: app/_lib/pipeline-events-public.ts:5
- **Observation**: `pipeline-events-public.ts:5-18` documents that `/api/pipeline/events` was deliberately reduced to initials + no entry id because the app "has no auth layer yet" and identity-tied-to-outcome is sensitive. But the sibling endpoints carry full identity unauthenticated: `GET /api/pipeline` returns `listPipeline()` rows including full `candidate_label`, scores, and the private recruiter `notes` scratchpad (pipeline.ts:300); `/api/pipeline/[id]/timeline` and `/api/pipeline/events?entry=` return full names + real stage transitions (timeline/route.ts:9-13 explicitly notes "an auth layer is the open follow-up"). The drawer note even invites pasting personal call facts ("wants 80k") into that exposed column (CandidateDrawer.tsx:715-743).
- **Why it matters**: The app ships an entire GDPR consent/anonymization lifecycle (db/pipeline.ts:901-1058) yet serves the very PII it scrubs to anyone who can reach the origin. The anonymized feed creates a *false sense of safety* — a reviewer sees "we handled IDOR" and misses that the board payload is wide open. This is the core trust/compliance promise of a hiring product.
- **Recommendation**: Treat the auth layer as a release blocker, not a "follow-up"; until then, gate `/api/pipeline`, `/timeline`, and `?entry=` behind the same boundary, and stop shipping `notes` on the list payload. Record the decision + target date so the trade-off isn't tribal knowledge.
- **Effort**: M

## 4. Saved views and per-stage SLAs are localStorage-only — no cross-device or team sharing
- **Lens**: 🚀 Business
- **Severity**: Medium
- **Category**: retention / collaboration lever
- **File**: app/features/sub_pipeline/PipelineTab.tsx:81
- **Observation**: Saved board views (`PIPELINE_VIEWS_KEY`, PipelineTab.tsx:81, 147-167) and per-stage aging SLA overrides (`PIPELINE_SLA_KEY`, :82, 170-193) are persisted only in `localStorage` — the comments explicitly call them "single board, client-only — no schema." A view can travel only as a hand-copied link (`copyViewLink`, :400-406); SLAs can't travel at all.
- **Why it matters**: For a multi-recruiter SaaS these are natural team artifacts: a shared "Backend — aging" view or an org-wide "Offer stalls after 3 days" SLA policy. Trapping them per-browser means they're lost on device switch and invisible to teammates — a missed stickiness/collaboration hook, and a feature that quietly degrades as a team grows.
- **Recommendation**: Add a small server-persisted, workspace-scoped views/SLA store with optional "share with team"; keep localStorage as the anonymous fallback. Aligns with the existing workspace scoping already in the DB layer.
- **Effort**: M

## 5. Bulk move/decide fire N sequential POSTs while bulk-invite uses one endpoint — inconsistent and fragile at scale
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: inconsistent pattern / happy-path-only
- **File**: app/features/sub_pipeline/PipelineTab.tsx:453
- **Observation**: `bulkMove` (PipelineTab.tsx:453-472) and `bulkDecide` (:489-504) loop `await postPipelineAction(...)` one entry at a time, but `bulkInvite` (:510-537) posts the whole cohort to a single `/api/schedule/invite/bulk` endpoint. With "select all visible" able to pick the entire filtered board, a bulk move/reject becomes dozens-to-hundreds of serial round-trips; if the recruiter navigates away mid-loop the batch is half-applied (some emailed, some not), and there's no documented reason these two paths don't get the same bulk endpoint the invite path already proves works.
- **Why it matters**: Batch action *is* the headline value of select-mode (PIPE1: "act on a cohort instead of N drawer trips"). The serial implementation makes the big-cohort case slow and partially-committable, undercutting the feature, and the inconsistency is a maintenance trap (the CAS/retry grammar is now duplicated three times with one variant).
- **Recommendation**: Add bulk `set_stage` / `decide` endpoints mirroring `invite/bulk` (per-entry isolation + per-entry `expectedStage`), and route all three bulk paths through one client helper.
- **Effort**: M
