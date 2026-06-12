# Biz+UI Fix Wave 1 — Reach every candidate (comms delivery)

> 6 commits, **7 findings closed** (4 High + 3 Medium — DCUI-2 and DCAPI-3 shared a root and closed together).
> Baseline preserved: tsc 0 → 0, unit 719/719 → 719/719, python 511 OK, `next build` ✓.

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|--------|-----------------|----------|-------|
| 1 | `6ee1e41` | automation-orchestration #2 | Medium | automation-pass.ts |
| 2 | `feb672d` | demo-simulation-channels #1 | High | lead-intake.ts, comms-dispatch.ts(+test), channels inbound route, messages en/cs |
| 3 | `d1788ce` | scheduling-offers #1 | High | comms-dispatch.ts(+test), decision-attribution.ts(+test), schedule invite + [token] routes, CandidateDrawer, messages en/cs |
| 4 | `cc3c6e5` | demo-simulation-channels #2 | Medium | api/comms route, CommsCenter, messages en/cs |
| 5 | `c0890cf` | dev-case-orchestration-api #1 | High | devcase-run.ts |
| 6 | `aa50b62` | dev-case-studio-ui #2 + dev-case-orchestration-api #3 | High + Medium | DevApplyForm, DevTypes, SubmissionRow, messages en/cs |

## What was fixed (grouped by sub-pattern)

1. **Undelivered token link** (`d1788ce`) — the self-scheduling link was the only candidate token link that never shipped through the product: minted, returned for copy-paste, never emailed, while the lifecycle panel claimed "sent". New `dispatchScheduleInvite` fires at mint (best-effort, full-entry recipient contract so inbound applicants' real address is used), the route returns `dispatched`, the drawer mirrors the voice link's sent/copy-fallback UI, and the booking confirmation now carries the link as a footer — the candidate's one durable way back to the shipped reschedule/.ics affordances. New `schedule_invite_sent` event kind registered end-to-end (DECISION_META, COMM_SENT_KINDS, analytics labels en/cs, writer-map test).

2. **Ghosted adverse outcomes** (`feb672d`, `6ee1e41`) — two paths broke the "never ghost" promise. (a) KO-declined webhook leads: the candidate's board said "submitted", kp held their email, and nothing was ever sent — new entry-less `dispatchKnockoutDecline` (kind `ko_decline`, envelope handles the null entry context), gated `notifyDecline: true` on the webhook caller only, so the own quick-apply form's live UI doesn't double-message. (b) The scheduled policy pass: a rejection whose notification failed surfaced as a bare `errors: 1` with no per-entry marker AND under-counted `rejected` (the increment sat after the `await`) — now mirrors screen-wave's `rejection_comms_failed` event and counts the committed DB transition before the comm hop.

3. **Alarm fatigue on recovered dead-letters** (`cc3c6e5`) — resend is append-only (the failed row is the audit record), but nothing computed supersession, so the red badge never cleared and the failed-only filter showed recovered rows with live Resend buttons forever. `/api/comms` now derives `recovered`/`recoveredAt` over the unfiltered window; the center drops recovered rows from count/pin/filter and renders a quiet "recovered · resent {time}" chip. Also: `useLiveRefresh(load)` — the center finally updates when the sim/automation generates comms.

4. **Identity dropped at the dev-case bridge** (`c0890cf`, `aa50b62`) — `promoteSubmission` created the pipeline entry without `sub.contact` or the lifecycle's DEVP5 `lang`, so every post-promotion comm addressed a free-text name in English; both now thread through (`CreatePipelineInput` supported them all along). Upstream, the public apply form now REQUIRES an email-shaped contact (bilingual "this is how we reach you" hint; webhook stays lenient for ATS callers), and the workbench finally shows contact (mailto-capable) + candidate notes on `SubmissionRow`, with a loud "unreachable if promoted" badge on contact-less webhook rows.

## Verification table

| Gate | Before wave | After wave |
|------|------------|-----------|
| tsc --noEmit | 0 errors | 0 errors |
| node --test unit | 719/719 | 719/719 |
| python unittest | 511 OK (4 skipped) | 511 OK (4 skipped) |
| next build | ✓ | ✓ |
| i18n parity | 1839 keys | 1849 keys (en=cs) |

## Cumulative status (scan 2026-06-12)

7 / 108 findings closed (4 / 32 Highs). Themes remaining per INDEX: B (honest automation), C (real data), D (dead ends), E (evidence), F (platform safety), G (i18n seams), H (theme register), I (shell/report UX), plus theme-A leftovers (sched-offers #2 follow-up nudge, demo-sim #3 demo comms beat).

## Patterns established (catalogue additions, items 25–29)

25. **Token-link delivery parity** — every candidate token link (voice, offer, schedule, dev-case apply) must auto-dispatch through `sendComm` with a durable event marker at mint; a copy panel is a fallback affordance, never the delivery channel. When adding a new token surface, grep `dispatchInterviewInvite` for the shape.
26. **Adverse outcomes notify entry-less** — `comms-envelope` ships null context fine, so a decline that predates any pipeline entry can (and must) still notify via `sendComm` without `ref`. Gate on the caller when one surface already shows the outcome live.
27. **Append-only ledgers need derived supersession** — when recovery is modeled as a NEW row (resend), every alarm surface must compute "superseded by newer same-(ref,kind) success" server-side; never mutate the audit row, never count recovered rows as actionable.
28. **Count the committed transition, not the side effect** — summary counters increment with the DB commit; comm hops get their own try/catch + per-entry failure event (screen-wave is the reference implementation).
29. **Bridges must thread identity** — any `createPipelineEntry` caller bridging from another store (dev-case promote, lead intake, apply intake) must pass `contact` + `locale`; grep `createPipelineEntry(` when adding bridges — the input type supports more than most callers pass.

## What remains

Wave 2 (suggested next): **B1 — honest attribution** — decision-attribution auto/human split (one root, two Highs), supervised auto-reject mode, decision-log applied/failed/skipped, KO discards in funnel, wave outcome detail.
