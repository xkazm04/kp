# Landing & Marketing — UI Perfectionist scan

> Context: The public marketing landing pages (Studio + Spark art directions) and the login entry page.
> Files reviewed: 16 of 14 (all 14 context files + globals.css + devAuth.ts for grounding)
> Total: 7 findings — Critical: 0, High: 3, Medium: 3, Low: 1

## 1. Pricing CTAs hard-link to /login, bypassing the dev sign-in gate every other CTA uses

- **Severity**: High
- **Category**: dead-control / interaction-correctness
- **File**: `app/landing/spark/PricingSection.tsx:93` (tier CTAs) and `:111` (enterprise CTA)
- **Scenario**: A visitor scrolls to the pricing band and clicks "Choose Free / Start / Contact sales". Every other primary CTA on the page (nav Sign in `SparkLanding.tsx:190`, hero `:269`, CTA band `:602`, About `AboutCurve.tsx:91`) routes through `DEV_GATE ? signInDev() : window.location.assign("/login")`. The pricing buttons instead do `<a href="/login">` unconditionally.
- **Root cause**: The pricing tier links were authored as plain anchors and never wired to the shared `signInDev`/`DEV_GATE` helper, so they diverge from the page's single sign-in convention.
- **Impact**: In development the entire page drops you straight into the dashboard, but the pricing buttons land you on the password `/login` screen that dev has no credential for — a dead end on the most conversion-critical control. It is also inconsistent behavior between two buttons that look identical to the user.
- **Fix sketch**: Replace the pricing `<a href="/login">` elements with the same `onClick={() => (DEV_GATE ? signInDev() : window.location.assign("/login"))}` button used elsewhere (or extract a shared `<SignInCta>` component so all six entry points share one code path).

## 2. Login error is not announced and not associated with the input (a11y on the production entry point)

- **Severity**: High
- **Category**: a11y
- **File**: `app/login/page.tsx:57` (error `<p>`), `:46` (password input)
- **Scenario**: A user types a wrong password and submits. The error message renders as a plain `<p className="text-sm text-coral">`. A screen-reader / keyboard user gets no announcement that the submit failed, and the password field gives no programmatic hint that it is invalid.
- **Root cause**: The error paragraph has no `role="alert"`/`aria-live="assertive"`, and the input has no `aria-invalid`, `aria-describedby`, or `autocomplete="current-password"` tying it to the message.
- **Impact**: On the real operator sign-in page, an AT user can be stuck re-submitting with no feedback that anything went wrong — a silent failure on the single production auth gate.
- **Fix sketch**: Add `role="alert"` (or wrap in an always-rendered `aria-live` region) to the error `<p>`; set `aria-invalid={status === "error"}` and `aria-describedby="login-error"` on the input; add `autocomplete="current-password"`. Optionally add the KandidateMark + a "← back to home" link so the page reads as part of the brand.

## 3. Reduced-motion is honored inconsistently — JS equalizer loops and scroll/entrance springs ignore the preference

- **Severity**: High
- **Category**: a11y / motion
- **File**: `app/landing/spark/aboutIllustrations.tsx:248-258` (VoiceArt equalizer), plus `whileInView` springs throughout `AboutCurve.tsx` and `aboutIllustrations.tsx`
- **Scenario**: A user with `prefers-reduced-motion: reduce` opens `/about` (or `/`). `SparkLanding.tsx` correctly gates confetti, marquee, and the mascot float behind `useReducedMotion()`, and the CSS `.voice-eq-bar` is gated in `globals.css:477`. But the `/about` VoiceArt equalizer uses a framer-motion `animate={{ height: [...] }}` `repeat: Infinity` loop (JS, not the gated CSS class), and the scroll-driven spine spring + dozens of `whileInView` spring entrances are never checked against `useReducedMotion()`.
- **Root cause**: Two animation systems (gated CSS keyframes vs. ungated framer-motion props) coexist, and only some framer paths read `useReducedMotion()`.
- **Impact**: Reduced-motion users still get a perpetually bouncing equalizer and full spring choreography on the marketing pages — exactly the vestibular-trigger motion the preference asks to suppress. Inconsistent within the same design system.
- **Fix sketch**: Thread `useReducedMotion()` into `aboutIllustrations`/`AboutCurve` and collapse infinite/entrance animations to a static end-state when true (mirror the `animate={reduceMotion ? undefined : …}` pattern already used in `SparkLanding.tsx:307`).

