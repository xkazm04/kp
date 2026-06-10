# Feature Scout — Conversational Apply (2026-06-10, re-scan of mined context)

> Total: 4 (1H/2M/1L)
> Prior scan 2026-06-08: 6 findings, APP1-3 shipped, APP4-6 retired. This re-scan reports only net-new gaps.

## 1. Let a re-apply update the original entry instead of discarding everything
- **Value**: High
- **Category**: functionality
- **Effort**: M
- **Where**: `app/api/apply/[id]/route.ts:139` (`acknowledgeReapply`) + `app/api/apply/[id]/route.ts:241` (primary dedup check), `app/_lib/db.ts:1995` (`findApplicationByApplicant`), `app/_lib/apply-intake.ts:81` (`applyDedupeKey`)
- **Gap**: A seam opened by shipping APP2 (contact) + W15 (dedup-by-email). When a repeat application is detected, `acknowledgeReapply` records a bare `re_applied` event and discards every fresh answer — a candidate who re-applies to add the CV they skipped, or to supply an email, gets "already applied" and stays exactly as thin/unreachable as before. Worse, the upgrade path duplicates: a first application with no email gets a name-keyed entry (`appl-jane-doe`); a re-apply WITH email is looked up by email only (db.ts:2009 — "NO name fallback"), misses, and mints a second row under an email-keyed dedupeKey for the same person.
- **Proposal**: On a detected repeat, merge instead of drop: backfill `contact` when the original is NULL and the re-apply carries a valid email; optionally rebuild the profile when the re-apply adds a CV the original lacked (the `built` machinery is already in the handler). For the upgrade path, when the email lookup misses, fall back to a name match restricted to entries with NULL contact for that job — same person becoming reachable, not a new applicant — and backfill rather than insert. Record what changed in the `re_applied` detail.
- **Why users need it**: Re-applying is the only self-service "update my info" path an applicant has (the token status page, APP4, was retired); today it is a dead end, so an unreachable candidate can never fix their reachability — the exact problem APP2 was shipped to solve.

## 2. Record knockout declines so recruiters can see the apply funnel
- **Value**: Medium
- **Category**: functionality
- **Effort**: M
- **Where**: `app/api/apply/[id]/route.ts:183-189` (the decline branch returns without persisting anything); `app/_lib/db.ts:2095` (`recordAutomationEvent` is entry-scoped, so it cannot capture a decline — no entry exists)
- **Gap**: A KO-declined application vanishes without trace: no event, no counter, not even which gate fired. A recruiter cannot see that a role's on-site requirement or language gate is turning away dozens of candidates a week, or that an apply link is getting traffic but zero passes — the data is in the POST (`expectedKoIds` vs the answers) and is thrown away.
- **Proposal**: Persist a minimal per-job decline record at the decline branch (jobId, failed KO step id(s), timestamp — no PII needed), e.g. a small `apply_declines` table or job-scoped event row. Surface it as a compact funnel line on the job's posting modal / candidates tab: applied N · declined M (top gate: ko_mode). Distinct from the automation scout's auto-scoring claim (that concerns *accepted* entries) and from the archived JOB4 sourcing analytics (different surface).
- **Why users need it**: KO questions are the role's hard filters; without decline telemetry a recruiter can never learn that a filter is miscalibrated (or that the role's location/mode is the real blocker) until the pipeline mysteriously stays empty.

## 3. Show the role posting on the apply page
- **Value**: Medium
- **Category**: user_benefit
- **Effort**: S
- **Where**: `app/apply/[id]/page.tsx:24-35` (header renders only title/company/subtitle); `app/features/sub_jobs/jobMarkdown.ts:8` (`jobToMarkdown` — the publish-ready posting already exists)
- **Gap**: The apply page gives the candidate three lines of context (title, company, one-line subtitle) before asking them to commit to a chat. The full publish-ready posting — description, requirements, salary band, early-career welcome — exists in `jobToMarkdown` but is only reachable from the recruiter's JobPostingModal; a candidate who received a bare forwarded link applies blind to a role whose location/mode they only discover at the KO questions.
- **Proposal**: Render a collapsible "About this role" section on the apply page, server-side, reusing `jobToMarkdown` (or a candidate-trimmed variant) through the existing `Markdown` component. Localize the section headings ("About the role", "What you'll bring" are hardcoded English in jobMarkdown.ts) via the apply catalog while leaving recruiter-authored body text as-is.
- **Why users need it**: Informed applicants self-select — fewer KO declines and fewer junk applications — and the page becomes shareable as the posting itself instead of requiring the ad to travel alongside the link.

