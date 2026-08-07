# Branding & White-label — bug-hunter + ui-perfectionist scan

> Context: Org-level white-label brand (name/accent/logo) validated in pure `brand-config.ts`, persisted via lazy-CREATE `brand-store.ts`, injected app-wide by the root layout's `BrandStyle` + `BrandProvider`; edited in `BrandingTab`.
> Files reviewed: 7 of 7
> Total: 5

Note on the CSS-injection surface (probed hard, NOT a finding): `sanitizeAccentColor`'s `HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/` is fully anchored, ASCII-only, `#`-required, trims then lowercases, and `saveBrand` is the sole writer of `accent_color`. Uppercase/3-vs-6/whitespace all normalize; `</style>`, `\31`, unicode, and `red;}...` all fail the anchor. The `dangerouslySetInnerHTML` in `BrandStyle` is genuinely safe. No bypass found — do not re-report.

## 1. Accent color has zero contrast validation — an operator can make primary buttons and focus rings unreadable app-wide, including candidate pages

- **Severity**: High
- **Lens**: ui-perfectionist
- **Category**: a11y / validation-gap
- **File**: `app/_lib/brand-config.ts:29-33`, `app/_components/BrandStyle.tsx:15-19`, `app/globals.css:11,236,313,323`
- **Scenario**: An operator opens Branding, picks accent `#ffffff` (or `#ffff00`, or any light hue) and saves. `--color-coral` is overridden in both themes by `BrandStyle`, which the root layout (`app/layout.tsx:154`) renders in the shared `<body>` — so the change hits the whole workspace AND every candidate-facing token page (offer/apply/schedule). Primary buttons render `text-white` on the accent → invisible text; focus rings (`box-shadow: 0 0 0 4px var(--color-coral)`, globals.css:313/323) and the active-nav bar become invisible → a keyboard/low-vision user loses all focus indication.
- **Root cause**: The design assumes any strict hex is a valid *brand* color, but "syntactically valid hex" ≠ "legible/accessible accent". Nothing anywhere computes contrast of the accent against white button text or the paper background; the only gate is the hex regex.
- **Impact**: Self-service control can render the product unusable/inaccessible platform-wide and on public candidate pages (WCAG 1.4.3 / 2.4.7 failure). Reversible, so not Critical.
- **Fix sketch**: In `sanitizeAccentColor` (or a `validateAccent` helper) compute WCAG contrast of the hex vs `#ffffff` and vs `--color-paper`; reject or warn below ~3:1, and surface an inline warning in `BrandingTab`. Centralizing it in the pure module makes the whole class impossible at the store boundary.

## 2. Clearing the accent does not revert live — the stale brand color stays on screen until a full reload, while the UI says "Saved"

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure / state-corruption
- **File**: `app/features/sub_branding/BrandingTab.tsx:19-23,69`, `app/_components/BrandStyle.tsx:17`
- **Scenario**: Page loads with a stored accent `#123456` → `BrandStyle` emits `<style>:root{--color-coral:#123456;}…</style>` in `<body>` (wins over globals.css by source order). Operator clears the accent field and Saves. Server stores `null`; `applyLiveAccent(null)` calls `documentElement.style.removeProperty("--color-coral")`. But the old value lives in `BrandStyle`'s `:root` rule, not in any inline property — removing the (absent) inline style falls the cascade *back onto* `BrandStyle`'s `#123456`. The accent visibly persists; only a reload picks up the now-null server value.
- **Root cause**: `applyLiveAccent` assumes live state is controlled by an inline `--color-coral` on `<html>`, but on first load that override lives in the server `<style>`. `removeProperty` can only undo a *set*, never the server rule — so the SET path works (inline > `:root`) while the CLEAR path is a no-op.
- **Impact**: "Saved" success theater; operator believes the reset failed and re-clicks, or ships thinking the brand reverted when candidate pages still show the old accent until each visitor reloads.
- **Fix sketch**: Always drive the inline var from full live state: `root.style.setProperty("--color-coral", accent ?? CORAL)` (never `removeProperty`), so post-hydration the inline style fully supersedes `BrandStyle` in every case.

