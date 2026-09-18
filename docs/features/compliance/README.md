# Compliance & trust

The compliance surface kp ships today: candidate-facing consent/erasure/
explanation, a per-tenant hash-chained decision record (tamper-*resistant* only
with an HMAC key configured — see Flows), human-oversight gates on adverse
actions, and an internal EU AI Act posture board. See
`ai-act-conformity.md` in this folder for the full article-by-article map and
open-gap register — this file is the "what exists and where" index.

## Entry points

| Surface | Route / component | Audience |
|---|---|---|
| Compliance posture board | `app/trust/page.tsx` → `app/trust/TrustContent.tsx` | Internal only (see below) |
| Data summary + erasure request | `app/data/[token]/page.tsx`, `DataClient.tsx` | Candidate (public, token-gated) |
| Application status + decision explanation + NPS | `app/status/[token]/StatusClient.tsx` | Candidate (public, token-gated) |
| Sealed decision dossier (full) | `app/api/decisions/records/route.ts` | Operator only |
| Public compliance summary | `app/api/compliance/route.ts` | Anyone (JSON) |
| Adverse-impact worksheet | `Decisions → Compliance` tab (`app/_lib/adverse-impact.ts`) | Operator, browser-only |

**`/trust` is PUBLIC and INDEXED**, flipped on 2026-08-05 and reversing the
2026-07-30 internal-for-now call. `app/trust/page.tsx` records the reasoning in
its header comment: auditable, verified hiring became the headline claim, and a
headline claim needs its evidence page indexable. The route carries no `robots`
override, is listed in `app/sitemap.ts` (`priority: 0.5`, monthly) and on the
public allow-list in `app/_lib/auth/public-routes.ts`, and is linked from the
landing footer.

Two consequences the earlier revision of this section got wrong. **The gap rows
stay** — a page that admits what is outstanding is the differentiator, so the
old plan of deleting the route once every row reads "enforced" is superseded;
what ships publicly is `trust-posture.ts`'s projection, which already carries no
internal evidence paths and no gap ids. And because the page is indexed, **every
claim on it is a public claim**: a stale row there costs more than a stale row
here. Its content is single-sourced in `app/_lib/trust-posture.ts`
(`OBLIGATIONS`, `CLASSIFICATION`, `SUBPROCESSORS`, `DATA_RIGHTS`,
`DISCLAIMER`) — that module is the live, tested, English-only projection of
the article map in `ai-act-conformity.md` and should be treated as the
authoritative "current posture" when it and the doc disagree.

**The recruiter-facing posture block states its own confidence.** The
compliance section inside the Decision Rules modal
(`app/features/hiring/decisions/DecisionsComplianceSection.tsx`) reads the saved
jurisdiction from `GET /api/decisions/config` and the effective retention
window from `GET /api/compliance`. Both reads can fail, and the block now says
so rather than falling back to a plausible default: an unread jurisdiction
renders the default *labelled* as unconfirmed (or as a failed read), and an
unread retention window prints a line that names no number at all
(`decisions.compliance.covered5Unconfirmed`) instead of the hardcoded "12
months" it used to assert. The two folds are pure and tested
(`decisionsComplianceFold.ts` / `.test.ts`).

## Flows

**Consent → retention → anonymize.** A required consent step
(`app/_lib/apply.ts`) is captured on every apply path and persisted via
`createPipelineEntry({ consentSource })` (`app/api/apply/[id]/route.ts`).
`app/_lib/consent.ts` is the pure core: `consentTtlDays()` (env
`KP_CONSENT_TTL_DAYS`, default 365), `consentExpiresAt`, `consentStatus`
(none/active/expiring/expired/anonymized), and the read-time PII gate
`consentWithholdsPii` (`consent.ts:72`). `app/_lib/db/pipeline.ts` owns the
DB lifecycle: `recordEntryConsent`, `anonymizeEntry` (masks the label, nulls
contact/GitHub fields, scrubs the linked profile + analyses, and — via
`scrubEntryLinkedPii`, `pipeline.ts:1341` — the interview transcript/
scorecard, comms outbox, offer payload, interview-prep payload, the candidate
survey comment, the dev-case family (submission, live-work session, captured chat,
skill credential) and the calibration row, the retired
onboarding intake/signature tables where a pre-removal database still has
them, and rediscovery-alert labels, all in one transaction),
and `anonymizeExpiredConsents` (the sweep, registered in `instrumentation.ts`).
The same heartbeat also runs `notifyExpiringConsents` (`app/_lib/consent-expiry-reminders.ts`):
entries whose consent is in the 30-day `CONSENT_EXPIRING_DAYS` window and that have
no `expiring_notified` event yet get exactly one candidate letter (kind
`consent_expiry`) carrying the existing `/data/[token]` and `/stop/[token]`
footers, claimed by `claimConsentExpiryNotice` in an IMMEDIATE transaction so a
re-tick cannot double-send. Opted-out, anonymized, and already-expired rows are
skipped — expiry itself stays the anonymize sweep's job.

