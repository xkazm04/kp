# Shared UI & Design System — bug-hunter + ui-perfectionist scan

> Context: Reusable behavioral primitives and the dual-theme (Studio Light / Spark Dark) design system: Modal + useDialogA11y focus-trap hook, the form-control family (TextInput/TextArea/Select/Checkbox/Radio/FileInput), RichTextEditor + markdown-html, Toast, Badge, RouteError/RouteLoading, score visuals.
> Files reviewed: 20 of 56
> Total: 5

## 1. `Select` swallows Escape via preventDefault only — one Escape closes the dropdown AND its parent dialog

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: event-ordering
- **File**: `app/_components/Select.tsx:164-212` (`onKeyDown`, esp. the `Escape` arm at :193-196) vs `app/_components/useDialogA11y.ts:93-99`
- **Scenario**: Open the candidate drawer (`app/features/sub_pipeline/CandidateDrawer.tsx:143` calls `useDialogA11y(dialogRef, onClose, { trap:true, lockScroll:true })`), then open the disposition `<Select>` at `CandidateDrawer.tsx:749`. Its option menu is showing. Press Escape once to dismiss just the dropdown — the dropdown closes AND the whole drawer closes with it, discarding any unsaved drawer edits.
- **Root cause**: The Select's `Escape`/`Enter` handlers call `e.preventDefault()` but never `e.stopPropagation()`. `useDialogA11y` registers its Escape handler on `document` (so Escape works with focus anywhere in the dialog). React's synthetic `onKeyDown` fires at the root container during bubble; because the Select never stops propagation, the native keydown keeps bubbling to `document`, where the dialog's `onKey` (gated only on "am I top of the stack?" — the Select isn't on that stack) also runs and calls `onClose`. Two handlers, one keypress.
- **Impact**: Every `Select` rendered inside a `Modal` or a `useDialogA11y` drawer (CandidateDrawer today; any future Select-in-dialog) loses the expected "first Escape closes the popup, second Escape closes the dialog" layering — a single Escape nukes the dialog and any in-progress input.
- **Fix sketch**: In the Select's `onKeyDown`, call `e.stopPropagation()` on `Escape` and on `Enter`-commit while `open` (and on the menu's own search-box handler). Make the class impossible by having any popup built on this pattern stop propagation whenever it consumed the key, so a document-level dialog listener never double-handles it.

## 2. Form-control family diverges in prop API and hover affordance across siblings

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: component-architecture
- **File**: `app/_components/TextInput.tsx:16-30`, `app/_components/TextArea.tsx:11-27`, `app/_components/Select.tsx:34-72`, `app/_components/FileInput.tsx:27-34`, `app/_components/Checkbox.tsx:12`, `app/_components/Radio.tsx:11`
- **Scenario**: A developer composes a form row with a `<TextInput>` beside a `<Select>`. To set the compact height they write `sizeVariant="sm"` on the input but must write `size="sm"` on the Select — the same concept, two prop names. At rest, hovering the row warms the Select's and FileInput's border (`hover:border-coral/40`) while the adjacent TextInput/TextArea border stays inert, so sibling controls animate differently under the same cursor.
- **Root cause**: The primitives were extracted independently without a shared field contract. `sizeVariant` (TextInput/TextArea) vs `size` (Select) name the same axis; `invalid` exists on TextInput/TextArea/Select but not Checkbox/Radio/FileInput; the coral hover-border was added to Select/FileInput but never back-ported to the text fields.
- **Impact**: Inconsistent authoring API (easy to pass the wrong prop and get no size change) and visible affordance drift within one form — the exact place token consistency matters most. It also blocks a uniform `invalid` styling pass over a whole form.
- **Fix sketch**: Standardize on one size prop name (`sizeVariant`) and add an `invalid` prop uniformly; either add `hover:border-coral/40` to TextInput/TextArea or drop it from Select/FileInput so the whole family agrees. Codify the shared field props in a `FieldBaseProps` type all six spread.

