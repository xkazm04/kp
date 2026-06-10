# Feature Scout — Workspace Shell & Shared UI (2026-06-10)

> Total: 6 (3H/2M/1L)

## 1. Add a global command palette / cross-entity search (Ctrl+K)
- **Value**: High
- **Category**: feature
- **Effort**: M
- **Where**: `app/features/Workspace.tsx:80` (shell mount point), `app/features/tabs.ts:132` (`buildUrl` deep-link builder) + `app/api/profile/route.ts`, `app/api/jobs/route.ts`, `app/api/jds/route.ts`, `app/api/analyses/route.ts`, `app/api/pipeline/route.ts`
- **Gap**: There is NO cross-entity search anywhere — grep confirms no `/api/search`, no palette, and the only search boxes are per-tab client filters over already-loaded lists (PipelineTab's filter bar, HistoryTab's filter bar, both from the 2026-06-08 scan's PIPE2/RES3). To find "that React candidate", a recruiter must guess which of 14 tabs holds them, open it, and filter there.
- **Proposal**: A shell-level palette mounted in `Workspace.tsx`, opened by Ctrl/Cmd+K (and a sidebar search affordance): one small `/api/search?q=` route doing SQLite `LIKE` queries across profiles, pipeline entries, jobs, saved JDs and analyses (all tables exist in `db.ts`), results grouped by entity type. Enter navigates via the existing deep links — `buildUrl({ tab: "profile", profile: id })`, `?tab=jobs&job=<id>`, `/history/<slug>`, `/jds/<slug>`. Include "jump to tab" actions derived from `NAV_GROUPS` so the palette doubles as a navigator. Reuse `Modal.tsx` (portal, focus trap, Escape, stack) as the chrome.
- **Why users need it**: Candidates, jobs, JDs and analyses each live behind a different tab; as data grows, "where is X?" is the single most repeated workflow and today it costs 3+ clicks plus a guess.

## 2. Surface "what needs my attention" in the sidebar — nav count badges + an attention endpoint
- **Value**: High
- **Category**: user_benefit
- **Effort**: M
- **Where**: `app/features/Workspace.tsx:103-133` (nav render), `app/features/WorkspaceNav.tsx:30-56` + `app/features/sub_decisions/DecisionsTab.tsx:61-65` (pending-approval derivation), `app/features/sub_pipeline/PipelineTab.tsx:236-240` (approvals/SLA-stale counts), `app/features/tasks/TasksIndicator.tsx:48-52` (the one existing badge)
- **Gap**: The shell's only persistent signal is the TasksIndicator running count. Pending human decisions (`approvalKind` set), scorecards to review, SLA-stale candidates, unpublished job drafts — each count is computed *inside* its own tab from `/api/pipeline`, so a recruiter sitting on Jobs has zero awareness that 6 decisions are queued. Worse, the automation heartbeat mutates entries server-side with no client signal (acknowledged in `PipelineTab.tsx:214-217`), so work accumulates invisibly.
- **Proposal**: A tiny `GET /api/attention` returning counts the server already knows how to compute: pending decisions (split `decision` vs AI-review kinds), SLA-stale entries, due schedule reminders (`dueReminders` in schedule-store), unpublished drafts. The shell fetches it on mount + `useLiveRefresh` + a 60s poll (mirroring PipelineTab's visibility-gated poll), and renders count pills on the matching nav items (Decisions, Pipeline, Schedule, Jobs) using the existing `Badge`/pill treatment. NAV item defs in `tabs.ts` gain an optional `badgeKey` so the mapping is declarative.
- **Why users need it**: This is an ATS — the product's job is "never let a candidate rot in a queue". Today the shell hides the queue depth behind clicks; badges turn the sidebar into the triage surface every recruiting tool trains users to expect.

## 3. Remember where I was — recents and resume-last-context in the shell
- **Value**: High
- **Category**: user_benefit
- **Effort**: S
- **Where**: `app/features/tabs.ts:153-172` (`TAB_SCOPED_PARAM_KEYS` + `clearedTabScopedParams` — the shell deliberately wipes selection on every tab switch), `app/features/sub_pipeline/PipelineTab.tsx:100-117` (localStorage persistence precedent `kp.pipelineViews`), `app/features/WorkspaceNav.tsx` (deep-link detail pages)
- **Gap**: Deep links exist for every entity (`?profile=`, `?job=`, `/history/<slug>`, `/jds/<slug>`) but nothing records them — grep for `recent|favorite|pinned` finds nothing client-side. A bare tab switch intentionally clears the selection, so a recruiter who hops Pipeline → Decisions → back to a candidate must re-find that candidate from scratch every time.
- **Proposal**: A small `useRecents` hook: when a tab-scoped param or detail page resolves to an entity, push `{type, id, label, href, at}` into a capped (~8) `localStorage` list (`kp.recents`, same SSR-safe mount-effect pattern as `kp.pipelineViews`). Render a "Recent" group at the top of the sidebar (both `Workspace.tsx` and `WorkspaceNav.tsx` so detail pages share it), each item a deep link. Optionally persist the last active tab and offer it as the landing view. If #1 ships, recents become the palette's empty-query state — the two compound.
- **Why users need it**: Recruiting work is interrupt-driven; "pick up where I left off" is currently impossible because the shell's own param-clearing contract erases context on every navigation.

## 4. Add global keyboard shortcuts for tab navigation + a "?" shortcut overlay
- **Value**: Medium
- **Category**: feature
- **Effort**: S
- **Where**: `app/features/Workspace.tsx:73-78` (`selectTab`), `app/features/tabs.ts:53-96` (`NAV_GROUPS` as the shortcut source), `app/_components/Modal.tsx:41-44` (`modalStack` — needs an exported `isAnyModalOpen()` guard)
- **Gap**: Grep confirms zero global keyboard shortcuts — the only document-level keydown handlers are Modal's Escape/Tab trap, the drawer, the diagram explorer and SimOfferFrame. Every tab change is a mouse trip to the sidebar; with 14 tabs this is the highest-frequency interaction in the app.
- **Proposal**: One shell-level keydown listener in `Workspace.tsx`: `g` then a mnemonic key (g p → Pipeline, g d → Decisions, …) derived from `NAV_GROUPS`, calling the existing `selectTab` (which already clears tab-scoped params correctly). `?` opens a shortcuts-reference `Modal`. Suppress when the event target is an input/textarea/contenteditable or any modal is open (export a tiny `isAnyModalOpen()` from Modal.tsx's existing stack). The i18n `nav` catalog already names every tab for the overlay.
- **Why users need it**: Recruiters doing screening waves bounce between Pipeline, Decisions and Schedule dozens of times an hour; shortcut nav plus the overlay is the standard power-user contract for a tool used all day.

## 5. Finish the bilingual shell: locale-aware metadata, latin-ext fonts, localized OG surface
- **Value**: Medium
- **Category**: functionality
- **Effort**: S
- **Where**: `app/layout.tsx:7-18` (both fonts load `subsets: ["latin"]` only), `app/layout.tsx:50-77` (static English `metadata` export, `openGraph.locale: "en_US"`), `app/opengraph-image.tsx:5` (English-only alt/title strings), `app/_lib/og-fonts.ts:53-68` (`pickFontUrl` deliberately prefers the latin-only subset)
- **Gap**: i18n just shipped (7922fbe) for the UI strings, but the shell's public surface didn't come along: there is no `generateMetadata` anywhere (grep), so `<title>`/description/OG stay English with `og:locale en_US` even when the document `lang` is `cs`; and the Inter/Fraunces subsets omit `latin-ext`, so Czech diacritics (ě š č ř ž ů — all over `messages/cs.json`, 94 KB) render in fallback fonts across the entire Czech UI.
- **Proposal**: Convert the static `metadata` export into `generateMetadata()` reading `getLocale()`/`getTranslations("meta")` with a new small `meta` catalog entry (title, description, OG strings) and locale-correct `og:locale`. Add `"latin-ext"` to both `next/font` subsets. For the OG image, either localize its strings through the same catalog or document it as intentionally English; if localized, teach `pickFontUrl` to also accept the latin-ext block for Czech glyphs.
- **Why users need it**: A Czech recruiter who switches to cs gets a visibly off-brand UI (wrong glyph rendering in the serif headings) and shares links that unfurl in English — the bilingual feature reads half-finished exactly where first impressions form.

## 6. Extend live-refresh across browser windows (BroadcastChannel bus)
- **Value**: Low
- **Category**: functionality
- **Effort**: S
- **Where**: `app/features/live-refresh.ts:12-14` (`notifyDataChanged` is a same-document `window` event), `app/features/sub_pipeline/PipelineTab.tsx:214-232` (the staleness poll added precisely because the bus can't reach other contexts)
- **Gap**: The live-refresh bus only spans one document. A recruiter working with two studio windows (board on one monitor, decisions on another — a natural pattern for a kanban tool), or acting on a preview of the public offer/schedule page in a second tab, leaves the other window silently stale; only PipelineTab self-rescues via its 30s poll, while Decisions/Channels/Schedule/Drafts just go stale.
- **Proposal**: In `live-refresh.ts`, mirror `notifyDataChanged()` onto a `BroadcastChannel("kp:data-changed")` and have the subscriber effect listen to both sources (channel feature-detected, ~15 lines). Zero call-site changes — all existing `notifyDataChanged`/`useLiveRefresh` callers inherit cross-window sync; the debounce already coalesces the double event in the originating window.
- **Why users need it**: Multi-window is how heavy ATS users actually work; today the second window lies until manually reloaded, undermining trust in the live board.

---
## Cross-checks performed
- Read `docs/harness/feature-scout-2026-06-08/INDEX.md` + `harness-learnings.md`: no overlap — that scan's 10 contexts covered the candidate→hire journey, never the shell. Its search theme (PIPE2/RES3, shipped) is per-tab filtering of loaded lists, not cross-entity search; JOB5/PIPE5 saved views are per-surface. The retired Med/Low backlog (VOX2 etc.) untouched.
- Grepped `docs/harness/ui-bug-scan-2026-06-08/` for `palette|shortcut|search|attention|locale|metadata|recents`: no collisions (that campaign's shell context was defect/polish-focused; all 83 closed).
- `grep "/api/search|CommandPalette|cmdk"` → nothing; listed ALL 71 API routes (`app/api/**/route.ts`) — no search/aggregation endpoint exists; entity lists confirmed at `/api/profile`, `/api/jobs`, `/api/jds`, `/api/analyses`, `/api/pipeline`.
- `grep addEventListener("keydown")` app-wide → only Modal Escape/Tab trap, CandidateDrawer, PipelineExplorer, SimOfferFrame. No global shortcuts.
- `grep localStorage` → only `kp.pipelineViews` + `kp.pipelineStageSla` (PipelineTab); `grep -i recent|favorite|pinned` → no client recents/favorites anywhere.
- `grep useLiveRefresh|notifyDataChanged` → consumers: ChannelsTab, DecisionsTab, PipelineTab, DraftsPanel; producers: SimulationProvider only. Confirmed same-document-only (`window.dispatchEvent`).
- `grep generateMetadata` → zero matches; read `layout.tsx` (static metadata, `subsets: ["latin"]`), `opengraph-image.tsx`, `apple-icon.tsx`, `og-fonts.ts` (latin-subset preference), `i18n/*` + `messages/cs.json` (94 KB Czech catalog exists). `git log` confirms i18n (7922fbe) landed AFTER both prior scans.
- Read DecisionsTab:30-99 + PipelineTab:205-240 to confirm attention counts are derived client-side per-tab from `/api/pipeline` (no shared endpoint), and the 30s poll exists only on Pipeline.
- Read every context file: Workspace.tsx, WorkspaceNav.tsx, live-refresh.ts, tabs.ts, layout.tsx, page.tsx, opengraph-image.tsx, apple-icon.tsx, og-fonts.ts, useJsonFetch.ts, useReducedMotion.ts, Badge.tsx, Modal.tsx, Markdown.tsx, SegmentedControl.tsx, icons/index.ts (+ TasksIndicator.tsx, LanguageSwitcher.tsx as shell residents).
