# OSS 1.0 cut

Date: 2026-11-08. Base commit: `f41adc3cf366678c9e51c4a7b4c8d53b017ab595`.

Top goal: a user runs the whole hiring process in the app, from job description to accepted candidate.

A box is ticked only where the named evidence was opened on this base and supports the line. Scope
items (C4, C5, C6, S1, S2, S3, L1, L2) are defined in the gitignored tiger file
`tiger/hunts/2026-10-17-comms-channels/scope.md`, cited below as scope.md. `.ai/tasks/2026-10-28-channels-and-oss-wrap-preanalysis.md` is cited as pre-analysis.

## 1. IN

### The hiring path, in order

- [x] Job description: save one as written, no model needed. `e2e/journey-role-to-schedule.spec.ts` (keyless JD leg), `app/api/jds/route.ts`
- [x] Job description: generate one, with a deterministic source when no model answers. `app/api/jds/generate/route.ts`, `app/_lib/jd-build-run.ts:155`
- [x] Publish: a draft goes live through one door, and the gate, status flip and debit commit together. `app/api/jobs/[id]/publish/route.ts`, `app/api/jobs/publish-atomicity.test.ts`
- [x] Publish: only a published role takes applications. `app/_lib/job-ingest.ts:242`, `app/apply/[id]/page.tsx:38`
- [x] Application intake: every door files at the entry column and records consent once. `app/_lib/application-filing.test.ts:199`, `app/api/apply/[id]/route.ts`
- [x] Rating, keyless: the role-fit ranker needs no key and scores the same with or without one. `app/_lib/entry-scoring.ts`, `app/_lib/entry-scoring.test.ts`
- [x] Screening, with a key: the model verdict is used and marked `llm`; any degrade is marked `deterministic`. `app/_lib/automation-run.ts:199`, `app/_lib/automation-run.test.ts:234`. No run against a live key was opened.
- [x] Screening: an adverse automated proposal is queued for a person, never applied by the pass. `app/_lib/automation-pass.ts:486`
- [x] Bulk screening wave: a commit needs a fresh approval over the exact set and a named approver. `app/_lib/screen-wave.ts:283`, `app/_lib/screen-wave-approval.ts`, `app/api/decisions/screen-wave/screen-wave-route.test.ts`
- [x] Interview: a candidate books a slot from a tokenized link, with no key. `e2e/journey-role-to-schedule.spec.ts`
- [x] Human scorecard: each interviewer keeps their own record per entry. `app/api/interview-prep/scorecard/route.ts`, `app/api/interview-prep/scorecard/panel-scorecards.test.ts:113`
- [x] Offer draft: drafted and parked at `offer_review`; an unpriced draft always parks. `app/_lib/automation-run.ts:699`, `app/_lib/automation-run.test.ts:265`
- [x] Offer approval: a person's accept at `offer_review` extends the offer and does not hire. `app/_lib/pipeline-entry-action.ts:453`, `app/api/pipeline/entry-route.test.ts:68`
- [x] Candidate accept: the token link records the response and a retry is idempotent. `app/api/offer/token-route.test.ts:84`, `app/_lib/offer-finalize.ts`
- [x] Hired: the candidate's accept moves the entry to Hired, and it is the only route there. `app/api/offer/token-route.test.ts:84`, `app/api/pipeline/entry-route.test.ts:55`
- [x] One end-to-end test from job description to accepted candidate. `e2e/journey-job-to-accept.spec.ts`, 5 of 5 green at `f3ebb789b` on a stock clone with no key and `KP_OFFLINE=1`, both on the managed server and on the production standalone build CI uses. It is not yet in the keyless CI subset: enrolment waits on `.claude/CLAUDE.md`, which is dirty in the operator checkout.

### Requirements off the path

