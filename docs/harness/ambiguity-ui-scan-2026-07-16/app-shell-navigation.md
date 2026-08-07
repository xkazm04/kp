# App Shell & Navigation — ambiguity-guardian + ui-perfectionist scan

> Total: 5 findings (0 critical, 1 high, 3 medium, 1 low)

## 1. Sidebar attention badges ignore the current workspace
- **Severity**: High
- **Lens**: ambiguity
- **Category**: multi-tenant-scoping
- **File**: `app/_lib/attention.ts:36`
- **Scenario**: A recruiter signed into a non-default workspace looks at the sidebar. Pipeline/Decisions/Schedule/Jobs/Channels badges show queue depths that belong to the *default* workspace, not theirs — and clicking a badge slice opens their own board, which shows a different set.
- **Root cause**: `attentionCounts()` calls `listPipeline()`, `listJobStatuses()`, `dueReminders()` with no arguments, so every source defaults to `DEFAULT_WORKSPACE_ID`. Its own header comment says the `/api/attention` route and `WorkspaceNav` "call it directly", yet neither passes a tenant — while the sibling search route (`app/api/search/route.ts:23`) correctly threads `await currentWorkspace()` into `searchEntities`. The primitives already accept a `workspaceId` param; only the caller drops it.
- **Impact**: Cross-tenant wrong counts. In any multi-workspace deployment the badges silently report a different tenant's backlog — a hint that actively misleads and can drive wrong prioritization.
- **Fix sketch**: Make `attentionCounts(workspaceId)` take the tenant and forward it to `listPipeline(id)` / `listJobStatuses(id)` (and scope `dueReminders` if the store supports it). Have the route pass `await currentWorkspace()` and `WorkspaceNav` pass its already-resolved workspace, mirroring the search route.

## 2. Language switcher renders locale codes, not the native names it documents (and the catalog ships)
- **Severity**: Medium
- **Lens**: ui
- **Category**: i18n-affordance
- **File**: `app/_components/LanguageSwitcher.tsx:45`
- **Scenario**: A German or Czech speaker opens the language toggle to find their language. The buttons read "EN / CS / DE / FR" (bare uppercase codes), not "English / Čeština / Deutsch / Français".
- **Root cause**: The button label is `{locale}` (the raw code). The component's own header comment promises each button is "labelled in its OWN language ('English' / 'Čeština')" so "a reader who can't read the current UI language can still find their own", and the `language` namespace in `en.json` already defines `language.en/cs/de/fr` with exactly those native names — but the component never calls `t(locale)`, leaving those four keys dead.
- **Impact**: The stated accessibility affordance is defeated; a user who cannot read the active UI language must recognize an ISO code instead of their language name. Comment, catalog, and rendered UI disagree.
- **Fix sketch**: Render `t(locale)` (native name) as the visible label, keep the code as a compact secondary or `aria`/title hint if desired. This uses the already-present, already-parity-checked catalog keys.

## 3. Badge pill is invisible on its own active tab (coral-on-coral)
- **Severity**: Medium
- **Lens**: ui
- **Category**: visual-hierarchy
- **File**: `app/features/nav/SectionRailNav.tsx:176`
- **Scenario**: On first load the default Pipeline tab is active and has an aging badge. The badge pill fill vanishes into the row: only the coral digit floats with no pill behind it.
- **Root cause**: The active nav row is `bg-coral/10 text-coral` (`navItemClass`, `tabs.ts:175`) and the badge pill / slice button are also `bg-coral/10 text-coral` (`SectionRailNav.tsx:176`, `:205`, `:215`). Identical background = zero contrast between pill and row whenever a badged tab is the active one — which the default (Pipeline, badged) is at rest.
- **Impact**: The queue-depth signal loses its shape exactly on the tab the user is most likely sitting on, weakening the at-a-glance count.
- **Fix sketch**: Give the pill a distinct fill on active rows — e.g. `bg-coral text-white` (or `bg-coral/20`) when `isActive`, keeping `bg-coral/10` for inactive rows so the pill always reads as a discrete element.

## 4. Pipeline aging badge slice can disagree with the count it advertises
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: undocumented-mismatch
- **File**: `app/_lib/attention.ts:39`
- **Scenario**: The Pipeline badge shows "3 aging" and, because it declares `badgeParams: { quick: "aging" }` (`tabs.ts:103`), is a click target that opens the board filtered to `?quick=aging`. The recruiter clicks expecting those 3 — and sees 0 or 7.
- **Root cause**: The server count uses `STAGE_SLA_DEFAULTS` (`attention.ts` via `slaForStage`), but the board's aging filter honors the recruiter's per-board localStorage overrides (`PIPELINE_SLA_KEY = "kp.pipelineStageSla"`, `sub_pipeline/PipelineTab.tsx:249`). The comment documents the *number* as an approximation, but turning the badge into a navigable slice quietly promises the destination matches the count — which it need not.
- **Impact**: A click-through whose result contradicts the badge that triggered it erodes trust in every badge.
- **Fix sketch**: Either drop the slice click target when server/client SLA can diverge, or persist the SLA overrides server-side (or pass them through) so the badge count and the `?quick=aging` cohort are computed from one source.

## 5. OpenGraph locale map is stale versus the four-locale universe
- **Severity**: Low
- **Lens**: ambiguity
- **Category**: constant-drift
- **File**: `app/layout.tsx:44`
- **Scenario**: A page shared under the `de` or `fr` locale carries `og:locale = en_US`, even though the title/description are localized and full `de.json` / `fr.json` catalogs ship.
- **Root cause**: `OG_LOCALE: Record<string, string> = { en: "en_US", cs: "cs_CZ" }` with a comment "Keep in sync with the LOCALES universe", but `LOCALES` (`i18n/locales.ts`) is `["en","cs","de","fr"]`. The `?? "en_US"` fallback masks the two missing entries, so the drift is silent.
- **Impact**: Incorrect social/OG locale metadata for half the supported languages; minor SEO/share-preview correctness gap.
- **Fix sketch**: Add `de: "de_DE"` and `fr: "fr_FR"` (and assert the map covers every `LOCALES` entry, or derive it from a single locale→BCP47 table) so it can't drift as locales are added.