## 3. `htmlToMarkdown` never escapes markdown metacharacters — literal `*`/`` ` ``/`<u>` in JD text corrupt the public render

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: state-corruption
- **File**: `app/_components/markdown-html.ts:149-179` (`serializeInline`, text branch `out += n.value`) → rendered by `app/_components/Markdown.tsx:16-33`
- **Scenario**: A recruiter types plain text into the RichTextEditor JD body — e.g. `use *args and **kwargs`, `C:\path\*.log`, or a footnote `salary * negotiable`. On blur, `htmlToMarkdown` emits the text verbatim (no escaping). When the public JD page renders that stored markdown via `Markdown.tsx`, the inline regex pairs the stray asterisks: `use *args and *` becomes italicized, the second run mangles, and typed backticks/`<u>` become code/underline the author never intended.
- **Root cause**: The WYSIWYG↔markdown round-trip escapes on the *display* side (`markdownToHtml`/`Markdown.tsx` HTML-escape correctly, so this is not an XSS hole) but the *serialize* side treats a contentEditable text node as already-safe markdown. A character that is literal in the editor is structural in markdown, and nothing re-escapes it.
- **Impact**: Silent content corruption on a candidate-facing page — the posting shows unintended italics/code/underline, and the round-trip is lossy (re-opening the editor re-parses the emphasis), so authored text quietly changes meaning.
- **Fix sketch**: In `serializeInline`'s text branch, escape markdown-active characters (`\`, `*`, `` ` ``, leading `#`/`-`/digits+`.`, and `<u>`-looking runs) before appending. Cover it in `markdown-html.test.ts` with a "literal asterisks survive round-trip" case so the class can't regress.

## 4. `RichTextEditor` has no disabled/read-only state and an optional accessible name

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: missing-ui-state
- **File**: `app/_components/RichTextEditor.tsx:37-51` (props), `:181-195` (the `contentEditable` surface)
- **Scenario**: A JD form is mid-save or shown read-only. Its `<TextInput>`/`<TextArea>`/`<Select>` siblings all accept `disabled` and visibly lock (cursor-not-allowed, opacity, no focus ring). The `RichTextEditor` accepts no `disabled` prop at all, so it stays fully editable and its toolbar stays live during submit. Separately, `ariaLabel` is optional; a caller that omits it renders a `role="textbox"` with no accessible name.
- **Root cause**: The editor was built for the always-editable JD body case, so the disabled/read-only branch of the form-control contract (present on every sibling) was never added, and the label was left to the caller rather than required or falling back to a wrapping `<label>`.
- **Impact**: Inconsistent form behavior — the one rich control can't be locked, allowing edits (and execCommand toolbar actions) while a mutation is in flight; and an unlabeled textbox is an a11y gap for screen-reader users on any call site that forgot `ariaLabel`.
- **Fix sketch**: Add a `disabled`/`readOnly` prop that sets `contentEditable={false}`, dims the surface (`opacity-60 cursor-not-allowed`), and disables the toolbar buttons; make `ariaLabel` required (or fall back to an associated `<label>`) so the textbox always has a name.

## 5. [STILL-OPEN] Markdown renderer still drops `[text](url)` links on public JD pages

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: missing-ui-state
- **File**: `app/_components/Markdown.tsx:16` (inline `re`) and `app/_components/markdown-html.ts:37` (same subset)
- **Scenario**: A JD authored in the builder (or an LLM-generated posting) contains `[Apply here](https://careers.example.com)`. The inline regex only handles `**bold**`, `*italic*`, `` `code` ``, and `<u>`; the link syntax falls through and the public `/jds/[slug]` page shows the raw `[Apply here](https://…)` text, not a clickable link. (Flagged in the 2026-06-20 report #3; verified still unfixed in current code — no link arm exists.) Still matters because it degrades a candidate-facing conversion surface.
- **Root cause**: The dependency-free renderer intentionally supports a subset and links were never added, even though links are core to the JD-posting use case it exists for.
- **Impact**: Recruiter/AI-authored postings render broken link syntax to candidates; the link isn't clickable, hurting application conversion on the public page.
- **Fix sketch**: Add a `[text](url)` arm to the inline `re` in both files, emitting a real `<a rel="noopener noreferrer" target="_blank">` (React element, preserving the "never dangerouslySetInnerHTML" guarantee) and validating the scheme to http/https/mailto. Autolink bare `https://` runs optionally.