## 4. Expose the language pin on the apply link (and a switcher on the apply page)
- **Value**: Low
- **Category**: feature
- **Effort**: S
- **Where**: `app/features/sub_jobs/JobPostingModal.tsx:28-39` (`copyApplyLink` copies the bare URL), `proxy.ts:6-16` (the `?lang=` override built explicitly for candidate-facing links), `app/features/Workspace.tsx:135` (LanguageSwitcher mounted only in recruiter chrome)
- **Gap**: Opened by i18n (7922fbe). The `?lang` proxy was built precisely so "candidate-facing links (offer / apply / …) can be shared in a specific language", but no UI exposes it: the copy-apply-link button copies the bare URL, and the public apply page has no language toggle (LanguageSwitcher lives only in the recruiter Workspace). Accept-Language covers the common case, so the residual gap is the mismatched-browser candidate (Czech speaker on an English-locale machine, or vice versa) and the recruiter posting to a single-language job board.
- **Proposal**: Add an EN/CS choice to the copy-apply-link affordance (append `?lang=cs`/`?lang=en`), and mount a minimal locale toggle on the apply page header (the switcher's server action already persists the cookie). Distinct from the sim-channels scout's comm-template localization claim — that is outbound email bodies; this is the apply page/link language.
- **Why users need it**: The product is Czech-market-first (`DEFAULT_APPLY_LANGUAGES`), the default locale is `en`, and the candidate is the one user who cannot reach the existing switcher — the last mile of the i18n work on its most public surface.

---
## Cross-checks performed
- Read prior report `feature-scout-2026-06-08/conversational-apply.md` (APP1-6) + INDEX.md (retirement banner) + harness-learnings W2/W15 lines. Confirmed shipped in code: APP1 CV step (`apply.ts:202`, `ConversationalApply.tsx:212`), APP2 email step + `contact` column (`apply.ts:114`, `db.ts:404`), APP3 `dispatchApplicationReceived` (`route.ts:308`), W15 email-preferred dedup (`apply-intake.ts:81`, `db.ts:1995`). APP4/5/6 not re-proposed (finding 1 explicitly notes the re-apply path is the non-token alternative to retired APP4).
- i18n briefing hypothesis checked and REJECTED as a gap: `buildApplyScript` takes a server-resolved `apply` translator (`apply.ts:100`), page.tsx builds steps via `getTranslations("apply")`, POST outcome messages localized (`route.ts:162`), locale resolution falls back to Accept-Language (`i18n/server.ts:13`, `locales.ts:30` matches `cs-CZ`→`cs`). Residual i18n gap is only the unexposed `?lang` pin/switcher (finding 4).
- Greps: `/apply/|applyLink` across app (only JobPostingModal mints the link, bare URL); `?lang` (only proxy.ts handles it, no UI emitter); `LocaleSwitcher|LanguageSwitcher` (recruiter Workspace only); `findApplicationByApplicant|contact` in db.ts (verified email-only lookup, no name fallback, no backfill anywhere); `recordAutomationEvent` (entry-scoped — declines unrecordable today); decline branch `route.ts:183-189` persists nothing.
- Read in full: `app/apply/[id]/page.tsx`, `app/apply/[id]/ConversationalApply.tsx`, `app/api/apply/[id]/route.ts`, `app/_lib/apply.ts`, `app/_lib/apply-intake.ts`, `i18n/{request,server,locales}.ts`, `proxy.ts`, `JobPostingModal.tsx`, `jobMarkdown.ts`, db.ts dedup/contact regions.
- Adjacent-scout collisions avoided: dev-case apply page (dev-case scouts — different surface), auto-score inbound applicants (automation scout — finding 2 covers *declines*, pre-entry, explicitly disjoint), job terminal lifecycle / apply-link-forever (job-catalog scout — not touched), comm-template localization (sim-channels scout — finding 4 is page/link language, not email bodies).
