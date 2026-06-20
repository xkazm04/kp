# Privacy, Consent & Provenance — Bug Hunter scan

> Context: GDPR-oriented consent capture/gating, AI-usage disclosure, candidate self-service erasure, and the provenance dossier that records how each data point was derived.
> Files reviewed: 13 of 13 (plus 6 supporting: db/pipeline.ts, db/profiles.ts, db/analyses.ts, db/jobs.ts, api/apply/[id]/route.ts, api/interview/connect+complete)
> Total: 7 findings — Critical: 1, High: 2, Medium: 3, Low: 1

## 1. Erasure/anonymization leaves saved analyses fully un-scrubbed (PII survives "erasure")
- **Severity**: Critical
- **Category**: retention-deletion-correctness / right-to-erasure
- **File**: `app/_lib/db/pipeline.ts:1005` (`anonymizeEntry`), `app/_lib/db/analyses.ts:46` (`saveAnalysis`), `docs/GDPR_AND_HIRING_EXTENSIONS.md:33`
- **Scenario**: A candidate applies, gets analyzed (the analysis is persisted to the `analyses` table with `payload_json` containing `candidate.name`, `rawText` = the entire CV, `contact`, `email`, `phone`, and verbatim `evidence` quotes). Later the candidate clicks "erase my data" on `/data/[token]`, or their consent expires and the sweep runs. `anonymizeEntry` masks the entry label, nulls `contact`/`github_*`, and calls `anonymizeProfile(row.candidate_id)` — but it **never touches the `analyses` rows**. The `scrubPiiFromPayload` helper (consent.ts:137) and `PII_KEYS` (which explicitly lists `rawtext`/`name`/`email`) exist precisely for this payload shape, yet are only wired to profiles.
- **Root cause**: The design doc (line 33) states anonymization must "scrub linked profile **+ analyses** PII", but `analyses` has no `candidate_id`/`entry_id` foreign key (analyses.ts:5–22) — there is no join from an entry to its analyses, so the implementer silently dropped the analyses half. The erasure is believed complete because the profile + entry columns are clean.
- **Impact**: After a GDPR Art. 17 erasure, the candidate's full CV text, name, email, and phone remain readable in the History tab and via `/api/analyses/[slug]`. This is a direct right-to-erasure violation and a reportable data-retention breach — the exact failure this whole context exists to prevent.
- **Fix sketch**: Add a stable link from analysis → entry/candidate (denormalize `entry_id` or `candidate_id` onto `analyses` at save time, or match on `candidate_label` as a fallback), then in `anonymizeEntry` iterate the linked analyses and run `saveAnalysis`/an update with `scrubPiiFromPayload(payload)` + `maskCandidateName(candidate_label)`. Add a test that asserts no PII key survives in any analysis payload post-erasure.

