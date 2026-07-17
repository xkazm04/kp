# Plans, Checkout & Billing UI — ambiguity-guardian + ui-perfectionist scan

> Total: 5 findings (0 critical, 1 high, 3 medium, 1 low)

## 1. "Choose plan" checkout button is a dead-end for a lapsed-but-lingering subscription

- **Severity**: High
- **Lens**: ambiguity
- **Category**: state-divergence
- **File**: `app/features/sub_billing/BillingTab.tsx:510`
- **Scenario**: A subscriber whose Polar row is `canceled` past `currentPeriodEnd`, or `past_due`/`unpaid` past the 7-day grace, is entitled to `free` (see `entitledPlan`, entitlements.ts:51-63). The UI derives `changeVia = data.plan.id === "free" ? "checkout" : "portal"`, so every catalog card shows a fresh **Choose plan** (checkout) button. The user clicks it and the server returns 403 "You already have a plan — change it from the customer portal", because `hasActiveSubscription` (entitlements.ts:77) still counts `canceled`/`past_due`/`unpaid` as an active subscription.
- **Root cause**: The client routes on the *entitled plan id* (which falls to `free` after grace/period-end) while the server guard routes on the *stored subscription status* (which lingers in a subscribed state). The two use different notions of "already subscribed", and the assumption "entitled plan == free ⇒ no live subscription" is silent and false.
- **Impact**: The user is trapped: every plan card 403s, and the portal path (`changeVia === "portal"`) is never rendered because `plan.id === "free"`. There is no on-screen route to the portal from the catalog, so they cannot resubscribe or manage the lingering subscription without knowing to click the header **Manage** button.
- **Fix sketch**: Have `GET /api/billing` expose the raw subscription-liveness (`hasActiveSubscription(state)`) alongside the entitled plan, and drive `changeVia` off that flag rather than `plan.id === "free"`. Then a free-entitled-but-still-subscribed user gets portal routing (or an explicit "resume via portal" affordance) instead of a checkout button that always 403s.

## 2. Free/BYOM interview-minutes meter shows a red "Depleted" alarm for an allowance that never existed

- **Severity**: Medium
- **Lens**: ui
- **Category**: misleading-state
- **File**: `app/features/sub_billing/BillingTab.tsx:50`
- **Scenario**: The Free plan (`interview_minutes: 0`) and BYOM (`interview_minutes: 0`) surface an `interview_minutes` meter with `limit: 0`, `used: 0`, `credits: 0`. `depleted = limit !== null && meter.remaining === 0` evaluates true, so the row paints the count in `font-semibold text-coral` ("0 / 0") and renders a critical `AlertTriangle` **Depleted** badge (BillingTab.tsx:64, 85).
- **Root cause**: The `depleted` predicate cannot distinguish "you consumed everything" from "this tier never included any" — both are `limit === 0 && remaining === 0`. The nearby comment (lines 69-71) handles the invalid `aria-valuemax=0` progressbar case but not this false-alarm styling.
- **Impact**: A brand-new Free-tier recruiter is greeted by a red warning badge on Billing implying they exhausted something they never had, undermining trust in the usage panel and nudging an unnecessary upgrade/support ticket.
- **Fix sketch**: Treat a `limit === 0` meter as "not included in this tier" rather than "depleted": when `limit === 0 && credits === 0`, render a neutral/steel "Not included" label instead of the coral count and the critical Depleted badge. Reserve the Depleted state for `limit > 0` (or credits previously present) meters.

## 3. Portal error/fallback feedback renders only in the header, detached from the plan-card Manage buttons that also trigger it

- **Severity**: Medium
- **Lens**: ui
- **Category**: feedback-placement
- **File**: `app/features/sub_billing/BillingTab.tsx:461`
- **Scenario**: An existing subscriber sees **Manage** buttons on the catalog cards (`changeVia === "portal"`, BillingTab.tsx:200-207) whose `onManage` calls the same `openPortal`. When the portal call fails, is popup-blocked, or hits the "no customer yet" hint, the resulting `portalNote` (error/`alert`, fallback link, or calm hint) is rendered **only** inside the current-plan header block (line 461), which can be several viewport heights above the card the user just clicked.
- **Root cause**: `portalNote` is single-source and bound to one render location; the plan-card Manage buttons share the handler but not the feedback surface.
- **Impact**: A user who clicks a card's Manage button and hits a blocked popup or a gateway error sees no response near their cursor — the fallback link and error message appear off-screen, so the action reads as a dead click even though the guidance exists elsewhere.
- **Fix sketch**: Either render `portalNote` adjacent to whichever control triggered `openPortal` (track the trigger), or scroll/focus the header note into view on set, or keep the card-level Manage buttons but surface the note inline within the card. Simplest: `note` element gets `tabIndex=-1` and receives focus when populated so assistive tech and sighted users are taken to it.

## 4. Post-checkout confirmation gives up after a fixed ~5.5s with no further refresh, stranding slow webhooks on "unconfirmed"

- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: magic-timing
- **File**: `app/features/sub_billing/BillingTab.tsx:281`
- **Scenario**: On return from checkout the component re-polls `/api/billing` at 2000 ms and 5000 ms, then flips `pollWindowElapsed` at 5500 ms (BillingTab.tsx:283-286). If the Polar webhook lands the entitlement after ~5.5 s, `checkoutBannerState` returns `unconfirmed` ("payment received, updating…") and stays there: there are no further polls and no refresh affordance, so the current-plan panel keeps showing the old (free) plan until the user manually reloads the page.
- **Root cause**: The poll schedule is three undocumented magic numbers (2000/5000/5500) with no stated rationale for why 5.5 s is enough, and the terminal `unconfirmed` state offers no user-driven retry — it assumes the webhook always beats the fixed window.
- **Impact**: On a slow webhook (cold MoR, retry, network hiccup) the paid customer sees a stale plan and a vague "updating" banner indefinitely, with no button to re-check — a confusing post-purchase moment for the highest-intent user.
- **Fix sketch**: Name the constants (e.g. `CHECKOUT_POLL_MS`, `POLL_WINDOW_MS`) with a comment on why the window was chosen, and when `unconfirmed` add a lightweight "Refresh" affordance (reuse the existing `load()` + reset `pollWindowElapsed`) or continue polling at a backed-off interval until the plan reflects paid or the user navigates away.

## 5. In-flight checkout silently swallows clicks on other still-enabled catalog buttons

- **Severity**: Low
- **Lens**: ui
- **Category**: disabled-state-inconsistency
- **File**: `app/features/sub_billing/BillingTab.tsx:306`
- **Scenario**: `startCheckout` early-returns `if (purchase && purchase.error === null) return;` while any purchase is redirecting. But each catalog card and the minute-pack button disable only on **their own** key (`busy` / `purchase?.key === plan.id`, lines 505, 550). So while (say) Starter is redirecting, the Growth card and the pack **Buy** button stay visually enabled; clicking them hits the early-return and does nothing, with zero feedback.
- **Root cause**: The "one purchase at a time" guard is global, but the disabled/`busy` styling is per-key, so the enabled/effective states diverge.
- **Impact**: Minor — the redirect window is short — but a user who clicks a second option during that window gets a dead, feedback-less button, briefly reading as a broken UI.
- **Fix sketch**: When a purchase is in flight (`purchase && purchase.error === null`), disable *all* catalog/pack buttons, not just the active one — e.g. pass a shared `anyPurchaseBusy` flag into `PlanCard` and the pack button's `disabled`. The active button keeps its "Redirecting…" label; the rest simply grey out.
