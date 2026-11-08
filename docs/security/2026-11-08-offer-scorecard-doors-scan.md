# Offer and human scorecard doors — security scan, 2026-11-08

Scope: `app/api/offer/[token]/route.ts` and `app/offer/`; `app/api/sim/offer-link/route.ts`;
`app/api/sim/offer-draft/route.ts`; `app/api/pipeline/[id]/route.ts`, `entry-actions.ts` and
`offer-letter/route.ts`; `app/_lib/offer-manual-draft.ts`;
`app/api/interview-prep/scorecard/route.ts`; the scorecard helpers in `app/_lib/interview-prep.ts`
and `app/_lib/interview-scorecard.ts`. Base: `d35e536c5`. Charter: `codebase-security-scan`.
Read for context: `92f60d409`, `f79958f7f`, `27be61db5`, and the helpers each door calls.

Method: code reading, with each claim traced to the line that carries it. Only finding 2 was
executed (a test that fails before the fix). Nothing was probed on a running server.

Severity is ranked as in the 2026-10-07 scan. There are no outside users yet, and open mode
(`KP_OPERATOR_PASSWORD` unset) makes every caller an owner by design
(`app/_lib/auth/current-user.ts:60`). Production fails closed unless `KP_ALLOW_OPEN=1`. A finding
that needs seats is rated for a password-mode deployment with real members.

Line numbers are from the tree after the fix commit `aa97ad840`.

## Summary

| # | Finding | Where | Severity | State |
| --- | --- | --- | --- | --- |
| 1 | A read-only seat can read a live offer link from the letter body, then accept or decline for the candidate | `app/api/comms/route.ts:24`, `app/api/pipeline/[id]/timeline/route.ts:22` | **High** | **Closed** by `6d8712c63` |
| 2 | `actor: "sim"` sealed a person's advance or extended offer on a real candidate as the engine's | `app/api/pipeline/[id]/route.ts:245` | **High** | **Fixed** `aa97ad840` |
| 3 | An open offer is never revoked. Accepting one on a closed entry answers "accepted" and tells the ATS | `app/_lib/offer-finalize.ts:76-114,175-177` | Medium | **Fixed** `21540f640` (the follow-on, closing open offers on entry close, is built: `lapseOffersOfClosedEntries` in `app/_lib/offers-store.ts`, fix `6c96cd0e0`) |
| 4 | Accepting a (SIM) offer debits the hire meter and fires the ATS webhooks | `app/_lib/offer-finalize.ts:132,168,175` | Medium | **Fixed** `555d3a1cd` |
| 5 | The scorecard gate writes the approval with no compare-and-swap | `app/api/interview-prep/scorecard/route.ts:286` | Medium | **Fixed** `298240805` |
| 6 | The scorecard GET hands the whole panel, with user ids, to any seat, including an interviewer who has not scored yet | `app/api/interview-prep/scorecard/route.ts:118-124` | Low | **Fixed** `e0c51ca35` (the reviewing role is `team:manage`, the closest the capability map has; the panel now reads a count, `othersCount`) |
| 7 | `rating: null` is stored as the worst rating | `app/api/interview-prep/scorecard/route.ts:197-199` | Low | **Fixed** `9aabc8a9a` |
| 8 | A scorecard files and seals on a closed entry, and with no ratings; the seal names a role, not the person | `app/api/interview-prep/scorecard/route.ts:184,252-262` | Low | **Fixed** `6f754b731` (the seal's actor proven only against `humanActor()`; an identified session is not exercised in a unit test) |
| 9 | Manual salary coercion: `true` is 1, `"abc"` is silently unpriced | `app/_lib/offer-manual-draft.ts:34,51`, `app/_lib/offer-policy.ts:197-205` | Low | **Fixed** `95a8e893d` |
| 10 | The manual draft re-checks the approval but not the stage or status across an await | `app/_lib/offer-manual-draft.ts:45,56,70` | Low | **Fixed** `b152a8ada` |
| 11 | A dead offer link keeps showing name, salary and company | `app/_lib/offer-finalize.ts:207-238` | Low | **Fixed** `dc7f8fe54`, narrowed: once expired, status and job title only. An answered offer keeps its terms, because the link holder is the candidate and this is their own record (the expired page was not checked in a browser) |
| 12 | Unbounded JSON bodies; no limiter on the two sim doors | `app/api/pipeline/[id]/route.ts:94`, scorecard `:158`, `app/api/sim/offer-draft/route.ts:19` | Low | **Fixed** `4b1a394a2` |
| 13 | Open mode has no Origin check, so a web page can drive these doors | `proxy.ts` (no origin check), bodies read with `request.json()` | Low (open mode only) | **Fixed** `c75aa0f8a` |

## Answers to the five questions

### (1) Who can reach each door

| Door | Gate | Tenant scope |
| --- | --- | --- |
| `GET`/`POST /api/offer/[token]` | Public by design (`app/_lib/auth/public-routes.ts:76`). The token is the authority. | The offer row's own `workspaceId` (`offer-finalize.ts:88,193`) |
| `GET /api/sim/offer-link` | `withWorkspace`; no capability. Admits only a (SIM) entry. | `resolveSimEntry` (`app/_lib/sim-entry.ts:33-37`), then the row's workspace (`:47-50`) |
| `POST /api/sim/offer-draft` | Same | Same |
| `GET /api/pipeline/[id]` | `withWorkspace`, `requireOperator` (`route.ts:64`) | `getPipelineEntry(id, ws)` |
| `POST /api/pipeline/[id]` | `withWorkspace`, `requireOperator` (`:90`), per-action `pipeline:write` from the action table (`:108`, `entry-actions.ts:36-47`) | Every branch passes `ws` |
| `GET .../offer-letter` | `withWorkspace`, `requireOperator` (`offer-letter/route.ts:26`); no capability, as for the board reads | `getPipelineEntry(id, workspaceId)` (`:30`) |
| `POST /api/interview-prep/scorecard` | `withWorkspace`, then `pipeline:write` first (`:146`) | `getPipelineEntry(entry, ws)` and `getInterviewPrep(entry, ws)` (`:173,184`) |
| `GET /api/interview-prep/scorecard` | `withWorkspace` only (finding 6) | Same scoped reads (`:113-114`) |

Open mode: `requireOperator` and `requireCapability` are no-ops and the caller is owner. That is
the documented posture, and it leaves each door's limiter as its only bound (`route.ts:42`,
scorecard `:41`). The two sim doors have no limiter (finding 12).

