# Biz+UI Scan — Analysis Results & Reporting (2026-06-12)

> Total: 5 (1H/3M/1L)

## 1. Make Print produce a complete, readable report artifact
- **Lens**: ui_perfectionist
- **Severity**: High
- **Category**: functionality
- **File**: `app/_components/results/ReportActions.tsx:36`
- **Scenario**: The report's "Print" button (RES1's advertised print-to-PDF path) calls `window.print()` on the history detail page. What comes out today: the entire left workspace sidebar (brand, nav groups, Recents, ThemeToggle) prints alongside the report; the tab BUTTON bar prints; and only the currently active tab's content is in the document — a recruiter printing "the report" for a hiring manager hands over one of five/six tabs plus app chrome. In Spark Dark it's worse: text tokens resolve to near-white (`--color-ink: #f4efe3`) and browsers skip background fills by default, so the printout is light-on-white, effectively blank.
- **Root cause**: `print:hidden` was applied only to the action buttons themselves (`ReportActions.tsx:25`), the DispositionEditor (`DispositionEditor.tsx:61`) and ListBlock copy buttons (`shared.tsx:190`). The sidebar `<aside>` in `app/features/WorkspaceNav.tsx:31` has no print rule; the tablist in `app/_components/results/ResultPanel.tsx:139` has none; tab panels are conditionally rendered (`ResultPanel.tsx:164-179`), so inactive tabs simply don't exist in the DOM at print time; and `app/globals.css:102-165` defines the dark token remap with no `@media print` reset back to the light palette.
- **Impact**: The printed/PDF report is the single artifact KP hands across the recruiter-to-hiring-manager boundary (the whole point of RES1). Today that artifact silently understates the candidate (one tab only), looks unprofessional (nav chrome), and is unreadable for any dark-theme user — undermining the report's credibility exactly where it's meant to differentiate.
- **Fix sketch**: (a) Add `print:hidden` to the `<aside>` in `WorkspaceNav.tsx:31` and to the tablist wrapper in `ResultPanel.tsx:138`. (b) Swap the conditional tab-panel render for an always-mounted render with `hidden`/visible classes plus `print:block`, or simpler: render a print-only stacked container (`hidden print:block`) that mounts all tab components with localized section headings (tab components are pure render off `analysis`, so double-mounting is cheap). (c) In `globals.css`, add an `@media print` block re-declaring the light brand/neutral/status tokens with higher precedence than `[data-theme="dark"]` so a dark-theme print is always ink-on-paper.

## 2. Deep-link the active report tab so a shared link opens where the sender pointed
- **Lens**: business_visionary
- **Severity**: Medium
- **Category**: user_benefit
- **File**: `app/_components/results/ResultPanel.tsx:81`
- **Scenario**: A recruiter opens the salary tab, hits "Copy report link", and messages a hiring manager "look at the salary read". The link copies `window.location.href` (`ReportActions.tsx:19`) — which never carries the tab — so the recipient lands on Extraction (or Compare) and has to hunt. A refresh also resets the recruiter's own place.
- **Root cause**: `activeTab` lives only in `useState` (`ResultPanel.tsx:81`); grep confirms zero `useSearchParams`/hash usage anywhere under `app/_components/results/`. The stable `/history/<slug>` URL (the RES1 selling point) addresses the report, not the view within it.
- **Impact**: The share loop is the report's main collaboration feature in a single-tenant tool — every shared link that opens on the wrong tab adds friction and buries the evidence the sender was pointing at (salary case, interview kit, GitHub deep-dive).
- **Fix sketch**: Sync `activeTab` to the URL hash (`#tab=salary`): read `window.location.hash` in the initial `useState` initializer (ResultPanel is a client component, safe), and write via `history.replaceState` in the tab click handler — no server re-render, works on both the live Analyze tab and the server-rendered history page, and the existing `window.location.href` copy in ReportActions picks it up for free. Validate against the `ResultTab` union and fall back to the current default (the existing stale-tab render-phase guard at `ResultPanel.tsx:92` already handles invalid ids).