- [x] Local start: one command, no key, and a demo option for a populated board. `scripts/up.mjs`, `README.md:44`
- [ ] Local start finishes in two minutes. No test or record on this base measures the time.
- [x] Keyless path document for the whole journey. `docs/features/hiring-pipeline/keyless-rating.md`
- [x] One Connect surface for channels in the cut: the Connectors deck reads one catalog, and `?tab=integrations` redirects to it. `app/features/hiring/channels/night/connectors/ChannelsNightConnectorsLevel.tsx`, `app/_lib/connect/catalog.ts`, `app/features/shell/tabRedirects.test.ts`
- [x] Connect degrades without keys: a keyless install reads every connector `not_configured`. `app/features/hiring/channels/night/connectors/connectorsDeckModel.test.ts`
- [x] Reasons, bulk rejection: the sealed record carries a reason code, its numbers and the approver. `app/_lib/screen-wave.ts:562`, `app/_lib/decision-attribution.ts:528`
- [x] Reasons, knockout: the candidate is told which must-have ended the application. `app/api/apply/[id]/ko-decline-door.test.ts`, `app/api/apply/[id]/route.ts:250`
- [x] Reasons, candidate view of sealed decisions. `app/_lib/status-decisions.ts`
- [x] Reasons, Match verdict: sealed as facts and rendered in the reader's language. `app/features/insights/matrix/focus/matchReasons.ts`, `app/_lib/decision-attribution.ts:579`
- [x] Reasons, AI scorecard: a rating carries its evidence quote or a not-assessed placeholder. `app/_lib/interview-scorecard.ts:30`
- [ ] Reasons, human scorecard: `evidence` is optional on a rating (`app/api/interview-prep/scorecard/route.ts:193`), so not every one carries a reason.
- [ ] Reasons, automatic ranking: the sweep writes a score and a `scored` event only (`app/_lib/entry-scoring.ts`); the policy reason is the number against a threshold (`pipeline/jobfit/automation.py:1037`).
- [ ] Reasons, one-off recruiter rejection: with no note, a seal can fall back to a template (`app/_lib/pipeline-entry-action.ts:66`).
- [ ] Green gates on main. `.github/workflows/ci.yml` defines them; a green run is not a repo path and none was opened for this base.

## 2. OUT

- **C6, reply door and one thread per candidate.** A third footer link `/reply/<token>`, a `candidate_replies` table and a reply clock (scope.md:72-83). A 1.0 user gets the `/data` and `/stop` footer links (`app/_lib/comms-dispatch.ts:217`), and a reply is only inferred from a duplicate inbound lead (`app/_lib/inbound-lead.ts:178`).
- **S2, ATS ingest runtime.** A credential broker, a decide/apply split, a sync pass and a field-map editor (scope.md:98-107). A 1.0 user gets the single-function import (`app/_lib/ats/ingest.ts:119`) and the inbound connections Connect lists; there is no broker in `app/`.
- **S3, Greenhouse and Lever, shadow first.** Vendor adapters with a promotion lifecycle (scope.md:109-118). A 1.0 user gets only `recruitee`, `recruitis` and `teamio` (`app/_lib/ats/connections-store.ts:70`); there is no Greenhouse or Lever connector row.
- **L1, email replies by a signed Reply-To at the edge.** Depends on C6 and needs a MIME-parser decision (scope.md:122-127). A 1.0 user gets the existing edge handler, which stores mail headers only (`edge/src/index.ts:46`, `:578`).
- **L2, one completion record per hiring decision.** Intended effects per decision with one recovery card (scope.md:129-134). A 1.0 user gets separate effects (`app/_lib/pipeline-entry-action.ts:657`) and a logged `rejection_comms_failed` kind (`app/_lib/decision-attribution.ts:111`), with no card.
- **A council of LLMs as a product evaluator of candidates.** Deferred by the operator 2026-10-17; the multi-model council is dev-time only. The `committee` mode in `app/_lib/group-eval-governance.ts:11` is a different thing: it makes the AI advisory to a human committee.

Also parked by a scope document:

- P21 resumable outreach waves; P14 owned response commitments; P01 draft stored on the entry; P04 interactive chat buttons (scope.md:139-147, "Kept, not chosen").
- Durable `lastOkAt` across restarts (`docs/features/connect/README.md:108`).
- Mailbox OAuth for sending, deferred by the T6 decision (pre-analysis:429-430).
- Organization currency in the database (T4 follow-up) and per-organization logo (T5) (pre-analysis:534-535).

## 3. QUESTIONS FOR THE OPERATOR: ART. 22 AND ART. 50

These are the operator's calls. Each one states what the code does, the decision, and the options.

### Art. 22