Cross-workspace: clean. A foreign entry, offer or submission id answers the same 404 as a
missing one on every door. `ensureHumanOnlyPrep` runs only after the scoped entry read and stamps
that entry's own workspace (scorecard `:185-186`). `fileHumanScorecard` is keyed by entry id
alone, but it is reached only past that read.

A demo session cannot use these doors for real data: `isOperator` and `resolveCaller` refuse it
(`require-operator.ts:36`, `current-user.ts:62`), and its workspace holds nothing else.

### (2) Offer token

- **Entropy:** clean. 24 CSPRNG bytes, about 192 bits (`app/_lib/random-id.ts:31-32`, called at `offers-store.ts:161`). Limiters are keyed per IP and token, so they do not slow guessing, and at this entropy that does not matter.
- **Expiry:** clean. Default 7 days, bounded 1-90 (`offer-policy.ts:15-16,36-40`). Lapse is checked on every read and answer (`offer-finalize.ts:29,208`) and swept by the heartbeat (`offers-store.ts:229`). Only legacy rows with a NULL deadline never lapse, which is a documented fail-open (`offer-policy.ts:81-82`).
- **Revocation:** there is none, apart from erasure nulling the token (`app/_lib/db/pipeline.ts:2557`). Finding 3.
- **Single use and replay:** clean. `markOfferResponded` is a compare-and-swap on `status = 'extended'` (`offers-store.ts:386-388`). Side effects belong to the winner alone. A replay answers the recorded status with `alreadyResponded: true` and changes nothing. A racing lapse answers expired, not "declined" (`offer-finalize.ts:66-73`).
- **Read-back:** `sim/offer-link` gives a token only for a (SIM) entry (`app/api/sim/offer-link/route.ts:33`, `sim-entry.ts:47-50`). The letter preview uses a placeholder (`comms-letter-preview.ts:38,93`). The timeline's offer items carry no token (`candidate-timeline.ts:328-335`). The extend response returns `link` to the person who approved it (`pipeline-entry-action.ts:369,373`), which is expected. **The letter body is the leak: finding 1.**
- **Dead or wrong token:** clean. One coded 404 with no data (`route.ts:29`, POST `:61`). `page.tsx:21` reads the row only for the workspace id, and a wrong token gets the default regime's public disclosure. The page has no raw HTML sink. An expired or answered link still shows its terms: finding 11.

### (3) Scorecard integrity