**Interview audio has its own consent and its own clock.** The AI voice interview is
transcript-only unless a workspace turns on `compliance.interviewRecordingOffered`
(Settings → Decision rules → Compliance; default OFF), and then only if the candidate
ticks a **separate** box on the portal — the transcript consent never covers audio.
When both hold, `interview_sessions.recording_consent_at` is the fact, and the candidate's
microphone (never the interviewer's voice, screen or camera) is stored as a file under
`<dirname(KP_DB_PATH)>/recordings/<workspace>/`. **The promise the candidate is shown is
the one the code enforces**: deleted 30 days after the hiring decision, at the latest 180
days after the call (`RECORDING_RETENTION_AFTER_DECISION_DAYS` /
`RECORDING_BACKSTOP_DAYS` in `app/_lib/interview-recording-paths.ts`, interpolated into
`interview.voice.recording.when`), on their own request from `/status/<token>`, or with an
Art. 17 erasure — which deletes the files AFTER `anonymizeEntry`'s transaction commits,
because unlinking a file is irreversible and a rollback cannot put it back. The daily
`interview_recording_retention` job enforces the two windows and the recruiter's playback
door re-checks the same predicate on every read, so a deployment whose clock never started
stops *serving* audio on time even while it is not yet deleting it. In every path the file
is unlinked and the `RecordingMeta` row is kept, stamped with when and why: the deletion is
the record. Full surface in [`../interviews/README.md`](../interviews/README.md).

**Consent gates rediscovery before it ranks, not only at the send door.** `rediscoverForJob` filters the pool through `suppressedCandidateIds` (`app/_lib/rediscovery-alert-store.ts`) and `recordRediscoveryAlerts` refuses a suppressed candidate, so an erased or lapsed-consent person is never ranked, never persisted as an alert row carrying their label, and never shown in the feed — see *Rediscovery honors consent before it ranks* in [`../jobs/README.md`](../jobs/README.md).

**The erasure list is pinned to the tenancy manifest.** The full-scrub test used to
assert that the tables it knew about were clean, and nothing asserted that the set of
tables it knew about was the set of tables holding candidate data. So a new per-tenant
table could join `TENANCY_SCOPED_TABLES` (`app/_lib/tenancy.ts`, which IS
machine-checked) and stay invisible to erasure — which is how the candidate survey
comment, the whole dev-case family and the signed skill credential came to survive an
Art. 17 request while `/data` told the candidate their data was gone.
`erasure-full-scrub.test.ts` now reads the manifest and requires every scoped table to
be one of three things: **written** by the erasure region (it parses the SQL out of
`db/pipeline.ts`, so a claim cannot outrun the code), **delegated** via
`ERASURE_DELEGATED_SCRUBS` (currently `profiles` → `anonymizeProfile`), or listed in
**`ERASURE_EXEMPT`** (`db/pipeline.ts`) with the legal or factual reason it is lawfully
retained. Adding a table to the manifest without doing one of the three turns the suite
red. `ERASURE_EXEMPT` is the list a DPO reads: it carries `decision_records` (the
Art. 17(3)(b)/(e) hash chain), `dev_session_events` (the tamper-evident observed-process
log, which holds no identifiers), `consent_events` (the Art. 5(2) proof that the erasure
happened cannot be what the erasure deletes), `outreach_state` (deleting it would re-arm
the contact it prevents), `ats_links` and `llm_usage`, among others.

**What the dev-case reach added.** Those rows are keyed by *submission*, never by entry
id, which is why the scrub never saw them. The join is the entry's own
`dev_submission_id` (written at promote, `devcase-run.promoteSubmission`) plus the legacy
reading of a pre-link entry whose candidate id was `ds-<submissionId>` — the same order
`dev-outcomes.hireOutcomeRef` uses, because the two disagreeing is how a row gets missed.
Through it, erasure now also masks `dev_submissions.candidate_ref` and nulls its
`contact`/`notes`, drops `dev_sessions.files_json` (the candidate's authored tree) and
blanks `dev_session_chat.text` (their verbatim prompts), and **revokes** the
`skill_profiles` credential as well as emptying its payload — an erased credential that
still verified would be a public page vouching for a scrubbed person. `candidate_nps`
loses its free-text `comment` (the 0-10 score stays: it names nobody and is the
candidate-experience measurement), and `dev_outcomes` loses `candidate_ref` and `note`
while keeping the predicted-score / outcome / rating pairing — a de-identification, not a
deletion. `dev_submissions.eval_json` and `transfer_score` likewise stay as the retained,
de-identified assessment record.

**An erasure happens exactly once, under concurrency.** Two doors reach
`anonymizeEntry` — the consent-expiry sweep and the candidate's own
`/data/[token]` request — and the "already scrubbed" check used to be a bare read
on a DEFERRED transaction, so both could pass it before either wrote. The second
pass then masked an already-masked label, re-ran the whole linked-PII scrub, and
logged a **second** `consent_events` row, so the accountability record (Art. 5(2))
showed one candidate erased twice. The transaction now runs `.immediate()` and its
claiming UPDATE re-asserts `anonymized_at IS NULL`, returning the row unchanged on
`changes === 0`. The candidate-facing guarantee is unchanged — an erasure was
always meant to be idempotent; the implementation now matches it, and
`pipeline-erasure-once.test.ts` pins the single consent event.
`decision_records` is **deliberately excluded** from the scrub — the code
comment at `pipeline.ts:1332-1335` states the GDPR Art. 17(3)(b)/(e)
legal-claims/compliance basis for retaining the sealed chain post-erasure.

Inside an analysis/profile payload the scrub is `scrubPiiFromPayload`
(`consent.ts`), which walks the blob generically: keys in `PII_KEYS` are blanked
(`name`, `rawText`, `email`, `phone`, `explanation`, …), arrays in
`PII_ARRAY_KEYS` (`evidence`, `parsingNotes` / `parsing_notes`) are emptied, and
the free-text CONTAINERS in `PII_CONTAINER_KEYS` — `evidenceTrace`,
`extractionComparison`, `interviewKit` — are deep-redacted subtree-wide. The
last two matter because the pipeline stores the uploaded CV text **three** times:
`candidate.rawText` plus `extractionComparison.{pypdfText,geminiText}`
(`pipeline/jobfit/pipeline.py` populates that on every run), so blanking
`rawText` alone left an identical copy of the CV — name, email, phone — readable
in History and `/api/analyses/[slug]` after an Art. 17 erasure. `explanation` and
`interviewKit.summary` are name-bearing for the same reason: the deterministic
(keyless) builders interpolate `candidate.name` straight into them.
`metadata.parsingNotes` is the same class of leak one key over: the extractor's
free-text commentary on the document, recruiter-visible on the saved report, and
not a retained score. Retained, as before: scores, skills, seniority, role
family, salary band, traits.

**Erasure survives a restart.** The shipped demo corpus is not inert: `ensureDb()`
re-runs `seedCandidates` and `seedAnalyses` on **every** boot (no empty-table guard,
by design, so a regenerated seed refreshes the pool without a DB reset), and 54 of the
seeded pipeline entries resolve to a `cand-*` profile and a `seed-*` analysis. Both
seeders therefore write the exact columns `anonymizeEntry` scrubs — the label and the
CV payload — so a re-seed used to hand the erased candidate's name and full CV back on
the next restart. `app/_lib/db/core.ts` now gates both upserts: `seedCandidates`
refreshes a row only while `profiles.updated_at IS NULL` (the marker meaning the
product has never written it — `saveProfile` stamps it at birth, `updateProfile` on
every content write, and `anonymizeProfile` goes through `updateProfile`), and
`seedAnalyses` skips any row linked — by `anonymizeEntry`'s own normalized-label +
workspace rule — to a `pipeline_entries` row carrying `anonymized_at`. Untouched seed
rows still refresh. `seed-analyses-preserve.test.ts` pins both directions.

**The “what we hold” list never over-claims, on either side.** `heldDataCategories`
(`app/_lib/data-held.ts`) projects the categories from what the entry ACTUALLY has, and
the route sends them. The client (`app/data/[token]/DataClient.tsx`) used to fall back to
`Object.keys(heldLabel)` when the field was absent, which re-armed the same hardcoded
five-item claim it removed — on a response that simply said nothing. `renderableHeldCategories`
replaces it: a missing or malformed field renders NOTHING, unlabelled and repeated keys are
dropped, and the “What we hold” heading is hidden with the list rather than left over an
empty box. Pinned in `app/_lib/data-held.test.ts`.

**The jurisdiction route answers the shaped envelope.** `GET /api/compliance` returns
`{ jurisdiction, consentRetentionMonths }` — the caller’s active regime (normalized at the
read boundary, so a stale or hand-edited row lands on the EU default rather than an empty
legal framework) and the window derived from `KP_CONSENT_TTL_DAYS`. It had no `try`/`catch`:
`getActiveRegimeId` opens the decision-config store’s own SQLite connection, so a locked or
unreachable database threw out of the handler and Next answered its framework 500 — an
unreadable body on the route that feeds the candidate-facing AI disclosure, with the raw
SQLITE_* detail and db path closest to a public surface. It now answers
`safeJsonError(…, "COMPLIANCE_LOOKUP_FAILED")`. Pinned by `app/api/compliance/compliance-route.test.ts`
(happy envelope, unknown-regime normalization, coded failure with no thrown detail on the
wire) and `app/_lib/compliance-regimes.test.ts`, which pins the normalization boundary and
the deliberate rule that only the US names a codified adverse-impact standard (the EEOC
four-fifths rule) — every other regime’s null is the contract, not a gap.

**Self-service erasure.** `ensureErasureToken` mints a per-entry token;
`app/data/[token]/page.tsx` + `DataClient.tsx` render the candidate's held
data and an erase button; `app/api/data/[token]/route.ts` handles GET
(projection) and POST (→ `anonymizeEntry`). GET already projects
`consentExpiresAt`; the page now formats it through `useDateFormat().date`
(`data.keptUntil`) so the person the TTL is about can see how long we keep
them, and a malformed expiry cannot print "Invalid Date". Anonymized entries
do not show a future expiry. The erase explainer and confirm name the limit
already stated on `/trust`: in-product erasure cannot reach a hosted voice
provider's copy of an interview. The token is carried in comms email footers.

The page distinguishes a **dead link** from a **transient fault**, because the
two need opposite reactions from the candidate: only a `404` renders the
terminal "this link has expired or is no longer valid" copy, while a `5xx` or a
dropped connection resolves the retryable `errors.DATA_LOOKUP_FAILED` message
(no page-local copy — `safeJsonError` already returns that code and all four
catalogs carry it). `anonymizeEntry` NULLs `erasure_token`, so a POST that
already landed — a second tab, or a response lost in flight — makes every
retry `404`; a failed erase therefore re-reads the entry before showing an
error, and treats a consumed token or an `anonymized` entry as **erased**.
Telling a candidate their erasure failed on data that is already gone would be
the one lie this surface must never tell.

The page was brought up to the offer door's standard on 2026-09-02, that door
being the reference for every public tokenized surface here. Four gaps closed:

- **The retryable branch now HAS a retry.** Its copy had promised one since the
  dead-link/fault split above landed; the only way to act on it was a manual
  reload, on a page reached from an email footer. `retryLoad` re-runs the same
  `load` callback, and the button renders ONLY for the retryable kind: a retry
  over a `404` is a loop with no exit.
- **A `Skeleton` loading state** shaped like the loaded page, replacing a bare
  line of text that reflowed into a full page on arrival (CLS).
- **A `LanguageSwitcher`**, mirroring the offer and status doors. The footer link
  is `?lang=`-pinned to the language of the LETTER it rode on, but a forwarded
  link or a stale `NEXT_LOCALE` cookie can still land a reader on this page in a
  language they do not read, and an erasure explainer is a legal affordance with
  no other chrome to escape through.
- **The erase confirm is a real `role="alertdialog"`** on the shared
  `useDialogA11y` hook (focus move in, Tab trap, Escape, focus restored to the
  trigger), with **Cancel first in the DOM** so the hook's "focus the first
  focusable" lands a keyboard user on the safe option and the destructive button
  sits last. It had been a plain `<div>` holding two buttons, destructive first,
  with no focus handling at all — for an irreversible action. Escape is ignored
  while the POST is in flight: the write is already irreversible and a vanished
  dialog would leave its result nowhere to land.

Every control on the page is now composed from `app/_components/ui/recipes.ts`
and sized `h-11` (44px, WCAG 2.5.8 AA) — as are the invite accept form and the
sign-in form, the other two doors opened from a link on a phone.
`app/data/[token]/token-doors-surface.test.ts` is the source guard for all
three: recipe use, the touch-target floor, the alertdialog wiring and the
Cancel-before-destructive DOM order.

That guard now scans **seven** files, not three: the offer card, the status
page, its NPS card and the sign-up form joined it (/perfect wave 20), because
each had hand-rolled the controls the first three had already stopped
hand-rolling. What changed on the two doors in this document:

- **The status page's retry and refresh** are `BTN_PRIMARY_LG` / `BTN_GHOST` at
  44px; the NPS scale's eleven cells were 36px and are now 44px (the scale keeps
  its own selected/unselected tint — no `BTN_*` recipe expresses a scale, and
  the guard exempts `role="radio"` on that ground alone). The five-step
  timeline marks the current `<li>` with `aria-current="step"` (the WAI-ARIA
  step-list token; the other four stay unset), same job `ChapterRail` does with
  `aria-current="location"`. Pinned by `status-decision-kinds.test.ts`.
- **The NPS failure is a `role="alert"` and the thanks swap a `role="status"`.**
  "That didn't go through" announced nothing: a screen-reader user pressed Send
  and heard silence over an answer that had been DROPPED, and the success case
  replaced the whole question card just as silently.
- **The two status doors, the Art. 86 decisions door, and the erasure door answer refusal CODES**, not bare
  English. `STATUS_LINK_INVALID` (404 on `/api/status/[token]`, its `/nps`
  sibling, and `GET /api/status/[token]/decisions` — one refusal for "no such token"
  and "no such entry", so the door is not an existence oracle), `STATUS_NPS_NOT_APPLICABLE` (409 for
  feedback on a still-running application), `NPS_SCORE_REQUIRED` /
  `NPS_SCORE_INVALID` (`parseNpsSubmission` refuses with a code, never an English
  `reason`; `POST /api/status/[token]/nps` answers `jsonRefusal(parsed.code, 400)`),
  and `DATA_LINK_INVALID` (404 for a
  never-issued or already-spent erasure token). All are in `REFUSAL_ERRORS`
  with four catalogue entries each; the page resolves `errors.<CODE>` in the
  reader's language (`docs/architecture/api-contracts.md` §1.1). Pinned by
  `app/api/status/status-decisions.test.ts` and `app/_lib/candidate-nps.test.ts`.

`e2e/token-doors-axe.spec.ts` now sweeps `/status/[token]` in two states — the
loaded timeline and the dead-link alert — beside the offer, erasure and invite
doors it already covered.

**Decision sealing + candidate explanation.** Every automated or human
adverse action is sealed into a per-tenant, hash-chained record
(`app/_lib/decision-record-store.ts`: `sealDecisionRecord`,
`verifyDecisionChain`).

**The seal is HMAC-SHA256 only when `KP_DECISION_HMAC_KEY` is set** (UAT
`LUC-ANA-1`). This sentence used to claim HMAC unconditionally; it is not what
the code does, and the default deployment is the other case. With no key
configured, `sealDecisionRecord` falls back to the keyless
`decisionContentHash` (a plain SHA-256 over `prevHash + payload`) and stores
`key_id = ''`. Such a chain is **integrity-evident** — it detects accidental
corruption, an *interior* deleted or reordered row, and an edit by anyone who
does not re-hash — but it is **not tamper-resistant against an insider**: the algorithm
is public and secret-free, so whoever can write `decision_records` can
recompute every link. `decision-record-store.test.ts` asserts exactly that
("a keyless chain ACCEPTS an insider re-hash") as the non-vacuity proof for
the keyed path. `verifyDecisionChain` therefore returns a **key census**
(`keyed`, `keylessCount`, `firstKeyedSeq`) beside `ok`, the records panel
conditions its badge on it, and each row shows its own `key_id`.

**TRUNCATION IS NOT DETECTED, at any key setting.** `verifyDecisionChain` walks a
workspace's rows in `seq` order and checks each link against its predecessor; it
holds no commitment to the chain's HEAD or LENGTH, so deleting the *newest* k rows
leaves a shorter chain that still returns `ok: true` (and `keyed: true` on a keyed
chain). Interior deletes and reorders still break the next link and are caught.
Closing this needs an anchor outside the row set — a per-tenant head pointer MAC'd
under the same key, which a deleter cannot re-sign — and is not built yet.

**No record is sealed for a decision that did not happen.** The screening wave seals
the Art. 22 record *before* it flips the status (`app/_lib/screen-wave.ts`), so a
rejection is never applied unrecorded. That ordering used to leave a residue: the
commit loop awaits a comms dispatch per rejection — a real relay round-trip, so the
event loop yields — and a recruiter moving a *later* candidate mid-wave made that
candidate's optimistic CAS refuse *after* their record was already sealed. The chain
is append-only, and an `auto_rejected` record is not inert: `status-decisions.ts`
renders it to the candidate on `/status/[token]` with the score and threshold,
`ats-egress.ts` ships the latest record to the customer's ATS as their decision, and
`heldOutEntryIds` drops them from the calibration clean arm. A failed **holdout** seal is now handled the same
way: `heldOutEntryIds` derives the calibration clean arm from the sealed holdout rows and
from nothing else, so an unwritable chain silently dropped the candidate from the arm
while the wave still reported a row reading "kept as a calibration holdout". The failure
is counted into `sealFailures`, the row carries `reasonCode: "holdoutSealFailed"`, and
the audit event says the record was not written instead of asserting a membership that
does not exist. The candidate stays spared either way — they left the reject set before
the approval was signed, so a failed holdout costs a calibration data point, never a
person. The wave now re-reads the
live row and skips (`reasonCode: "staleSkipped"`) **without sealing** when the stage or
status has drifted; what remains is the single synchronous statement between that read
and the CAS. The status half also stops a second rejection email to a candidate a
recruiter rejected by hand mid-wave (`reject` is idempotent in `actOnPipelineEntry`, so
the stage CAS alone would have waved it through). Pinned by the mid-wave-drift test in
`app/_lib/screen-wave.test.ts`, which drives the interleaving through a loopback relay.

Two consequences worth stating to an auditor:

**Verification is incremental, with a scheduled full re-hash.** `verifyDecisionChain`
re-hashed every row of a workspace's chain on every call, and `/api/decisions/records`
calls it on every panel mount — so reading the decisions panel cost the customer's whole
decision history, which only grows, while the record list beside it capped at 1000 rows.
A verified prefix now anchors the next run: the process remembers the highest good
`(seq, content_hash, key ids)` per workspace and re-hashes only the rows above it. The
checkpoint is **in-process, never persisted** — a checkpoint row in the DB would be
written by exactly the party the chain defends against — and it is void the moment its
anchor row's stored hash or key id moves, or any key its prefix was sealed under stops
resolving (so the rotation fail-closed rule still bites on the next read, not on the
next full pass). It is honoured for at most `CHAIN_FULL_VERIFY_INTERVAL_MS` (15 min);
past that the chain is re-hashed whole, which is what catches the one tamper a
checkpoint is blind to — a payload rewritten *without* re-hashing, inside the verified
prefix. That accepted lag sits beside the route's existing ~20s verdict memo. The
verdict now reports `verifiedFromSeq` and `fullyVerified` so a surface can never present
a partial re-hash as the full proof, and `verifyDecisionChain(ws, { full: true })` is
the caller saying the full proof is the point. Census fields (`count`, `keylessCount`,
`keyed`, `firstKeyedSeq`) are computed by SQL aggregate and always describe the WHOLE
chain, not the re-hashed slice. Pinned by `decision-record-store.test.ts` §9.

**The clean-arm read is bounded.** `heldOutEntryIds` ran two unbounded
`SELECT DISTINCT` scans of `decision_records` (spared refs, then the entire
auto-rejected history) and `/api/analytics/calibration` called it **twice** per request.
It is now one capped, newest-first scan (`HELD_OUT_SCAN_LIMIT`, default 2000 — the arm
measures recent selection quality) plus a lookup of the rejected side for those refs
only, chunked under the SQLite variable floor; it also takes an optional `jobId` to
scope the arm to one role through `pipeline_entries`, falling back to the workspace arm
rather than an empty one where that table is not on the connection. The calibration
route reads it once behind a lazy memo instead of twice.

- **A key added later cannot retro-seal earlier records.** They keep
  `key_id = ''` permanently. What the key does buy retroactively is the
  cascade: once keyed links exist, editing an older keyless record breaks the
  chain at the first keyed link, which cannot be reforged without the key.
  A chain that was **never** keyed has no such anchor.
- **Rotate, never remove.** Each row records the key id it was sealed under;
  the retired secret must stay readable as `KP_DECISION_HMAC_KEY_<oldId>` or
  its rows fail closed. Appending a keyless row onto a keyed chain is refused
  outright (a logged skip, never a silent downgrade). Both vars, the rotation
  contract and the ceiling are documented in `.env.example`.

**Art. 12 traceability is now read back, not only sealed** (UAT `LUC-ANA-13`). A
record sealed by a group evaluation (`group_eval_lead` / `group_eval_advisory`)
carries, in its `inputs`, *which prompt produced the reasoning* and *what the model
said about the candidate it ranked first* — written at seal time by
`app/_lib/group-eval-run.ts`. `parseSealTraceability`
(`app/_lib/decision-attribution.ts`) had shipped with **no production caller**; its
first one is
`app/features/insights/analytics/sections/DecisionRecordDetail.tsx`, the expanded
Rationale row in the Decision records table, which renders the prompt version(s) as
chips and the lead's verdict, strengths and gaps **verbatim** — it is evidence, so
it is never summarised or re-narrated.

Three honest absences, never a blank: a seal carrying neither half (every record
written before W0.3) says so in one sentence naming both possible causes; a seal
with a prompt version but no model text says that; a run with no LLM behind it
reports an empty prompt version as *not recorded* rather than implying one. The
parser returns `null` instead of an empty shell precisely so those states stay
distinguishable, and the block renders on group-eval kinds only — a "not recorded"
line on an advance or an offer would claim a compliance gap that does not exist.
Pinned by `sections/sealTraceabilityRender.test.ts`.

`decision_records` has **no seed snapshot and cannot have one**: the chain accretes
at runtime and each link hashes the one before it, so a checked-in fixture would
either ship hashes the first real seal invalidates or have to be written into an
existing chain — the tampering the chain exists to detect. The six group-eval
records in the seeded workspace predate W0.3 and must stay that way. Top the corpus
up by **appending** a real evaluation, with a running server against the DB being
topped up:

```bash
node scripts/seed-group-eval-seals.mjs [--base-url http://localhost:3001] [--dry-run] [--timeout-ms 120000]
```

It is **not wired into `package.json`**; it also honours `KP_BASE_URL`. It drives
the same `POST /api/tasks {kind:"group_eval"}` the Decisions modal does, so the
live writer produces the seal over real cohort data and nothing is fabricated
(keyless, the reasoning is the deterministic ranker's and `promptVersion` is
honestly empty). Idempotent: it exits without acting when any group-eval record
already carries traceability.

The full dossier (`GET /api/decisions/records`) stays operator-gated
(`requireOperator()`) because it carries rationale text, chain hashes and
policy versions. A store fault on that read answers
`DECISION_RECORDS_READ_FAILED` through `safeJsonError` rather than forwarding
SQLITE text or the db path. The same operator-session re-verify is pinned for every
`/api/decisions/*` handler in `app/api/decisions/decisions-auth.test.ts`,
including `GET /api/decisions/peer-context` (salary expectations) and
`GET /api/decisions/jd-freshness` (JD-edit times), so dropping
`requireOperator` on either is a red test rather than a public PII leak.
A store fault on jd-freshness answers `JD_FRESHNESS_LOOKUP_FAILED` through
`safeJsonError`; the client already treats a missing `editedAt` as non-stale.
`GET /api/decisions/reconsider` still pages at 50 auto-rejects, but the envelope
now carries `truncated` and `total` so an auditor can see when the safety valve's
window hid the rest of an irreversible wave.

A **separate, redacted candidate-facing view** now exists:
`app/_lib/status-decisions.ts` derives a `CandidateDecisionView` (kind,
attribution, reasonCode, and — for `auto_rejected` only — the threshold facts
that were actually decisive) from the same sealed rows, served on
`/status/[token]`. Rejection reasons shown to candidates come **from this
sealed record, never freshly generated** (see the module header comment,
`status-decisions.ts:1-11`).

**Human oversight on adverse actions.** Bulk auto-rejects require a signed
approval token the server recomputes and refuses on cohort drift
(`app/_lib/screen-wave-approval.ts`, `app/api/decisions/screen-wave/route.ts`).
Every non-2xx from that door is a coded envelope (`jsonRefusal` /
`safeJsonError`): missing `jobId`, a malformed override, a 409 approval
refusal (still carrying `reason` from `SCREEN_WAVE_REFUSAL_REASONS`), and the
500 catch. The client resolves `errors.<CODE>`; English `error.message` and
store detail never become the painted string.

**One review authorizes ONE commit.** The token is a pure function of
`(jobId, policyVersion, reject set, issuedAt)`, so re-POSTing the same commit body
inside the 15-minute freshness window re-derived the same signature and passed every
check again; the only thing that stopped a replay was the first commit having emptied
its own cohort, which nothing asserted and which does not happen when part of the
reviewed set survives (a seal failure, a mid-wave stage drift). The token is now
**spent** on commit — `consumeScreenWaveApprovalToken` in `screen-wave-approval.ts`,
an in-process ledger holding each token's own expiry — and a re-post is refused with
the existing 409 carrying `reason: "spent"`. The 409 body now always carries a
machine-readable `reason` from `SCREEN_WAVE_REFUSAL_REASONS`
(`required` / `expired` / `mismatch` / `spent` / `unattributed`), because the five
refusals ask the recruiter for five different things. Consumption runs **after** every
other refusal, so a fixable one (an unnamed approver) never burns the review. Honest
limit: the ledger is per process, so a multi-worker deployment does not catch a replay
routed to a second worker — a `consumed_at` column beside the seal would, and is the
recorded next step. Pinned by `screen-wave-guards.test.ts` (§7) and
`screen-wave-approval.test.ts`.

**The sealed record names the policy the approval bound.** The wave signs its token
over a `policyVersion` carrying the family-floor map and the holdout rate, and the
holdout seal stored that string — but the auto-reject seal rebuilt a shorter
`bottom<pct>/maxMatch<the candidate's effective floor>`, dropping both suffixes. A
reject record therefore could not be joined back to the approval that authorized it,
nor to the holdout seals of the same wave: two arms of one audit trail attesting to
two different policies. Both arms now seal the token-bound string; the per-candidate
effective floor rides the sealed `inputs.threshold`, where a per-record number belongs.
The join is the test: `screen-wave-guards.test.ts` §6 feeds the RECORD's
`policyVersion` back to `verifyScreenWaveApprovalToken` and requires it to re-derive
the approved token.
Unattended automation (`app/_lib/automation-pass.ts`) never executes a
reject itself — "AUTO1 RETIRED" (`automation-pass.ts:302-308`): every
fairness-cleared reject is queued as `rejection_review` for a human.
Advance-top-N stops before Offer (`app/api/pipeline/command/route.ts`).

**Two-step confirm in the control room.** The consequential controls on
`/control` — approving an Art. 22 human gate, reconciling, and applying the
calibrated promote floor — arm on the first click and only run on a second
click of the *same* control (`app/control/controlRoomConfirm.ts`
`armOrExecute`; pause/resume stay one-click, a kill switch must). Each pending
gate also carries a **Review** link to `/?tab=assignments&lifecycle=<id>` so
sign-off can happen on `DevLifecycleReviewPanel` (case edits, probe-gate
override) rather than a truncated title. An armed Confirm also expires after
15s (`ARMED_TTL_MS`): a late second click disarms without executing, so a
parked confirm cannot apply a promote floor or approve a gate after the
operator has left the page. Escape while armed calls `cancelArmed` (execute
false, nextArmed null) and announces the cancel on a polite live region. The room
re-polls every 3s, so a control's identity has to include anything that can
change under the arm: the promote-floor key carries the VALUE (`floorKey`,
e.g. `floor:70`), and a pending-gate Approve is keyed as `gateKey(id, detail)`
so a polled replacement under the same lifecycle id re-arms instead of
signing off. With the earlier constant `"floor"` key a suggestion that
moved between the two clicks — one newly-decided outcome is enough to shift
which band `calibrate()` picks — was applied without its own confirm and
sealed into `dev_audit` as a human decision for a number nobody confirmed.

**AI disclosure (Art. 50).** `app/_components/AiDisclosure.tsx` is rendered
on every public candidate-facing surface, including the most recently added
`/status/[token]` (`StatusClient.tsx`), plus quick/conversational apply,
the dev-case apply page, the voice interview portal, offer, and schedule pages.
(`/onboarding/[token]` also carried it until the post-hire onboarding module was
removed; the surface no longer exists, so the obligation no longer attaches to
it.)

**The regime it names is resolved server-side, per tenant (Art. 13 accuracy).**
The note states two facts as law — the jurisdiction's anti-discrimination
framework + data law, and the consent-retention window — and both now arrive as
props (`regimeId`, `retentionMonths`) from `disclosureComplianceFor()`
(`app/_lib/compliance-disclosure.ts`), called by each surface's own server
component off the workspace it has *already* established: the invite behind a
`/schedule` token, the session behind an `/interview` token, the posting behind a
`/devcase/apply` token, the offer behind an `/offer` token, the status link behind
a `/status` token (`getWorkspaceByStatusToken`), and `getJobWorkspace(job.id)` for
both apply paths — the same tenant the applicant is actually filed into.

This replaced a browser fetch of `GET /api/compliance`, which was wrong twice and
both times toward **under**-disclosure: the route is not on the public allow-list
(`app/_lib/auth/public-routes.ts`), so on any deployment with
`KP_OPERATOR_PASSWORD` set the fail-closed proxy 401'd it and the EU/12-month
pre-fetch default was the *final* state; and it answers for the **caller's**
workspace, which for a session-less candidate is the default one. A `us` workspace
therefore told its candidates they were assessed under EU equal-treatment
directives and processed under GDPR.

`GET /api/compliance` stays **gated** on purpose. Allow-listing it would not fix
the candidate half — an anonymous request still carries no workspace — and making
it tenant-aware for a public caller would mean trusting a caller-supplied
workspace id, i.e. letting anyone enumerate any team's legal posture. Its readers
are now session-bearing only: the recruiter Decisions compliance card and the
interview simulator tab, which is the single render site still on the fetch path
(it lives inside the authenticated shell, so the endpoint is both reachable and
tenant-correct there). `app/_components/ai-disclosure-props.test.ts` pins the
arrangement: it enumerates every `<AiDisclosure>` render site in `app/`, fails on
one that is neither a declared public surface nor a declared session-bearing
exemption, and requires each public element to carry both props — so a ninth
candidate surface cannot quietly revert to the EU default. The EU default survives
as the last-resort fallback only.

**Fairness backstops.** `app/_lib/archetypes.ts` (`isFairnessProtected`,
`isEarlyCareer`) + `app/_lib/automation-fairness.ts` re-derive the sole
legitimate auto-reject path defense-in-depth; `app/_lib/adverse-impact.ts`
is a browser-only four-fifths-rule worksheet for externally supplied
demographic counts — the app itself holds none. Two rules keep that worksheet
from rendering a false clean bill: a pasted row must carry **exactly** three
comma fields (`group, selected, total`; a trailing comma is tolerated) or it is
reported in `malformedRows` rather than truncated — a spreadsheet paste with
thousands separators, `Women, 1,200, 5,000`, used to parse silently as 1/200 —
and the reference group is tracked by row **index**, not by name, so a duplicate
group label can no longer mark two rows `isReference` and exempt the second from
the flag. The UI for this lives at
`app/features/hiring/decisions/groupEval/GroupEvalFairnessPanel.tsx` (not
`app/features/sub_decisions/...` — that path in the older conformity doc no
longer exists; corrected here). That panel's closing claim — whether the
cross-scheme *robust order* agrees with the headline fit order — is resolved by
`robustOrderVerdict` (`groupEval/groupEvalHelpers.ts`): the matrix can cover
fewer candidates than the comparison (the ranker's pool drops entries it cannot
resolve), so the orders are compared on the matrix's own field, and a comparison
that cannot be made states **nothing** rather than defaulting to "agrees".

**The comparison discloses who was withheld, and what fell back.** A group
evaluation excludes cohort members who were anonymized (an Art. 17 erasure) or
whose consent to be processed has lapsed, through the same fail-closed predicate
outreach uses; and every one of its up-to-eight AI stages degrades soft into a
deterministic twin. Both facts are recorded on the saved payload
(`consentExcluded`, `degradedStages` — see `docs/features/matching/README.md`) and
are now folded for the reader by `groupEval/groupEvalDisclosure.ts` and rendered by
`GroupEvalNotices.tsx` in the same amber `Notice` the drift and governance warnings
use: a caveat on the comparison, never a calm or confirming tone.

The consent notice is a **count only** — the payload deliberately never carries the
excluded people's ids, so the disclosure cannot re-materialize what the erasure
removed. The degraded notice names the stages in a fixed order and distinguishes a
*timeout* from a *failure*, because the two ask an operator for different things.
Without it an evaluation whose ranking, narrative and rationales had all fallen
back was indistinguishable from a full AI comparison — and a field that shrank for
a consent reason read as a field that simply had fewer applicants. Pinned by
`groupEval/groupEvalDisclosure.test.ts`.

**Name/gender-proxy neutrality.** `pipeline/jobfit/tests/test_name_neutrality.py`
now pins byte-identity of the deterministic scorer's output across
Czech-male/Czech-female(-ová)/Vietnamese/Ukrainian/Arabic/Roma-associated
name variants — this closes what was gap G3 in the original conformity pack.

## Interview feedback letters — request, record, draft

### Feedback letters — request, record, draft

After a **person** decided on an application (not selected, or hired), the candidate can ask,
from their own `/status/<token>` page, for a short letter about their AI interview. A draft is
prepared in their language from the recorded scorecard; a recruiter edits it, owns every
sentence and approves or declines it (the review queue, delivery and the status-page UI are
WP-beta). Only an approved letter ever reaches the candidate. Contract:
`app/_lib/interview-letter-types.ts`.

#### Who may ask (read from the record)

`app/_lib/interview-letter-policy.ts` `letterEligibility` — pure, pinned by
`interview-letter-policy.test.ts`:

| Entry | Eligible | Why |
| --- | --- | --- |
| `rejected`, deciding event names a human (`human:…`, or an actor-less legacy `rejected` row) | yes, `not_selected` | a person decided about this candidate |
| `rejected`, deciding event is `auto_rejected` / `auto:…` (screen wave, guided sim) | no | an automated screen-out — even when a named person approved the batch; the batch approval is about a cohort |
| `rejected`, no reject event at all | no | fail closed: who decided is unknowable |
| live entry at the board's terminal stage (`candidateStatusFor` = `hired`) | yes, `hired` | |
| `role_closed`, `rematched` | no | nobody decided about this candidate |
| `declined` | no | the candidate's own decision (reads "withdrawn") |
| any other live entry | no | no decision yet |
| consent withheld (`consentWithholdsPii`) | no | and the page is told nothing at all |
| no interview scorecard on record | no | the letter is about the interview; there is nothing to report |

**The deciding event** is the newest `rejected` / `auto_rejected` pipeline event on the entry
(`interviewLetterDecidingEvent`). `actOnPipelineEntry('reject')` is the only writer of
`status='rejected'` and writes exactly one of those kinds in the same transaction; a
reinstatement flips the status back to `active`, so on a still-rejected entry the newest
reject event is the one that put it there. Attribution (`letterEventAttribution`) is the
candidate decision history's own three-state rule (`status-decisions.ts`
`sealedActorAttribution`), restated for the two reject kinds and pinned equal to it by test.

