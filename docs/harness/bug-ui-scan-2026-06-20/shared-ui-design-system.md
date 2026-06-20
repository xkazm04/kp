# Shared UI & Design System — UI Perfectionist scan

> Context: Reusable behavioral primitives and the dual-theme (Studio Light / Spark Dark) design system: Modal, Badge, SegmentedControl, recipes, theme tokens, icons and score visuals.
> Files reviewed: 31 of 44
> Total: 7 findings — Critical: 0, High: 3, Medium: 3, Low: 1

## 1. No shared Select / Input primitive — 32 raw `<select>` re-rolled across 21 files
- **Severity**: High
- **Category**: component-extraction
- **File**: `app/_components/ui/recipes.ts:119` (the `FIELD` recipe — and its absence at scale)
- **Scenario**: A developer adds any new form control (a provider picker, a stage filter, a JD-template dropdown). There is no `Select`/`Input` component and the `FIELD` recipe string is used in only 3 files, so they hand-roll a native `<select>` with bespoke classes. The codebase already has 32 raw `<select>` occurrences across 21 files (KeysPanel, JdBuilder, DecisionsTab, MatchTab, …).
- **Root cause**: The design system extracted behavioral primitives (Modal, SegmentedControl, Badge) and class recipes for buttons/chips/panels, but stopped short of the two most-used native controls — selects and text inputs. `FIELD` is a bare class string with no focus, hover, disabled, or invalid treatment, so even adopting it leaves each call site to add those states ad hoc.
- **Impact**: Visual drift (custom chevrons, inconsistent heights/padding, mismatched dark-mode borders), and inconsistent a11y — a raw `<select>` only inherits the global `:focus-visible` ring, while disabled/invalid styling is per-site or missing. The one place token consistency matters most (every form) is the least consolidated.
- **Fix sketch**: Ship `<Select>` and `<Input>` primitives in `app/_components/` composing `FIELD`, with built-in `disabled:opacity-50`, `aria-invalid` border tone, and a consistent chevron. Extend `FIELD` to carry focus/disabled/invalid variants. Migrate opportunistically per the recipes' stated migration policy.

