# Job Postings & Lifecycle — UI Perfectionist scan

> Context: Create, ingest, publish and close job postings and track their lifecycle (Jobs tab table, posting modal, ad ingestion, draft splitting).
> Files reviewed: 11 of 21
> Total: 7 findings — Critical: 0, High: 3, Medium: 3, Low: 1

## 1. Closing or reopening a role in the modal leaves the catalog row badge stale

- **Severity**: High
- **Category**: stale-state / missing-refetch
- **File**: `app/features/sub_jobs/JobPostingModal.tsx:45` (closeRole) and `:78` (publishRole); `app/features/sub_jobs/JobsTab.tsx:237` (`<JobRow … onOpen … />`)
- **Scenario**: A recruiter opens a published role, clicks Close (or opens a draft and Sources/Publishes it), then closes the modal. The Jobs table behind it still shows the old status badge — a closed role still reads as live, a published draft still wears the grey DRAFT pill.
- **Root cause**: `JobPostingModal` mutates only its own local `closed`/`published` state. `JobsTab` passes no `onChanged`/`reload` callback to the modal (unlike `IngestAdPanel`, which gets `onIngested`/`onBulkComplete` and calls `reload()`), and `JobRow` renders `job.status` from the cached corpus. Nothing invalidates the list after a lifecycle transition.
- **Impact**: The catalog misrepresents which roles are open. The `openOnly` filter and the "statTotal/entryEligible" chips also reflect pre-change data, so a just-closed role keeps appearing in an "open only" view until a full manual reload.
- **Fix sketch**: Thread an `onChanged?: () => void` prop into `JobPostingModal`, fire it in the `closeRole`/`publishRole` success branches, and wire it to `useJobsList().reload` in `JobsTab` (the plumbing already exists for ingestion).

## 2. Lifecycle strip never reaches a real loading or empty state; fetch errors vanish

- **Severity**: High
- **Category**: missing-loading-state / silent-failure
- **File**: `app/features/sub_jobs/JobLifecycleStrip.tsx:63` and `:41-61`
- **Scenario**: On a slow `/api/pipeline` + `/api/channels/webhooks` round-trip, the strip renders nothing, then a row of pills pops in (layout shift inside the modal). If either fetch rejects, `.catch(() => undefined)` swallows it and the segment silently disappears — a role with 5 active candidates can show no funnel pill with no indication anything failed.
- **Root cause**: The component conflates "still loading" (`entries === null && hooks === null`) with "nothing to show", and treats fetch failure as an empty result. There is no skeleton and no error affordance.
- **Impact**: Recruiters can't tell "this role genuinely has no activity" from "the lifecycle data failed to load." Counts that drive deep-link navigation (decisions/schedule/offers) silently under-report, and the late pop-in causes CLS in the modal header.
- **Fix sketch**: Render a thin skeleton strip while either fetch is pending; on rejection set an error flag and show a muted "couldn't load activity" inline (not a thrown-away `undefined`). Reserve the strip's height to avoid the shift.

## 3. Markdown copy/quick-apply clipboard failures fail silently — button gives no feedback

- **Severity**: High
- **Category**: silent-failure / missing-error-state
- **File**: `app/features/sub_jobs/JobPostingModal.tsx:130` (`copyApplyLink`), `:147` (`copyQuickApplyLink`), `:156` (`copy`)
- **Scenario**: In a non-secure context, a denied clipboard permission, or any browser where `navigator.clipboard` is undefined, the recruiter clicks "Copy Markdown" / "Apply link". The `catch {}` is a bare no-op: the button never flips to the ✓ "Copied" state, never errors, and the user believes the text is on their clipboard when it is not.
- **Root cause**: Each handler catches the failure and discards it (`/* clipboard blocked — no-op */`), so success and failure are visually identical (the checkmark only appears on success, but nothing communicates failure).
- **Impact**: A recruiter pastes nothing into a job board or email and ships an empty posting / dead link, the highest-cost outcome in this surface. The same pattern affects all three copy buttons.
- **Fix sketch**: In the `catch`, set a transient inline error ("Couldn't copy — select & copy manually") and optionally render the raw string in a focusable, selectable field as a fallback. At minimum, distinguish the failed state visually instead of staying inert.

## 4. Bulk-ingest abort on tab switch leaves a torn result table and no cancel control

