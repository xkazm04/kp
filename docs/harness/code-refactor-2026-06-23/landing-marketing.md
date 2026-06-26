> Total: 6 findings (0c critical, 1h high, 3m medium, 2l low)

## 1. `DISPLAY`/`HAND` Spark font tokens re-defined locally instead of imported
- **Severity**: High
- **Category**: duplication
- **File**: app/landing/spark/AboutCurve.tsx:20-21, app/landing/spark/aboutIllustrations.tsx:17-18
- **Scenario**: `tokens.ts` already exports `DISPLAY` and `HAND` (lines 6-7) as the single "sticker-sheet vocabulary" the file's own comment claims is shared. But `AboutCurve.tsx` and `aboutIllustrations.tsx` each re-declare identical `const DISPLAY = "font-[family-name:var(--font-spark-display)]"` / `const HAND = ...` locally rather than importing them. Confirmed with `grep -rn 'const DISPLAY =\|const HAND ='` → 3 definitions of the same two strings (1 in tokens.ts, 2 local copies); `SparkLanding.tsx` and `PricingSection.tsx` correctly import from `./tokens`.
- **Root cause**: The two `/about` files were authored as a parallel art-direction surface and copied the font-class strings inline rather than reusing the token module that already centralizes them.
- **Impact**: Four divergent string copies of the same Tailwind font-family classes. If the Spark font CSS-variable name changes (e.g. `--font-spark-display` → another name), two of the four call sites silently keep the old value and the /about page renders in the wrong typeface — a latent skew bug, not just style noise.
- **Fix sketch**: Delete the local `const DISPLAY`/`const HAND` in both files and `import { DISPLAY, HAND } from "./tokens"` (AboutCurve) / `from "./tokens"` (aboutIllustrations). Zero behavior change; collapses 4 definitions to 1.

## 2. Sign-in handler `DEV_GATE ? signInDev() : window.location.assign("/login")` duplicated 4×
- **Severity**: Medium
- **Category**: duplication
- **File**: app/landing/spark/SparkLanding.tsx:190,269,602; app/landing/spark/AboutCurve.tsx:91
- **Scenario**: The exact dev-gate-or-login branch appears 4 times. `grep -rn "DEV_GATE ? signInDev() : window.location.assign"` returns 3 inline `onClick` copies in SparkLanding plus 1 extracted `onSignIn` const in AboutCurve. AboutCurve already shows the right pattern (one named handler); SparkLanding repeats the ternary inline at hero CTA, nav button, and final CTA.
- **Root cause**: Copy-paste of the CTA button across hero/nav/footer-CTA sections without hoisting a shared handler.
- **Impact**: The sign-in routing rule (and its open-redirect / dev-gate semantics) lives in 4 places. A change to how unauthenticated sign-in dispatches (e.g. preserving a `?next=`) must be made 4× or it drifts. Low blast radius today but it is exactly the kind of auth-entry logic that should have one source.
- **Fix sketch**: Hoist one `const onSignIn = useCallback(() => (DEV_GATE ? signInDev() : window.location.assign("/login")), [])` in `SparkLanding` (mirroring AboutCurve line 91) and reuse it in all three buttons. Optionally promote a shared `landingSignIn()` helper next to `devAuth` so AboutCurve and SparkLanding share one function.

## 3. Topbar + footer wordmark/scaffolding duplicated between SparkLanding and AboutCurve
- **Severity**: Medium
- **Category**: duplication
- **File**: app/landing/spark/SparkLanding.tsx:164-196 & 615-626; app/landing/spark/AboutCurve.tsx:97-116 & 171-184
- **Scenario**: Both pages hand-roll the same header (KandidateMark + `Kandi<span className="text-[#d65a4a]">D</span>ate` wordmark + sign-in button) and the same footer (KandidateMark + `KandiDate · {tagline}` + LandingLangSwitch). `grep -rn 'Kandi<span'` confirms the identical wordmark markup in both files; the sign-in button class string (`rounded-lg border-[3px] border-[#17202a] bg-[#caa54c] px-4 py-2 shadow-[3px_3px_0_#17202a] ...`) is byte-for-byte identical across the two headers.
- **Root cause**: /about was built as a sibling page and copied the chrome rather than extracting a shared `<SparkHeader>` / `<SparkFooter>` / `<Wordmark>`.
- **Impact**: Brand chrome (logo, wordmark, footer language switch, sign-in styling) is maintained twice. A wordmark or footer change touches two files and can desync the two public surfaces. Medium because it is genuine avoidable copy (not the intentional art-direction parallel — these two files are the *same* art direction).
- **Fix sketch**: Extract `SparkHeader`, `SparkFooter`, and a `<Wordmark/>` (the `Kandi D ate` span) into a small shared module in `app/landing/spark/`. SparkLanding's nav has extra in-page anchors (#how/#features/#pricing/#about) so the header could take a `links?` prop; the footer/wordmark are fully shareable.