#### The request door

`POST /api/status/[token]/letter` — body `{ lang?: "en"|"cs"|"de"|"fr" }` (the language the
page was showing; otherwise the entry's comms locale via `resolveCommsLocale`).

| Answer | When |
| --- | --- |
| `200 { ok: true, letter: CandidateLetterView }` | recorded; the `interview_letter` draft task is queued |
| `409 STATUS_LETTER_ALREADY_REQUESTED` + `{ letter }` | a letter already exists: its state is returned, never a second letter or a second queued draft |
| `409 STATUS_LETTER_NOT_ELIGIBLE` | one code for every reason above — the door is not a way to learn which applies |
| `404 STATUS_LINK_INVALID` · `413 PAYLOAD_TOO_LARGE` (1 KB) · `429 TOO_MANY_REQUESTS` (10/min per client+token) · `500 STATUS_LETTER_REQUEST_FAILED` | |

Gate order: throttle → token → entry (tenant from `getEntryWorkspace`) → body cap →
eligibility / idempotency → insert → queue. Public under the `/api/status/` prefix; pinned in
`app/api/rate-limit-contract.test.ts` and `status-letter.test.ts`. If the task queue refuses,
the request is still recorded (the candidate is told so) and the letter waits in the
recruiter's queue without a draft.

`GET /api/status/[token]` gains `letter: CandidateLetterView` — `{ canRequest, state,
requestedAt, text }` and nothing else: no draft, no reviewer, no ids, no delivery detail;
`text` only once `sent`; consent withheld blanks it.

#### The record

`interview_letters` (DDL in `app/_lib/db/core.ts`, store `app/_lib/db/interview-letters.ts`):
one row per application, unique on `(workspace_id, entry_id)` — the request is an
`INSERT … ON CONFLICT DO NOTHING`, so two clicks produce one letter. States
`requested → drafted → sent | declined`; every write is a compare-and-swap on the state it
leaves (a late draft never overwrites a person's decision). `decidedBy` must be a `human:…`
actor; texts are capped at `LETTER_MAX_CHARS` at the store. Workspace-scoped with no by-id
carve-out (`interview-letters-tenancy.test.ts`). **Erasure** (`scrubEntryLinkedPii`) blanks
`draft_text` and `final_text` and stamps `erased_at`; the row stays as the record that a letter
was asked for, and is closed to further writes. Listed on `/data` as its own category
(`feedbackLetter`) whenever a row exists.

#### The draft

`app/_lib/interview-letter-run.ts` (task kind `interview_letter`, budget `cheap`, deduped on
the letter id) spawns the candidate-free `automation_cli interview-letter` with
`--letter-json {outcome, jobTitle, company, kitTopics}` and the entry's stored scorecard.
`pipeline/jobfit/automation.py`:

- `letter_evidence` — built on `interview_evidence`, then narrowed to **names only**: at most
  two strengths and two areas to develop, each matched to the rubric's own vocabulary
  (anything off-rubric is dropped). "Experience & fit" and "Motivation" are never handed back
  as something to work on. Kit competency titles ride along as the topics the conversation
  was built around. No rating, verdict, quote, summary or confidence reaches the prompt.
- `draft_interview_letter` (`INTERVIEW_LETTER_PROMPT_VERSION = "interview-letter-v1"`,
  uncached) — thanks, what went well, what to work on, a respectful close; the outcome
  shapes only the frame and the close. `letter_problem` discards a model letter **whole** if
  it is empty, over the cap, uses protected-characteristic language, carries any digit
  outside the role's own title, names the scoring machinery (score, rating, rubric,
  scorecard, points…), or reproduces a run of the candidate's recorded words.

**Keyless** (or a discarded model letter): the CLI returns an empty body plus the names, and
the runner builds the template from `interviewLetter.template.*` and
`rubric.competency.<key>.label` in the letter's language (`interview-letter-template.ts`); a
name the rubric catalog does not know is dropped, never printed. The stored draft says
`source: "model"` or `"template"`. The task result carries the engine, the language and
whether a draft was stored — never the text or the candidate's name (the tasks table
outlives an erasure). If the drafting CLI itself fails, the task fails and the letter stays
`requested` for a recruiter to redraft or write by hand.

