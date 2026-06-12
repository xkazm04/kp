# Biz+UI Scan — Conversational Apply (2026-06-12)

> Total: 5 (1H/3M/1L)

Prior scans (2026-06-08, 2026-06-10) verified as shipped: CV step, email step, ack comm, re-apply merge (W8-6), KO-decline audit, apply-page LanguageSwitcher + ?lang pin. Findings below are net-new — most opened by the two HEAD-adjacent commits that postdate the last scan: `d19dad7` (quick-apply lead loop, E2–E5) and `529f7a0` (dual-theme design system).

## 1. Thread the lead's identity through the quick-apply enrichment link
- **Lens**: business_visionary
- **Severity**: High
- **Category**: user_benefit
- **File**: `app/api/apply/[id]/quick/route.ts:85` (also `app/apply/[id]/quick/QuickApplyForm.tsx:99`, `app/apply/[id]/page.tsx:13`, `app/_lib/db.ts:2782`)
- **Scenario**: A lead submits the quick form (name + email + KOs), gets the ack email with the "complete your profile" link, clicks it — and the full chat greets them as a stranger: re-type name, re-type email, re-answer the same three KO questions they already passed, before any new question appears.
- **Root cause**: `enrichLink` is built as a bare `/apply/${job.id}?lang=...` (quick/route.ts:85) and the success-screen CTA is `href={/apply/${jobId}}` (QuickApplyForm.tsx:99); the conversational page reads no searchParams and `ConversationalApply` has no prefill/skip mechanism, so the lead re-enters at step 0. Worse, the merge back onto their lead entry hinges on retyping the *exact same* email: `findApplicationByApplicant`'s name fallback is restricted to contactless rows (db.ts:2782-2787), and every lead row HAS a contact (lead-intake.ts:129) — so an alternate address or typo silently mints a second pipeline row for the same person.
- **Impact**: The enrichment hand-off is the E2 loop's entire conversion point ("re-applying with the same address rebuilds the profile" — lead-intake.ts:11-12). Today it taxes the returning lead with ~5 redundant steps at the moment of highest intent and can fork the candidate into duplicate entries, defeating the merge machinery shipped for exactly this journey.
- **Fix sketch**: Mint an opaque token (or reuse the entry id) on the lead entry and append it to both the email `enrichLink` and the success-screen CTA (`/apply/[id]?lead=...`). The apply page (already `force-dynamic`, already a server component doing `getJob`) resolves it, seeds `answers` with name/email/passed-KO ids, and passes a trimmed `steps` array (nextVisibleStepIndex already handles arbitrary skips) plus a "Welcome back, {name}" greeting. The POST carries the token so the merge targets that entry directly instead of re-deriving identity from the typed email.

## 2. Run the knockout gates before the high-effort steps
- **Lens**: business_visionary
- **Severity**: Medium
- **Category**: user_benefit
- **File**: `app/_lib/apply.ts:209` (KO steps appended last, after the CV step at apply.ts:202; decline discards everything at `app/api/apply/[id]/route.ts:223-234`)
- **Scenario**: A candidate answers the name, email, archetype and lane questions, lists skills, uploads and waits for their CV to extract — and only then learns the role needs on-site presence in Brno they can't meet. The decline branch creates no entry, so every answer and the CV text are discarded.
- **Root cause**: `buildApplyScript` pushes `ko_auth`/`ko_mode`/`ko_lang` after all capture steps including the file upload (apply.ts:202-230); the KO verdict only runs at the final POST (route.ts:219), which returns `declined` without persisting anything the candidate typed.
- **Impact**: Maximum wasted effort for exactly the people the gates exist to filter — a sour first brand impression ("they made me upload my CV, then rejected me on a yes/no") and inflated mid-flow drop-off for everyone, since the costliest step (CV) sits before the cheapest ones. The quick-apply form already demonstrates the right shape: KOs up front, effort after.
- **Fix sketch**: Reorder in `buildApplyScript` only — KO steps right after `email` (identity first, eligibility second, effort last); ids, conditions and the POST contract are order-agnostic (`failedKoStepIds` checks ids, not positions), so the route, quick form (`applyKoSteps` filters by type) and tests need no change. An ineligible candidate then invests ~3 answers, not 8 plus a file.

