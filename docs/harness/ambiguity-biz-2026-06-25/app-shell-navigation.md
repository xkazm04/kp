# App Shell & Navigation — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀3 / 🚀2 | Severity: C0/H1/M4/L0

## 1. The autonomy control room is a dark capability — unreachable from the shell and unbadged
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: dark capability / discoverability / compliance
- **File**: app/control/page.tsx:170
- **Observation**: `/control` is the human-oversight surface for the autonomous hiring pipeline — kill switch, the pending human approval gates ("Awaiting your decision · N", page.tsx:211), and the immutable audit trail the page itself calls "the record-keeping a high-risk AI hiring system requires" (page.tsx:166-168). A repo-wide grep finds **zero inbound links** to `/control`: it is not in `NAV_GROUPS` (tabs.ts:98-153), so it is absent from the command palette (which derives actions from `NAV_GROUPS`, CommandPalette.tsx:174) and from the keyboard chords (KeyboardShortcuts.tsx:28). Its only link is *outbound* (page.tsx:170 → `/?tab=dev`). The room is reachable only by manually typing the URL. Separately, the shell's `decisions` badge counts pipeline approval gates (`needsHumanDecision`, attention.ts:38) — a different system from the control room's `pendingGates`, so the gates here light no shell signal at all.
- **Why it matters**: A compliance kill switch and human-decision gates that no one can find from the workspace are, operationally, switched off. A recruiter sitting on Pipeline has no way to know automation is mid-run or that gates await — exactly the "feature built but never reachable / badge wired but never lit" pattern kp is known for, on the highest-stakes surface in the product.
- **Recommendation**: Add a nav entry (e.g. under Settings) or a persistent shell affordance for `/control`, derive a command-palette action + chord from it, and add an attention bucket that counts `pendingGates` (and reflects `autonomy === "paused"`) so the oversight queue surfaces globally.
- **Effort**: M

## 2. Command-palette action plumbing is built but carries exactly one command
- **Lens**: 🚀 Business
- **Severity**: Medium
- **Category**: power-user value left on the table
- **File**: app/features/CommandPalette.tsx:28
- **Observation**: `PaletteItem` already supports non-navigation commands via a generic `action?: () => void` field (CommandPalette.tsx:28), and `go()` runs it on pick (line 218). But the *only* command wired in is the guided tour (lines 182-191). Everything else the palette offers is navigation (recents + jump-to-tab + search hits). There is no "New analysis", "Add candidate", "Pause automation", "Switch language", or "Open keyboard shortcuts" verb.
- **Why it matters**: The palette is positioned as the power-user differentiator (SHELL1, "one Ctrl/Cmd+K surface"), yet a daily-driver recruiter still mouses to a tab for every *action*. The infrastructure to make it a true command surface is already shipped and proven by the tour command — so the incremental cost of high-value verbs is low and the retention upside (keyboard-only operation) is high.
- **Recommendation**: Add 3-5 high-frequency action items (start analysis, add candidate, pause/resume automation, open shortcuts, toggle language) as `action`/`href` palette entries, grouped under the existing `actions` group. Pause/resume also closes finding #1's gap.
- **Effort**: M

## 3. i18n has-fallback contract silently ships English into Czech; the parity gate can't catch a key missing from the default catalog
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: i18n / silent gap / CI blind spot
- **File**: app/features/tabs.ts:150
- **Observation**: The Settings group declares `{ id: "workspace", label: "Workspace" }` (tabs.ts:150), but `nav.tabs.workspace` is **absent from both `messages/en.json` and `messages/cs.json`** (verified: en `nav.tabs` has 17 keys, no `workspace`; cs the same). `navLabel` (tabs.ts:58-61) falls back to the baked-in English `label` when `t.has(key)` is false, so the tab renders "Workspace" in *both* locales — untranslated in Czech, with no error. The CI gate `i18n-check.mjs` only asserts cross-locale *parity* (every en key exists in cs, lines 146-164); it never asserts that every `NAV_GROUPS` tab id has a catalog entry, so a key missing from the *default* catalog is invisible to it. The has-fallback design (intended as graceful degradation) doubles as a trap: any future tab works "fine" while quietly being English-only in cs.
- **Why it matters**: Czech users get an English label with zero warning surface, and the team's safety net (i18n-check + the next-intl Messages augmentation) gives false confidence. This is undocumented tribal knowledge — "the fallback hides untranslated tabs" — that should be enforced, not assumed.
- **Recommendation**: Add `nav.tabs.workspace` (+ cs translation). Extend i18n-check (or a unit test) to assert every `NAV_GROUPS.flatMap(g=>g.items)` id has a `nav.tabs.<id>` key in the *default* catalog, turning the silent fallback into a build failure.
- **Effort**: S

## 4. A failed attention fetch is indistinguishable from "all clear" — badges read 0
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: happy-path-only / silent failure
- **File**: app/features/useAttention.ts:24
- **Observation**: `useAttention` swallows fetch failures to "keep the previous counts" (useAttention.ts:24-28), but on the **first** load there are no previous counts — `counts` stays `null`. The renderer then computes `const badge = item.badgeKey && attention ? attention[item.badgeKey] : 0` (Workspace.tsx:199, mirrored in WorkspaceNav.tsx:56), so a null state collapses every badge to **0**. A down or slow `/api/attention` therefore tells the recruiter "nothing needs your attention" — identical to a genuinely empty queue. The documented trade-off ("a badge is a hint, never worth an error surface", useAttention.ts:9-13) acknowledges *not erroring* but never acknowledges that the failure mode reads as a positive "all clear" signal.
- **Why it matters**: Attention badges exist precisely so a recruiter on another tab doesn't miss queued decisions/aging entries. A false zero defeats the entire SHELL2 feature on exactly the day the API is flaky — the worst possible silent failure for an attention system.
- **Recommendation**: Distinguish "unknown" from "zero": render a muted/skeleton dot (not a 0/blank) until the first successful load, and optionally suppress badges entirely on a never-loaded error rather than showing implied zeros.
- **Effort**: S

## 5. Attention badges stay stale up to 60s after returning to a backgrounded tab
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: magic number / unhandled edge case
- **File**: app/features/useAttention.ts:33
- **Observation**: The poll runs every `POLL_MS` (60_000) but is visibility-gated — `setInterval(() => { if (!document.hidden) load(); }, POLL_MS)` (useAttention.ts:33-36). There is **no `visibilitychange` listener** to refetch on regain. So when a recruiter backgrounds the studio (lunch, a meeting) and returns, the badges show pre-lunch counts until the next interval boundary fires — up to a full 60s of stale "what needs my attention," and the server-side automation heartbeat the poll exists to catch (per the comment, useAttention.ts:9-12) is exactly what mutated counts while the tab was hidden. The gate correctly avoids polling a hidden tab but never schedules the catch-up read the gate's own rationale implies.
- **Why it matters**: Returning to the tab is the single moment a recruiter most expects fresh counts, and it's the one moment the current design guarantees staleness. The 60s constant's documented reasoning covers the *idle-but-visible* case, not the *return-from-hidden* case — an unrecorded edge in an otherwise well-reasoned comment.
- **Recommendation**: Add a `visibilitychange` listener that calls `load()` when `document.hidden` flips to false (and clears/realigns the interval). Cheap, removes the stale window, and matches the existing live-refresh philosophy.
- **Effort**: S