#### Known gaps

- No UI yet: the recruiter queue, approve/decline/redraft doors, delivery and the status-page
  controls are WP-beta.
- One letter per application: an application that is reopened and decided again keeps its
  first letter.

## Interview feedback letters — review, send, show

The recruiter's half of the interview feedback letter (WP-beta). A letter a candidate asked
for waits in a **Feedback requests** queue in the Decisions tab; a recruiter edits the draft,
owns every sentence, and approves it (it is emailed and shown on the candidate's status page)
or declines it (the status page says the team does not send individual feedback). Nothing
reaches the candidate without a person's approval.

### The queue

`GET /api/decisions/feedback-letters` — `requireOperator`, the caller's own team
(`app/_lib/interview-letter-review.ts` `feedbackLetterQueue` over the store's
`interviewLetterQueue`, one batched `getPipelineEntriesByIds` read for the page).

`200 { items: FeedbackLetterQueueItem[], truncated }` — open (`requested` / `drafted`),
non-erased letters, oldest request first, at most 100 (`truncated` says when more wait). Each
item: `id, candidateLabel, jobTitle, outcome (not_selected|hired), requestedAt, state, lang,
draft {text, source (model|template), createdAt} | null, closeOnly`. `500
FEEDBACK_LETTERS_LIST_FAILED`.

`closeOnly` (`letterCloseOnly`) is `consent_withheld` when the entry's consent is expired or
anonymized, `application_gone` when the entry no longer exists, else null. A close-only item
carries **no draft** and a masked label (the read-time PII gate, `consent.ts`): it can only
be declined. The approve and redraft doors refuse on exactly the same rule, so the list and
the doors agree.

Why a queue of its own: a reject clears `approval_kind`, so a decided candidate never reaches
the ordinary Decisions queue; like **Reconsider**, this is the only list they appear on.

### The doors

All three: `requireOperator` → `requireCapabilityCoded("pipeline:write", requireCapability)`
(a viewer gets `403 FORBIDDEN_CAPABILITY` + `capability`), the caller's team only (a foreign
id is `404 FEEDBACK_LETTER_NOT_FOUND`), a per-IP limiter placed after every cheap refusal and
pinned in `app/api/rate-limit-contract.test.ts`, the actor from `humanActor()` (the signed-in
person, `human:<Name>`, or `human:recruiter` on a deployment that cannot name one; never from
the body). A letter that is no longer open answers `409 FEEDBACK_LETTER_MOVED` + `{ state }`
and writes nothing, both on the pre-read and when the store's compare-and-swap loses a race.