## 3. Localize the echoed Yes/No chat bubble
- **Lens**: ui_perfectionist
- **Severity**: Medium
- **Category**: ui
- **File**: `app/apply/[id]/ConversationalApply.tsx:203`
- **Scenario**: A Czech candidate (the product's primary market) taps the button labelled "Ano" on a knockout question — and their own chat bubble echoes back "Yes" in English. Happens on every KO step, 1–3 times per application.
- **Root cause**: `submitKo` hardcodes the echo label: `advance(step.id, {...}, yes ? "Yes" : "No")` (line 203), while the buttons themselves render `tCommon("yes")`/`tCommon("no")` (lines 318, 327) and every other echo path is localized (choice steps echo `opt.label`, the file step echoes `t("attachedFile")`/`t("skippedFile")`). The 06-10 i18n cross-check verified prompts and outcomes but missed this echo.
- **Impact**: A visible language break inside the candidate's own utterances on the company's first-impression surface — the one flow where the bilingual catalog work (`cs.common.yes: "Ano"` exists, messages/cs.json:107) was most deliberately threaded.
- **Fix sketch**: `advance(step.id, { ...answers, [step.id]: yes }, yes ? tCommon("yes") : tCommon("no"))` — both translators are already in scope.

## 4. Pin the candidate-facing apply surfaces to Studio Light (or give candidates the toggle)
- **Lens**: ui_perfectionist
- **Severity**: Medium
- **Category**: ui
- **File**: `app/layout.tsx:117` (THEME_INIT exempts only `/landing`; no ThemeToggle on `app/apply/[id]/page.tsx:49-51` or `quick/page.tsx:58-60`)
- **Scenario**: Any candidate whose OS prefers dark opens the apply link and lands in "Spark Dark" — the deliberately playful sticker-sheet register (Bricolage display face on the job title, candy accents, hard offset shadows, tilt-on-hover vocabulary) that `529f7a0` describes as the *experimental* register "for creative users". There is no way out: ThemeToggle is mounted only in the recruiter Workspace/WorkspaceNav (the only two consumers per grep), and the apply pages carry only the LanguageSwitcher.
- **Root cause**: The pre-hydration bootstrap applies `prefers-color-scheme: dark` globally except `/landing` (layout.tsx:117), which was hard-exempted precisely because it is a fixed public art direction — but the equally public, equally brand-bearing `/apply` routes were not given the same treatment, nor the toggle that makes the dark register an opt-in elsewhere.
- **Impact**: The employer cannot control which register their hiring front door renders in; an applicant to a conservative Czech corporate sees the experimental sticker-sheet purely because of their OS setting, on the page the brief calls the candidate's first impression. DESIGN.md frames light as "the calm corporate studio" — the brand-safe default for exactly this audience.
- **Fix sketch**: Follow the existing `/landing` precedent: extend the THEME_INIT guard to candidate-facing prefixes (`/apply`, and plausibly `/offer`, `/devcase` — confirm with their owners) so they always render Studio Light; one-line change in the inline script, zero component churn. Alternative if candidate dark mode is wanted later: a real candidate decision is mounting ThemeToggle beside the LanguageSwitcher — but defaulting an experimental register onto candidates should not stand meanwhile.

## 5. Give the chat a sense of remaining effort
- **Lens**: ui_perfectionist
- **Severity**: Low
- **Category**: ui
- **File**: `app/apply/[id]/ConversationalApply.tsx:171` (visibility logic already computable in `app/_lib/apply-intake.ts:164-173`)
- **Scenario**: The candidate answers question after question with no signal of how many remain — the flow is 8–10 steps including a file upload, but from inside the chat it could be three or thirty. Mid-flow abandonment is invisible-cost: the decline/accept outcome only exists if they reach the end.
- **Root cause**: The script is fixed and server-built (page.tsx:40), and `nextVisibleStepIndex` (apply-intake.ts:164) already encodes which steps are visible under the current answers — so remaining-count is a pure derivation — but the UI renders only the current step with no progress affordance.
- **Impact**: Unknown-length forms measurably depress completion; this flow grew from 5 steps to ~9 (archetype lanes + CV + KOs) without ever signalling length. Cheap conversion protection on the funnel's most fragile surface.
- **Fix sketch**: Derive `answered / (answered + remaining)` by walking `steps` with `stepConditionMet` under the current `answers` (lane branches make the total dynamic — recompute per answer), and render a quiet `text-sm text-steel` "Question 4 of 9" line (or a thin coral progress hairline) above the step controls. Token-only styling, no new state, honors both themes for free.

---
## Cross-checks performed
- Read both prior reports; confirmed shipped in code (not re-flagged): CV step (apply.ts:202), email step (apply.ts:114), ack dispatch (route.ts:421), W8-6 merge (route.ts:296-354, db.ts:2803), KO-decline audit (route.ts:224, db.ts recordKnockoutDecline), apply-page LanguageSwitcher (page.tsx:50) + ?lang pin (quick/route.ts:85). Known-but-unshipped items (role posting on apply page, save-and-resume, custom screening questions, decline-funnel UI) not re-flagged.
- Deferred-list respected: no auth, no extra languages, no slot/SLA/decision-rule items.
- Net-new provenance: findings 1 (E2 loop) and 4 (dual theme) trace to commits d19dad7 / 529f7a0, both dated Jun 11 — after the 06-10 scan.
- Read in full: ConversationalApply.tsx, apply/[id]/page.tsx, quick/page.tsx, QuickApplyForm.tsx, api/apply/[id]/route.ts, quick/route.ts, apply.ts, apply-intake.ts, lead-intake.ts, globals.css, recipes.ts, layout.tsx, db.ts dedup/merge region (2746-2833).
