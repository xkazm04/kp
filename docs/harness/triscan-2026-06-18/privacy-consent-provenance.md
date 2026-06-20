# Privacy, Consent & Provenance — Tri-Lens Scan
> Total: 5
> Severity: 0 Critical / 3 High / 2 Medium / 0 Low
> Lens: 3 bug / 1 ui / 1 biz

The interview-consent gate is genuinely solid: `/connect` rejects an un-consented
candidate session (403) before minting credentials *and* `markInterviewStarted`'s
guarded UPDATE backstops it; `/complete` refuses to persist a candidate transcript
unless `consent_at` is non-null; `mode` is server-set at session creation, never
read from the request body; the expiry sweep is registered in `instrumentation.ts`.
The findings below are the gaps *around* that core — proof-of-consent, the retention
edge, and the export/disclosure surfaces — none of which the existing tests cover.

## 1. Consent is recorded without the policy/text version it was given against
- **Lens**: 🚀 Business Visionary (primary) | 🐛 Bug Hunter
- **Severity**: High
- **Category**: GDPR provenance / proof-of-consent
- **Value**: impact 8/10 · effort 3/10 · risk 2/10
- **File**: `app/_lib/db/pipeline.ts:899` (`recordEntryConsent`); `app/_lib/db/interviews.ts:329` (`markInterviewStarted`); columns at `app/_lib/db/pipeline.ts:223-225`
- **Scenario**: A candidate disputes processing ("I never agreed to a 12-month retention / to an AI-transcribed interview"). The recruiter can show `consent_given_at` and `consent_source` ("apply"), but cannot show *what statement the candidate actually saw*. The disclosure copy (`messages/en.json:127`, `:348`) can be edited at any time with no record of which wording was live when consent was captured.
- **Root cause**: Both consent writes persist only timestamp + source. There is no `consent_version` / `consent_text_hash` column and no `CONSENT_VERSION` constant; the only `policyVersion` in the codebase is on *decision* records (`decision-record-store.ts`), not consent. GDPR Art. 7(1) requires the controller to *demonstrate* consent — which means the exact terms, not just that a box was ticked.
- **Impact**: Consent is legally unprovable; a single copy edit retroactively orphans every prior grant. This is the compliance backbone's load-bearing gap and a clean differentiator vs. opaque vendors.
- **Fix sketch**: Add a `CONSENT_POLICY_VERSION` constant (bump on any disclosure-copy change) and persist `consent_version` (+ optionally a hash of the rendered text) in `recordEntryConsent` and on `interview_sessions.consent_at`. Surface it in the consent-audit drawer and the erasure-page projection. i18n parity: keep the version stable across en/cs of the *same* wording.

## 2. A corrupt `consent_expires_at` silently becomes permanent retention
- **Lens**: 🐛 Bug Hunter (primary) | 🚀 Business Visionary
- **Severity**: High
- **Category**: Retention / right-to-erasure failure mode
- **Value**: impact 7/10 · effort 2/10 · risk 2/10
- **File**: `app/_lib/consent.ts:37-38`; sweep query at `app/_lib/db/pipeline.ts:992-999`
- **Scenario**: An entry's `consent_expires_at` is non-null but unparseable (a bad import, a migration that stored a non-ISO value, a truncated string). `consentStatus` hits `if (!Number.isFinite(exp)) return "active"` — the drawer shows a healthy green "active" chip *forever*. Meanwhile the sweep's `consent_expires_at <= ?` SQLite string comparison won't match a garbage value either, so the row is never anonymized.
- **Root cause**: The "fall back to active on unparseable expiry" branch was written as graceful degradation, but for a *retention* field "active" is the unsafe default — it means "keep the PII indefinitely". A genuinely-set-but-corrupt expiry is indistinguishable from "no expiry recorded (legacy)" and both resolve to the never-expiring state.
- **Impact**: PII silently retained past its lawful window with no visible signal — the exact thing the consent lifecycle exists to prevent. Low likelihood, high regulatory severity, and invisible until an audit.
- **Fix sketch**: Treat an unparseable-but-present `expiresAt` as `"expired"` (fail-closed) rather than `"active"`, and log a one-line warning so the bad row is fixable. Keep the genuine `expiresAt === null` legacy case as "active" only if that open-ended grant is intended; otherwise give it a backfilled expiry.