- **Actor source:** clean. The body is read for `ratings`, `summary` and `recommendation` only (`:158-162`). `author`, `authorLabel` and `stage` come from the session and the entry (`:90-94,240`). `source` is forced to `"human"` (`:218`, `interview-prep.ts:184`). A rating cannot set `offRubric`, because only `competency`, `rating` and `evidence` are copied (`:201`).
- **Overwriting a colleague:** clean. Records are keyed by (author, stage), a save replaces only its own key, and legacy records are unclaimable (`human-scorecard-set.ts:76-92`). The read-merge-write is `.immediate()` (`interview-prep.ts:181-192`). In open mode or on a shared-password session there is no identity, so one slot per round is shared. That is documented (`human-scorecard-set.ts:23-25`).
- **AUTO versus human, after `27be61db5`:** the scorecard door can only file a human kind (`:254`, `:292`). The real gap was the other direction on the pipeline door: a person's act could be filed as the machine's. Finding 2, fixed. A person's name still cannot be claimed on someone else's behalf, because `sealActor` is session-derived (`pipeline-entry-action.ts:390`).

Whether a given attribution meets Art. 22 or Art. 50 is the operator's call; this report takes no position.

### (4) Manual offer draft

- **Bounds:** the figure and currency pass `validateOfferTerms` on draft and again on extend (`offer-manual-draft.ts:51`, `pipeline-entry-action.ts:279`). Range is above 0 and up to 100,000,000; the currency list is closed. Coercion edge cases: finding 9.
- **Text fields:** the manual draft takes no free text from the caller. Subject and body are catalog templates filled with the entry's label and title (`offer-manual-draft.ts:57-60`).
- **HTML:** clean. The offer page is React with no `dangerouslySetInnerHTML` under `app/offer/`. The letter is plain text, and the SMTP builder folds CR/LF out of headers (`comms-smtp.ts:98`, tested at `comms-smtp.test.ts:235`).
- **LLM prompt:** clean. The manual draft calls no model. No code under `pipeline/` reads `humanScorecard`, and no TypeScript consumer of it passes it to a model.
- **Rate limits:** `draft_offer` and the board moves share 300 per 10 minutes per IP (`route.ts:42,220`). Scorecard writes 60 per 10 minutes (`:41`). Offer view 60 per minute and respond 10 per minute per token and IP (`route.ts:14,42`). The sim doors have none: finding 12.

### (5) Secrets and dependencies

- **Errors:** clean. Failures answer codes through `safeJsonError`; tokens are not put in error bodies or log lines. Log lines on these paths name offer and entry ids (`offer-reminders.ts:49`, `offers-store.ts:448`). The limiter holds the raw token as an in-memory key only.
- **Not verified:** a dispatch failure logs the relay's own detail (`pipeline-entry-action.ts:344`), and I did not trace every relay error string. The token is in the URL path, so any reverse-proxy access log in a deployment will hold it. `Referrer-Policy: strict-origin-when-cross-origin` keeps it out of cross-site referrers (`next.config.ts:27`).
- **Dependencies:** `npm audit --omit=dev` reports 5 moderate and no high or critical: `@sentry/*`, `glob`, `minimatch`. None handles request input on these doors as far as the imports show; I did not trace each advisory. Python dependencies were not audited because none of these doors spawns the pipeline.

## Findings

### 1. A read-only seat can read a live offer link (High, closed `6d8712c63`)

An offer letter is stored in the outbox with its link in the body (`composeOfferLetter`,
`app/_lib/comms-dispatch.ts:691-712`). Two reads return that body:

- `GET /api/comms` asks only `withWorkspace` (`app/api/comms/route.ts:24`) and returns the rows (`:44-52`).
- `GET /api/pipeline/[id]/timeline` asks `requireOperator` (`timeline/route.ts:22-24`), which a viewer passes. The body rides `toCandidateComm` (`app/_lib/candidate-timeline.ts:109`).

**Exploit:** a `viewer` seat (only the `read` capability, `app/_lib/auth/roles.ts:36`) reads the
letter, takes `/offer/<token>`, and POSTs `{"response":"accept"}` or `"decline"` to the public
door. Accept hires and fires the ATS handoff. Decline closes the entry, and the row's CAS makes
the answer final. The candidate's act is forged with nothing naming the person. `sim-entry.ts:10-13` already treats this exact capability, a viewer holding a real offer token, as a defect
on the sim doors; the outbox is the path that remained. Tenant-bound: another team cannot do it.