## 2. No shared CopyButton — clipboard + "Copied" feedback re-implemented per surface
- **Severity**: High
- **Category**: component-extraction
- **File**: `app/_components/results/shared.tsx` (and `results/ReportActions.tsx`, `results/interview/SoftSignalsSection.tsx`; `navigator.clipboard.writeText` appears across ~78 files)
- **Scenario**: Anywhere a token link, JD markdown, transcript, or report needs a copy affordance, the developer re-writes `navigator.clipboard.writeText(...)`, a `copied` boolean, a 2s reset timer, and an `aria-live` announce — or omits the success feedback and the success-confirmation/error path entirely.
- **Root cause**: Clipboard copy is a behavioral pattern (state + timeout + a11y announce + failure fallback) but lives only inside `_components/results/`, not as a shared primitive in `_components/`. Each consumer re-derives it, so the icon, "Copied!" label, reset timing, and screen-reader announcement drift, and clipboard-write rejection is often unhandled.
- **Impact**: Inconsistent feedback (some surfaces flash "Copied", some don't), and missing `aria-live` confirmation means SR users can't tell a copy succeeded. A rejected `writeText` (insecure context / permissions) silently no-ops on the surfaces that don't catch it.
- **Fix sketch**: Add `app/_components/CopyButton.tsx` owning the write, the timed "Copied" swap, an `aria-live="polite"` status, and a try/catch fallback. Replace the three results-local copies and adopt it at the scattered call sites.

## 3. Markdown renderer drops links — JD postings can't render `[text](url)`
- **Severity**: Medium
- **Category**: feature-gap
- **File**: `app/_components/Markdown.tsx:16` (inline regex) and `:35` (block loop)
- **Scenario**: A job description authored in the JD builder (or an LLM-generated posting) contains a Markdown link — `[Apply here](https://…)` or a careers-page URL. The renderer's inline regex only matches `**bold**`, `*italic*`, and `` `code` ``; the link syntax falls through and renders as literal `[Apply here](https://…)` text on the public JD page.
- **Root cause**: The dependency-free renderer intentionally supports a subset, but links are a core need for the JD-posting use case it was built for, and were omitted. Autolinking bare URLs is also absent.
- **Impact**: Recruiter-authored or AI-generated postings show raw bracket/paren syntax to candidates on a public page — looks broken and the link isn't clickable, hurting application conversion.
- **Fix sketch**: Add a `[text](url)` arm to the inline `re`, emitting `<a href rel="noopener noreferrer" target="_blank" class="text-coral underline">`; validate the URL scheme (http/https/mailto only) to keep the "builds elements, never `dangerouslySetInnerHTML`" safety guarantee. Optionally autolink bare `https://` runs.

## 4. `Badge` caution + muted tones risk failing WCAG contrast
- **Severity**: Medium
- **Category**: a11y
- **File**: `app/_components/Badge.tsx:26` (`TONE_CLASS`) and `:58` (`muted` path)
- **Scenario**: A "Low confidence" / "Template fallback" / "Wide band" caution badge renders `bg-amber-100 text-amber-700` at `text-sm` (14px) weight 600; a "muted" zero-count badge renders `text-stone-400` on `bg-stone-100`. The muted stone-400-on-stone-100 pairing in particular is low-contrast small text.
- **Root cause**: Tone classes were chosen for hue harmony with the cream canvas, not verified against the 4.5:1 (small-text) WCAG AA threshold. The `muted` path deliberately recedes the text, which is exactly where contrast slips below AA.
- **Impact**: Caution and muted badges — which carry *degraded/needs-attention* meaning (the prep fallback, low confidence) — are the hardest to read for low-vision users, inverting the intent: the states that most need to be noticed are the least legible.
- **Fix sketch**: Verify each `TONE_CLASS` pair and the muted pair against AA at 14px/600; darken the caution foreground (e.g. `text-amber-800`) and lift the muted foreground (e.g. `text-stone-500`/`steel`) until ≥4.5:1 in BOTH themes. The token seam means one edit re-tones every badge.

## 5. `brand.ts` PAPER drifts from the live `--color-paper` token despite the "lockstep" contract
- **Severity**: Medium
- **Category**: token-drift
- **File**: `app/_lib/brand.ts:20` (`PAPER = "#f7f5ef"`) vs `app/globals.css:9` (`--color-paper: #fdf8ee`)
- **Scenario**: The OG social card (`opengraph-image.tsx`) and `apple-icon.tsx` render their background and card fills from `PAPER`. Because brand.ts is a stylesheet-less mirror of the `@theme` tokens, its `PAPER` is supposed to equal the live canvas color — but it's `#f7f5ef` while the app canvas is `#fdf8ee` (the only one of the 8 brand literals that diverged; INK/MOSS/CORAL/STEEL/LIMEWASH/DIAL_* all match).
- **Root cause**: `--color-paper` was retuned to the warmer "Option C" cream in globals.css, but the JS mirror in brand.ts was not updated, even though its own doc comment promises "keep these literals in lockstep with the @theme block."
- **Impact**: The share-preview card and Apple touch icon render on a subtly different cream than the actual app, so the brand's first impression (link unfurl, home-screen icon) is off-palette versus every in-app surface. Silent because nothing asserts the two halves agree.
- **Fix sketch**: Set `PAPER = "#fdf8ee"` to match the token. Add a tiny test (sibling to `og-fonts.test.ts`) asserting each brand literal equals the corresponding `--color-*` value parsed from globals.css, so future retunes can't drift again.

## 6. `LoadStatus` re-implements relative-time instead of the canonical `formatRelativeTime`
- **Severity**: Low
- **Category**: component-extraction
- **File**: `app/_components/LoadStatus.tsx:7` (local `ago()`) vs `app/_lib/format.ts:289` (`formatRelativeTime`)
- **Scenario**: The stale-data pill/banner renders "stale · 3m ago" via a private `ago(ms)` helper that buckets a raw epoch, while every other surface (audit log, outbox, tasks, history) renders ages through `formatRelativeTime(iso)` in format.ts — the documented single relative-time renderer with the UTC/naive-timestamp contract and future-skew guard.
- **Root cause**: `LoadStatus` predates or sidesteps the format.ts consolidation; it takes an epoch `number` (`lastUpdated`) rather than the ISO contract, so it couldn't reuse the shared helper without a signature change, and a parallel copy was written instead.
- **Impact**: Two relative-time renderers means bucketing/wording can drift (this one says "just now" for `<0`, the canonical one clamps and warns), and the stale indicator escapes the timestamp-contract guarantees. Pure consistency debt, no user-facing break today.
- **Fix sketch**: Have `useLoader` carry `lastUpdated` as an ISO string (or expose a converter) and delete `LoadStatus`'s `ago()` in favor of `formatRelativeTime`; the existing `Math.max(0, …)`/future-skew handling in format.ts already covers the edge cases.

## 7. Multiple hand-rolled `role="dialog"` surfaces bypass the shared `Modal` (focus trap, scroll lock, Escape-stack)
- **Severity**: High
- **Category**: a11y
- **File**: `app/_components/Modal.tsx` (the primitive) vs 5 non-Modal dialogs: `app/features/sub_pipeline/CandidateDrawer.tsx`, `app/features/sub_matrix/MatrixTab.tsx`, `app/features/simulation/SimExplainDrawer.tsx`, `app/diagrams/PipelineExplorer.tsx`, `app/landing/spark/FeaturePreviews.tsx`
- **Scenario**: Opening the candidate drawer, the matrix detail dialog, or the sim explain drawer renders a `role="dialog"` that did NOT go through the shared `Modal`. The shared Modal carefully implements focus trapping, focus restoration to the trigger, the ref-counted body-scroll lock, the document-level Escape handler, the modal-stack gating, and per-instance `aria-labelledby`. Each hand-rolled dialog re-implements (or omits) some subset.
- **Root cause**: `Modal` is centered-dialog-shaped; surfaces that want a side drawer, an inline panel, or a full-bleed explorer couldn't use it as-is, so they rolled their own dialog semantics rather than the design system offering a drawer/panel variant.
- **Impact**: Inconsistent and frequently incomplete a11y on real dialogs — focus can escape behind an open drawer, Escape may not close it, background scroll may not lock, and `isAnyModalOpen()` (which the global keyboard shortcuts consult) doesn't know these are open, so a bare keypress can switch tabs underneath them. This is the highest-leverage gap: the primitive solved dialog a11y once, but the hardest cases opted out.
- **Fix sketch**: Extract the focus-trap + scroll-lock + Escape-stack core (already isolated in Modal) into a `useDialog()` hook or a `Dialog`/`Drawer` shell, and refactor the 5 surfaces onto it so they all register in the shared `modalStack` and inherit the trap. At minimum, route CandidateDrawer and SimExplainDrawer (the most-used) through it first.