- **Severity**: Medium
- **Category**: interaction-correctness / missing-control
- **File**: `app/features/sub_jobs/IngestAdPanel.tsx:106` (`submitBulk`), `:131` (abort early-return), `:207` (Cancel button `disabled={busy}`)
- **Scenario**: During a 10-ad bulk import the only "Cancel" button is `disabled={busy}`, so a recruiter cannot stop a long run from the UI — the sole abort path is unmounting the panel (tab switch), which hits the `if (controller.signal.aborted) return` early-out, leaving `busy`/`progress` frozen and a partial results list.
- **Root cause**: The abort controller is wired to unmount only; there is no in-flight cancel affordance, and the abort early-return skips the `setNote` summary so the partial run is never explained.
- **Impact**: A user who pasted a bad batch is stuck watching it run, or force-navigates and loses the per-row outcome summary. No way to stop sequential Claude parses mid-run despite the code supporting it.
- **Fix sketch**: While `busy && bulk`, repurpose the Cancel button to call `abortRef.current?.abort()` (enable it), and in the abort branch still emit a "Stopped after N of M" note from the rows accumulated so far.

## 5. Job table rows are not real buttons — `role="button"` on `<tr>` is a screen-reader/semantics trap

- **Severity**: Medium
- **Category**: a11y / semantics
- **File**: `app/features/sub_jobs/JobRow.tsx:13-23`
- **Scenario**: Each corpus row is a `<tr tabIndex={0} role="button" onClick … onKeyDown>`. Applying `role="button"` to a table row removes it from the table's row semantics for assistive tech, so the `<caption>` + column headers carefully built in `JobsTable.tsx` are decoupled from the row a screen reader is announcing as a button, and the row's cells lose their `gridcell`/`cell` association.
- **Root cause**: The interactive affordance is bolted onto the structural `<tr>` rather than onto a focusable element inside a cell, overriding the native table role.
- **Impact**: Screen-reader users lose the "row N, Role column = X" context that the table markup provides, and the row reads as an opaque button. The hand-rolled `Enter`/`Space` handler also re-implements button keyboard behavior imperfectly.
- **Fix sketch**: Keep the `<tr>` as a row; make the first (or title) cell a real `<button>` (or wrap the row content in a `<button>`-styled cell) that carries `onClick` and focus, preserving table semantics while remaining keyboard-operable.

## 6. Publish/close result notes are squeezed into the footer button row and truncate

- **Severity**: Medium
- **Category**: layout / visual-hierarchy
- **File**: `app/features/sub_jobs/JobPostingModal.tsx:196-227`
- **Scenario**: After publishing, the footer holds the close/reopen button, the apply + quick-apply + matrix + copy buttons, AND the `publishNote` / `closeError` / `withdrewCount` messages all on one `justify-end` flex row (`Modal` footer at `Modal.tsx:175`). A real sourcing-warning message (`publishedButFailed` with an embedded warning string) is forced into a `min-w-0 truncate` span and is largely cut off; on a narrow viewport the action buttons wrap unpredictably around the text.
- **Root cause**: Status messaging shares the action toolbar instead of having its own region; the only mitigation is `truncate` + a `title` tooltip, which hides the substance of a warning that explains why sourcing failed.
- **Impact**: The most important feedback (why a publish half-failed, how many candidates were withdrawn) is the first thing clipped, undermining the careful "warn vs clean sourced 0" distinction the code builds.
- **Fix sketch**: Move `publishNote`/`closeError`/`withdrewCount` out of the footer into a dedicated full-width status row above the footer (or the modal body), leaving the footer for actions only; drop the `truncate` so warnings are readable.

## 7. Background-refetch overlay pulses the whole table and hides nothing meaningfully

- **Severity**: Low
- **Category**: polish / loading-state
- **File**: `app/features/sub_jobs/JobsTab.tsx:226-233`
- **Scenario**: Every filter keystroke triggers a 180ms-debounced refetch; while `fetching` is true the entire results `<div>` gets `animate-pulse opacity-60`, so the full table visibly flickers on each search character even though the previous rows are still valid and on screen.
- **Root cause**: A coarse opacity/pulse on the whole list is used as the in-place refetch indicator, applied on every filter change rather than a subtle, localized busy cue.
- **Impact**: Distracting full-table flicker during normal typing; `aria-busy` toggling rapidly can also spam assistive tech. It reads as "the data is reloading" when results are merely being refined.
- **Fix sketch**: Replace the table-wide pulse with a small inline spinner near the result count (the `aria-live` "showing N of M" line), or only dim after a short delay so fast responses don't flash; keep `aria-busy` but stop the visual pulse on the content.
