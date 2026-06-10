# Feature Scout — Candidate Profile Builder (2026-06-10)

> Total: 6 (3H/2M/1L)

## 1. Give saved profiles a home: a "Saved profiles" panel with edit / duplicate / delete
- **Value**: High
- **Category**: functionality
- **Effort**: M
- **Where**: `app/features/sub_profile/ProfileTab.tsx:92` (tab body — no profile list anywhere) (+ `app/api/profile/route.ts:95` GET list, `app/api/profile/route.ts:165` DELETE, `app/features/sub_profile/ProfileEditor.tsx:20` EditorMode `"duplicate"`, `app/_components/results/ArchetypeBanner.tsx:80`)
- **Gap**: Saved v2 profiles are invisible on the very tab that builds them — the only UI listing them at all is the Match tab's `<select>`. Three backends are fully built with **zero UI caller**: `DELETE /api/profile?id=` (no `method: "DELETE"` fetch to it anywhere), `EditorMode "duplicate"` (heading + POST-as-new logic implemented in ProfileEditor; ProfileTab only ever sets `create`/`edit`), and the GET list. Editing is reachable ONLY via the pipeline drawer's deep link (`CandidateDrawer.tsx:590`), so a profile not yet in the pipeline can never be re-opened; ArchetypeBanner's post-save "Saved · open in Profile" link (`ArchetypeBanner.tsx:80`) lands on a view that cannot show what was just saved.
- **Proposal**: Add a "Saved profiles" section to ProfileTab (fetch the existing `GET /api/profile` list; `ProfileRow` already carries label/archetype/role_family/completeness/created_at). Each row gets Edit (`setEditor({mode:"edit",…})` reusing the deep-link hydration fetch), Duplicate (`mode:"duplicate"` — finally wiring the dark mode), Delete (the orphaned DELETE route, with confirm), and a "Find roles" link (`?tab=match&profile=<id>` — see #4). Optionally accept a `?focus=<id>` param so ArchetypeBanner's link can highlight the just-promoted profile.
- **Why users need it**: Recruiters who build or promote a profile currently lose all access to it (can't fix a typo, can't remove a test/duplicate row, can't clone a similar candidate) unless the candidate happens to be in a pipeline — the seeded population plus applicants makes the unmanageable list grow forever.

## 2. Capture candidate contact (email) in the profile and thread it into the pipeline
- **Value**: High
- **Category**: functionality
- **Effort**: M
- **Where**: `pipeline/jobfit/profile.py:104` (CandidateProfileV2 — no contact field) (+ `app/_lib/comms-dispatch.ts:23` — "Recruiter/Match-sourced entries still carry no contact, so they resolve to the name", `app/_lib/useAddToPipeline.ts:40` pipelineAddBody, `app/api/pipeline/route.ts:40`, `app/features/sub_profile/ProfileEditor.tsx:293` Basics section)
- **Gap**: The candidate-loop work (feature-scout 2026-06-08 W2) made *applicants* deliverable via `pipeline_entries.contact`, but every recruiter-built/sourced candidate still has `contact = null` — comms-dispatch's own comment documents that outreach, interview invites, rejections and schedule invites for them resolve to the candidate's *name* and dead-letter. Yet the profile builder — the one surface where the recruiter is literally typing in what they know about the candidate — has no email/contact field (`CandidateProfileV2` carries location/availability but no contact).
- **Proposal**: Add an optional `contact` (email) field to `CandidateProfileV2` + `ProfilePayload` + the editor's Basics grid (and the AI-draft extraction prompt). Extend `PipelineAddInput`/`pipelineAddBody` and `POST /api/pipeline` with an optional `contact`, validated like the apply route's email step; the sourcing surfaces (recruiter-candidates, rediscovery, matrix shortlist) read it off the pool profile so `postPipelineAdd` carries it. `candidateRecipient` then resolves correctly with zero comms changes.
- **Why users need it**: Today the whole downstream comms stack (outreach → interview link → rejection → schedule) silently dead-letters for every candidate who didn't arrive through the apply chat; one field at intake makes the existing machinery actually deliver.

## 3. Draft the profile from an uploaded CV file (reuse /api/extract-text)
- **Value**: High
- **Category**: feature
- **Effort**: S
- **Where**: `app/features/sub_profile/ProfileEditor.tsx:248` (AI panel — paste-only textarea) (+ `app/api/profile/draft/route.ts`, `app/api/extract-text` — already consumed by `app/apply/[id]/ConversationalApply.tsx:219` and `app/features/sub_analyze/AnalyzeApi.ts:118`, `app/_lib/upload-constraints.ts`)
- **Gap**: The context's promise is "build a profile from evidence (CV, links, manual fields)" — but there is no CV path into the builder at all. The AI-assist drafts only from hand-pasted notes; a recruiter holding a PDF CV must open it elsewhere, copy the text, and paste it. Meanwhile the apply chat (APP1) and the Analyze tab both already extract files client-side via `/api/extract-text` with shared `upload-constraints` validation.
- **Proposal**: Add a file input / drop zone to the AI-draft panel that posts the file to `/api/extract-text` (exact pattern of `ConversationalApply`'s CV step, including the client-side type/size checks from `upload-constraints`), fills `aiText` with the extracted text (head-sampled to the draft cap), and optionally auto-runs `runDraft`. No new backend — three existing pieces wired together.
- **Why users need it**: The most common evidence a recruiter has *is* a CV file; today the builder's fastest path still requires manual copy-paste, which is exactly the kind of friction that makes recruiters skip structured profiles and stay in the Analyze tab.

## 4. Close the post-save dead-end: "Find matching roles" after saving a profile
- **Value**: Medium
- **Category**: user_benefit
- **Effort**: S
- **Where**: `app/features/sub_profile/ProfileTab.tsx:86` (`onSaved={() => setEditor(null)}` — saved id discarded) (+ `app/features/sub_profile/ProfileEditor.tsx:191`, `app/features/sub_match/MatchTab.tsx:83` — existing `?tab=match&profile=<id>` auto-run deep link)
- **Gap**: Saving a profile closes the editor and drops the recruiter back at the archetype manager; the saved id is thrown away and the ResultPanel's "saved" state never even renders (confirmed by the e2e: "the saved-state result panel never settles in the DOM"). The natural next step — match this candidate against open roles — requires navigating to Match and re-finding the candidate in a dropdown. Yet MatchTab *already* supports `?tab=match&profile=<id>` with preselect + auto-run (built for the pipeline drawer).
- **Proposal**: On a successful save, show a brief success state (or toast/banner on ProfileTab) carrying two CTAs: "Find matching roles" → `router.push(buildUrl({ tab: "match", profile: savedId }))` (zero new backend — the deep link auto-runs), and "Keep editing". `onSaved` already receives `savedId`; only the handler discards it.
- **Why users need it**: Build → match is the product's core journey; today it dead-ends at the moment of highest intent and forces a manual re-find of the candidate the recruiter just typed in.

## 5. Show built profiles in the candidates-by-archetype matrix (today it shows only CV analyses)
- **Value**: Medium
- **Category**: feature
- **Effort**: M
- **Where**: `app/api/profile/candidates/route.ts:10` (`listAnalysisRecords` only) (+ `app/features/sub_profile/CandidateMatrix.tsx:23`, `app/_lib/db.ts:1122` `listProfileRecords`)
- **Gap**: The Profile tab's "candidates grouped by archetype" overview is fed exclusively from saved CV *analyses* — the `profiles` table (recruiter-built profiles, ArchetypeBanner promotions, the 50-candidate seeded population that exists precisely so "Profile / Match / Pipeline show an enterprise-like load", per `seed_candidates.py`) never appears. The tab that manages archetypes can't show most of the candidates routed to them, and a just-built profile is invisible in the very matrix below the editor.
- **Proposal**: Extend `/api/profile/candidates` to union profile rows (`listProfileRecords` — id/label/archetype/role_family/completeness are all denormalized) with the analysis rows, tagging each with `source: "analysis" | "profile"`. CandidateMatrix renders profile cells with a small source badge; clicking a profile cell opens the editor (`setEditor({mode:"edit"})`) instead of `/history/<slug>`. Dedupe rows whose analysis was promoted to a profile by label if both appear.
- **Why users need it**: The archetype matrix is the tab's stated "overview of analyzed candidates" but silently omits the majority population, so recruiters can't trust it as a roster — and the archetype columns (whose weights they tune right above) look emptier than the real pool.

## 6. Make the "Add next" completeness nudges actionable (click → focus the field)
- **Value**: Low
- **Category**: user_benefit
- **Effort**: S
- **Where**: `app/features/sub_profile/ProfileResultPanel.tsx:35` (plain `<li>` labels) (+ `pipeline/jobfit/profile.py:175` `completeness_gaps`, `pipeline/jobfit/profile_cli.py:82` — emits only `missing` labels, `app/_lib/completeness-followup.ts:29` GAP_FIELDS)
- **Gap**: Python's `completeness_gaps()` was built as the machine-readable twin of `missing` explicitly "so an intake follow-up UI can render one TARGETED field per gap (keyed by the check id)" — but only the Analyze pipeline consumes it (ArchetypeBanner follow-up); `profile_cli` itself emits just the human labels, so the editor's ResultPanel can only print inert text and the recruiter has to hunt the form for the matching input.
- **Proposal**: Have `profile_cli` also emit `gaps: [{check, label}]` (one extra `completeness_gaps(profile)` call; additive to `ProfileCliOutput`, so TS picks it up at the typed seam). In ResultPanel, render each gap as a button that scrolls to / focuses the corresponding editor control via a small check-id → field-anchor map (e.g. `min_3_skills` → first empty skill input, `has_project_or_thesis` → evidence section), reusing GAP_FIELDS prompts as tooltips.
- **Why users need it**: The completeness meter's whole purpose is to drive the next keystroke; clickable nudges turn "profile 67% complete" from a verdict into a guided fill-in, especially for the longer two-column form.

---
## Cross-checks performed
- Read `docs/harness/feature-scout-2026-06-08/INDEX.md` + `harness-learnings.md` first; verified no overlap with the 60 shipped/retired opportunities (closest neighbors checked: CV1/RES2 add-to-pipeline = analysis surfaces not the builder; APP1 CV upload = candidate apply chat, not the recruiter builder; APP2 contact = apply intake only — comms-dispatch.ts:23 explicitly scopes it "purely additive for inbound applicants"; MAT1 weighting and retired VOX/JOB/DEC/PREP/SCH items untouched).
- Grep `method: "DELETE"` across `app/` → only tasks/templates; **no caller of DELETE /api/profile** (finding 1).
- Grep `duplicate` across `app/**/*.tsx` → `EditorMode "duplicate"` declared/handled in ProfileEditor, **never set by any caller** (ProfileTab sets only create/edit) (finding 1).
- Grep `api/profile` consumers → MatchTab dropdown, AnalysisSummaryModal (by id), ProfileTab deep-link (by id), ArchetypeBanner (POST). **No saved-profiles list UI exists anywhere** (finding 1).
- Grep `contact` in `app/api/pipeline/route.ts` and `useAddToPipeline.ts` → no contact in the add body; read `comms-dispatch.ts:19-31` (`candidateRecipient` contact→label→id→"candidate" fallback, dead-letter comment) and `profile.py` CandidateProfileV2 fields → no contact field (finding 2).
- Grep `extract-text` → route exists, consumed by ConversationalApply + AnalyzeApi; **no reference in sub_profile/** (finding 3).
- Read `MatchTab.tsx:79-92` → `?tab=match&profile=<id>` deep link with auto-run already shipped (pipeline-drawer-originated); ProfileTab/Editor never link to it (finding 4).
- Read `app/api/profile/candidates/route.ts` → `listAnalysisRecords(200)` only; `listProfileRecords` exists in db.ts (used by candidate-pool/matrix) but not here (finding 5).
- Grep `completeness_gaps` → defined in profile.py, consumed only via `pipeline.py:484-491` dump → ArchetypeBanner/completeness-followup; absent from `profile_cli.py` output (finding 6).
- Also read: ProfileForm.ts, ProfileFields.tsx, ProfileEvidenceColumn.tsx, ArchetypeManager.tsx, CandidateMatrix.tsx, candidate-pool.ts, profile_draft route, seed_candidates.py, profile_cli.py, e2e spec. Note: context file list names `e2e/profile-smoke.spec.ts`, which was renamed — the real file is `e2e/profile-builder.spec.ts` (context drift).
