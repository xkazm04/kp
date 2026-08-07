# Privacy, Consent & Provenance — ambiguity-guardian + ui-perfectionist scan

> Total: 5 findings (0 critical, 1 high, 3 medium, 1 low)

## 1. Erasure/data-rights link 404s after anonymization — candidate sees a generic error, never confirmation
- **Severity**: High
- **Lens**: ambiguity
- **Category**: dead-branch-broken-flow
- **File**: `app/data/[token]/DataClient.tsx:99` (with `app/api/data/[token]/route.ts:14` and `app/_lib/db/pipeline.ts:1319`)
- **Scenario**: A candidate's consent expires; the sweep auto-anonymizes them. Later they open the "manage your data" link from an old email. `anonymizeEntry` (expiry *or* erasure reason) sets `erasure_token = NULL`, so `findEntryByErasureToken(token)` returns null → GET `/api/data/[token]` returns 404 → `DataClient` runs `.catch(() => setLoadError(...))` and shows the generic "we couldn't load your data" error.
- **Root cause**: The success/reassurance branch `erased || view.anonymized` (line 99) can only fire when a `view` with `anonymized === true` is fetched, but the token that would fetch it is nulled at the moment anonymization happens. The `view.anonymized` half of that condition is therefore unreachable dead code — the author clearly intended anonymized entries to render the calm "your data is gone" screen, but they can never load one.
- **Impact**: On the flagship GDPR transparency surface, the exact population GDPR cares most about (expired/erased candidates) hits a scary error instead of confirmation that their data is safe. It also affects a candidate who successfully erased and later revisits the same link.
- **Fix sketch**: Either keep the token resolvable post-anonymization (don't null it, or add a second lookup that recognizes an already-anonymized entry) so GET can return `{ anonymized: true }` and DataClient shows the reassurance screen; or have the GET route return a 200 "already anonymized" projection for a nulled-but-recently-anonymized token. Then the `view.anonymized` branch becomes live.

## 2. A consent with no expiry is treated as perpetually "active" — indefinite PII retention with no sweep path
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: silent-retention-gap
- **File**: `app/_lib/consent.ts:56`
- **Scenario**: `consentStatus` returns `"active"` when `givenAt` is set but `expiresAt` is null ("legacy / no expiry"). The expiry sweep filters `consent_expires_at < now`, so a null-expiry row is never selected, never anonymized, and `consentWithholdsPii`/`outreachSuppressionReason` both treat it as fully live forever.
- **Root cause**: The lifecycle silently assumes every granted consent carries an expiry, but recruiter-sourced or legacy/pre-migration rows can have `consentGivenAt` without `consentExpiresAt`, and nothing backfills one.
- **Impact**: Such candidates' PII (CV, contact, transcript) is retained indefinitely and they remain contactable for outreach forever — the precise GDPR retention hole the anonymize-on-expiry design exists to close, reached by omission rather than intent.
- **Fix sketch**: Decide the policy for a null-expiry consent explicitly: either treat "granted but no expiry" as needing a backfilled `consentExpiresAt` at read time (givenAt + `consentTtlDays()`), or classify it as a distinct status the sweep/UI flags for operator attention. Document the choice next to the `!snap.expiresAt` branch so it stops reading as an accidental "never expires".

## 3. AiDisclosure pre-fetch defaults can permanently mis-state the legal disclosure
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: wrong-legal-copy
- **File**: `app/_components/AiDisclosure.tsx:33-34` (and the catch at `:47-49`)
- **Scenario**: The component defaults `regimeId` to `"eu"` and `retentionMonths` to `12`, then resolves the real values from `/api/compliance`. If that fetch fails, the `.catch` keeps the defaults permanently. So a US/UK tenant's candidates are shown the EU anti-discrimination framework + GDPR data-law line, and a deployment with `KP_CONSENT_TTL_DAYS > 365` under-discloses retention (e.g. shows "12 months" while enforcing 24) — the GDPR-worse under-disclosure direction that `consentRetentionMonths` in consent.ts is explicitly built to avoid.
- **Root cause**: The hardcoded defaults mirror only the *server default* (eu / 365 days), not the *configured* value, and the failure path silently ships those defaults as if authoritative. The inline comment's claim of "never a flash of WRONG content" holds only for an EU, ≤365-day tenant.
- **Impact**: A candidate can be shown the wrong legal framework and a shorter-than-enforced retention window on a consent disclosure — a compliance statement that is materially false for non-EU or long-retention deployments, and permanently so if the endpoint is down.
- **Fix sketch**: On fetch failure, degrade to a neutral non-committal retention/regime line (or suppress the specific regime/retention sentence) rather than asserting eu/12mo. Alternatively pass the server-resolved regime + effective retention into this component from a server parent so first paint is already correct and there is no failure-window falsehood.

## 4. DataClient has no retry and no error-type distinction — inconsistent with its sibling StatusClient
- **Severity**: Medium
- **Lens**: ui
- **Category**: error-state-inconsistency
- **File**: `app/data/[token]/DataClient.tsx:39-48`
- **Scenario**: DataClient's load is `.catch(() => setLoadError(t("loadFailed")))` — a single dead-end message with no Retry, collapsing a permanent 404 (bad/expired/already-erased link) and a transient offline/5xx into the same copy. The sibling public-token page `StatusClient` (`app/status/[token]/StatusClient.tsx:46-69`) already solves this with `classifyStatusError` → distinct "get a fresh link" vs "retryable" copy plus a Retry button.
- **Root cause**: Two near-identical public token pages implement error handling independently; the newer/erasure one didn't adopt the typed-error + Retry pattern the status page established.
- **Impact**: A candidate who hits a momentary network blip on their data-rights page is stranded with no way to retry, and a candidate on a genuinely dead link isn't told to request a fresh one. Compounds finding #1 (the post-anonymization 404 lands here with no recovery or explanation).
- **Fix sketch**: Reuse the StatusClient approach — inspect `res.status`, branch on invalid-link vs retryable, and render a Retry affordance for the transient case. Ideally extract the shared classify+retry error block into one component used by both public token pages.

## 5. Consent status chips break the design-token palette and contradict their own comment
- **Severity**: Low
- **Lens**: ui
- **Category**: palette-inconsistency
- **File**: `app/features/sub_pipeline/ConsentPanel.tsx:65-71`
- **Scenario**: `statusTone` styles `active`/`none`/`anonymized` from design tokens (`moss`, `steel`, `stone`), but `expiring` and `expired` hardcode raw Tailwind palette (`bg-amber-100 text-amber-800`, `bg-red-100 text-red-700`). The inline comment asserts "no hardcoded hex; mapped neutrals/status shades flip in dark mode" — but these are fixed Tailwind palette values and the app ships no dark mode (`dark:` variants are effectively absent), so the claim is untrue on both counts.
- **Root cause**: Two of five status tones bypass the token system, and a stale comment describes an intent (token-only, dark-adaptive) the code doesn't meet.
- **Impact**: The two most safety-relevant chips (expiring/expired) can't be restyled centrally with the rest of the status system and drift visually from the app's token-driven status colors; the misleading comment will mislead the next maintainer.
- **Fix sketch**: Define amber/red status tokens (as `moss` already is) and map all five tones through them, or at minimum correct the comment to say these two use raw Tailwind palette. Keep the same visual hues; only route them through the shared token so they stay consistent and centrally themeable.
