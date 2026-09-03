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

**`/trust` is currently `robots: { index: false, follow: false }` and marked
internal-for-now** (`app/trust/page.tsx:10-17`) — it is a working posture board
used to track what's enforced vs. outstanding, not a published marketing page.
The plan recorded in the file itself is to delete the route once every row
reads "enforced." Its content is single-sourced in `app/_lib/trust-posture.ts`
(`OBLIGATIONS`, `CLASSIFICATION`, `SUBPROCESSORS`, `DATA_RIGHTS`,
`DISCLAIMER`) — that module is the live, tested, English-only projection of
the article map in `ai-act-conformity.md` and should be treated as the
authoritative "current posture" when it and the doc disagree.

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
scorecard, comms outbox, offer payload, interview-prep payload, the retired
onboarding intake/signature tables where a pre-removal database still has
them, and rediscovery-alert labels, all in one transaction),
and `anonymizeExpiredConsents` (the sweep, registered in `instrumentation.ts`).
`decision_records` is **deliberately excluded** from the scrub — the code
comment at `pipeline.ts:1332-1335` states the GDPR Art. 17(3)(b)/(e)
legal-claims/compliance basis for retaining the sealed chain post-erasure.

Inside an analysis/profile payload the scrub is `scrubPiiFromPayload`
(`consent.ts`), which walks the blob generically: keys in `PII_KEYS` are blanked
(`name`, `rawText`, `email`, `phone`, `explanation`, …), `evidence` arrays are
emptied, and the free-text CONTAINERS in `PII_CONTAINER_KEYS` — `evidenceTrace`,
`extractionComparison`, `interviewKit` — are deep-redacted subtree-wide. The
last two matter because the pipeline stores the uploaded CV text **three** times:
`candidate.rawText` plus `extractionComparison.{pypdfText,geminiText}`
(`pipeline/jobfit/pipeline.py` populates that on every run), so blanking
`rawText` alone left an identical copy of the CV — name, email, phone — readable
in History and `/api/analyses/[slug]` after an Art. 17 erasure. `explanation` and
`interviewKit.summary` are name-bearing for the same reason: the deterministic
(keyless) builders interpolate `candidate.name` straight into them. Retained, as
before: scores, skills, seniority, role family, salary band, traits.

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

**Self-service erasure.** `ensureErasureToken` mints a per-entry token;
`app/data/[token]/page.tsx` + `DataClient.tsx` render the candidate's held
data and an erase button; `app/api/data/[token]/route.ts` handles GET
(projection) and POST (→ `anonymizeEntry`). The token is carried in comms
email footers.

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
  the guard exempts `role="radio"` on that ground alone).
- **The NPS failure is a `role="alert"` and the thanks swap a `role="status"`.**
  "That didn't go through" announced nothing: a screen-reader user pressed Send
  and heard silence over an answer that had been DROPPED, and the success case
  replaced the whole question card just as silently.
- **The two status doors and the erasure door answer refusal CODES**, not bare
  English. `STATUS_LINK_INVALID` (404 on both `/api/status/[token]` and its
  `/nps` sibling — one refusal for "no such token" and "no such entry", so the
  door is not an existence oracle), `STATUS_NPS_NOT_APPLICABLE` (409 for
  feedback on a still-running application) and `DATA_LINK_INVALID` (404 for a
  never-issued or already-spent erasure token). All three are in `REFUSAL_ERRORS`
  with four catalogue entries each; the page resolves `errors.<CODE>` in the
  reader's language (`docs/architecture/api-contracts.md` §1.1).

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
`heldOutEntryIds` drops them from the calibration clean arm. The wave now re-reads the
live row and skips (`reasonCode: "staleSkipped"`) **without sealing** when the stage or
status has drifted; what remains is the single synchronous statement between that read
and the CAS. The status half also stops a second rejection email to a candidate a
recruiter rejected by hand mid-wave (`reject` is idempotent in `actOnPipelineEntry`, so
the stage CAS alone would have waved it through). Pinned by the mid-wave-drift test in
`app/_lib/screen-wave.test.ts`, which drives the interleaving through a loopback relay.

Two consequences worth stating to an auditor:

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
policy versions. A **separate, redacted candidate-facing view** now exists:
`app/_lib/status-decisions.ts` derives a `CandidateDecisionView` (kind,
attribution, reasonCode, and — for `auto_rejected` only — the threshold facts
that were actually decisive) from the same sealed rows, served on
`/status/[token]`. Rejection reasons shown to candidates come **from this
sealed record, never freshly generated** (see the module header comment,
`status-decisions.ts:1-11`).