| Door | Body | Answers |
| --- | --- | --- |
| `POST …/[id]/approve` | `{ finalText }` (16 KB cap, trimmed at the ends) | `200 { ok, letter: {id, state, decidedAt}, delivery }` · `400 FEEDBACK_LETTER_TEXT_EMPTY` · `400 FEEDBACK_LETTER_TEXT_TOO_LONG` + `maxChars` · `409 FEEDBACK_LETTER_CONSENT_WITHHELD` · `413 PAYLOAD_TOO_LARGE` · `429` · `500 FEEDBACK_LETTER_APPROVE_FAILED` (30/10 min) |
| `POST …/[id]/decline` | none | `200 { ok, letter }` · `429` · `500 FEEDBACK_LETTER_DECLINE_FAILED` (30/10 min). Allowed on a close-only letter: it writes who decided, nothing about the candidate |
| `POST …/[id]/redraft` | none | `200 { ok, taskId }` (the `interview_letter` task, params `{letterId, jobTitle}`, deduped on the letter) · `409 FEEDBACK_LETTER_CONSENT_WITHHELD` · `429` · `500 FEEDBACK_LETTER_REDRAFT_FAILED` (20/10 min) |

Redraft has no body on purpose: the new draft is written from the interview record alone,
so the recruiter's unsaved edits are never sent to it (the editor says so), and a late draft
loses to a decision at the store's CAS.