## 3. Make the saved report pipeline-aware instead of dead-ending the recruiter's decision
- **Lens**: business_visionary
- **Severity**: Medium
- **Category**: functionality
- **File**: `app/history/[slug]/page.tsx:117`
- **Scenario**: A recruiter reopens a saved report for a candidate they already pushed to the pipeline last week. The header still shows a fresh "Add to pipeline" button (state resets to `"idle"` on every mount, `AddToPipelineButton.tsx:33`); clicking it flips to "Added" even though `createPipelineEntry` deduped and returned `created: false` (`app/_lib/db.ts:2676-2697`) — a false "new add" confirmation with no hint of the candidate's actual stage. Meanwhile, recording "advance" or "pass" in the DispositionEditor changes nothing anywhere else: grep shows `disposition` is consumed only by history surfaces (`HistoryTab.tsx`, `history/[slug]/page.tsx`, `api/analyses/[slug]/route.ts`, `db.ts`) — pipeline, decisions, and analytics never read it. A candidate can sit "pass"-ed on the report yet active and schedulable on the board.
- **Root cause**: `page.tsx:117-129` builds `pipelineRef` purely from the analysis row; nothing queries `pipeline_entries` for an existing entry (`candidate_id = slug AND job_id = jd_slug`), even though `candidateOutcomes()` (`db.ts:2515`) already exposes exactly this lookup for rediscovery. The PATCH in `api/analyses/[slug]/route.ts:79-83` writes the disposition and stops.
- **Impact**: The disposition feature's promise is an auditable human decision record — but the record is a dead end, and the report contradicts the board. Contradictory states (passed-on-report, active-in-pipeline) erode trust in the tool's "source of truth" claim and can lead to scheduling a candidate someone already rejected.
- **Fix sketch**: On the server page, look up the existing entry (narrow query mirroring `candidateOutcomes()`); pass `existingStage`/`status` into `AddToPipelineButton` so it renders an "In pipeline · Screened" chip state (reuse `CHIP` from `app/_components/ui/recipes.ts`) instead of the add CTA, with a link to the board. When `DispositionEditor` saves "advance"/"pass" and an active entry exists, show an inline follow-up ("Candidate is in the pipeline at Screened — open board") so the human decision and the funnel state get reconciled by the human, not silently.

## 4. Route history scores through the score-tone design system
- **Lens**: ui_perfectionist
- **Severity**: Medium
- **Category**: ui
- **File**: `app/features/sub_history/HistoryTab.tsx:211`
- **Scenario**: The history table — the recruiter's densest ranked surface — renders scores as bare numbers (`{row.score ?? "—"}`), and the detail header interpolates the score into a plain meta string (`app/history/[slug]/page.tsx:92`). No tone color, so triaging 200 rows means reading every number; in Spark Dark the score also misses its signature stamp treatment.
- **Root cause**: ScoreBadge's own doc comment claims the 75/50 tone cutoffs keep "the matrix view, history list, and JD page" consistent (`app/_components/ScoreBadge.tsx:8`), and `globals.css:15-26` declares `--color-score-*` the single source of truth for ranked surfaces — but HistoryTab never imports it (grep: 13 ScoreBadge consumers, history absent). The surface predates the token system and was never migrated.
- **Impact**: The one place recruiters scan scores in bulk bypasses the design system's core data-visual identity; rank perception ("moss = strong") learned everywhere else doesn't transfer, and the HEAD design commit's stamp register skips the history list entirely.
- **Fix sketch**: In the score `<Td>`, replace the raw number with `<ScoreBadge score={row.score} />`, keeping the existing `review_flags` warn pill beside it; in the detail header, pull the score out of the meta sentence into a `ScoreBadge` next to the title (adjust the `histScore` message accordingly). Drop-in, both themes handled by the component.

## 5. Lead history rows with the candidate, not the slug
- **Lens**: ui_perfectionist
- **Severity**: Low
- **Category**: ui
- **File**: `app/features/sub_history/HistoryTab.tsx:199`
- **Scenario**: The first, most visually loud cell in every history row is the machine slug — coral, mono, underlined — and it is the ONLY navigation affordance. The candidate's name, the thing a recruiter actually scans for, sits unlinked in plain text in column two. Row hover styling (`hover:bg-paper/60`, plus the dark theme's coral row marker from `globals.css:214`) advertises whole-row clickability the row doesn't have.
- **Root cause**: Columns were laid out slug-first when slugs were the only identifier (`HistoryTab.tsx:186-207`); the Link wrapper was attached to the slug cell and never revisited as candidate labels, dispositions, and flags arrived.
- **Impact**: Recruiters visually parse a mono ID column before reaching the name on every scan; mis-aimed clicks on the name do nothing. Small but constant friction on a surface used many times a day, and an inverted hierarchy (machine ID louder than human identity) that contradicts the design system's typographic intent.
- **Fix sketch**: Make the candidate label the primary link to `/history/${row.slug}` (same `Link` pattern, `font-semibold text-ink hover:text-coral`), move it to column one, and demote the slug to a quiet secondary line under the name or a narrow mono `text-sm text-steel` cell. No server change; column translations already exist (`colCandidate`, `colSlug`).