**Human oversight on adverse actions.** Bulk auto-rejects require a signed
approval token the server recomputes and refuses on cohort drift
(`app/_lib/screen-wave-approval.ts`, `app/api/decisions/screen-wave/route.ts`).
Unattended automation (`app/_lib/automation-pass.ts`) never executes a
reject itself — "AUTO1 RETIRED" (`automation-pass.ts:302-308`): every
fairness-cleared reject is queued as `rejection_review` for a human.
Advance-top-N stops before Offer (`app/api/pipeline/command/route.ts`).

**Two-step confirm in the control room.** The consequential controls on
`/control` — approving an Art. 22 human gate, reconciling, and applying the
calibrated promote floor — arm on the first click and only run on a second
click of the *same* control (`app/control/controlRoomConfirm.ts`
`armOrExecute`; pause/resume stay one-click, a kill switch must). The room
re-polls every 3s, so a control's identity has to include anything that can
change under the arm: the promote-floor key carries the VALUE (`floorKey`,
e.g. `floor:70`). With the earlier constant `"floor"` key a suggestion that
moved between the two clicks — one newly-decided outcome is enough to shift
which band `calibrate()` picks — was applied without its own confirm and
sealed into `dev_audit` as a human decision for a number nobody confirmed.

**AI disclosure (Art. 50).** `app/_components/AiDisclosure.tsx` is rendered
on every public candidate-facing surface, including the most recently added
`/status/[token]` (`StatusClient.tsx:324`), plus quick/conversational apply,
the voice interview portal, offer, and schedule pages. (`/onboarding/[token]`
also carried it until the post-hire onboarding module was removed; the surface
no longer exists, so the obligation no longer attaches to it.)

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

**Name/gender-proxy neutrality.** `pipeline/jobfit/tests/test_name_neutrality.py`
now pins byte-identity of the deterministic scorer's output across
Czech-male/Czech-female(-ová)/Vietnamese/Ukrainian/Arabic/Roma-associated
name variants — this closes what was gap G3 in the original conformity pack.

## Surface

| Concern | Files |
|---|---|
| Consent core + DB lifecycle | `app/_lib/consent.ts`, `app/_lib/db/pipeline.ts` (`recordEntryConsent`, `anonymizeEntry`, `anonymizeExpiredConsents`, `scrubEntryLinkedPii`) |
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
| AI disclosure UI | `app/_components/AiDisclosure.tsx` |
| Provenance dossier | `app/_lib/provenance-dossier.ts` |
| Compliance posture board | `app/trust/page.tsx`, `app/trust/TrustContent.tsx`, `app/_lib/trust-posture.ts` |
| Public compliance JSON | `app/api/compliance/route.ts` |
| Approver identity for sealed approvals | `app/_lib/auth/operator-approver.ts` — `approverIdentity()` / `resolveApprover()` / `humanActor()` over `currentUserId()` + `app/_lib/db/users.ts`, falling back to `operatorApprover()` (env `KP_OPERATOR_NAME`) |
| Actor on the operational log | `pipeline_events.actor` (`app/_lib/db/core.ts`) — nullable, no backfill; parsed by `parseEventActor()` in `app/_lib/decision-attribution.ts` |
| Org backup/restore (per-tenant) | `app/api/workspace/export/route.ts`, `app/api/workspace/import/route.ts`, `app/_lib/db-portability.ts` (`dumpOrg`/`restoreOrg`), scope from `app/_lib/tenancy.ts` `orgExportClass` |

## Data model

- `pipeline_entries`: `consent_given_at`, `consent_expires_at`,
  `consent_source`, `anonymized_at`, `erasure_token`.
- `consent_events` (append-only): `id, entry_id, kind, detail, created_at` —
  `kind ∈ granted|renewed|expiring_notified|expired|anonymized|erasure_requested|erased`.
- `decision_records`: the hash-chained sealed decision log (HMAC-keyed per row
  via `key_id` when `KP_DECISION_HMAC_KEY` is set — see Flows above) — never
  scrubbed by erasure (retained per Art. 17(3) exemption).
- `pipeline_events`: operational log with honest auto/human attribution, plus a
  nullable `actor` (`auto:<engine>` / `human:<Name>` / `human:recruiter` / NULL).
  Rows written before the column existed stay NULL — deliberately not backfilled,
  since inventing an approver for them would be the overclaim G5 was about.
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
- **G13** — the no-demographic-data posture needs to be documented as a deliberate choice (with its limits) rather than left implicit.
- **G14** — no EU-database registration / CE-marking scaffolding (premature until G1/G2 ship).

Closed since the conformity pack was last compiled (2026-07-27):
**G3** (name-neutrality test shipped), **G11** (AI disclosure added to
`/status`, and to `/onboarding` before that surface was retired), and **G9 partially** (a redacted candidate
decision-explanation view now exists on `/status/[token]`; the full sealed
dossier remains operator-only by design).

The AI Act's high-risk obligations apply in full from **2 August 2026** —
imminent. G1/G2 (the two purely-documentation gaps) are the highest-priority
remaining work before that date.