## 2. Public erasure endpoint is unauthenticated AND unthrottled (token enumeration + erase-DoS)
- **Severity**: High
- **Category**: trust-boundary / rate-limit-gap
- **File**: `app/api/data/[token]/route.ts:33` (POST), `:12` (GET)
- **Scenario**: `POST /api/data/<token>` calls `findEntryByErasureToken(token)` then `anonymizeEntry(...)` with zero auth, zero CAPTCHA, and zero rate limiting. An attacker who scripts the endpoint can (a) enumerate the token space to discover valid tokens (the GET returns a candidate-safe projection that confirms a hit vs 404), and (b) for any token they obtain (forwarded email, shared inbox, logs, referrer leak), irreversibly anonymize that candidate's record — destructive and non-recoverable.
- **Root cause**: The token is treated as a sufficient capability, but the route applies none of the standard public-endpoint defenses (rate limit / throttle) that the codebase uses elsewhere. `randomToken("er")` strength mitigates blind guessing but does nothing against a leaked/forwarded token, and nothing caps request volume.
- **Impact**: A single leaked link lets anyone destroy a candidate's pipeline record; a loop against the endpoint is a cheap enumeration + denial-of-data attack. Irreversible (anonymize is terminal).
- **Fix sketch**: Add IP/token rate limiting to both verbs; require the POST to carry a confirmation nonce issued by the GET (so a bare scripted POST can't fire); log erasure requests with source IP; consider a short "undo" window before the scrub is committed.

## 3. `anonymizeProfile` is workspace-pinned — a non-default-tenant profile silently fails to scrub
- **Severity**: High
- **Category**: silent-failure / tenant-isolation
- **File**: `app/_lib/db/profiles.ts:107` (`anonymizeProfile`, `workspaceId = DEFAULT_WORKSPACE_ID`), called from `app/_lib/db/pipeline.ts:1024` with no workspace argument
- **Scenario**: A pipeline entry whose linked profile was saved under any workspace other than `"workspace"` reaches anonymization (expiry sweep or erasure). `anonymizeEntry` calls `anonymizeProfile(row.candidate_id)` with no workspace, so it defaults to `DEFAULT_WORKSPACE_ID`. `getProfileRecord(id, "workspace")` finds no row (wrong tenant), returns `null`, and `anonymizeProfile` returns `false` — which `anonymizeEntry` ignores (the call site discards the boolean). The entry is stamped `anonymized_at` and the audit logs "erased", but the CV payload is never scrubbed.
- **Root cause**: Cross-tenant by design at the entry level (anonymize resolves rows globally) but the profile primitive is tenant-scoped and the caller passes no tenant, so the two disagree. The `false` return is swallowed, so the failure is invisible — the audit trail asserts success.
- **Impact**: In any real multi-workspace deployment, erasure/expiry produces a *false* "erased" audit event while the candidate's CV PII stays intact in the profiles table. Today this is latent (apply-path `saveProfile` also defaults to `"workspace"`), but it is a live correctness trap the moment a second workspace exists.
- **Fix sketch**: Thread the entry's `workspace_id` into `anonymizeProfile`, or have `anonymizeEntry` resolve the profile's true workspace first. Make the profile-scrub failure loud: if `candidate_id` is set and `anonymizeProfile` returns `false`, throw (so the sweep logs it) rather than stamping `anonymized_at` over un-scrubbed data.

## 4. Consent recording is best-effort try/catch — processing can proceed with no consent row, so the sweep never reclaims it
- **Severity**: Medium
- **Category**: consent-enforcement-gap / silent-failure
- **File**: `app/api/apply/[id]/route.ts:447-451` and `:395-399` (`recordEntryConsent` wrapped in try/catch that only `console.error`s)
- **Scenario**: At apply, `recordEntryConsent(entry.id, "apply")` is deliberately best-effort ("never block the apply ack"). If it throws (DB lock/SQLITE_BUSY, transaction failure), the entry is created and the candidate is immediately analyzed by AI — but `consent_given_at`/`consent_expires_at` stay NULL. `consentStatus` then reports `"none"`, which `outreachSuppressionReason` treats as *contactable*, and `anonymizeExpiredConsents` only sweeps rows with `consent_expires_at IS NOT NULL` — so this entry is **never** auto-anonymized.
- **Root cause**: Consent is captured as a non-critical side effect of apply, but it is the *legal basis* for the processing that apply triggers. A failed write produces a permanently-retained, contactable record with no recorded consent and no expiry — the opposite of fail-closed.
- **Impact**: Silent indefinite retention + outreach of a candidate whose consent was never durably recorded. Hard to detect (it looks like a recruiter-sourced `none` row).
- **Fix sketch**: Treat a consent-record failure on the consenting apply path as a hard error (fail the apply, or queue a retry), OR have the sweep also reclaim entries that have `consent_given_at IS NULL AND created_at < now - TTL`. At minimum, alert on consent-write failures rather than only `console.error`.

## 5. Malformed/open-ended `consent_expires_at` makes a consent immortal (never expires, never suppresses)
- **Severity**: Medium
- **Category**: edge-case / retention-correctness
- **File**: `app/_lib/consent.ts:36-38` (`consentStatus`: `if (!snap.expiresAt) return "active"` and `if (!Number.isFinite(exp)) return "active"`)
- **Scenario**: An entry whose `consent_expires_at` is null (legacy/open-ended grant) or a non-ISO/garbage string. `consentStatus` returns `"active"` in both cases. `anonymizeExpiredConsents` skips it (`consent_expires_at IS NOT NULL`), and `outreachSuppressionReason` returns `null` (contactable) forever.
- **Root cause**: "Degrade safely" was implemented as "degrade to permanently-valid" — the safe default for a *consent expiry* should be to treat an unknown/unparseable expiry as expired (fail-closed), not active. An open-ended consent has no retention bound at all.
- **Impact**: Any entry with a null or corrupted expiry is retained and remarketed indefinitely with no GDPR retention ceiling — undermines the entire expiry-sweep guarantee.
- **Fix sketch**: Treat `!expiresAt` and non-finite `exp` as `"expired"` (or a bounded fallback derived from `givenAt + CONSENT_TTL_DAYS`) so unbounded/garbage data is reclaimed rather than immortalized; backfill nulls from `consent_given_at`.

## 6. Erasure POST reports `{erased:true}` regardless of whether anything was actually scrubbed
- **Severity**: Medium
- **Category**: success-theater / silent-failure
- **File**: `app/api/data/[token]/route.ts:38-39`, `app/_lib/db/pipeline.ts:1005-1030` (`anonymizeEntry` returns the entry on the already-anonymized no-op and ignores the profile-scrub result)
- **Scenario**: The POST handler calls `anonymizeEntry(entry.id, "erasure")` and unconditionally returns `jsonOk({ erased: true })`. If the profile scrub silently failed (finding #3), or analyses were never in scope (finding #1), the candidate is still shown the green "Your data has been erased" confirmation (`data/[token]/page.tsx:79-85`).
- **Root cause**: The route's success signal is "the function didn't throw", not "PII is gone". The pure scrub helpers can no-op or partially-apply without raising, so the confirmation is decoupled from the actual outcome.
- **Impact**: A candidate is affirmatively told their data is erased while CV text / analyses / cross-tenant profile may remain — a compliance-grade false statement made directly to the data subject.
- **Fix sketch**: Have `anonymizeEntry` return a structured result (entry scrubbed? profile scrubbed? analyses scrubbed?) and only return `erased:true` when every applicable surface confirms a scrub; otherwise return a partial/failed status and alert.

## 7. Provenance dossier embeds full candidate PII with no redacted/anonymized variant
- **Severity**: Low
- **Category**: pii-handling / provenance-integrity
- **File**: `app/_lib/provenance-dossier.ts:33` (`name = analysis.candidate?.name ...`), `:77-93` (verbatim evidence + soft-signal detail)
- **Scenario**: `buildProvenanceDossier` always renders the candidate's real name, role, years, and verbatim CV evidence quotes into an exportable Markdown file intended for hiring panels / EU AI Act compliance review. There is no flag to produce a de-identified dossier, and it does not consult consent/anonymization state — a dossier built for an already-anonymized candidate still re-materializes their name from the (possibly un-scrubbed) analysis payload.
- **Root cause**: The dossier is designed as a faithful provenance record but conflates "explainable" with "identified" — provenance integrity does not require re-exposing raw PII, and exports outlive the in-app retention controls.
- **Impact**: An exported dossier is an uncontrolled copy of PII outside the consent/erasure lifecycle; if generated against a payload that finding #1 left un-scrubbed, erased candidates' names re-enter circulation via downloaded files.
- **Fix sketch**: Accept a `redacted` mode that runs `maskCandidateName` + drops verbatim evidence quotes (keep scores/structure); refuse or auto-redact a dossier when the source entry/profile is anonymized; stamp the export with the consent status at generation time.
