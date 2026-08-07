# Branding & White-label — ambiguity-guardian + ui-perfectionist scan

> Total: 5 findings (0 critical, 0 high, 4 medium, 1 low)

## 1. CSS-injection safety is enforced on write but never re-checked on the read path that injects into `<style>`
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: trust-boundary
- **File**: `app/_components/BrandStyle.tsx:12-18`
- **Scenario**: BrandStyle interpolates `accent` straight into `dangerouslySetInnerHTML`. Its SAFETY comment asserts this is safe because "the color is strictly hex-validated at the store boundary". But the value it receives comes from `getBrand()` (`app/_lib/brand-store.ts:36-42`), which returns `accent_color` verbatim from the DB with no re-validation. The single guarantee the injection relies on is enforced only in `saveBrand`, not where the value is actually used.
- **Root cause**: The invariant ("accent is always a strict hex") lives on the write path (`sanitizeBrand`), while the security-critical consumer trusts the read path. Any row not written through `saveBrand` — a manual DB edit, a pre-validation row, or a new writer added during the explicitly-anticipated E0 multi-tenancy migration (`brand-store.ts:5-8`) — becomes a stored-XSS `<style>` injection vector.
- **Impact**: Latent CSS/stored-XSS injection app-wide (including candidate-facing pages) if any accent ever reaches the DB without passing `sanitizeAccentColor`. Today's paths are safe, so this is defense-in-depth, but the comment overstates the guarantee.
- **Fix sketch**: Re-run `sanitizeAccentColor(brand.accentColor)` at the injection site in BrandStyle (or inside `getBrand`) so the value is validated where it is trusted, not only where it is written. Then the SAFETY comment's claim becomes structurally true.

## 2. Accent legibility is validated only against the light-theme canvas; a dark accent passes but is invisible in dark mode
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: undocumented-assumption
- **File**: `app/_lib/brand-config.ts:44-56, 91-98`
- **Scenario**: `accentIsLegible` checks the accent against white text (`ON_ACCENT_TEXT`) and against exactly one background: `PAPER_BG = "#fdf8ee"`, the light-theme paper. The comment claims light is "the demanding case… far lighter than the dark theme's paper, so a pale accent contrasts least here." That reasoning holds for *pale* accents only. A *dark* accent (e.g. `#241a12`) clears white-text contrast and clears light-paper contrast, so it is deemed legible — yet BrandStyle also overrides `--color-coral` under `[data-theme="dark"]`, where the accent draws the focus ring / active-nav bar / row-hover stripe against dark paper `#141b24` (confirmed in `globals.css:127-129, 236`). Against that background a dark accent's indicators are effectively invisible.
- **Root cause**: The single-background model bakes in an unstated assumption that only pale accents are the risk; the symmetric dark-accent-in-dark-theme case is never checked.
- **Impact**: A dark-mode operator can save a dark brand accent that passes the guard yet renders focus rings and active-nav indicators unreadable in dark theme (WCAG 2.4.7 / 1.4.11 regression) — the exact failure the helper exists to prevent.
- **Fix sketch**: Also require the accent to clear `MIN_ACCENT_CONTRAST` against the dark-theme paper (`#141b24`) as a graphical indicator, i.e. add a second `contrastRatio(hex, DARK_PAPER_BG)` check in `accentIsLegible`, and update the comment's "demanding case" reasoning to cover both extremes.

## 3. An invalid hex silently makes the color swatch show product coral instead of signaling the input is unparseable
- **Severity**: Medium
- **Lens**: ui
- **Category**: misleading-state
- **File**: `app/features/sub_branding/BrandingTab.tsx:74,79-80,180,259`
- **Scenario**: `effectiveAccent = normalizeHex6(accent.trim()) ?? CORAL` drives both the `<input type="color">` swatch and the preview tiles. When the operator types a malformed value (`#zz`, `d65a`, a stray paste), `normalizeHex6` returns null and everything falls back to CORAL — so the swatch and preview button confidently render the product's default coral while the text field holds an unparseable string. The only inline warning (`accentIllegible`, line 79-80) fires for *valid-but-illegible* hex, so invalid input produces zero feedback; on save the server silently coerces it to null.
- **Root cause**: The "never blank" fallback (`?? CORAL`) is applied without first distinguishing "empty (use default)" from "non-empty but invalid", so an invalid state is painted identically to the default state.
- **Impact**: The operator believes they set coral (the swatch says so), saves, and the accent is silently discarded — a confusing round-trip with no error until they notice the color never changed.
- **Fix sketch**: When `accent.trim()` is non-empty and `normalizeHex6` returns null, show an inline "not a valid hex color" hint and visually distinguish the swatch (e.g. a muted/placeholder treatment) rather than rendering CORAL as if valid. Keep the empty-field case rendering the default.

## 4. An illegible accent blocks saving the entire form, including unrelated name/logo edits
- **Severity**: Medium
- **Lens**: ui
- **Category**: coupled-validation
- **File**: `app/features/sub_branding/BrandingTab.tsx:98-102`
- **Scenario**: The Save button is enabled whenever the form is dirty (line 224). If the operator edits the display name or logo while an illegible (valid-but-low-contrast) accent sits in the accent field, clicking Save hits the early `return` at line 99-102 and nothing persists — the valid name/logo changes are thrown away along with the rejected accent. The button looked actionable and produced only an error toast.
- **Root cause**: A single field's contrast failure gates the whole PUT, rather than gating just the accent field while letting the other two save.
- **Impact**: Operators can be stuck unable to save legitimate name/logo changes until they also fix or clear an accent they may not have been trying to change — friction with no clear cause-and-effect.
- **Fix sketch**: Either disable Save (with the contrast hint as the reason) so it doesn't read as actionable, or let the save proceed and drop only the illegible accent to null server-side (which `sanitizeBrand` already does), surfacing "accent not applied — low contrast" as a non-blocking notice instead of aborting the whole request.

## 5. The strict hex regex is duplicated inline in the editor instead of reusing a shared predicate
- **Severity**: Low
- **Lens**: ambiguity
- **Category**: duplicated-constant
- **File**: `app/features/sub_branding/BrandingTab.tsx:80`
- **Scenario**: `accentIllegible` re-inlines `/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/`, a byte-for-byte copy of `HEX_COLOR` in `brand-config.ts:25`. The canonical regex is not exported, so the editor keeps its own copy.
- **Root cause**: `brand-config.ts` centralizes every other validation rule but does not expose the hex predicate, forcing the one client that needs "is this a syntactically valid hex" to reimplement it.
- **Impact**: If the accepted color format ever changes (e.g. adding 8-digit `#rrggbbaa`), the store and the editor's warning logic silently diverge — the store would accept a value the editor still flags, or vice versa.
- **Fix sketch**: Export a small `isHexColor(value: string): boolean` (or the `HEX_COLOR` regex) from `brand-config.ts` and have BrandingTab call it, so both the store boundary and the editor's live warning share one definition.
