# Landing & Marketing — bug-hunter + ui-perfectionist scan

> Context: The public marketing landing pages (Studio + Spark art directions), the login entry page, and the new `/market` "Market Pulse" data-visualization surface.
> Files reviewed: 8 of 21
> Total: 5

## 1. Choropleth map is color-only: keyboard/SR users get the region name but never its value

- **Severity**: High
- **Lens**: ui-perfectionist
- **Category**: a11y
- **File**: `app/landing/spark/market/CzMap.tsx:39-82`, `app/landing/spark/market/parts.tsx:109-141`
- **Scenario**: A keyboard or screen-reader visitor tabs across the 14 region paths on `/market`. Each `<motion.path>` is `role="button"` `tabIndex={0}` with `aria-label={g.name}` — so AT announces only "Praha, button". The actual metric (vacancies / median salary) is encoded purely by the heat-ramp fill and is rendered *only* in the separate `RegionDetail` card, which is a plain `<div>` with no `aria-live`. `onFocus` updates the card's text, but because it is not a live region the change is never announced. The map centerpiece therefore conveys zero data to non-sighted users.
- **Root cause**: Data value lives in fill color + a visually-adjacent card, decoupled from the focused element's accessible name; the card was built to avoid layout reflow, not to announce.
- **Impact**: The page's flagship data viz is unreadable by keyboard/SR users — a reachable a11y failure on a public, indexable surface.
- **Fix sketch**: Fold the value into each path's label, e.g. `aria-label={`${g.name}: ${fmtInt(r.vacancies)} vacancies, median ${fmtCzk(r.medianSalary)}`}`, AND add `role="status" aria-live="polite"` to `RegionDetail`. Make "value belongs in the accessible name" the rule for every colored mark.

## 2. On mobile the `/market` topbar — including the only Sign In CTA — is hidden with no menu

- **Severity**: High
- **Lens**: ui-perfectionist
- **Category**: responsiveness
- **File**: `app/landing/spark/market/MarketPulseApp.tsx:36-51`
- **Scenario**: The entire `<nav>` (Home, About, language switch, and the primary "Sign In" button) is `className="hidden … sm:flex"`. Below the `sm` breakpoint the whole bar collapses to just the logo, and there is no hamburger/menu fallback anywhere in the component. The hero and Atlas body contain no Sign In button either, so on a phone `/market` has literally no sign-in affordance and no navigation (only a `← Home` link buried in the footer).
- **Root cause**: The nav was authored desktop-first with a single `sm:flex` reveal and no mobile-menu branch; unlike `SparkHome`, this standalone shell was never given one.
- **Impact**: Majority-mobile marketing traffic lands on the page with no CTA and no way to reach sign-in or the other pages — the conversion path is dead on the most common device class.
- **Fix sketch**: Add a mobile menu button (disclosure) that reveals the same links + Sign In below `sm`, or at minimum keep the Sign In button always visible. Extract a shared `<LandingTopbar>` so `/`, `/about`, `/market` share one responsive nav.

## 3. Every JD card's sector label renders coral — wrong argument passed to `familyColor()`

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: state-corruption / visual-consistency
- **File**: `app/landing/spark/market/parts.tsx:292` (call), `:31-34` (`familyColor`)
- **Scenario**: `JdCard` colors its sector label with `familyColor(item.orgType)`. But `familyColor` looks its argument up in `FAMILY_ORDER` (the 16 role-family keys) via `indexOf`, while `item.orgType` is only ever `"private" | "public" | "agency"`. `indexOf` returns `-1`, `Math.max(0, -1)` clamps to `0`, so **every** card returns `FAMILY_COLORS[0]` = `CORAL`, regardless of sector. Confirmed against the data: JD items carry `private`/`public`, so a public-sector card shows a coral label — which in the `OrgSplit` panel (`:240`) specifically means *private*.
- **Root cause**: A family-color helper reused for org-type coloring; the type mismatch is silently swallowed by the `Math.max(0, …)` clamp instead of failing.
- **Impact**: The sector cue is always the same color and actively misleads (coral = private elsewhere). Silent, since nothing errors.
- **Fix sketch**: Use the existing `{ private: CORAL, public: STEEL, agency: AMBER }` record from `OrgSplit` for org types. Make `familyColor` accept `FamilyKey` (not `string`) so this class of mismatch is a type error.

## 4. Map landmark label is hardcoded English, and region paths are role="button" with no key handler

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: a11y / i18n
- **File**: `app/landing/spark/market/CzMap.tsx:44` (label), `:60-68` (paths)
- **Scenario**: The SVG's `aria-label="Map of Czech regions"` is a literal English string on a page whose every other string resolves through the `jobMarket` i18n namespace (which is present in en/cs/de/fr). A Czech/German/French screen-reader user hears the one structural label in English. Separately, each path is `role="button"` but has only `onFocus`/`onClick` and no `onKeyDown` — Enter/Space do nothing distinct; activation happens to work only because focus doubles as activation.
- **Root cause**: The label was written inline instead of via `useTranslations`; the ARIA `button` role was applied without the keyboard contract (Enter/Space) that role implies.
- **Impact**: A localized product ships an un-localized landmark on its flagship marketing viz; the role/behavior mismatch is a latent a11y correctness gap.
- **Fix sketch**: `aria-label={t("map.ariaLabel")}` (add the key to all 4 locales). Either drop `role="button"` (it is really a selectable list — consider `role="listbox"`/`option`) or add an `onKeyDown` that handles Enter/Space.

## 5. Map legend is color-only and `aria-hidden`; mid-tones aren't readable and dead-end CTAs persist

- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: a11y / polish
- **File**: `app/landing/spark/market/parts.tsx:84-104` (`MapLegend`)
- **Scenario**: `MapLegend` shows only the min/max endpoints plus an `aria-hidden` gradient bar — there are no intermediate ticks or discrete buckets, so neither a sighted nor an AT user can map a region's mid-tone fill back to an approximate value from the legend alone (they must hover each region). AT users get nothing (the swatch is `aria-hidden` and has no text scale). Noting once, per scope: the landing's primary CTAs remain dead-ends in dev (known, tracked).
- **Root cause**: A continuous ramp was chosen for aesthetics without a quantized legend or text scale.
- **Impact**: The choropleth's scale is only loosely decodable; minor on a marketing page, but it undercuts the "read the country at a glance" promise.
- **Fix sketch**: Add 3-4 labeled tick values under the gradient (quantile breaks) with visible text, so the scale reads without hovering and is available to AT.
