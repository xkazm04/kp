# Biz+UI Scan — Workspace Shell & Shared UI (2026-06-12)

> Total: 5 (0H/4M/1L)

(Prior-scan delta: all six feature-scout 06-10 findings shipped — CommandPalette/`/api/search` (SHELL1), attention badges (SHELL2), recents (SHELL3), g-chords + "?" overlay (SHELL4), locale metadata + latin-ext fonts (SHELL5, commit 2b2afe9). This scan audits those implementations plus the dual-theme system (529f7a0). Sibling 06-12 reports already claim the candidate-facing Spark Dark leak (conversational-apply #X / scheduling-offers #3, both anchored on `layout.tsx:117`) and the scrim-token gap incl. Modal backdrop migration (demo-simulation-channels #4) — not re-flagged here.)

## 1. Restore the command surface on detail pages — Ctrl+K, chords and language die on /history and /jds
- **Lens**: ui_perfectionist
- **Severity**: Medium
- **Category**: ui
- **File**: `app/features/WorkspaceNav.tsx:31-87`
- **Scenario**: A recruiter hits Ctrl+K, picks an analysis or a saved JD — the palette's own `analysis`/`jd` hit types route to `/history/<slug>` and `/jds/<slug>` (`CommandPalette.tsx:44-46`). On arrival, Ctrl+K is dead, `g`-chords and the `?` overlay are dead, and the LanguageSwitcher is gone (the interactive shell mounts it at `Workspace.tsx:165`; `WorkspaceNav.tsx:84-86` mounts only ThemeToggle). The flagship navigation feature strands users at exactly the destinations it sends them to; a Czech recruiter can't switch language on the report she's reading.
- **Root cause**: `CommandPalette`, `KeyboardShortcuts` and `LanguageSwitcher` are mounted only inside the client `Workspace` (`Workspace.tsx:113,120,165`). `WorkspaceNav` (the server-rendered sidebar for `WorkspaceShell` pages) adopted the client-island pattern for RecentsNav and ThemeToggle but not for the other three — even though `CommandPalette` is fully self-contained (`useSearchParams`/`router.push` with absolute hrefs, works under any route).
- **Impact**: The shell contract ("one Ctrl/Cmd+K surface… anywhere", per the palette trigger and `?` overlay copy) is false on the two most-visited deep-link pages — every report read and JD review breaks the muscle memory the shell just trained, forcing a mouse trip back through the brand link.
- **Fix sketch**: Mount `<CommandPalette />` in `WorkspaceNav` under the brand block (same client-island move as `RecentsNav`, line 44). Add a small `KeyboardShortcutsStandalone` island wrapping the existing component with `onSelectTab={(id) => router.push(tabHref(id))}` (`tabHref` already exists in `tabs.ts:112`). Mount `<LanguageSwitcher />` beside the ThemeToggle at line 84, mirroring `Workspace.tsx:164-167`.

## 2. Localize the shared chrome's screen-reader strings — Modal still says "Close" in a bilingual app
- **Lens**: ui_perfectionist
- **Severity**: Medium
- **Category**: ui
- **File**: `app/_components/Modal.tsx:151,170`
- **Scenario**: The i18n campaign (waves 1–4, b6ee6b9 et al.) localized visible copy, but the shared components' accessibility layer was skipped: every dialog in the app exposes two English `aria-label="Close"` controls (backdrop + X) to Czech screen-reader users — including the candidate-facing schedule/offer/apply dialogs. Same leak in `PlantUml.tsx:448,497,501` ("Expand diagram to full screen", "Zoom out/in"), `ScanAnimation.tsx:14` ("Scanning CV"), and `VoiceInterview.tsx:724` ("Live interview transcript" — read to candidates mid-interview). (`AnalysisProgress.tsx:105` is already claimed by the cv-analysis-workspace 06-12 report.)
- **Root cause**: `Modal` takes no translator and hardcodes the literals; grep `aria-label="[A-Z]` over `app/_components` + `app/features/*.tsx` confirms the set above. The `common.close` key already exists in the catalogs (3 occurrences in `messages/en.json`).
- **Impact**: For assistive-tech users the "bilingual shell" is half-English in its most repeated interaction (closing a dialog), and a candidate-facing surface leaks recruiter-locale-independent English — undercutting the just-shipped i18n story exactly where WCAG users meet it.
- **Fix sketch**: `useTranslations("common")` inside `Modal` for both close buttons (it is already a client component); same one-liner in PlantUml/ScanAnimation/VoiceInterview with keys added to the `common`/feature catalogs. No API change — callers untouched.

## 3. Give the shell a real mobile mode — the sidebar is a full-screen wall before any content
- **Lens**: ui_perfectionist
- **Severity**: Medium
- **Category**: ui
- **File**: `app/features/Workspace.tsx:97-169`
- **Scenario**: On a phone (<768px, the `md:` breakpoint) the `<aside>` renders as a static full-width block stacked above `<main>`: brand (98-108) + palette trigger (112-114) + up to 8 recents (117) + 14 nav items in 5 groups (122-163) + language/theme toggles + TasksIndicator — roughly two viewport-heights of chrome before the first pixel of pipeline. Tapping a nav item swaps the tab via `router.replace(..., { scroll: false })` (line 82), so the user is left staring at the same nav and must scroll past the whole wall again to see the tab they just opened. `WorkspaceNav.tsx:31` has the identical structure on detail pages.
- **Root cause**: The responsive treatment is limited to `md:` layout switches (`md:w-64 md:sticky`); there is no collapse/disclosure state for small screens anywhere in the shell (no `hidden`, no hamburger, no `<details>` — grep confirms).
- **Impact**: "Check the board / approve a decision from the phone between interviews" is a natural recruiter moment this single-tenant tool should own; today every mobile visit costs two screens of scrolling per navigation, and the attention badges — the triage signal — sit above the fold while the work sits below it.
- **Fix sketch**: Below `md`, collapse the aside to a compact sticky header: brand mark + current tab name + attention-badge sum + a disclosure button toggling the nav block (`useState`, `aria-expanded`, close-on-select inside `selectTab`); keep the palette trigger in the header since Ctrl+K doesn't exist on touch. Reuse the existing `navItemClass`/badge markup unchanged inside the disclosure; same pattern mirrored in `WorkspaceNav` with a client-island wrapper.

## 4. Fix ScoreDial's unfilled track in Spark Dark — a literal hex makes empty look full
- **Lens**: ui_perfectionist
- **Severity**: Medium
- **Category**: ui
- **File**: `app/_components/ScoreDial.tsx:118`
- **Scenario**: Open any analysis report in Spark Dark. The dial's filled band segments resolve through the score scale (`bandColor` → `var(--color-score-*)`, lines 47-51) and re-tone correctly — but the unfilled segments are stroked with the literal `#e7e5e4` (light stone-200). On the dark card the "empty" arc renders as the brightest element in the dial: a 45-score candidate's dial reads at a glance like a full, glowing arc, inverting the visual the count-up number sits inside.
- **Root cause**: Line 118: `stroke={isFilled ? bandColor(i) : "#e7e5e4"}` — an SVG attribute bypassing the token seam, violating DESIGN.md's rule #1 ("No literal color values outside `app/landing/`"; `--color-stone-200` is remapped to `#364453` in dark, `globals.css:120`). The neighboring `FactorChart.tsx:28-30` shows the correct pattern for chrome that can't use classes (theme-forked constants via `useTheme`), and the dial's own dark-register comment (line ~128) shows it was otherwise dark-audited.
- **Impact**: The report's hero visual — the first thing a recruiter triages by — misleads in the register the design system just shipped; one wrong glance on a ranked stack is a mis-prioritized candidate.
- **Fix sketch**: `stroke={isFilled ? bandColor(i) : "var(--color-stone-200)"}` — SVG strokes accept CSS variables, so the one-token swap inherits both themes with zero behavioral fork. While in file, sweep the sibling literal if any other stroke/fill hexes exist in `app/_components` SVGs (grep shows ScoreDial is the only remapped-palette offender; `CompareIcon`/`PlantUml` are content, not theme surfaces).
- 
## 5. Finish the theme system: a "System" option and cross-window sync
- **Lens**: ui_perfectionist
- **Severity**: Low
- **Category**: ui
- **File**: `app/_lib/theme.ts:31-44`
- **Scenario**: The toggle is binary (`ThemeToggle.tsx:20-23`). Once a recruiter taps either option, `kp-theme` is written and the pre-paint bootstrap prefers it forever (`layout.tsx:117` — stored beats `prefers-color-scheme`); there is no way back to "follow my OS" (auto dark at night, light by day) short of clearing localStorage. Separately, `setTheme` notifies only same-document listeners (`theme.ts:38-43`) and nothing listens to the `storage` event — with two studio windows open (board on one monitor, decisions on the other; the multi-window pattern the 06-10 scan documented), flipping the theme in one leaves the other in the old register until reload.
- **Root cause**: The store models `Theme = "light" | "dark"` with no `system` sentinel, and `subscribeTheme` wires no `window.addEventListener("storage", …)` bridge, so the localStorage write never propagates across documents.
- **Impact**: Mild but persistent trust dents in the design system's front door: a one-way preference door, and visibly desynced windows showing two brands of the same app side by side.
- **Fix sketch**: Add a third "System" segment (Monitor icon) to `ThemeToggle` that removes `kp-theme` and applies `matchMedia("(prefers-color-scheme: dark)")` (plus a `change` listener while unset — THEME_INIT already implements the same precedence for first paint). In `subscribeTheme`, also bind `storage` events filtered on `THEME_STORAGE_KEY` and re-apply the attribute, so every window converges; `useTheme` consumers update for free via `useSyncExternalStore`.
