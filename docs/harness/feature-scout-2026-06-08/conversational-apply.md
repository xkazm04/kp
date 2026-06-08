# Feature Scout — Conversational Apply (kp)

> Total: 6 opportunities (High: 3, Medium: 2, Low: 1)
> Files read: ~12

Context: the candidate-facing token-link apply flow (`/apply/[id]`) — a formless
chat that captures answers, runs job-derived knockout questions, normalizes the
answers into a real CandidateProfileV2, and drops a passing applicant into the
pipeline at "Accepted". Gaps below were confirmed by reading how candidates
*otherwise* enter the system: the recruiter Profile form (`/api/profile` +
`/api/extract-text` CV upload), the comms stack (`comms.ts`,
`comms-dispatch.ts`, `distribution.intakeSubmission`), and the existing
candidate token pages (`/offer/[token]`).

---

## 1. CV / résumé upload during apply
- **Value**: High
- **Category**: integration
- **Where it slots in**: `app/apply/[id]/ConversationalApply.tsx:269` (the free-text `experience`/`skills` steps) and `app/api/apply/[id]/route.ts:57` (`buildApplyProfileDraft` → `profile_cli`)
- **Gap**: The conversational flow captures only what the applicant *types* into chat. The recruiter Profile path is far richer: it runs `/api/extract-text` (`app/api/extract-text/route.ts:29`) over an uploaded PDF/DOCX/TXT/MD, then feeds the extracted text into the same `profile_cli` normalizer. An applicant with a polished CV must instead hand-summarise their whole career into a one-line "most relevant recent experience" box.
- **Opportunity**: Add an optional "Attach your CV" step that POSTs the file to the *already-built* `/api/extract-text` endpoint, then folds the returned text into `buildApplyProfileDraft` as a high-weight `kind: "cv"`/`"job"` evidence item alongside the typed skills.
- **Why it matters**: Turns a thin typed stub into a fully matchable candidate — the single biggest quality lift for inbound applicants, using infra that already exists.
- **Sketch**: New `{ type: "file" }` ApplyStep → reuse `validateUploadServer` + `/api/extract-text` → push extracted text into `buildIntakeProfile` evidence; degrade gracefully to typed answers if extraction fails (the route already has a degraded-intake path).

## 2. Capture an email/contact so applicants are actually reachable
- **Value**: High
- **Category**: functionality
- **Where it slots in**: `app/_lib/apply.ts:65` (`buildApplyScript` steps) and `app/api/apply/[id]/route.ts:181` (answer parsing)
- **Gap**: The flow captures **no contact field** — documented as a hard limitation in three places (`db.ts:1895`, `comms.ts:18`, `comms-dispatch.ts:23`). Consequences: (a) dedup is name-only, so two same-named applicants silently merge onto one entry (`findApplicationByApplicant`); (b) every downstream comm (`dispatchRejection`, `dispatchOffer`, interview confirmations) resolves the recipient to the literal `"candidate"` and **dead-letters**, because there is no address to send to.
- **Opportunity**: Add one required `email` step (and optional phone), validate it, store it on the pipeline entry, and pass it as the comms recipient + the dedup key.
- **Why it matters**: Closes the documented "unaddressable recipient" seam — the whole offer/rejection/interview comms stack becomes deliverable for inbound applicants, and dedup stops colliding on name.
- **Sketch**: `{ id: "email", type: "text" }` step with email validation in the POST caps block; thread it to `createPipelineEntry` (new `contact` column on `pipeline_entries`, mirroring `dev_submissions.contact`) and to `candidateRecipient`.

