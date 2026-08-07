# Compliance & trust

The compliance surface kp ships today: candidate-facing consent/erasure/
explanation, a per-tenant tamper-evident decision chain, human-oversight
gates on adverse actions, and an internal EU AI Act posture board. See
`ai-act-conformity.md` in this folder for the full article-by-article map and
open-gap register — this file is the "what exists and where" index.

## Entry points

| Surface | Route / component | Audience |
|---|---|---|
| Compliance posture board | `app/trust/page.tsx` → `app/trust/TrustContent.tsx` | Internal only (see below) |
| Data summary + erasure request | `app/data/[token]/page.tsx`, `DataClient.tsx` | Candidate (public, token-gated) |
| Application status + decision explanation + NPS | `app/status/[token]/StatusClient.tsx` | Candidate (public, token-gated) |
| Onboarding hand-off (post-hire) | `app/onboarding/[token]/OnboardingClient.tsx` | Candidate (public, token-gated) |
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
scorecard, comms outbox, offer payload, interview-prep payload, onboarding
intake/signature, and rediscovery-alert labels, all in one transaction),
and `anonymizeExpiredConsents` (the sweep, registered in `instrumentation.ts`).
`decision_records` is **deliberately excluded** from the scrub — the code
comment at `pipeline.ts:1332-1335` states the GDPR Art. 17(3)(b)/(e)
legal-claims/compliance basis for retaining the sealed chain post-erasure.

**Self-service erasure.** `ensureErasureToken` mints a per-entry token;
`app/data/[token]/page.tsx` + `DataClient.tsx` render the candidate's held
data and an erase button; `app/api/data/[token]/route.ts` handles GET
(projection) and POST (→ `anonymizeEntry`). The token is carried in comms
email footers.

**Decision sealing + candidate explanation.** Every automated or human
adverse action is sealed into a per-tenant, HMAC-SHA256 hash-chained record
(`app/_lib/decision-record-store.ts`: `sealDecisionRecord`,
`verifyDecisionChain`, key rotation via `KP_DECISION_HMAC_KEY[_ID]`). The
full dossier (`GET /api/decisions/records`) stays operator-gated
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

**AI disclosure (Art. 50).** `app/_components/AiDisclosure.tsx` is rendered
on every public candidate-facing surface, including the two most recently
added: `/status/[token]` (`StatusClient.tsx:324`) and `/onboarding/[token]`
(`OnboardingClient.tsx:239`), plus quick/conversational apply, the voice
interview portal, offer, and schedule pages.

**Fairness backstops.** `app/_lib/archetypes.ts` (`isFairnessProtected`,
`isEarlyCareer`) + `app/_lib/automation-fairness.ts` re-derive the sole
legitimate auto-reject path defense-in-depth; `app/_lib/adverse-impact.ts`
is a browser-only four-fifths-rule worksheet for externally supplied
demographic counts — the app itself holds none. The UI for this lives at
`app/features/hiring/decisions/groupEval/GroupEvalFairnessPanel.tsx` (not
`app/features/sub_decisions/...` — that path in the older conformity doc no
longer exists; corrected here).

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
| Fairness / adverse impact | `app/_lib/archetypes.ts`, `app/_lib/automation-fairness.ts`, `app/_lib/adverse-impact.ts`, `app/features/hiring/decisions/groupEval/GroupEvalFairnessPanel.tsx` |
| Name-neutrality eval | `pipeline/jobfit/tests/test_name_neutrality.py` |
| Calibration / holdout / accuracy | `app/_lib/calibration.ts`, `app/_lib/screen-wave-holdout.ts`, `app/api/analytics/calibration/apply-threshold/route.ts` |
| AI disclosure UI | `app/_components/AiDisclosure.tsx` |
| Provenance dossier | `app/_lib/provenance-dossier.ts` |
| Compliance posture board | `app/trust/page.tsx`, `app/trust/TrustContent.tsx`, `app/_lib/trust-posture.ts` |
| Public compliance JSON | `app/api/compliance/route.ts` |
| Operator identity for sealed approvals | `app/_lib/auth/operator-approver.ts` (env `KP_OPERATOR_NAME`) |
| Whole-DB export/import (not yet per-tenant) | `app/api/workspace/export/route.ts`, `app/api/workspace/import/route.ts`, `app/_lib/db-portability.ts` |

## Data model

- `pipeline_entries`: `consent_given_at`, `consent_expires_at`,
  `consent_source`, `anonymized_at`, `erasure_token`.
- `consent_events` (append-only): `id, entry_id, kind, detail, created_at` —
  `kind ∈ granted|renewed|expiring_notified|expired|anonymized|erasure_requested|erased`.
- `decision_records`: the HMAC-chained sealed decision log — never scrubbed
  by erasure (retained per Art. 17(3) exemption; see Flows above).
- `pipeline_events`: operational log with honest auto/human attribution.
- `llm_usage`: usage ledger including a `deterministic` source flag.

## Known gaps

Full detail and gap ids (G1–G14) live in `ai-act-conformity.md`. Still open
as of this doc:

- **G1** — no published risk-management document (Art. 9).
- **G2** — no Annex IV technical documentation or deployer instructions-for-use published (Art. 11, 13, 26).
- **G4** — no `audit_events` table for auth/config/PII-read/export events (Art. 12).
- **G5** — sealed-record actor is a role string (`"operator (single-operator deployment)"`) unless `KP_OPERATOR_NAME` is set; not yet threaded to the per-user identity that the E0 tenancy work introduced (Art. 14).
- **G6** — log-retention window is undocumented (never pruned, but no stated policy).
- **G7** — no signed/SIEM audit export; only the whole-DB dump exists.
- **G8** — no training/seed-data governance artifact.
- **G10** — no post-market monitoring or incident-reporting runbook (Art. 72/73).
- **G12** — decision chain is now per-tenant, but `workspace/export` and `workspace/import` remain whole-database dumps guarded only by mode checks — must be reworked before `KP_MULTI_WORKSPACE` ships.
- **G13** — the no-demographic-data posture needs to be documented as a deliberate choice (with its limits) rather than left implicit.
- **G14** — no EU-database registration / CE-marking scaffolding (premature until G1/G2 ship).

Closed since the conformity pack was last compiled (2026-07-27):
**G3** (name-neutrality test shipped), **G11** (AI disclosure added to
`/status` and `/onboarding`), and **G9 partially** (a redacted candidate
decision-explanation view now exists on `/status/[token]`; the full sealed
dossier remains operator-only by design).

The AI Act's high-risk obligations apply in full from **2 August 2026** —
imminent. G1/G2 (the two purely-documentation gaps) are the highest-priority
remaining work before that date.
