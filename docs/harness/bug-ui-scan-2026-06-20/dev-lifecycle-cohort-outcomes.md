# Dev Lifecycle, Cohort & Outcomes — UI Perfectionist scan

> Context: Manage dev case lifecycle (approve/close/redesign), cohort probe strength, interview kits, skill-profile verification, outbox comms and hiring outcomes.
> Files reviewed: 16 of 35
> Total: 7 findings — Critical: 0, High: 3, Medium: 3, Low: 1

## 1. OutboxTable ignores the API's `relayConfigured` flag — disclaimer and "queued" pill lie when a relay IS wired

- **Severity**: High
- **Category**: misleading-affordance / silent-failure
- **File**: `app/features/sub_dev/OutboxSection.tsx:78-84` (and `app/features/sub_dev/DevTab.tsx:81-85`, `app/api/devcase/comms/route.ts:13`)
- **Scenario**: An operator sets `COMMS_WEBHOOK_URL` so messages relay through a real channel. The GET `/api/devcase/comms` returns `relayConfigured: true` precisely so the client can tell whether a `queued` row means "offline" (expected) or "unexpected, needs attention" (the route's own comment). DevTab's loader parses only `p.outbox` and throws the flag away.
- **Root cause**: The static caption is hardcoded to always tell the user to "set `COMMS_WEBHOOK_URL` to relay through a real channel" and renders `queued` as a benign steel pill, with no branch on `relayConfigured`.
- **Impact**: When a relay is configured, every `queued` row is silently abnormal (the relay should have moved it to `sent`/`failed`) but the UI presents it as the normal terminal dev state and instructs the user to configure something already configured — a dropped delivery reads as routine.
- **Fix sketch**: Thread `relayConfigured` through DevTab's loader into `OutboxTable`. When `true`, hide the "set COMMS_WEBHOOK_URL" caption and render `queued` with a warning tint + "stuck in queue" affordance; when `false`, keep today's "offline/local" copy.

## 2. CohortProbe heatmap conveys miss-severity by color alone (WCAG 1.4.1)

- **Severity**: High
- **Category**: a11y
- **File**: `app/features/sub_dev/CohortProbePanel.tsx:16-20,50-52`
- **Scenario**: A reviewer with low color vision (or on a low-contrast display) reads the cohort probe insights. `heatClass(rate)` maps miss-rate to coral / amber / moss tints, and the only differentiator between a healthy probe and a miscalibration flag is that background color — the text is just `"NN% missed"` in every band.
- **Root cause**: Severity is encoded purely in the tint; there is no icon, weight change, or textual qualifier ("high/critical") accompanying the percentage.
- **Impact**: A colorblind reviewer cannot distinguish a probe the whole cohort detected from one nobody caught — exactly the miscalibration signal the panel exists to surface. The headline "Possible miscalibration" callout only fires at `missRate === 1`, so the 0.75–0.99 coral band has no non-color cue at all.
- **Fix sketch**: Add a non-color cue inside the heat chip — e.g. an `AlertTriangle`/`CheckCircle` glyph keyed to the band, or a band word ("high miss" / "ok") — and ensure each chip has a `title`/`aria-label` stating the severity, not just the number.

## 3. LifecycleRow action header never wraps — title + up to four buttons overflow on mobile

- **Severity**: High
- **Category**: responsiveness
- **File**: `app/features/sub_dev/LifecycleRow.tsx:83-135`
- **Scenario**: A lifecycle that is both `stalled` and `closable` renders, in one `<div className="flex items-center gap-2">`, the truncating title, the stage badge, a "stalled Nd" chip, a "Re-source" button, a "Review & approve" button (when awaiting), and a "Close case" button. On a phone width this row has no `flex-wrap`, so the buttons get crushed against the truncated title.
- **Root cause**: The container is `flex items-center` with no `flex-wrap`, unlike the sibling `CaseDetail` header (`flex flex-wrap items-center gap-2`) and `InterviewKit` which both wrap.
- **Impact**: On mobile/narrow viewports the title truncates to a few characters and the action buttons either overflow horizontally or shrink below comfortable touch-target size, making the primary lifecycle actions hard to hit — a real-device usability break.
- **Fix sketch**: Add `flex-wrap` to the container (matching CaseDetail) and let the title block keep `min-w-0 flex-1`; optionally move the actions to a second wrapped row under the title on `sm:` and below.

## 4. Skill-profile axis meters have no accessible role/value and a 0-score axis is an invisible bar

- **Severity**: Medium
- **Category**: a11y / missing-empty-state
- **File**: `app/skill/[token]/page.tsx:75-87`
- **Scenario**: A third party (or the candidate) opens the public score-card. Each durable axis renders a label, a raw number, and a `bg-stone-100` track with a `bg-ink` fill `style={{ width: ... }}`. The fill `div` has no `role="meter"`/`progressbar`, no `aria-valuenow/min/max`, and no `aria-label`. An axis whose score is `0` renders a track with a zero-width fill — visually an empty bar with a "0" beside it, indistinguishable from "no data".
- **Root cause**: The meter is a pure presentational div; the numeric value lives only in an adjacent visual span, not associated with the bar, and there's no empty/zero treatment.
- **Impact**: Screen-reader users get the number but no notion of the bar/scale; sighted users see ambiguous empty bars for low/zero axes on a candidate's public credential.
- **Fix sketch**: Wrap the track in `role="meter"` (or `progressbar`) with `aria-valuenow={score} aria-valuemin={0} aria-valuemax={100}` and an `aria-label` naming the axis; render a subtle baseline/tick or a "—" affordance when `score === 0`.

## 5. Low-confidence Durable Skill Profile shows a bare bold "confidence %" with no caution treatment

- **Severity**: Medium
- **Category**: missing-state / misleading-affordance
- **File**: `app/skill/[token]/page.tsx:55-69` (confidence: `:22,:64-66`)
- **Scenario**: A credential minted from a deterministic-fallback / thin evaluation carries a low propagated `confidence` (the codebase pins `LOW_CONFIDENCE = 0.4` and threads it everywhere internally). The public card prints `confidencePct` as a plain bold black number next to the transfer score, with the same visual weight regardless of value.
- **Root cause**: The page already downgrades a *substantively empty* credential to an "incomplete" badge, but a *substantive yet low-confidence* one gets the full green "verified" treatment with an unqualified confidence figure.
- **Impact**: A third party reads a "verified" green shield and a confident-looking transfer score over an inference the system itself considers low-trust — the exact "green over a 0" failure mode the code tries to avoid, one notch up.
- **Fix sketch**: When `confidence <= LOW_CONFIDENCE`, render the confidence figure in a muted/amber treatment with a short "low-confidence inference" caption (mirroring the internal low-confidence convention), without changing the cryptographic verdict.

## 6. InterviewKit copy success/failure is visual-only (no aria-live; blocked clipboard fails silently)

- **Severity**: Medium
- **Category**: a11y / error-handling
- **File**: `app/features/sub_dev/InterviewKit.tsx:29-37,50-56`
- **Scenario**: A recruiter clicks "Copy". On success the button swaps icon+label to "Copied" for 1.5s (no live-region announcement). On failure (`navigator.clipboard` rejects — non-secure context / permission), the `catch {}` is empty and the button label never leaves "Copy", so the user gets no signal the copy didn't happen.
- **Root cause**: State change is purely a label/icon swap with no `aria-live` region, and the failure path relies on an unstated assumption that the Download button is "the fallback" without telling the user.
- **Impact**: Screen-reader users hear nothing when the copy succeeds; all users get no feedback when it fails and may paste stale clipboard content into an interview doc.
- **Fix sketch**: Announce the result via an `aria-live="polite"` span ("Interview kit copied" / "Copy failed — use Export"), and on the `catch` set a transient error state that points to the Export button rather than swallowing it.

## 7. OutboxTable silently truncates at 50 rows with no "showing 50 of N" indicator

- **Severity**: Low
- **Category**: missing-state
- **File**: `app/features/sub_dev/OutboxSection.tsx:97`
- **Scenario**: A busy pipeline accumulates >50 outbox messages. The table renders `outbox.slice(0, 50)` with no footer, count, pagination, or "showing first 50 of N" note.
- **Root cause**: A hard slice caps the render with no surfaced indication that older rows exist.
- **Impact**: A recruiter scanning for a specific (e.g. failed/dead-lettered) message older than the 50 most recent believes it isn't there — a comms audit log that silently hides its tail. The tab's count chip shows the true total, deepening the mismatch (count says 80, table shows 50).
- **Fix sketch**: Show a footer row "Showing 50 of {outbox.length}" when truncated, and add a "load more"/scroll affordance or a filter (e.g. status = failed) so the dead-lettered tail stays reachable.
