# Workspace Shell & Shared UI — UI+Bug combined scan
> Total: 4 findings (0 crit / 1 high / 2 med / 1 low)
> Group: Platform & Shared Infrastructure | Lens mix: 2 bug / 2 ui | Files read: 22

## 1. Modal entrance (`animate-fade-in`) ignores prefers-reduced-motion
- **Severity**: Medium
- **Lens**: 🎨 UI / a11y
- **Category**: Accessibility — reduced motion gap in a shared primitive
- **File**: `app/globals.css:174` (keyframe) consumed by `app/_components/Modal.tsx:151`
- **Scenario**: A user with the OS "reduce motion" preference set opens ANY modal (reused app-wide). The dialog still animates `opacity 0→1` + `translateY(4px)→0` on every open.
- **Root cause**: globals.css adds `@media (prefers-reduced-motion: reduce)` overrides for `animate-tab-in`, `.stagger-children`, `animate-drawer-in`, the voice loops, and `score-band-fill` (lines 218, 255, 295, 313) — but NOT for `animate-fade-in` (174-187) or `animate-slide-in` (225-238). Modal hardcodes `animate-fade-in` on the dialog container, so the JS-side `useReducedMotion` gate (used correctly in SegmentedControl) is bypassed for this CSS animation. The translateY transform is exactly the kind of motion the preference is meant to suppress.
- **Impact**: Every dialog in the app violates the reduced-motion contract the rest of globals.css honors — multiplied across all Modal consumers (InterviewPrep, transcript, compare, etc.). Inconsistent: tab swaps respect the preference, dialogs do not.
- **Fix sketch**: Add `animate-fade-in` (and `animate-slide-in`) to a `@media (prefers-reduced-motion: reduce) { … { animation: none } }` block, mirroring the existing `animate-tab-in` override. One-line additions; no JS change needed.

## 2. Modal focus trap only snapshots focusables at mount — async/lazy content can't be Tab-reached
- **Severity**: Medium
- **Lens**: 🐛 Bug / a11y
- **Category**: Edge case / focus management
- **File**: `app/_components/Modal.tsx:80-90`
- **Scenario**: A modal whose body renders nothing focusable on first paint (a `useJsonFetch` spinner, a lazy `dynamic()` chunk, or an empty list that later fills) mounts. `focusables()` is recomputed live on each Tab keypress (good), so trapping itself recovers — but initial focus `(focusables()[0] ?? node)?.focus()` runs synchronously at mount, before async content exists, so focus lands on the container (`tabIndex={-1}`). That part is fine. The real gap: there is NO MutationObserver/refocus, and the `focusables()` querySelector at line 82 excludes elements made focusable via `contentEditable` or with `tabindex="0"` set *after* mount only matters at Tab time — acceptable. The genuine issue is `[disabled]` filtering uses `hasAttribute("disabled")` (line 84) which misses `aria-disabled="true"` buttons (common in this codebase's submit buttons), so a visually-disabled button can become the trap's `first`/`last` boundary and receive focus on Tab wrap.
- **Root cause**: `querySelectorAll('button, [href], input, …')` + `.filter(el => !el.hasAttribute("disabled"))` treats only the native `disabled` attribute as non-focusable; `aria-disabled` controls (still in the tab order, still focusable, but semantically inert) are included.
- **Impact**: Tab can land focus on an inert (aria-disabled) control and, when it is the last focusable, the wrap target — a confusing but non-crashing a11y degradation in any modal with aria-disabled actions.
- **Fix sketch**: Extend the filter to also exclude `el.getAttribute("aria-disabled") === "true"` and elements with zero layout box (`offsetParent === null`) so hidden-but-present focusables don't become trap boundaries.

## 3. `useJsonFetch` treats a 204 / empty-body response as a load error
- **Severity**: High
- **Lens**: 🐛 Bug
- **Category**: Silent failure on a common path
- **File**: `app/_lib/useJsonFetch.ts:22-30`
- **Scenario**: A tab fetches an endpoint that returns `204 No Content` or any `2xx` with an empty body (a valid REST pattern for "nothing yet"). `r.json()` throws on empty body → caught into `null` (line 24). Then line 26: `!r.ok` is false (it's 2xx), and the `body && …` guard is false (body is null), so it falls through to `setData(body as T)` → `setData(null)`. Because the hook's loading state is exactly `data === null && error === null`, the consumer is now PINNED in the loading skeleton forever (data never becomes non-null, no error to show a retry).
- **Root cause**: A successful-but-empty response is indistinguishable from "still loading" in this hook's state model — `null` doubles as both "not yet fetched" and "fetched nothing". There's no `loaded` flag.
- **Impact**: Any tab whose API legitimately 204s (or returns empty JSON `null`) shows a perpetual skeleton with no error and no retry — a broken common path for the shared fetch hook used across 5+ tabs (Analytics, Compare, RediscoverPanel, InterviewPrep, transcript).
- **Fix sketch**: Track an explicit `loaded` boolean set true in both the success and error branches; derive `loading = !loaded`. Or, on a 2xx with null body, `setData((body ?? {}) as T)` / `setData([] as T)` per the contract — but the `loaded` flag is the robust fix and removes the null-overloading.

## 4. `Markdown` inline parser drops bold/italic that contains other markers, and never linkifies — but renders raw `<` safely
- **Severity**: Low
- **Lens**: 🎨 UI (with a verified security non-issue)
- **Category**: Rendering fidelity / design consistency
- **File**: `app/_components/Markdown.tsx:12,15-16`
- **Scenario**: Job-posting content with `**bold with `code` inside**`, `**multi *word* emphasis**`, or a bare URL renders incorrectly: the split regex `/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g` uses `[^*]+`, so any asterisk *inside* a bold/italic span breaks the match and the literal `**`/`*` shows through. Bare URLs and `[text](url)` links are not parsed at all — they render as plain text (the renderer supports no link syntax), which for a job-postings renderer is a real content-fidelity gap.
- **Root cause**: Deliberately minimal single-pass tokenizer; `[^*]+` cannot express nesting and there is no link rule. NOTE — the XSS surface flagged in the brief is NOT exploitable: the renderer builds React elements only (no `dangerouslySetInnerHTML`), so `<script>`/HTML in untrusted content is escaped as text. The PlantUml fence (line 49) delegates to `PlantUml`; untrusted `puml` is its concern, not Markdown's. This finding is fidelity, not security.
- **Impact**: Cosmetic — stray `*`/`**` glyphs and non-clickable URLs in rendered JD/markdown content. No security or crash risk.
- **Fix sketch**: If link support is wanted, add a `[text](url)` rule that emits an `<a>` with `rel="noopener noreferrer"` and a scheme allowlist (http/https/mailto) to keep the no-injection guarantee. For nested emphasis, recurse `inline()` on the captured inner text instead of slicing a raw string. Both optional given the "minimal subset" contract — hence Low.