## 3. External logo is a raw `<img src>` with no error fallback and no referrer policy — broken image on failure, third-party beacon on every render

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: missing-ui-state / security
- **File**: `app/_components/BrandHeader.tsx:18-23`, `app/features/sub_branding/BrandingTab.tsx:189-199`, `app/_lib/brand-config.ts:45-55`
- **Scenario**: Operator sets a logo URL that later 404s, is renamed, or is slow. Both sidebars (`BrandHeader`, rendered on the authenticated shell) and the preview render `<img src={logoUrl} alt="">` with no `onError` handler → a permanently broken-image glyph replaces the brand mark, with `alt=""` so screen readers get nothing. Separately, `sanitizeLogoUrl` accepts *any* `https` host with no allowlist and the tag sets no `referrerPolicy`, so every viewer's browser makes a credentialed cross-origin request to the operator-chosen host, leaking IP/User-Agent/Referer on each load.
- **Root cause**: The logo is treated as a trusted bundled asset (`no-img-element` is disabled with that justification), but it is arbitrary operator-supplied external content — it can fail, disappear, or phone home.
- **Impact**: Degraded/branding-broken shell with no graceful fallback to the default `KandidateMark`; passive tracking/deanonymization vector via a third-party host.
- **Fix sketch**: Add `onError` that falls back to `<KandidateMark>` (share one `<BrandLogo>` component across sidebar + preview), give it a meaningful `alt` (the display name), and set `referrerPolicy="no-referrer"`; optionally constrain hosts in `sanitizeLogoUrl`.

## 4. "Reset" blanks the form to empty (not last-saved) and there is no unsaved-change guard — edits or a whole brand can be silently lost

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: missing-ui-state / interaction-correctness
- **File**: `app/features/sub_branding/BrandingTab.tsx:78-83,166-171`
- **Scenario**: A workspace has saved brand "Acme"/accent/logo. Operator clicks the `RotateCcw` "Reset" button (which reads as "revert to defaults/last-saved"): `reset()` sets name/accent/logo to `""` but does NOT persist — so the form now diverges from the still-stored "Acme" with no indication, and one subsequent Save wipes the entire brand. Independently, there is no dirty-state tracking or `beforeunload`/tab-switch guard: editing fields and navigating away in the SPA silently discards the edits, and Save is always enabled even when nothing changed.
- **Root cause**: "Reset" conflates "clear the form" with "revert to saved," and the component keeps no baseline of the loaded values to compare against or restore.
- **Impact**: Confusing, near-destructive control; accidental total brand loss; lost edits on navigation.
- **Fix sketch**: Keep the loaded config as a `baseline` ref; make Reset restore to `baseline` (not empty) and disable Save when `current === baseline`; warn on navigate-away when dirty. A separate explicit "Clear branding" affordance can cover the wipe intent.

## 5. A 3-digit hex accent breaks the translucent badge swatch in the live preview

- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: `app/features/sub_branding/BrandingTab.tsx:52,211-214`
- **Scenario**: `effectiveAccent`'s regex accepts 3-digit hex, so typing `#abc` yields `effectiveAccent = "#abc"`. The preview badge sets `background: \`${effectiveAccent}1a\`` to fake ~10% alpha → `"#abc1a"`, a 5-hex-digit string that is not a valid CSS color, so the browser drops it and the badge loses its tint (transparent/inherited background) while other swatches still render.
- **Root cause**: String-concatenating a two-char alpha suffix assumes the accent is always `#rrggbb`, but the accepted grammar also permits `#rgb`.
- **Impact**: Cosmetic inconsistency in the preview only (the stored accent itself is fine app-wide); misleads the operator about how the "soft badge" will look.
- **Fix sketch**: Normalize `effectiveAccent` to 6 digits before the concat, or use `color-mix(in srgb, var(--color-coral) 10%, transparent)` / an rgba() built from parsed channels so any valid hex length works.