## 4. `PREVIEWS` registry is `export`ed but only consumed inside its own file
- **Severity**: Medium
- **Category**: dead-code
- **File**: app/landing/spark/FeaturePreviews.tsx:414
- **Scenario**: `export const PREVIEWS: Record<PreviewKey, PreviewDef>` is declared exported, but its only reader is `FeatureSpotlight` in the same file (line 434, `PREVIEWS[preview]`). `grep -rn "PREVIEWS"` across `app/` returns only the definition and the same-file usage; no external import. SparkLanding imports `FeatureSpotlight` and `type PreviewKey` from this module, never `PREVIEWS`.
- **Root cause**: Likely exported speculatively (or left over from when the registry was consumed externally) and never narrowed back to file-local.
- **Impact**: Misleading public surface — the `export` implies an extension point that nothing uses, and it blocks dead-code elimination tooling from flagging the internal-only registry. Minor, but it widens the module's apparent API for no caller.
- **Fix sketch**: Drop the `export` keyword (`const PREVIEWS = ...`). No import to update since nothing else references it.

## 5. `/landing` and `/landing/spark` routes are now redirect-only shells (descoped routes)
- **Severity**: Low
- **Category**: dead-code
- **File**: app/landing/page.tsx:1-8, app/landing/spark/page.tsx:1-9
- **Scenario**: Both route `page.tsx` files now only `redirect("/")` — the real landing is served at `/` via `app/page.tsx` → `HomeGate` → `SparkHome` (confirmed in app/page.tsx:3,27). The components live on as the "marketing component library" in the `spark/` folder; only the routes are vestigial. The comments document this intentionally, so these are kept-on-purpose redirects (bookmark safety), not bugs.
- **Root cause**: Landing was relocated to `/` (sign-in-gated home); the old standalone routes were left as redirect stubs.
- **Impact**: Effectively zero today (the redirects are a deliberate kindness for stale links). Flagged only so reviewers know two `page.tsx` files in scope carry no UI and the "two routes" mental model is stale. Could be removed once external links are confirmed dead, but the cost of keeping them is negligible.
- **Fix sketch**: No action recommended now. If/when stale-bookmark traffic is confirmed gone, delete `app/landing/page.tsx` and `app/landing/spark/page.tsx` (Next will then 404 those paths) — but keep the `spark/` component files, which are the live home/about library.

## 6. Stale context/scope: "Studio" art direction does not exist in the codebase
- **Severity**: Low
- **Category**: cleanup
- **File**: (scope/context description) — app/landing/** has no Studio file
- **Scenario**: The context names "Studio + Spark art directions" and the focus mentions "repeated marketing copy blocks/tokens between Studio and Spark." `grep -rni "studio" app/landing app/page.tsx app/about` and `find app -iname "*studio*"` both return nothing — only the Spark variant exists. The in-file comments also reference older variant names ("Variant A — Spark", "the Signal variant's product figures" in FeaturePreviews.tsx:25) that no longer have sibling implementations.
- **Root cause**: Earlier multi-variant A/B landing exploration was consolidated down to Spark; the surrounding docs/context and a couple of in-file comments still reference retired variant names (Studio, Signal).
- **Impact**: Documentation/comment drift only — no runtime effect. Misleads future readers into hunting for a non-existent Studio surface or expecting Studio↔Spark copy duplication that cannot exist. The "Spark vs Studio parallel" the quality bar warns about is moot.
- **Fix sketch**: Update the comment in FeaturePreviews.tsx:25 ("the Signal variant's product figures") and "Variant A — Spark" in SparkLanding.tsx:28 to drop the dead-variant references, and correct any context/doc that still implies a Studio landing exists.
