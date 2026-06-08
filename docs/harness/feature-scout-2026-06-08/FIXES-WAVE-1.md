# Feature Scout Fix Wave 1 — Light up the dark capabilities (Theme A)

> 5 commits, 6 of 7 approved opportunities shipped (DEC1 deferred).
> Baseline preserved: tsc 0 → 0 · unit 617 → 617 · python 486 → 486 · next build ✓.

The marquee theme of the scan: **fully-built, hardened backends that had no UI to
invoke them.** Each fix is mostly a control + wiring, not new machinery.

## Commits

| # | Commit | Opportunity | Files |
|---|---|---|---|
| 1 | `cd8510b` | RES2 + CV1 (partial) — "Add to pipeline" on the candidate report | `AddToPipelineButton.tsx` (new), `ResultPanel.tsx`, `history/[slug]/page.tsx` (+ committed the shared `useAddToPipeline.ts`/test it reuses) |
| 2 | `0b3b9e4` | PIPE1 — manual stage move from the drawer | `db.ts`, `PipelineShared.tsx`, `api/pipeline/[id]/route.ts`, `CandidateDrawer.tsx` |
| 3 | `b897624` | JOB1 — paste-a-job-ad ingest in the Jobs UI | `IngestAdPanel.tsx` (new), `useJobsList.ts`, `JobsTab.tsx` |
| 4 | `f58778a` | VOX1 — deliver the voice-screen link to the candidate | `comms-dispatch.ts`, `api/interview/create/route.ts`, `CandidateDrawer.tsx` |
| 5 | `6995bba` | MAT3 (partial) — bulk-shortlist roles from Match results | `MatchCard.tsx`, `Results.tsx` |

## What was shipped (grouped)

1. **Act on a result (RES2 / CV1).** A finished job-fit report was a dead end; the
   recruiter could read the score but had to leave for Match to act. `ResultPanel`
   now renders an "Add to pipeline" action (optional `pipelineRef`), reusing the
   canonical `postPipelineAdd`. Wired on the history detail page where the saved row
   carries the candidate slug + JD slug the POST needs; shown only when the analysis
   ran against a saved JD. CV1's live Analyze-tab surface is deferred (see below).
2. **Manual stage move (PIPE1).** `set_stage` action + `setPipelineEntryStage` (same
   IMMEDIATE-tx + `expectedStage` CAS as the AI actions) let a recruiter move a
   candidate backward / skip / fix a misfile — recorded as a new `moved` event so it's
   auditable. A stage `<select>` in the drawer drives it (active entries only).
3. **Paste-a-job-ad (JOB1).** `/api/jobs/ingest` (Claude-CLI parse + content-hash
   dedup) had zero UI callers — the catalog read like a read-only seeded demo. A
   self-contained `IngestAdPanel` (AbortController-cancellable parse, client-mirrored
   30-char floor) calls it; `useJobsList.reload()` refreshes in place and the new (or
   deduped) role auto-opens.
4. **Deliver the interview link (VOX1).** The minted `/interview/<token>` only opened
   in the recruiter's own tab — the headline voice feature was undeliverable
   end-to-end. `dispatchInterviewInvite` sends it via the existing Outbox channel from
   `/api/interview/create`, gated on the provider being configured and best-effort
   (never fails session creation); the drawer confirms "Invite sent".
5. **Bulk shortlist (MAT3, partial).** Match results gained per-card shortlist
   checkboxes + a bulk bar ("Shortlist top 5" / "Add N to pipeline" / Clear) that
   files the candidate under many roles in one pass; failures stay selected for retry.
   Matrix cross-tab multi-select is deferred.

## Verification (before → after)

| Gate | Baseline | After Wave 1 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `next build` | ✓ | ✓ |
| `npm run test:unit` (node --test) | 617 pass / 0 fail | 617 pass / 0 fail |
| `npm run test:python` | 486 pass (4 skip) | 486 pass (4 skip) |

No new tests were added (the load-bearing logic — `postPipelineAdd` — is already
covered by `useAddToPipeline.test.ts`; the rest is UI wiring, which this repo locks
via source-level guards rather than component tests). Each fix was tsc-checked before
its commit.

## Patterns established (catalogue additions)

1. **Dark-capability audit.** The highest-leverage Feature Scout finding shape isn't
   "missing feature" — it's a built, tested backend with no UI caller (grep the route
   for `*.tsx` callers; zero hits = a dark capability). The fix is a control + wiring,
   not new machinery. Six of this wave's findings were this shape.
2. **Recruiter-override twin of an AI action.** When an AI/automation write exists
   (`actOnPipelineEntry`), the manual override should be its twin — same tx + CAS,
   distinct event kind (`moved` ≠ `advanced`) so analytics and the audit trail stay
   honest about who moved what.
3. **Best-effort outward comms, gated on configured + non-fatal.** A new candidate
   send (`dispatchInterviewInvite`) goes through the shared Outbox `sendComm` (durable
   by default, real relay only when configured), is gated on the capability actually
   working (`voiceAvailability`), and never fails the primary action on a comms throw.

## What remains (deferred this wave)

- **DEC1 — run the screening auto-reject wave from Decisions.** Deferred deliberately:
  it triggers irreversible rejection emails, and the scan's own DEC2 (dry-run preview)
  is its required safety companion. Ship the two together in a later wave, not the
  one-click irreversible button alone.
- **CV1 (Analyze-tab surface).** The live post-analyze tab can't offer "Add to
  pipeline" yet — the saved analysis slug isn't threaded to the client through the
  analyze task result (crosses the generated-schema boundary). RES2 (history) covers
  every saved analysis in the meantime.
- **MAT3 (Matrix surface).** Cross-tab multi-cell select + batch add in the Fit Matrix
  — the other half of MAT3; the Match-results half shipped.
- **Themes B–G (54 more opportunities)** remain in `INDEX.md` for future waves:
  candidate-loop comms, export/share, search/filter, decision record, configuration,
  AI-assist + guardrails.

## Note on commit hygiene

kp's working tree was heavily mid-WIP (a separate idea batch). Per the agreed Wave-1
handling, commits 2 (`db.ts`, pipeline route) carry adjacent uncommitted idea-batch
code (e.g. `rematchSourceEntry`, idea-9ad8a777) that rode along; commits 1, 3, 4, 5
touched only HEAD-clean files (+ the untracked `useAddToPipeline.ts` dep in #1) and
are pure. All work is on branch `feat/feature-scout-wave1-dark-capabilities`.
