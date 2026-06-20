# Offers & Onboarding — UI Perfectionist scan

> Context: Generate, send, and finalize candidate offers via a tokenized public offer page, gated by offer policy.
> Files reviewed: 9 of 8 (all 8 manifest files + AiDisclosure/initials/use-error-message dependencies)
> Total: 7 findings — Critical: 0, High: 2, Medium: 3, Low: 2

## 1. Initial load shows raw "Loading…" text with no skeleton or layout reservation (CLS + bare first paint)

- **Severity**: High
- **Category**: missing-loading-state / CLS
- **File**: `app/offer/[token]/page.tsx:157-158`
- **Scenario**: A candidate opens the offer link on a cold/slow connection. Until `GET /api/offer/[token]` resolves, the entire card body is a single centered line of muted text: `<p className="text-center text-sm text-steel">{tCommon("loading")}</p>`.
- **Root cause**: The page has no loading skeleton. The branch order is `notFound → loadError → !offer (loading) → offer`, and the loading branch renders the smallest possible placeholder inside the otherwise-empty card. When `offer` arrives, the card jumps from a one-line height to the full header/comp/buttons height.
- **Impact**: This is the candidate's first impression of a high-stakes, "premium letterhead" offer document, and it renders as a near-blank box that then visibly reflows (layout shift). Feels broken/unofficial on exactly the page where trust matters most; the reflow is a measurable CLS hit.
- **Fix sketch**: Replace the bare loading `<p>` with a skeleton that mirrors the real layout (a pulsing logo square + two title bars + a comp block + two button bars, e.g. `animate-pulse bg-stone-100 rounded`). Reserve the card's min-height so the transition to loaded content does not jump.

## 2. A salary of exactly 0 (and a "0 hours left" deadline) silently vanish from the offer

- **Severity**: High
- **Category**: falsy-guard / silent-data-loss
- **File**: `app/offer/[token]/page.tsx:185` (`{offer.salary ? (…) }`) and `:234-235` (`offerHoursRemaining` then `if (hrs === null …) return null`)
- **Scenario**: The compensation block is gated on `offer.salary ?` — a truthiness test. If a record carries `salary: 0` (a placeholder/equity-only/data-entry slip), the entire "Proposed compensation" block is omitted with no indication. Separately, `offerHoursRemaining` can return `0` (rounds up, floors at 0) for an offer in its final minutes; `0` is rendered fine by the countdown, but the surrounding `hrs <= 48` styling and copy ("0 hours left") read as already-expired while the buttons remain live.
- **Root cause**: `?` truthiness conflates "absent" (`null`) with the legitimate value `0`. The comp block should test `offer.salary != null`, not `offer.salary`.
- **Impact**: An offer page that should show "0" (or trigger a "contact us about comp" affordance) instead shows no compensation at all — the candidate sees an offer with a blank money section and may distrust or abandon it. The "0 hours left" copy on a still-acceptable offer is misleading.
- **Fix sketch**: Change line 185 to `offer.salary != null ?`. For the countdown, when `hrs === 0` switch copy to an urgent "expires today / within the hour" string rather than "0 hours left", or hide the hours fragment and keep only the dated `deadline` line.

## 3. Company-less offers lose the eyebrow→title visual hierarchy and the logo monogram

