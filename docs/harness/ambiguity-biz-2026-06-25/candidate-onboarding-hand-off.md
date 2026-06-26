# Candidate Onboarding Hand-off — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀3 / 🚀2 | Severity: C0/H3/M2/L0

## 1. E-sign + onboarding is fully built but never metered or gated — pure revenue left on the table
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: monetization / dark capability
- **File**: app/_lib/billing/plans.ts:11
- **Observation**: The plan catalog meters only `["ai_candidates", "case_designs", "interview_minutes"]` (plans.ts:11; limits at :34–58). The onboarding hand-off — reusable templates, per-hire runs, and an e-signature seam (`requestSignature`/`markSigned`, onboarding-store.ts:320, 332) — has no entitlement check and no meter anywhere. Onboarding is surfaced as a top-level tab (tabs.ts:105) on every tier including Free.
- **Why it matters**: E-sign envelopes and HRIS onboarding modules are the single most common recruiting-SaaS upsell (DocuSign/Signicat bill per envelope; competitors gate onboarding behind a premium tier). kp gives the whole capability away unmetered. A `signatures` meter or a "Pre-boarding & e-sign" add-on is near-zero build cost because the persistence and UI already exist.
- **Recommendation**: Add a `signatures` (or `onboarding_runs`) meter to METERS/PLANS and gate `requestSignature` through `billing/enforce.ts`; or sell onboarding as a Growth-tier feature / paid add-on. Surface remaining envelope allowance in the Onboarding tab.
- **Effort**: M

## 2. The "audit-stamped e-sign" is recruiter self-attestation — the candidate can never actually sign
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: hidden trade-off / stub-vs-real seam / legal risk
- **File**: app/features/sub_onboarding/OnboardingTab.tsx:495
- **Observation**: "Mark signed" is a recruiter-side button that calls `markSigned` with `signer: detail.run.candidateLabel ?? "Signed"` (OnboardingTab.tsx:495) — the recruiter stamps the document as signed *by the candidate*, who did nothing. The candidate-facing view deliberately exposes only the questionnaire and "never the recruiter checklist actions" (onboarding-candidate.ts:11, view at :35–45), so there is no candidate signature path at all. Yet the store calls the result "Audit-stamped" (onboarding-store.ts:331) and the seam is just a comment-level TODO with no adapter interface (onboarding-store.ts:317–319). No signer authentication, IP, consent, or document hash is captured.
- **Why it matters**: These documents are employment contracts, NDAs, and IP/equity assignments (presets, onboarding.ts:179, 195). A self-attested "signed" with no signer identity gives a false impression of evidentiary value and could be relied on in a dispute. The not-eIDAS caveat (onboarding.ts:6) is buried in a source comment, not shown to the recruiter clicking the button.
- **Recommendation**: Define a real `EsignProvider` interface (createEnvelope/onSignedCallback) as the seam; until a provider is wired, relabel UI/state as "Marked complete (internal)" not "Signed", and capture who marked it + when. Optionally let the candidate sign from their token page.
- **Effort**: M

## 3. Candidate only ever sees the onboarding link on the accept screen — no email, no reminder, lost pre-boarding completion
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: retention / completion-rate lever / unmet pain point
- **File**: app/onboarding/[token]/page.tsx (delivery path) + app/_lib/onboarding-candidate.ts:66
- **Observation**: The pre-boarding questionnaire is reachable only via the CTA rendered right after the candidate accepts the offer (offer/[token]/page.tsx:227). Nothing emails the token-link, and `submitCandidateIntake` fires only a *recruiter*-side timeline event (`recordAutomationEvent(... "onboarding_intake_submitted" ...)`, onboarding-candidate.ts:66) — there is no candidate nudge if they close the tab before filling it in.
- **Why it matters**: Pre-boarding engagement is a well-known early-attrition/ghosting lever — the window between accept and day-one is exactly when no-shows happen. A questionnaire only one click reachable, once, with no resend means most hires never complete it, and the recruiter's hire record stays empty. This is concrete growth/retention value the existing token already enables.
- **Recommendation**: On accept, email the candidate their `/onboarding/{token}` link; add a reminder if `intake` is still null after N days (reuse the existing automation/comms dispatch). Surface "questionnaire pending/done" on the recruiter run card.
- **Effort**: M

## 4. Comments repeatedly promise "editable after creation," but onboarding templates have no update or delete path
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: documented capability that doesn't exist / doc-vs-code drift
- **File**: app/_lib/onboarding.ts:128
- **Observation**: Multiple comments assert editability — "Editable per template once created" (onboarding.ts:12), "every task/field is editable after creation" (onboarding.ts:128), "the questionnaire is editable data" (OnboardingTab.tsx:253). But the store exposes only `createTemplate` (onboarding-store.ts:157); there is no `updateTemplate`/`deleteTemplate` for `onboarding_templates`, and the POST route handles only `create_template` (route.ts:40). (The `updateTemplate`/`deleteTemplate` that do exist are in the unrelated JD-template system, templates-store.ts.)
- **Why it matters**: A typo'd or outdated checklist/questionnaire is permanent; the recruiter must create a new template, and existing runs stay bound to the immutable `template_id`. The repeated "editable" claims are tribal-knowledge contradicting the code, misleading future maintainers and users.
- **Recommendation**: Either implement `updateTemplate`/`deleteTemplate` (+ PATCH/DELETE on `/api/onboarding/template/[id]`, guarding edits against in-flight runs), or correct the comments to state templates are create-only and add a "Duplicate to edit" affordance.
- **Effort**: M

## 5. i18n labels are frozen to 6 default keys — every industry-preset/custom field shows English to Czech users
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: undocumented assumption / i18n drift / happy-path-only
- **File**: app/onboarding/[token]/page.tsx:21
- **Observation**: Both label maps are hardcoded to only the 6 `DEFAULT_QUESTIONNAIRE` keys (page.tsx:21–28; recruiter side OnboardingTab.tsx:409–416), falling back to the authored English `field.label` for anything else. Every preset-introduced key — `licenseNumber`, `immunizationStatus`, `ppeSize`, `githubHandle`, `workAuthorization`, `certifications`, `availability` (onboarding.ts:161–226) — has no cs/en translation. The comment at page.tsx:18–20 claims the server-driven `fields` list means "the two can't drift," but localization *does* drift: any non-default key renders raw English.
- **Why it matters**: kp ships en + cs, and the presets were explicitly built for non-tech, non-English cohorts (clinical, trades, frontline). A Czech clinical hire sees "License / registration number" and "Immunization status" in English on a candidate-facing page — an avoidable polish/trust gap. The comment also overstates coverage, masking the issue.
- **Recommendation**: Localize the known preset keys (extend the i18n catalog + maps for all preset keys), or store a per-field localized label / `labelKey` on the template so authored labels can carry translations. At minimum, fix the comment to state custom/preset keys are not localized.
- **Effort**: S
