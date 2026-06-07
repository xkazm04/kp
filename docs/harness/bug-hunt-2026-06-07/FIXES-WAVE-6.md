# Bug Hunt Fix Wave 6 — Silent failures & batch-abort recovery

> 4 commits, 4 findings closed (3 high, 1 medium).
> Baseline preserved: tsc 0→0 · `next build` ✓ · unit 585→585 · python 474→474. No regressions.

## Commits

| # | Commit | Finding | Severity | File |
|---|---|---|---|---|
| 1 | `25bdf4f` | data-layer #2 | High | `analyze-run.ts` |
| 2 | `266955a` | automation #4 | High | `automation-pass.ts` |
| 3 | `ce0d6b1` | pipeline #2 | High | `PipelineTab.tsx` |
| 4 | `0725dc4` | scheduling #5 | Medium | `schedule/[token]/route.ts`, `SchedulePicker.tsx` |

## What was fixed

1. **502 on a successful, paid analysis.** `runAnalyze` parsed CLI stdout with raw `JSON.parse`, but the analyze CLI invokes an LLM and the interpreter prints shutdown chatter (asyncio "Event loop is closed", `ResourceWarning`, "leaked semaphore") *after* the JSON line — so a successful, already-billed analysis intermittently 502'd and was discarded uncached (the retry pays again). Switched to `parsePythonJson(stdout, stderr)`, the exact defense the sibling `reasoning-run` already uses; a genuine non-JSON run still degrades to 502, now with stderr context.

2. **One comm throw aborted the whole policy pass.** The apply loop had no per-decision try/catch, so a throw from `dispatchRejection` (a comms fault, a transient `SQLITE_BUSY` past the busy_timeout) propagated out and rejected the entire pass — discarding the summary of everything already applied and skipping every later decision. Worse, a reject's DB transition is committed *before* the comm, so the pass aborted with the candidate rejected-but-un-notified. Each decision's apply+dispatch is now isolated (records into a new `summary.errors` count and continues).

3. **A failed automation pass looked like a successful no-op.** `runPass` only acted inside `if (r.ok)` — empty else, no catch — so a 4xx/5xx/network failure left the operator believing the funnel was processed when it wasn't. Now surfaces `!r.ok` and thrown errors via the existing error banner; clears it on a clean pass.

4. **"We've sent a confirmation" when it wasn't.** The schedule-confirm route swallowed a `dispatchInterviewConfirmation` throw as best-effort, yet the candidate page unconditionally promised a confirmation + reminder — and for a short-notice booking (no separate timed reminder), a silently-failed confirmation means *zero* notification for an imminent interview. The route now flags + logs the failure (reconcile machinery) and returns `confirmationSent:false`; the success card softens to "we'll be in touch to confirm."

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `next build` | ✓ | ✓ |
| `npm run test:unit` | 585 | 585 |
| `npm run test:python` | 474 (4 skipped) | 474 (unaffected) |

## Patterns established (catalogue items 16–17)

16. **A batch loop must isolate per-item failures.** One item's throw should never abort the batch — discarding already-applied work and skipping every later item. Wrap each iteration, record the error (a visible count), and continue. (Especially when an item's durable write commits before its side effect.)
17. **A non-OK response is not a no-op — branch on it.** A handler that acts only on `if (r.ok)` with an empty else makes outright failure indistinguishable from a successful no-op. Always handle `!r.ok` and thrown errors with a visible signal.

(W6 also re-applied catalogue items 6 — parse-chatter via `parsePythonJson` — and 14 — don't claim a delivery you couldn't make.)

## Cumulative status (waves 1–4, 6)

| Wave | Theme | Closed |
|---|---|---|
| 1 | Duplicate side-effects & double-firing | 6 |
| 2 | Python numeric & LLM-boundary safety | 6 |
| 3 | Analyze run lifecycle & task cancellation | 4 + Data#1 (analyze) |
| 4 | Voice interview end-of-call & connection timing | 6 |
| 6 | Silent failures & batch-abort recovery | 4 |

Pattern catalogue: 17 items. **26 / 51 findings fully closed** (+ Data#1 partial). No criticals remain.

## What remains

W5 dev-case provenance (7 — WIP overlap, re-read `evaluate.py`/`models.py` first), W7 status/uniqueness guards (6), W8 board/form UI (11) — 25 findings open per `INDEX.md`, plus the Data#1 signal-forward for the 5 non-analyze handlers.