## 3. Provenance dossier export reproduces full PII with no access gate or anonymized-state check
- **Lens**: 🐛 Bug Hunter (primary) | 🚀 Business Visionary
- **Severity**: High
- **Category**: Uncontrolled PII export / re-identification after erasure
- **File**: `app/_lib/provenance-dossier.ts:33,41,77` (name + verbatim CV evidence quotes); export at `app/_components/results/ReportActions.tsx:37-40`
- **Value**: impact 7/10 · effort 4/10 · risk 3/10
- **Scenario**: `exportDossier` builds a Markdown file containing the candidate's full name (`analysis.candidate?.name`) and the verbatim CV `evidenceTrace` quotes (which the consent module itself classes as the worst PII surface — see `consent.ts:111-113`, where `evidence[]` is emptied wholesale on anonymization). The dossier is generated client-side from the in-memory `analysis` payload, so it (a) carries unredacted PII into an ungoverned `.md` on someone's disk and (b) will happily reproduce the original name/quotes even for an entry whose pipeline row was anonymized, if the underlying `analyses` payload wasn't scrubbed in lockstep.
- **Root cause**: The dossier was built as a pure renderer of whatever payload it's handed; it has no notion of consent/anonymization state, and the export button does no redaction. `anonymizeEntry` scrubs the *profile* payload (`pipeline.ts:979`) but the saved `analyses` blob that `ReportActions` reads is a separate artifact — re-identification risk if the two ever diverge.
- **Impact**: A "right to explanation" feature doubles as an uncontrolled DSAR/PII exfiltration surface and can undo an erasure. Damages the very compliance story it's meant to sell.
- **Fix sketch**: Run the dossier's PII fields through `scrubPiiFromPayload`/`maskCandidateName` when the source entry is anonymized (pass an `anonymized` flag into `ReportActions`), and stamp the dossier footer with a "contains personal data — handle under your retention policy" notice beside the existing advisory line (`provenance-dossier.ts:106-107`).

## 4. The candidate-facing interview portal omits the data-processing & retention disclosure
- **Lens**: 🎨 UI Perfectionist (primary) | 🚀 Business Visionary
- **Severity**: Medium
- **Category**: AI-usage disclosure completeness / consent UX
- **Value**: impact 6/10 · effort 2/10 · risk 1/10
- **File**: `app/interview/[token]/page.tsx:81` (`<AiDisclosure className="mt-6" />` — no `showDataConsent`); checkbox copy `messages/en.json:348`
- **Scenario**: The voice-interview portal is the single place a *real* candidate consents to a recorded, AI-conducted, transcribed interview. The checkbox text (`interview.voice.consent`) covers "AI-conducted / transcribed / no audio stored" but says nothing about *retention duration* or *the right to access/erase*. The `AiDisclosure` below it is rendered without `showDataConsent`, so the GDPR retention + self-service-erasure sentence (`aiDisclosure.dataConsent`) — which the apply surfaces *do* show — is absent exactly where the most sensitive processing (a transcript) is consented to.
- **Root cause**: `showDataConsent` was wired only into the apply surfaces (`AiDisclosure.tsx:8-10` comment); the interview portal was treated as "interview consent, not data consent", but a transcript is personal data with the same 12-month retention.
- **Impact**: Asymmetric, incomplete disclosure on the highest-stakes surface; a candidate is not told how long the transcript is kept or how to erase it. Trivial UX/legal win.
- **Fix sketch**: Pass `showDataConsent` on the interview portal's `AiDisclosure`, and add the retention + "manage your data" link to the consent checkbox copy (en/cs parity). Verify the link/erasure-token path is available for interview-only candidates too.

## 5. Apply processes the CV before consent is durably recorded, and the consent write is best-effort
- **Lens**: 🐛 Bug Hunter (primary) | 🚀 Business Visionary
- **Severity**: Medium
- **Category**: Data-processed-before-consent / lawful-basis ordering
- **Value**: impact 6/10 · effort 4/10 · risk 3/10
- **File**: `app/api/apply/[id]/route.ts:399-438` (Python profile build at :399, entry created :402, `recordEntryConsent` only at :434-438 inside try/catch)
- **Scenario**: On apply, `buildApplicantProfile` spawns the Python pipeline that parses/scores the candidate's CV (`:399`) and `createPipelineEntry` persists the entry + contact + profile (`:402`) *before* `recordEntryConsent` runs. That consent write is wrapped "best-effort — never block a successful application" (`:434-438`): if it throws, the application still succeeds and the PII/analysis are durably stored with **no consent row at all**. There is also no server-side check that a consent answer was actually submitted — submitting *is* treated as consent implicitly.
- **Root cause**: Consent was modeled as post-hoc bookkeeping on a flow whose lawful basis is "submitting = consenting", so the processing order and the swallow-on-failure both run counter to "record the basis before/with the processing".
- **Impact**: A window (and a failure mode) where a real candidate's data is processed and retained with no recorded consent — the opposite of the interview flow's fail-closed stance. Inconsistent posture across the two intake paths.
- **Fix sketch**: Record consent in the same transaction as (or immediately before) `createPipelineEntry`, and treat a `recordEntryConsent` failure as a hard error for the *consent state* (surface "needs consent capture" on the entry) rather than a silent log. Optionally require an explicit consent field in the apply body, mirroring `isConnectConsentSatisfied`'s `=== true` discipline.