**Q1. Knockout gate.** *Built, see the rulings below.* This is what the code did when the question was put: a "no" to a must-have ended the application with no person involved and no pipeline entry; an audit event was written and a decline email went out when an address was known (`app/api/apply/[id]/route.ts:250`, `app/_lib/lead-intake.ts:127`). The test header recorded an earlier owner decision to keep it (`app/api/apply/[id]/ko-decline-door.test.ts:3`). Since the ruling, a "no" files a real entry held behind the `decision` approval, carrying the failed must-have ids; nothing is declined and nothing is mailed at intake; a person confirms the rejection (one letter, naming the must-have) or clears the hold. The compliance screen shows the regime's oversight text beside it (`app/_lib/compliance-regimes.ts:43`, `:85`; `app/features/hiring/decisions/DecisionsComplianceSection.tsx:94`).
Decision: does the gate stay automatic in 1.0?
- A. Keep it. No product change.
- B. Keep the question, but file a held entry for a person to confirm. Adds a queue step at intake and removes the instant decline.
- C. Let each workspace switch it off. Adds a setting; the disclosure copy must then vary.

**Q2. Score-threshold advances.** *As asked, before the ruling below was built:* the policy pass advanced a scored entry out of the entry column, and a non-early-career score of 70 or more after 2 days in screening, with no person (`pipeline/jobfit/automation.py:137`, `:1041`; `app/_lib/automation-pass.ts:440`). Scores from 40 to 69 wait for a person. The clock is off unless `AUTOMATION_SCHEDULER_AUTOSTART=1` (`app/_lib/scheduler-store.ts:126`), but the manual pass applies the same rule.
Decision: is an automatic advance, and the wait of those not advanced, acceptable without a person?
- A. Keep it. No product change.
- B. Queue advances for approval like rejections. More approval cards per pass.
- C. Keep only the entry-column move. Screening advances become a person's.

**Q3. Delegable gates.** Screening and offer gates default to `human`, and a workspace can set either to `auto` (`app/_lib/decision-config-schema.ts:296`, `:298`). On `auto`, a model's advance verdict is ratified and a priced offer goes to the candidate unattended (`app/_lib/automation-run.ts:660`, `:726`, `:730`). Guards exclude shielded candidates, template verdicts and contradicting scorecards.
Decision: does `auto` ship in 1.0?
- A. Ship both as they are. No change.
- B. Remove `auto` for offers only. The setting and `offer_auto_extended` path go; the disclosure text changes.
- C. Remove both. The gate setting becomes display only; `aiDisclosure.body` changes (`messages/en.json:1237`).

**Q4. Bulk approval as a human review.** A recruiter previews a reject set and commits it with one action inside 15 minutes; the token signs the set and is single-spend (`app/_lib/screen-wave-approval.ts:25`, `:93`). The spend ledger is per process (`:73`). The same protocol backs the role-run gates (`app/_lib/role-run-gates.ts:130`).
Decision: is one approval over a set the human involvement 1.0 relies on?
- A. Keep it. No change.
- B. Require an opened or acknowledged row per candidate. Slower waves, a new preview interaction.
- C. Cap the set size per commit. Larger cohorts need several reviews.

**Q5. Ratifying a queued rejection with no note.** A queued reject carries the policy's reason and the score (`app/_lib/automation-pass.ts:486`). A recruiter can accept with no note, and the seal then carries the machine's rationale (`app/_lib/pipeline-entry-action.ts:60`).
Decision: must a person add their own reason?
- A. No. Current behaviour.
- B. Require a note on each ratified reject. One more field per rejection.
- C. Require a choice from a reason list. New catalog, four locales, structured reporting.

**Q6. Who counts as a named approver in open mode.** With no session identity, a wave commit is refused unless `KP_OPERATOR_NAME` is set, and that value is a free string (`app/_lib/screen-wave.ts:311`, `app/_lib/auth/operator-approver.ts:20`). A role-run gate is also refused (`app/api/role-runs/[id]/gate/commit/route.ts:66`). A one-off human action in open mode records only `human:recruiter` (`app/_lib/auth/operator-approver.ts:50`).
Decision: what identity must an adverse decision carry on a keyless local install?
- A. Keep it as is. The env name passes; a single action records the role.
- B. Ask for a reviewer name in first-run setup. A setup step, stored per install.
- C. Require a signed-in account for any adverse action. Ends open-mode rejection and touches the two-minute start.

**Q7. Route to a human review.** The candidate is told to ask for a review by replying to any message (`messages/en.json:1239`, `:2142`; `app/status/[token]/StatusClient.tsx:397`). C6 is out, so no in-app door receives that reply, and a keyless install sends no mail.
Decision: is a reply to the hiring team the review route in 1.0?
- A. Keep the copy. No change.
- B. Add a request button on the status page. A new write path and a queue item, outside the current cut.
- C. Name a contact address per workspace in the copy. A setting and four-locale copy.

### Art. 50

