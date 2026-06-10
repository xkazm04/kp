# Feature Scout #2 — Fix Wave 5: "Dev-case closes its loop" (Theme D)

> 4 commits, 6 findings closed (5 High + 1 High pair-half; the two duplicate pairs DEVS1+DEVO1 and DEVO2+DEVS2 each shipped as one work item).
> Baseline preserved: tsc 0 → 0 · next build ✓ · unit 646 → 646 · python 500 OK → 500 OK · eslint clean on all changed files.

One mental model: the take-home subsystem had every internal stage built and hardened, but
its three boundary crossings — candidate in, ground truth back, terminal state out — were
all severed. This wave reconnects them, plus the human gate in the middle.

## Commits

| # | Commit | Finding | Value | Files |
|---|---|---|---|---|
| 1 | `56ae3fa` | DEVS1+DEVO1 (pair) — candidate apply page behind the token | High×2 | 6 (+308/−1) |
| 2 | `a13237b` | DEVO2+DEVS2 (pair) — outcome calibration auto-feed + one-click recording | High×2 | 4 (+184/−1) |
| 3 | `be46e6f` | DEVO3 — case close-out with wrap-up comms | High | 6 (+135/−5) |
| 4 | `cbf7851` | DEVP1 — real review at the human approval gate | High | 7 (+327/−11) |

## What was fixed

1. **The flow is deliverable.** The "apply link" was the POST-only inbound webhook (a
   browser 405'd); the materialized starter seed had zero callers anywhere. New public
   `/devcase/apply/[token]` page (bilingual, token-surface pattern): probe-safe
   `caseToMarkdown` brief, per-file seed download + preview + one-click bundle, and a
   submission form through the same webhook (ack/dedup/lifecycle-resume free).
   ApplyTokenPill copies the page URL.

2. **The calibration loop learns by itself.** `recordOutcome`'s only caller was the
   control room's hand-transcribed form (`ref` never populated). New
   `recordPipelineOutcome` (ref+outcome idempotent, score-bounded, ds- prefix inlined to
   keep the store self-contained) fires at both terminal transitions — the reject branch
   of `actOnPipelineEntry` (after the IMMEDIATE tx; best-effort) and the Hired CAS winner
   in offer-finalize — each with a system-actor audit row. Promoted SubmissionRows gain
   inline Hired/Rejected/Withdrawn (+perf 1–5) buttons through the validated route.

3. **Cases can end.** "closed" was in STAGES and TERMINAL with no writer: non-promoted
   submitters were ghosted after an ack promising review, and tokens collected forever.
   Human-gated close route: courteous wrap-up comm to every non-promoted submitter
   (deduped by recipient), postings closed, lifecycle → closed, audit row. The inbound
   webhook answers 410 on a closed posting; the apply page renders a closure card.

4. **The human gate reviews instead of rubber-stamping.** The designed artifacts were
   served but the UI type dropped them. awaiting_approval rows open a review panel:
   flagging analysis, LIVE candidate-safe preview over the in-flight edits, INTERNAL
   probe panel; bounded edits (title/brief/tasks/timebox) ride the approve;
   "Regenerate with note" re-runs only the design step (`design_case(feedback=)` →
   `devcase_cli --feedback`) and returns to the same gate.

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `next build` | ✓ | ✓ |
| `npm run test:unit` | 646 | 646 |
| `npm run test:python` | 500 OK (4 skip) | 500 OK (4 skip) |
| eslint (changed files) | clean | clean |

## Patterns established (catalogue items 8–10)

8. **A token-shaped artifact must resolve to a human surface.** A copyable "link" that
   only a machine can consume is the deliverability bug in disguise (VOX1, then this) —
   when you mint a token, build the page before the pill.
9. **Terminal stages need writers, and the close must propagate to every open mouth.**
   Adding "closed" to a stage enum does nothing; the writer has to also stop intake
   (webhook 410, page card) and settle obligations (wrap-up comms) or the terminal state
   ghosts people.
10. **Feed learning loops from the transitions that already know the answer.** A
    calibration store fed by manual transcription starves; the terminal transition holds
    ref + prediction + outcome in one place — hook it there, idempotently, best-effort,
    outside the transaction.

## What remains

Theme D Mediums/Lows stay open: DEVS5 side-by-side compare (deferred this wave for scope),
DEVO4 DEV_POLICY knobs, DEVO5/DEVS4 outbox resend+triage (overlaps SIM2 — Wave 6's comms
center), DEVO6 audit export, DEVS6 seed preview in CaseDetail, DEVP4 fairness-gate card,
DEVP5 case-artifact language, plus the late-arrival re-eval resume (inbound still resumes
from `collecting` only — noted in DEVO3, deferred). Rubric-weight editing at the gate was
deliberately left engine-owned (regenerate covers it).