- **Severity**: Medium
- **Category**: visual-hierarchy / inconsistent-layout
- **File**: `app/offer/[token]/page.tsx:161-180`
- **Scenario**: When `offer.company` is null, the header collapses to a single bare `<p>` eyebrow (line 176) with no monogram and no container, then the `<h1>` falls back to `t("roleGeneric")` ("A role with us"). The branch with a company renders a 44px monogram tile + eyebrow + company name in a flex row; the without-company branch renders only the eyebrow line.
- **Root cause**: Two divergent header layouts conditioned on `company`, rather than one layout that degrades gracefully (the monogram has no neutral fallback for the no-company case even though `initials(label, "•")` already supports a placeholder).
- **Impact**: Offers without a resolved company (job has no `company`, or `getJob` returned null) look visibly less finished/official than ones with a company — inconsistent branding on the same template, undermining the "premium letterhead" intent.
- **Fix sketch**: Render one header: always show the accent monogram tile (use a neutral placeholder glyph when there's no company), always show the eyebrow, and only conditionally show the company-name line. Keep the gradient strip + monogram constant so every offer reads as the same official document.

## 4. Disabled/muted buttons rely on opacity alone — insufficient contrast + no `aria-disabled` semantics for the muted sibling

- **Severity**: Medium
- **Category**: a11y / disabled-state
- **File**: `app/offer/[token]/page.tsx:303-327` (and the confirm pair `:269-294`)
- **Scenario**: While one response is pending, the *other* button is visually muted via `pending === "decline" ? "opacity-40" : ""` (and vice-versa) but is NOT actually `disabled` only in the sense that `disabled={pending !== null}` is applied to both — so the muted button IS disabled, yet its only distinguishing cue is `opacity-40`. At 40% opacity, "Decline" text on stone fails WCAG contrast, and there is no non-color signal that it is unavailable.
- **Root cause**: State is communicated purely through reduced opacity. The disabled `<button>` does carry the native disabled semantics, but the *extra* 0.4 mute is a color-only affordance and pushes text below 4.5:1.
- **Impact**: Low-vision users (and anyone on a dim screen) can't read the muted button label, and the "which action is in flight" cue is invisible to them. The pressed button does have a spinner + `aria-busy`, but the muted sibling has no equivalent textual/aria cue.
- **Fix sketch**: Keep the spinner on the active button; for the inactive one rely on the native `disabled` styling already in the class (`disabled:opacity-60`) instead of stacking a separate `opacity-40`, and ensure the disabled label still clears 4.5:1. Optionally add `aria-hidden`-free text or keep label fully opaque and only dim the background.

## 5. The standalone "Decline" entry button has no `data-sim-click` and no `aria-busy`, unlike every sibling action

- **Severity**: Medium
- **Category**: inconsistency / instrumentation-gap
- **File**: `app/offer/[token]/page.tsx:318-327` vs `:301` (accept) and `:271` (confirm-decline)
- **Scenario**: Accept (`data-sim-click="offer-accept"`), confirm-decline (`data-sim-click="offer-decline-confirm"`), and the onboarding CTA (`data-sim-click="offer-onboarding-cta"`) all carry sim-click hooks used by the guided simulation. The first-step "Decline" button that opens the confirm dialog has none. It also lacks `aria-busy` (it only toggles a local `confirmingDecline` state, so this is minor), but the missing sim hook means the guided demo cannot drive the decline path.
- **Root cause**: Instrumentation was added per-action ad hoc; the decline *entry* control was missed because the real POST happens on the confirm button.
- **Impact**: The guided simulation (a marketing/demo surface) cannot script "candidate declines"; and any analytics keyed on these hooks under-counts decline intent. Pure inconsistency in an otherwise carefully-instrumented component.
- **Fix sketch**: Add `data-sim-click="offer-decline"` to the line-318 button so the decline flow is fully drivable/measurable, matching the accept/confirm/onboarding hooks.

## 6. No `role="status"`/live-region for the terminal accepted/declined/expired swap — screen readers get no announcement

- **Severity**: Low
- **Category**: a11y / live-region
- **File**: `app/offer/[token]/page.tsx:198-226`
- **Scenario**: After a successful POST, the buttons are replaced in-place by the accepted/declined/expired result card. The error banner has `role="alert"` (line 249) and the decline confirm has `role="alertdialog"`, but the *success* outcome card (the most important state change — "🎉 Offer accepted") has no `role="status"`/`aria-live`, so assistive tech announces nothing when the candidate's action completes.
- **Root cause**: Live-region treatment was applied to error/confirm paths but not the success result swap.
- **Impact**: A screen-reader user who clicks Accept hears the button's `aria-busy`, then silence — no confirmation that the offer was accepted or that an onboarding next-step appeared. They must manually re-navigate to discover the outcome.
- **Fix sketch**: Wrap the result block (lines 198-226) in a container with `role="status" aria-live="polite"` (or add it to each outcome card) so the accepted/declined/expired title is announced on appearance. The onboarding CTA should receive focus on accept.

## 7. Two near-identical fetch-then-parse blocks (`load` and `reconcile`) duplicate the GET logic

- **Severity**: Low
- **Category**: component-extraction / DRY
- **File**: `app/offer/[token]/page.tsx:57-78` (`load`) and `:88-101` (`reconcile`)
- **Scenario**: `load` and `reconcile` both do `fetch(/api/offer/${token})` → `r.json().catch(() => ({}))` → branch on `p.offer.status` to set `result`. They diverge only in error handling (load sets `loadError`/`notFound`; reconcile is silent). The terminal-status check `s === "accepted" || s === "declined" || s === "expired"` is copy-pasted in three places (lines 74, 94, and implicitly the result type).
- **Root cause**: The reconcile-after-ambiguous-POST path was bolted on next to the existing loader without extracting the shared GET+status-derivation.
- **Impact**: Maintenance hazard — a future status value (e.g. "rescinded") must be added in three string literals or behavior silently diverges between initial load and reconcile. No user-facing bug today.
- **Fix sketch**: Extract a `fetchOfferStatus(token): Promise<{ offer?: OfferView; terminal?: Result }>` helper and a `TERMINAL_RESULTS` set; have both callers consume it and apply their own error policy. Derive the terminal-status check from a single shared constant.