**Fix (`6d8712c63`):** one pure projection, `app/_lib/comms-link-redaction.ts`, rewrites the
`/offer`, `/schedule`, `/status`, `/data`, `/stop` and `/interview` links in a letter body to a tokenless
placeholder unless the caller holds `pipeline:write`. It is applied on `GET /api/comms`, the pipeline
timeline and `GET /api/devcase/comms`. Stored rows, send, resend and the composer are untouched. The projection also covers the
other token-bearing letter kinds named above, though they were not audited one by one. Tests:
`app/_lib/comms-link-redaction.test.ts` and
`app/api/comms/comms-link-redaction-routes.test.ts`.

### 2. The engine claim falsified a real candidate's record (High, fixed `aa97ad840`)

`engineClaimOf` forwarded `actor: "sim"` on every accept. In `runPipelineEntryAction` that made
`sealActor` `auto:sim` (`app/_lib/pipeline-entry-action.ts:383,390`) and the kind `auto_advanced`
(`:587`). It also passed into `extendDraftedOffer` (`:454`), so a real offer's `offer_terms`
record said `auto:sim`.

**Exploit:** anyone with `pipeline:write` sends `{"action":"accept","actor":"sim"}` for a real
entry. The advance or extended offer is written into the tamper-evident chain as a machine's,
the person's name is gone, and the automation counts move. Same class as finding 1 of the
2026-10-07 scan, which also rated High a sealed record falsified by a client.

**Fix:** the claim survives only on a (SIM)-titled entry (`entry-actions.ts`, `route.ts:245`);
otherwise it is dropped and the session's human is recorded. Tests:
`app/api/pipeline/engine-claim-door.test.ts` (failed before the fix) and
`entry-actions.test.ts`. Offer extension itself is unchanged.

**Residual:** the marker is a substring of the job title (`app/_lib/sim-marker.ts`). A person who
can title a role "(SIM)" regains the claim, but that also keeps the role's letters off the real
channel (`comms-dispatch.ts:290`) and out of analytics, so it cannot reach a real candidate as
a real decision.

### 3. An open offer is never revoked (Medium)

Nothing moves an offer off `extended` when the entry is rejected, closed or moved: the only
status writers are lapse and response (`offers-store.ts:214,235,387`).

**Exploit:** a candidate is rejected or the role closes while the link is live. The page still
offers Accept. The CAS claims the row, `actOnPipelineEntry` refuses (`offer-finalize.ts:88`), and
the entry records `offer_accept_blocked` (`:113`). But the candidate is told `ok: true, status: "accepted"` (`:177`), and `offer.accepted` goes to the ATS unconditionally (`:175`), unlike the
decline path which is guarded (`:199`). If a recruiter moved the entry back a stage, the accept
advances it one stage from wherever it stands.

**Fix:** refuse the response when the entry is closed or no longer on an offer-role stage, and
hold `offer.accepted` on the same condition as the decline. Close open offers when an entry
closes. `offer-finalize.ts` and `offers-store.ts` are outside this task's paths. What a candidate
sees in that state is a product call.

### 4. A (SIM) offer accept reaches billing and the ATS (Medium)

`respondToOffer` has no SIM check, and neither `recordMeterUsage`
(`app/_lib/billing/entitlements.ts:316`) nor `dispatchAtsEvent` (`app/_lib/ats-egress.ts:490`)
has one. The guided sim's last step accepts through the public door
(`useSimulationWalk.ts:635`).

**Exploit:** running the demo on a workspace with an ATS webhook sends a fabricated
`candidate.hired` and `offer.accepted` to the customer's system and debits one hire. The comms
layer and analytics already exclude (SIM); this path does not.

**Fix:** treat an entry with a (SIM) title as not hire-bearing in `offer-finalize.ts`. Outside
this task's paths.

### 5. The scorecard gate has no compare-and-swap (Medium)

The approval kind is read at `:173`, an `await` follows at `:240`, and the write at `:286` is a
plain `setApproval` with no `expectedApprovalKind`, though the store offers it. That breaks the
repo's read→compute→write rule.

**Exploit (race):** an AI `scorecard_review`, an `offer_review` or a recruiter's resolution lands
in the gap and is overwritten by this card. No privilege is gained; a decision card is lost.

**Fix:** pass `{ expectedApprovalKind: pipelineEntry.approvalKind }` and only record the event
and return `gated: true` when it wrote. Inside this task's paths; left for after the push, as
it is Medium.

### 6. The scorecard GET exposes the whole panel (Low)

`records` (`:118,122-124`) carries every interviewer's verdict and `author` user id to any session
in the workspace. The form seeds only from `mine`, but the file's own stated standard is no access
to the first rating before recording the second (`human-scorecard-set.ts:7-10`), and display
surfaces strip `author` (`:129-130`). Team-bound.