**Q8. Telling the candidate the interviewer is an AI.** The portal requires a ticked consent saying the screen is AI-conducted, enforced at connect (`messages/en.json:2393`, `app/api/interview/connect/route.ts:245`). The spoken self-introduction is a prompt instruction to the provider (`app/_lib/voice/candidate-brief.ts:258`), not fixed audio.
Decision: is the written tick plus an instructed introduction what 1.0 relies on?
- A. Keep it. No change.
- B. Play a fixed pre-rendered statement before the model speaks. New audio per locale and a change to the call start.
- C. Verify the introduction from the transcript and flag sessions without it. A new check; no change to the call.

**Q9. Marking synthetic voice.** The interview speaks generated audio. A search for watermark, C2PA and synthetic in `packages/voice-tts/src` and `app/api/tts` finds nothing. The repo's conformity map records a 2 December 2026 end to the marking grace period (`docs/features/compliance/ai-act-conformity.md:29`, `:145`).
Decision: what marking does generated interview audio carry in 1.0?
- A. None, relying on Q8's disclosure. No change.
- B. Add machine-readable marking at the TTS layer. Differs per provider; a provider may not offer it.
- C. Take the AI voice interview out of 1.0. Human interviews remain the path.

**Q10. LLM-drafted letters.** Rejection and offer letters can be model-drafted (`app/_lib/automation-run.ts:112`). A search of the comms and automation modules finds no AI-authorship line, and the footer holds only data and opt-out links (`app/_lib/comms-dispatch.ts:217`). Outreach letters are released by a person (`app/_lib/automation-run.ts:812`), but a sourced candidate may first hear from the product there, before any page carrying `app/_components/AiDisclosure.tsx`.
Decision: does a candidate letter say that AI drafted it?
- A. No line. No change.
- B. Add a footer line to every model-drafted letter. Needs the `llm` or `deterministic` source at send time and four-locale copy.
- C. Add a line only to first-contact outreach. One template change.

### Rulings, 2026-11-09

These are product decisions by the owner, recorded on 2026-11-09. Counsel has not reviewed them. They do not settle the Art. 22 or Art. 50 questions as legal conclusions; they fix what 1.0 ships.

- **Q9 and Q8: the AI voice interview is OUT of 1.0.** Human interviews remain the path. The voice interview ships switched off behind a default-off flag, `KP_VOICE_INTERVIEW` (on only when exactly `1`; `app/_lib/voice/enabled.ts`), with the code kept. Q8 is moot while voice is off. **Delivered by branch `autopilot/accepted-idea-delivery-998e4e4f`.**
- **Q3: option C.** `auto` is removed for both the screening and offer gates. The gate setting is display only. The `offer_auto_extended` path is removed. `aiDisclosure.body` changes. Existing rows that say `auto` behave as `human`. No column is dropped. Decided, not yet built.
- **Q1: option B.** A knockout keeps its question but files a held entry for a person to confirm. No instant decline. **Built** (branch `autopilot/accepted-idea-delivery-aad2feba`). All three doors (conversational apply, quick apply, the lead core behind channel webhooks) file the entry behind the existing `decision` approval, `approval_detail` carries the failed must-have ids (`app/_lib/knockout-hold.ts`), and the applicant is answered `held`: a person will review, nothing decided. A person's reject sends the one knockout letter (`dispatchKnockoutRejection`) and seals like any human rejection; a person's accept clears the hold, and the entry continues as an applicant. Automation excludes a held entry (`executeAutomationPass`). Existing `ko_declined` events and their analytics are untouched. The 30-day contact sweep of ADR 0019 still covers the ref-less letters written before this change; a new letter is the entry's own outbox row, so the entry's retention (consent expiry, erasure on request) governs it. ADR 0019 is superseded by this ruling and still carries its old text: it needs an amendment from the operator.
- **Q2: option B.** Score-threshold advances queue for approval the way rejections do. **Built** (branch `autopilot/accepted-idea-delivery-94ed12f7`). The policy pass (`evaluate_entry`) still proposes an advance from the entry column and from the screening column (score at or above 70 after 2 days), but `applyPassDecisions` no longer applies it: it files a pending `screening_review` approval carrying the policy's reason and the target stage (`policyAdvanceDetail`, `app/_lib/approval-kinds.ts`) and marks the decision queued through the same encoding as a reject, so the preview and the commit agree and `summary.advanced` is 0 in every committed run. No kind or queue was added. A person's accept moves the entry one stage to the named stage and seals as a human decision; a person's decline (`declineQueuedAdvance`, now reachable as the `decline_advance` action on the single and batch doors and the card's Keep in place button, sealed first as `advance_declined`) leaves it in place and the policy does not propose it again while it stays in that stage. The entry column's branch now also holds on a pending approval (it did not before, so a queued entry would have been re-proposed each tick). Not changed: the screen task's model-verdict advance in `automation-run.ts` (a different door, the Q3 gate). The manual pass applies the same rule. Four-locale copy that said advances stay automatic was corrected.
- **Q10: option B.** Every model-drafted letter carries an AI-drafted footer line, in four locales. BUILT (2026-11-09, branch `autopilot/accepted-idea-delivery-c9510f9d`; owner decision, counsel has not reviewed it, and no legal claim beyond the one line was added). The line is `comms.aiDraftedFooter` (en, cs, de, fr), rendered by `renderCandidateFooters` in `app/_lib/comms-dispatch.ts` from a typed `aiDrafted` field on the send, decided at send time from the draft's stored source: offers read `verdictSource` in the approval detail, held outreach reads the new nullable `outreach_letters.draft_source`. A source of `template` carries no line; `llm`, no stored source (drafted before this) and any unknown word all carry it, because "not AI" is never claimed without proof. A person's edit does not remove it. Rejection letters are templates plus recorded profile gaps and need no line; the interview feedback letter has a model draft, and its caller does not pass the source yet, so it carries the line.
- **Q7: option C.** The review-request copy carries a contact address per workspace, in four locales. BUILT (2026-11-09, branch `autopilot/accepted-idea-delivery-82cdb1df`; owner decision, counsel has not reviewed it, and no legal claim beyond the address was added). `workspaces.review_contact_email` is set in the Workspaces console and passed server-side to the status, interview and apply surfaces and the knockout letter; with none set the line says to contact the hiring team and promises no reply door. No reply inbox was built (C6 stays out).
- **Q4, Q5, Q6: option A.** No change.