### Delivery

`app/_lib/interview-letter-delivery.ts` `deliverApprovedLetter`, after the approve lands.
`dispatchInterviewLetter` (`comms-dispatch.ts`) sends the recruiter's final text verbatim
through `sendCandidateComm` as comm kind **`interview_letter`** (in `KNOWN_COMM_KINDS`,
`devcase.outboxKind.interview_letter` in all four catalogs), in the **letter's** language
(`resolveCommsLocale(letter.lang)`), subject `comms.interviewLetter.subject[Role]`, plus one
line with the candidate's **status link** (`getOrCreateStatusLink`, absolute via
`candidateLinkBase`, `?lang=`-pinned) and the usual data/opt-out footers. The line is omitted
if no token can be minted, never printed dead.

The letter records what the outbox reported (`interviewLetterRecordDelivery`): `sent` (relay
accepted), `queued` (no relay: the outbox row is the destination), `failed` (dead-lettered).
The door's `delivery` field is `{ delivery, suppressed, readableOnStatusPage, recorded }`.

**Consent.** Two different gates, deliberately:

- *Entry consent withheld* (expired or anonymized): approve and redraft are **refused**
  (`409 FEEDBACK_LETTER_CONSENT_WITHHELD`) before anything is stored. No letter is written
  about a person whose consent lapsed, the same line the draft runner holds
  (`interview-letter-run.ts`). The page shows nothing either way (`candidateLetterView`).
  Decline still closes the request. An anonymized entry's letter is already erased by the
  scrub and answers `FEEDBACK_LETTER_MOVED`.