## 4. The /about timeline loses its spine and its step numbers entirely on mobile

- **Severity**: Medium
- **Category**: responsiveness / missing-mobile-state
- **File**: `app/landing/spark/AboutCurve.tsx:139` (SVG spine `hidden … md:block`) and `:66` (numbered node column `hidden md:block`)
- **Scenario**: On a phone, the seven `StepRow`s stack vertically. The connecting serpentine spine SVG and the `01`–`07` numbered node badges are both `hidden` below the `md` breakpoint.
- **Root cause**: The visual ordering/connective tissue was built only for the two-column desktop layout; no mobile fallback for the numbering or the "this is a sequence" cue was added.
- **Impact**: Mobile visitors (the majority of marketing traffic) see seven unconnected, unnumbered cards with no sense that this is an ordered pipeline — the page's core narrative ("walk one hire down the whole pipeline") is lost on the smallest screens.
- **Fix sketch**: Render a lightweight mobile affordance below `md` — e.g. show the `String(n).padStart(2,"0")` badge inline above each step's eyebrow, and/or a simple vertical rule on the left, so the sequence reads without the desktop spine.

## 5. Feature cards claim `aria-haspopup="dialog"` but the hover/focus-opened spotlight is non-interactive and unfocusable

- **Severity**: Medium
- **Category**: a11y / misleading-affordance
- **File**: `app/landing/spark/SparkLanding.tsx:402-447` (card), `app/landing/spark/FeaturePreviews.tsx:444-457` (overlay)
- **Scenario**: A keyboard user tabs onto a feature card. `onFocus` calls `hoverOpen`, which sets `preview` but not `pinned`. The `FeatureSpotlight` then renders with `pointer-events-none` and `aria-modal={pinned}` = false. The card advertises `aria-haspopup="dialog"` + `aria-expanded={true}`, yet the "dialog" that appears cannot be reached or interacted with, and focus never moves into it; only pressing Enter (which sets `pinned`) yields a real, closeable dialog.
- **Root cause**: A single overlay serves two modes — a passive hover-preview and a true pinned dialog — but the ARIA on the trigger always promises a dialog, and there is no focus management into the pinned dialog (no focus trap / initial focus / focus-return).
- **Impact**: Screen-reader users are told a dialog opened on focus when nothing actionable did; when they do pin it, focus stays on the card behind the overlay, so they may never discover the close button or content.
- **Fix sketch**: Only expose `aria-haspopup`/`aria-expanded` for the pinned (real dialog) state; on pin, move focus into the dialog and restore it to the trigger on close; consider making the non-pinned hover preview `aria-hidden` so it isn't announced as a dialog.

## 6. Duplicated marquee text is read twice by screen readers

- **Severity**: Medium
- **Category**: a11y
- **File**: `app/landing/spark/SparkLanding.tsx:331-345`
- **Scenario**: The marquee renders `[...marquee, ...marquee]` (content duplicated for a seamless infinite scroll). The wrapping strip has no `aria-hidden`, so assistive tech reads every promotional phrase twice in a row, interleaved with the decorative `Sparkles`.
- **Root cause**: The duplicate copy needed for the visual loop is also exposed to the accessibility tree.
- **Impact**: Confusing, repetitive output for AT users; the marquee is purely decorative reinforcement, not new information.
- **Fix sketch**: Mark the scrolling strip `aria-hidden` (the same phrases already appear as real headings/feature copy below) — or render one set for AT and the visual duplicate with `aria-hidden`.

## 7. Login form has no max-width-busting / branding gaps and submit shows no spinner affordance

- **Severity**: Low
- **Category**: polish / loading-state
- **File**: `app/login/page.tsx:58-64`
- **Scenario**: On submit, the button text swaps to `t("submitting")` and disables, but there is no visual progress indicator (spinner/aria-busy) and the page is an unbranded bare form with no logo or link home.
- **Root cause**: Minimal-first form that was never given the same Spark polish as the marketing surfaces it gates.
- **Impact**: On a slow `/api/auth/login` round-trip the only feedback is a text change; the entry page also feels disconnected from the otherwise highly-art-directed brand.
- **Fix sketch**: Add `aria-busy={status === "submitting"}` and a small inline spinner to the button; add the `KandidateMark` header and a "← Home" link so the gate reads as part of the product.
