# Privacy, Consent & Provenance — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀3 / 🚀2 | Severity: C1/H2/M2/L0

## 1. Erasure leaves verbatim CV quotes behind — `evidenceTrace.*` is never scrubbed
- **Lens**: 🌀 Ambiguity
- **Severity**: Critical
- **Category**: GDPR Art. 17 erasure completeness
- **File**: app/_lib/consent.ts:129
- **Observation**: The PII scrubber only empties the array key named exactly `evidence` (`PII_ARRAY_KEYS = new Set(["evidence"])`, consent.ts:129) and a fixed set of scalar PII keys. But the analysis payload also carries `evidenceTrace: { experience, skills, seniority, education, salary }` — each an `z.array(z.string())` of **verbatim CV quotes** (schemas.generated.ts:115-120). None of those keys are in the deny-list, so `scrubPiiFromPayload` walks straight through them and returns the strings unchanged. `anonymizeEntry` runs this scrubber over every linked `analyses` row inside the erasure transaction (db/pipeline.ts ~1035-1050) and even comments that it removes "rawText, name, email, phone, **verbatim evidence**" — but it doesn't. Worse, `buildProvenanceDossier` prints exactly these surviving quotes (`comp("Experience", …, ev?.experience)`, provenance-dossier.ts:64-66), so after a candidate clicks "erase" their CV snippets (employer names, dates, project descriptions, sometimes their own name) remain readable in History, via `/api/analyses/[slug]`, and re-exportable as a dossier.
- **Why it matters**: This is a silent right-to-erasure failure that directly contradicts the documented invariant — the most dangerous kind of compliance hole, because the audit log records "erased" while re-identifying free text persists. For a regulated EU/bank buyer this is a hard DPIA blocker.
- **Recommendation**: Switch the scrubber from a key deny-list to redacting all free-text under known free-text containers (`evidenceTrace.*`, `interviewKit.summary/questions`, `jobFit.summary`, `explanation`), or whitelist only the numeric/enum recruitment-signal fields to keep and blank everything else. Add a test that asserts no `evidenceTrace` string survives `anonymizeEntry`.
- **Effort**: S

## 2. The provenance dossier (right-to-explanation artifact) is recruiter-only
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: Dark capability / EU AI Act Art. 86 + GDPR Art. 15(1)(h)
- **File**: app/_components/results/ReportActions.tsx:40
- **Observation**: `buildProvenanceDossier` is described in its own header as a record "WHY the number is what it is … for a compliance review under the EU AI Act" (provenance-dossier.ts:11). Yet its only consumer is a recruiter-facing download button on the History detail page (ReportActions.tsx:40); grep shows no other call site. The candidate-facing data page (app/data/[token]/page.tsx:58) lists only the *categories* held ("cv, contact, answers, interview, scores") and an erase button — it never surfaces the reasoning. So the single best trust artifact kp owns reaches hiring managers but never the data subject or an external auditor.
- **Why it matters**: Employment screening is Annex III high-risk under the EU AI Act; Art. 86 gives the affected person a right to an explanation of the individual decision, and GDPR Art. 15(1)(h) gives meaningful information about the logic involved. The dossier already exists — exposing a candidate-/auditor-scoped version is the cheapest possible compliance + conversion win for a regulated buyer who is choosing kp precisely because competitors are "opaque AI-hiring vendors" (AiDisclosure.tsx:8-9).
- **Why it matters**: (continued) trust is the conversion lever the product already claims; this leaves it unredeemed.
- **Recommendation**: Add a candidate-/auditor-scoped dossier view behind the erasure token (reuse the masked, evidence-free projection once Finding 1 is fixed), and let recruiters optionally attach it to the rejection/offer comm.
- **Effort**: M

## 3. `CONSENT_TTL_DAYS = 365` is a global, jurisdiction- and source-blind magic number
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: Magic constant / storage-limitation (Art. 5(1)(e))
- **File**: app/_lib/consent.ts:10
- **Observation**: Retention is a single hardcoded constant applied to every consent regardless of `consent_source` (`apply | quick-apply | recruiter | webhook`) or jurisdiction. The justifying comment even names the dropped case — "Recruitis/Sloneek both default to ~1 year (**or the position length**)" — but the position-length / per-jurisdiction variant is never modelled. Meanwhile the disclosure shown to candidates IS jurisdiction-aware (AiDisclosure.tsx resolves the active regime's `dataLaw`), so the app promises jurisdiction-specific data handling on the surface while the engine that actually governs anonymization is uniform. A recruiter-sourced entry (lawful basis = legitimate interest, candidate never applied) gets the identical 365-day consent clock as an explicit applicant grant.
- **Why it matters**: Undocumented assumption with real storage-limitation exposure: over-retention in stricter regimes, under-retention vs. "length of the role" expectations, and a basis/clock mismatch a DPO will flag during sign-off (the doc already lists DPO sign-off as a pre-prod gate).
- **Recommendation**: Derive the TTL from `(source, regime)` rather than a constant, record the chosen lawful basis alongside `consent_source`, and document why each window was picked.
- **Effort**: S

## 4. Interview consent gate fails OPEN on an unrecognized session mode
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: Fail-open default / unhandled edge case
- **File**: app/_lib/interview-consent.ts:42
- **Observation**: `consentRequired(mode)` returns true only when `mode === "candidate"` (interview-consent.ts:42-44); every other value yields "consent not required." The session row is coerced with `mode: r.mode === "candidate" ? "candidate" : "test"` (db/interviews.ts:144), so any null/garbled/legacy/unknown mode silently collapses to `test` and bypasses the very gate this module exists to enforce. The file's own preamble warns that "a future UI regression could run and store a real candidate's interview with no consent on record" — but the server-side gate it offers as the defense fails open on exactly that ambiguity.
- **Why it matters**: A hard legal precondition should fail closed: an unrecognized mode for what might be a real person should *require* consent, not skip it. As written, one bad migration or write path turns the consent invariant off without any error.
- **Recommendation**: Treat unknown modes as `candidate` (require consent) in the coercion, or have `consentRequired` default-deny on anything not explicitly `test`.
- **Effort**: S

## 5. Self-service page is erasure-only — no subject-access readout or data export
- **Lens**: 🚀 Business
- **Severity**: Medium
- **Category**: Value left on table / GDPR Art. 15 + 20
- **File**: app/data/[token]/page.tsx:58
- **Observation**: The token page lists categories held (`held = ["cv","contact","answers","interview","scores"]`) and offers exactly one action: erase. It never shows the actual held data and offers no "download my data." The recruiter side already computes scores, consent history (listConsentEvents) and the dossier — the candidate just can't see any of it. The page hands the data subject the destructive right (erasure) while withholding the constructive ones (access + portability).
- **Why it matters**: DSAR self-service is a concrete sales differentiator for a regulated buyer and a trust/conversion lever for candidates; building it on data that already exists is low effort. It is also a "dark capability" of the type the codebase is known for — captured-but-never-surfaced.
- **Recommendation**: Add a token-gated read view (and JSON/PDF export) of the candidate's own held data + consent timeline, reusing the existing projections; pair it with the candidate-scoped dossier from Finding 2.
- **Effort**: M