- *The channel's gate* (`commsSendSuppression`, resolved at the candidate IDENTITY, e.g.
  another application of the same person was erased): the approval stands, no email is sent
  (`CommsSuppressedError`), the letter's delivery is recorded `failed` (the contract has no
  fourth word, and `queued` would claim an outbox row that does not exist), `suppressed:
  true` is returned, and the letter stays readable on this application's status page because
  its own consent allows it.

A delivery fault never turns the approval into a 500: the approval is on the record, and the
response says what the email did.

### The recruiter UI

`app/features/hiring/decisions/DecisionsFeedbackLetters.tsx` (mounted once in
`DecisionsTab.tsx` beside Reconsider; its own read in `useFeedbackLetters.ts`, latest-wins,
live-refresh) — a `<details>` section: title with the count (`—` when the first read
failed, `N+` when truncated), help line, empty state, one row per letter (candidate, role,
outcome, asked date, state chip, **Review**). Open by default while anyone waits.

`DecisionsFeedbackLetterEditor.tsx` (a `Modal`) — the draft's source (model / standard
template / none yet) and language, the one-line rule ("names competencies, never quotes the
candidate, never gives a score"), the text, a live counter against `LETTER_MAX_CHARS` that
names the overshoot before any refusal (Approve is disabled while the text cannot be stored),
a no-relay notice, **Approve and send** (moss), **Redraft** (queues a draft, watched with
`useTaskResult` + `TaskFlightNote`; the text is replaced only when a redraft was asked for or
the recruiter has not edited), **Decline** with an inline confirm. Outcomes are said as they
happened: `doneSent` / `doneQueued` / `doneFailed` / `doneSuppressed`, then whether the page
shows it; `doneDeclined` (or `doneClosed` for a close-only letter). Pure rules in
`feedbackLetterEditorLogic.ts`.

### The candidate's status page

`app/status/[token]/StatusLetterCard.tsx`, rendered by `StatusClient.tsx` after the decision
history. Pure rules in `statusLetterView.ts`:

| `letter` | Card |
| --- | --- |
| `canRequest` | "Request feedback on your interview" + "a person on the hiring team reviews it before it is sent" |
| `requested` | "You asked for feedback on {date}…" + follow-up |
| `drafted` | "Your letter is being prepared…" + follow-up |
| `sent` | the approved text, verbatim |
| `declined` | "The hiring team has decided not to send individual feedback on this interview." |
| anything else / consent withheld | nothing |

The follow-up promises email only when a relay is configured (`whenReadyEmail` vs
`whenReadyPage`), and both say that a decision not to send will also appear on the page. The
request is one click (it is idempotent); a repeated request folds the existing state back; a
"not available" refusal removes the button and says so once; any other failure is a coded
`role="alert"` with the button left in place. The page's poll still stops at a terminal
status, so a candidate sees later states on Refresh or from the email.

### Tests

`app/api/decisions/feedback-letters/feedback-letters.test.ts` (real handlers, signed
sessions: gates, queue tenancy and shape, close-only, human actor, CAS race, 409s, delivery
`queued` with the status link and language, suppressed send, decline, redraft task params),
`feedbackLetterEditorLogic.test.ts`, `app/status/[token]/statusLetterView.test.ts`, the
comm-kind pins (`comms-envelope.test.ts`, `outbox-kind-catalog.test.ts`) and the rate-limit
contract.

### Known gaps

- **No decline email.** A decline is said on the status page only; the candidate learns it
  there (they were told on request that it would appear there).
- **A failed email is not retried from here.** The outbox row can be resent from the Comms
  outbox, but that resend does not update the letter's `delivery`.
- **The human-written final text is not run through a protected-attribute filter.** The
  model draft is (`letter_problem` in `automation.py`); the recruiter's text is theirs and is
  sent verbatim. The registry's `protected-attribute-line-suppression` asks for the filter
  over human text too; a warn-in-editor design is open.
- The candidate's page does not poll after a terminal status, so the letter appears on
  Refresh or via the email link.

(Also owed outside this section: `docs/features/comms/README.md` gains the
`dispatchInterviewLetter` dispatcher; `docs/features/comms/outbound-export.md` line ~100
lists `interview_letter` among the kinds; `docs/architecture/api-reference.md` needs
`npm run api:docs` for the four routes; and the WP-alpha "Known gaps" bullet "No UI yet…"
is now closed.)

## Surface

| Concern | Files |
|---|---|
| Consent core + DB lifecycle | `app/_lib/consent.ts`, `app/_lib/db/pipeline.ts` (`recordEntryConsent`, `anonymizeEntry`, `anonymizeExpiredConsents`, `claimConsentExpiryNotice`, `scrubEntryLinkedPii`), `app/_lib/consent-expiry-reminders.ts` (`notifyExpiringConsents`) |
| Data-held / jurisdiction resolver | `app/_lib/data-held.ts`, `app/_lib/compliance-regimes.ts` |
| Erasure self-service | `app/data/[token]/page.tsx`, `DataClient.tsx`, `app/api/data/[token]/route.ts` |
| Candidate status + decision explanation + NPS | `app/status/[token]/StatusClient.tsx`, `app/_lib/status-decisions.ts`, `app/api/status/[token]/nps/route.ts`, `app/_lib/candidate-nps.ts`, `app/_lib/candidate-nps-store.ts` |
| Decision chain (sealing/verify) | `app/_lib/decision-record-store.ts`, `app/api/decisions/records/route.ts` |
| Human oversight gates | `app/_lib/screen-wave-approval.ts`, `app/api/decisions/screen-wave/route.ts`, `app/_lib/automation-pass.ts`, `app/_lib/approval-kinds.ts`, `app/_lib/dev-control.ts`, `app/control/**` (shell `ControlRoom.tsx` + `AutonomyBar` / `GatesPanel` / `AuditPanel` / `CalibrationPanel`) |
| Decision attribution (auto vs human) | `app/_lib/decision-attribution.ts` |
| Art. 12 traceability read-back | `parseSealTraceability` (`app/_lib/decision-attribution.ts`), written by `app/_lib/group-eval-run.ts`, rendered by `app/features/insights/analytics/sections/DecisionRecordDetail.tsx`; corpus top-up via `scripts/seed-group-eval-seals.mjs` |
| Fairness / adverse impact | `app/_lib/archetypes.ts`, `app/_lib/automation-fairness.ts`, `app/_lib/adverse-impact.ts`, `app/features/hiring/decisions/groupEval/GroupEvalFairnessPanel.tsx` |
| Name-neutrality eval | `pipeline/jobfit/tests/test_name_neutrality.py` |
| Calibration / holdout / accuracy | `app/_lib/calibration.ts`, `app/_lib/screen-wave-holdout.ts`, `app/api/analytics/calibration/apply-threshold/route.ts` |
| AI disclosure UI | `app/_components/AiDisclosure.tsx`, per-tenant values from `app/_lib/compliance-disclosure.ts` (`disclosureComplianceFor`), shape in `app/_lib/compliance-regimes.ts` (`DisclosureCompliance`), pinned by `app/_components/ai-disclosure-props.test.ts` |
| Provenance dossier | `app/_lib/provenance-dossier.ts` |
| Compliance posture board | `app/trust/page.tsx`, `app/trust/TrustContent.tsx`, `app/_lib/trust-posture.ts` |
| Recruiter-facing posture block (Decision Rules modal) | `app/features/hiring/decisions/DecisionsComplianceSection.tsx`, state in `decisionsComplianceState.ts`, pure folds in `decisionsComplianceFold.ts` (tested) |
| Compliance JSON (gated, session-scoped) | `app/api/compliance/route.ts` |
| Approver identity for sealed approvals | `app/_lib/auth/operator-approver.ts` — `approverIdentity()` / `resolveApprover()` / `humanActor()` over `currentUserId()` + `app/_lib/db/users.ts`, falling back to `operatorApprover()` (env `KP_OPERATOR_NAME`) |
| Actor on the operational log | `pipeline_events.actor` (`app/_lib/db/core.ts`) — nullable, no backfill; parsed by `parseEventActor()` in `app/_lib/decision-attribution.ts` |
| Org backup/restore (per-tenant) | `app/api/workspace/export/route.ts`, `app/api/workspace/import/route.ts`, `app/_lib/db-portability.ts` (`dumpOrg`/`restoreOrg`), scope from `app/_lib/tenancy.ts` `orgExportClass` |

## Data model

- `pipeline_entries`: `consent_given_at`, `consent_expires_at`,
  `consent_source`, `anonymized_at`, `erasure_token`.
- `consent_events` (append-only): `id, entry_id, kind, detail, created_at` —
  `kind ∈ granted|renewed|expiring_notified|expired|anonymized|erasure_requested|erased`.
- `ERASURE_EXEMPT` (`app/_lib/db/pipeline.ts`): table → the reason it is lawfully
  retained through an Art. 17 erasure. Pinned to `TENANCY_SCOPED_TABLES` by
  `erasure-full-scrub.test.ts`.
- `decision_records`: the hash-chained sealed decision log (HMAC-keyed per row
  via `key_id` when `KP_DECISION_HMAC_KEY` is set — see Flows above) — never
  scrubbed by erasure (retained per Art. 17(3) exemption).
- `pipeline_events`: operational log with honest auto/human attribution, plus a
  nullable `actor` (`auto:<engine>` / `human:<Name>` / `human:recruiter` / NULL).
  Rows written before the column existed stay NULL — deliberately not backfilled,
  since inventing an approver for them would be the overclaim G5 was about.
- `interview_sessions`: `recording_consent_at` (the candidate's SEPARATE audio consent,
  distinct from `consent_at`) and `recordings_json` — one `RecordingMeta` per recorded
  attempt, **including deleted ones**, each carrying `deletedAt` and a `deleteReason`
  (`retention` | `candidate_request` | `recruiter` | `erasure`). The audio itself is a
  file under the data dir, not a column.
- `llm_usage`: usage ledger including a `deterministic` source flag.

## Known gaps

Full detail and gap ids (G1–G14) live in `ai-act-conformity.md`. Still open
as of this doc:

- **G1** — no published risk-management document (Art. 9).
- **G2** — no Annex IV technical documentation or deployer instructions-for-use published (Art. 11, 13, 26).
- **G4** — no `audit_events` table for auth/config/PII-read/export events (Art. 12).
- **G5** — **closed** (`docs/BACKLOG.md` carries the row). `resolveApprover()` / `humanActor()` (`app/_lib/auth/operator-approver.ts`) seal the signed-in person's name, `pipeline_events.actor` records who acted, and the sealed adverse rationale renders „Approved by {who}" — or „Approver not identified" where a deployment genuinely has no named user. `operatorApprover()` survives as the honest fallback for open/keyless single-operator deploys, and legacy rows are deliberately not backfilled. Residual: two seal call sites are still role-only (`app/api/analytics/calibration/apply-threshold/route.ts` and the reinstate/scorecard/schedule seals under `app/api/pipeline/[id]` and `app/api/schedule`).
- **G6** — log-retention window is undocumented (never pruned, but no stated policy).
- **The decision chain ships keyless by default** (UAT `LUC-ANA-1`). `KP_DECISION_HMAC_KEY` is unset in the reference deploy, so every sealed record carries `key_id = ''`: integrity-evident, not tamper-resistant against someone with write access to the database. The surface and this doc now say so (the badge is conditioned on the census, each row shows its `key_id`, and `.env.example` documents the var and its ceiling), which makes the CLAIM honest — it does not make the deployment keyed. Turning the key on is an operator action, and it cannot retro-seal existing records.
- **Chain truncation is undetectable** (see the decision-sealing section above). `verifyDecisionChain` has no head/length commitment, so deleting the newest rows of a workspace's chain still verifies `ok: true` / `keyed: true`. Needs a MAC'd per-tenant head anchor stored outside the row set.
- **G7** — no signed/SIEM audit export; only the org backup exists.
- **G8** — no training/seed-data governance artifact.
- **G10** — no post-market monitoring or incident-reporting runbook (Art. 72/73).
- **G12** — **closed.** The decision chain is per-tenant, and `workspace/export` / `workspace/import` now move ONE ORGANIZATION (`dumpOrg` / `restoreOrg`), scoped by the tenancy manifest and gated on `org:manage`. What remains is narrower and documented rather than open: a backup restores in place, into the deployment it came from, and does not carry the six singleton config tables (`ORG_CONFIG_NOT_PORTABLE`).
- **G13** — **closed (2026-09-08).** The no-demographic-data posture is written up as a deliberate choice in `ai-act-conformity.md` ("G13 in detail"): what it buys (no Art. 10(5) exceptional-circumstances burden, no Art. 9 special-category holding to defend), how fairness is tested instead (perturbation — byte-identity of the scorer across name variants — rather than collection), and what it costs (kp cannot measure its own disparate impact; the four-fifths primitive is the deployer’s own workflow over counts kp never sees).
- **G14** — no EU-database registration / declaration of conformity / CE-marking scaffolding. **No longer "premature"**: G1/G2 are still its inputs, but 15 months is the horizon on which a conformity assessment gets planned rather than deferred, and the Omnibus makes an SME/small-mid-cap simplified technical-documentation template available that kp is small enough to use. See the G14 row in `ai-act-conformity.md` §3.

Closed since the conformity pack was last compiled (2026-07-27):
**G3** (name-neutrality test shipped), **G11** (AI disclosure added to
`/status`, and to `/onboarding` before that surface was retired), and **G9 partially** (a redacted candidate
decision-explanation view now exists on `/status/[token]`; the full sealed
dossier remains operator-only by design).

## The dates

**The Annex III high-risk obligations apply from 2 December 2027**, not
2 August 2026. **Regulation (EU) 2026/1744** (the AI Omnibus) entered into force
27 July 2026 and moved them; Annex I product-embedded systems move to 2 August
2028. This section asserted the 2 August 2026 date and called it "imminent"
until 2026-09-08; the correction is verified against the Commission's own page,
<https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai>.

**What was not deferred, and binds today:** the **Art. 5** prohibitions (in
force since 2 Feb 2025, penalties from 2 Aug 2025, €35M/7% — including 5(1)(f)
emotion inference in the workplace); **Art. 50** transparency (applied 2 Aug
2026, €15M/3%), whose synthetic-content **marking** grace period for
pre-existing systems ends **2 December 2026**; and **Art. 4** AI literacy
(softened by the Omnibus to an effort obligation, enforceable from 2 Aug 2026).
All of GDPR and the national employment layer are untouched by any AI Act date.

**G1/G2 are still the highest-priority remaining work — but not because a date
is close.** They are what an auditor, an enterprise legal team and a works
council ask for first; they are the inputs G14 is assembled from; and **kp
cannot fall back on Art. 111 grandfathering.** Art. 111 protects a high-risk
system placed on the market before the applicability date *only until it is
substantially modified*, and kp ships continuously — any material scoring or
automation change voids it. Nobody should later propose a grandfathering
strategy here: there is none available. Treat the deferral as a **15-month
runway, not a reprieve**, and plan for full applicability on 2 December 2027.

The full work list — Art. 5/50 exposure, the GDPR gaps, provider posture, the
national layer, and the documentation chain this runway is for — is
[`regulatory-backlog.md`](./regulatory-backlog.md) in this folder.