**Fix:** omit other authors' records until the caller has filed for this round, unless they hold a
reviewing role, and pass the list through `humanScorecardViews`.

### 7. `rating: null` becomes the worst score (Low)

`Number(null)` and `Number("")` are 0, so they pass the finite check and clamp to 1 (`:197-199`),
though the comment says an unrated competency is omitted. The shipped form filters nulls
(`ScheduleHumanScorecardPanel.tsx:197`), so this needs a hand-made request or a client bug.

**Fix:** accept a number, or a non-empty numeric string, only.

### 8. Scorecard edge states and the seal's actor (Low)

When a prep already exists, a closed or hired entry still accepts a card and seals it (`:184`).
A recommendation with no ratings still opens the Interview to Offer gate (`:279`). The seal's
actor is the role `human:recruiter` (`:254`) while the event beside it names the person (`:289`);
the name is in the seal's `inputs` as a user id.

**Fix:** require an active entry to write and at least one rating to gate; seal with `humanActor()`.

### 9. Salary coercion (Low)

`Number(true)` is 1 and `Number([5])` is 5, so a non-numeric body value becomes a figure. A typed
`"abc"` is treated as unpriced instead of refused, and also skips the band midpoint
(`offer-manual-draft.ts:34`, `offer-policy.ts:197-205`). The recruiter still approves the card
before anything reaches a candidate.

**Fix:** in `draftManualOffer`, refuse a typed value that is not a number or numeric string.

### 10. The manual draft does not re-check stage or status (Low)

The stage and status are read at `:45`, `namespaceTranslator` is awaited at `:56`, and the CAS at
`:70` covers only the approval kind. An entry rejected in that gap gets an `offer_review` card, and
the accept branch that extends it runs before the terminal check
(`pipeline-entry-action.ts:453` before `:566`). The window is one short await.

**Fix:** re-read the entry after the await and before `setApproval`.

### 11. Dead links keep their data (Low)

`offerView` returns the candidate's name, salary, company and notes for any status
(`offer-finalize.ts:207-238`), so an answered or expired link shows them until erasure.

**Fix:** return status and job title only once an offer is expired, or some window after it is
answered.

### 12. Unbounded bodies and unthrottled sim doors (Low)

Only the public offer door caps its body (`app/api/offer/[token]/route.ts:35,52`).
`request.json()` is unbounded at `pipeline/[id]/route.ts:94`, scorecard `:61,158` and
`sim/offer-draft/route.ts:19`; `MAX_RATINGS` applies only after the parse. The two sim doors have
no limiter, though they touch demo rows only.

**Fix:** `readJsonWithLimit` on all three; a limiter on the sim doors.

### 13. Open mode has no Origin check (Low, open mode only)

These doors parse JSON without requiring its content type, so a cross-site `text/plain` POST is a
simple CORS request, and open mode needs no cookie. A page visited by someone running an open
instance could drive the write doors if it knows an entry id, and ids are derived
(`m-<candidateId>-<jobId>`). The response is unreadable to the page. With a password set the
session cookie is `SameSite=Lax` (`session-issuer.ts:89`), which blocks this.

**Fix:** a same-origin check in the proxy for state-changing `/api` calls. **Fixed** `c75aa0f8a`: `app/_lib/auth/same-origin.ts` (pure, tested) is called from `proxy.ts` ahead of the auth decision in every mode; POST/PUT/PATCH/DELETE to `/api` answer 403 when `Sec-Fetch-Site` is `cross-site` or `Origin` (including `null`) matches none of `x-forwarded-host`, `Host`, `APP_BASE_URL`. Requests with neither header (CLI, server-to-server) pass. Exempt: the five machine-sender webhook paths. Spec: `e2e/same-origin-write-door.spec.ts`.

## Checked and clean

Cross-workspace reach on every door. Capability order (refused seats spend no limiter and learn
no ids). Token entropy, expiry, single use and replay. The dead and wrong token responses. Body
fields cannot name an actor, interviewer, round or kind on the scorecard or notes doors. Scorecard
isolation between interviewers and the `.immediate()` merge. Offer terms validated twice. Offer
page and letter HTML escaping, subject header injection, and LLM prompt reach. `ttlDays` resolved
rather than trusted (`offer-policy.ts:36-40`). Candidate-facing projection: `offerView` lists its
fields and keeps the letter text off the wire (`offer-finalize.ts:216-238`). Letter preview mints
no token and writes nothing.

## Not in this scan

Other token-bearing letters beyond the offer (see finding 1), the batch and command doors (covered
on 2026-10-07; the batch route forwards no `actor`), the AI offer draft, and live probing.