## 4. OPEN

- **S1, Slack and Teams desk** (scope.md:87-96). Not on the operator's out list and not in `app/_lib/connect/catalog.ts`. Missing: an in or out call.
- **Prior scope statement.** `docs/product/coverage-plan.md` does not exist on this base. `docs/product/enterprise-readiness.md` and `docs/ship/` state no 1.0 cut. Missing: whether the E0 to E6 rows bind 1.0.
- **AI voice interview: OUT** (owner ruling 2026-11-09, section 3). Ships off behind `KP_VOICE_INTERVIEW`.
- **Modules off the named path:** devcase work samples, Gigs, the `/me` job-seeker module, Polar billing. Missing: an in or out call for each.
- **Shipped work waiting on the owner** (pre-analysis:536-538): T8 key deviation, T9 tunnel exposure, T11, T13 and T15 sign-offs. Missing: the sign-offs and whether 1.0 waits for them.
- **Earlier pre-analysis gaps:** C2-debt, T6 portability, T7 for SMTP, T10 ops warning (pre-analysis:312, :405, :432, :492). Not re-checked on this base. Missing: a status check.
- **Offer page accessibility.** Measured at `f3ebb789b` (`e2e/token-doors-axe.spec.ts`, no key, `KP_OFFLINE=1`): the decline confirm on `/offer/[token]` now passes axe, both on the managed server (6 passed, 2 skipped, exit 0) and on the production build (the two offer tests pass). The comment at `playwright.config.ts:89` is stale. The spec is still not enrollable: on the production build `/status/not-a-real-token` fails at `token-doors-axe.spec.ts:291`, where `locator('[role="alert"]')` matches two elements, the dead-link alert and Next's `#__next-route-announcer__`, a strict-mode violation (3 of 3 runs, exit 1; 5 passed, 1 failed, 1 skipped, 1 did not run). It is a spec selector defect, not an accessibility one. The selector is now scoped (`[role="alert"]:not(#__next-route-announcer__)`, commit `5237efa44`) and the stale comment at `playwright.config.ts:89` is deleted. Re-measured at `5237efa44` on a throwaway clone with a real `npm ci`, no key, `KP_OFFLINE=1`: green on the managed server (6 passed, 2 skipped, exit 0) and on the production standalone build (6 passed, 2 skipped, exit 0), including the dead-link test; no axe violation. Enrolment in `KEYLESS_SPECS` is still open (it needs `.claude/CLAUDE.md` and the pin test changed together).