## 3. Application-received confirmation comm
- **Value**: High
- **Category**: automation
- **Where it slots in**: `app/api/apply/[id]/route.ts:262` (right after the successful `applied` event)
- **Gap**: A passing applicant gets only an ephemeral in-page "You're in 🎉" bubble. No durable acknowledgement is ever sent — even though `distribution.intakeSubmission` (`distribution.ts:79`) already auto-acks dev-case submissions over `sendComm`, and the entire `comms-dispatch` family fires acks/rejections/offers for every *other* pipeline event.
- **Opportunity**: On a fresh acceptance, dispatch an "We received your application — <role>" acknowledgement through the existing `sendComm` channel (kind: `acknowledgement`), exactly as `intakeSubmission` does.
- **Why it matters**: Brings inbound applicants to comms parity with the rest of the pipeline; a candidate who closes the tab still has a record their application landed. Most valuable once #2 lands (a real address to send to), but the outbox audit row is useful even before then.
- **Sketch**: Add `dispatchApplicationReceived(entry)` to `comms-dispatch.ts` modelled on `dispatchOnboarding`; call it in the `built.ok`/`created` branch; record an `acknowledgement_sent` event.

## 4. Candidate application-status page (`/apply/[id]/status/[token]`)
- **Value**: Medium
- **Category**: user_benefit
- **Where it slots in**: new sibling of `app/offer/[token]/page.tsx`; entry minted in `app/api/apply/[id]/route.ts:233`
- **Gap**: The product already has token-gated candidate pages — `/offer/[token]` lets a candidate return and see their offer status. Apply has no equivalent: once the chat ends, the applicant can never check "is my application still being reviewed?" and has no link to return to.
- **Opportunity**: On acceptance, mint a status token, return it in the success message as a "Track your application" link, and serve a read-only page showing the current pipeline stage (Accepted / Screening / Interview / Offer) for that entry.
- **Why it matters**: Reduces "did it go through?" anxiety and inbound "what's my status" emails; reuses the proven token-page + public-token pattern the offer page established.
- **Sketch**: `status_token` column on the entry → new `app/apply/[id]/status/[token]/page.tsx` reading `pipeline-status.ts` stage; surface a humanised stage label only (no internal scores).

## 5. Recruiter-authored custom screening questions per role
- **Value**: Medium
- **Category**: feature
- **Where it slots in**: `app/_lib/apply.ts:147` (`buildApplyScript` KO block) and `app/features/sub_jobs/JobPostingModal.tsx:59` (where the Apply-link button lives)
- **Gap**: Knockout questions are entirely *derived* from job fields — work authorisation, work mode, languages (`KO_STEP_IDS` at `apply.ts:25`). A recruiter can't add a role-specific gate like "Do you have a valid driver's licence?" or "Minimum 3 years with Kubernetes?". The apply link is generated, but the *questions behind it* aren't configurable.
- **Opportunity**: Let recruiters define a small list of custom KO/screening questions on the job; `buildApplyScript` appends them as `ko`/`choice` steps and the POST evaluates them via the existing `KO_STEP_IDS` decline path.
- **Why it matters**: Competitor-parity table-stakes for any ATS apply flow; lets one role auto-filter on its real disqualifiers instead of only the three generic gates.
- **Sketch**: Add `screeningQuestions` to `JobRecord`; author them in `JobPostingModal` next to the Apply-link button; merge their ids into the KO set so a "no"/out-of-range answer declines, just like today's job-derived KOs.

## 6. "Save & resume" a half-finished application
- **Value**: Low
- **Category**: functionality
- **Where it slots in**: `app/apply/[id]/ConversationalApply.tsx:135` (`advance`) — answers live only in React state
- **Gap**: Captured `answers` exist purely in component state. A dropped connection, an accidental back-button, or a closed tab before the final step loses everything; the only recovery offered is "Start over" (`restartConversation`, line 124). Longer flows (student lane + future CV upload + custom screening) make abandonment more likely.
- **Opportunity**: Persist in-progress answers to `localStorage` keyed by `jobId`, and rehydrate the chat (and step index) on return so a candidate can pick up where they left off.
- **Why it matters**: Recovers abandoned applications at near-zero cost; the more questions the flow grows (ideas #1, #5), the more this matters.
- **Sketch**: `useEffect` to write `{ idx, answers, msgs }` to `localStorage` on change; on mount, offer "Resume your application?" if a saved draft for this `jobId` exists; clear it on successful submit.
