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
corruption, a deleted or reordered row, and an edit by anyone who does not
re-hash — but it is **not tamper-resistant against an insider**: the algorithm
is public and secret-free, so whoever can write `decision_records` can
recompute every link. `decision-record-store.test.ts` asserts exactly that
("a keyless chain ACCEPTS an insider re-hash") as the non-vacuity proof for
the keyed path. `verifyDecisionChain` therefore returns a **key census**
(`keyed`, `keylessCount`, `firstKeyedSeq`) beside `ok`, the records panel
conditions its badge on it, and each row shows its own `key_id`.

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
