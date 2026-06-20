# L1 — Sam Okafor (international senior software-engineer candidate)

Run: l1-2026-06-19 · Mode: L1 theoretical (code-grounded, no browser) · Language: en
Character file: `uat/characters/sam-dev-candidate.md`
Surface binding: tokenized public pages only (`/devcase/apply/[token]`, `/apply/[id]`, `/status/[token]`) — NOT the workspace.

## Reachability note (resolved before judging)

Sam reaches only tokenized public pages, and only with a minted token + a published
dev-case fixture. The local token-mint path is an unresolved `env.md` open question
(#3). Both journeys are therefore evaluated as the **designed** experience from code;
true reachability + job-unblock are deferred to L2. No findings on workspace tabs.

---

## Journey: dev-case-hire — VERDICT: L1-conditional

Structurally Sam can complete the loop (read brief -> work in the live surface -> submit
-> get an evidence-backed eval), and the machinery behind it is genuinely strong. But
two **major** findings carry forward: a senior case is timeboxed at **6 hours** and tells
him so, and the page presents **two contradictory submission paths**. A third major: the
exact surface where AI evaluates him carries **no AI-use disclosure**.

### Findings

| id | sev | dim | type | title | evidence |
|---|---|---|---|---|---|
| sam-dch-01 | major | time-saved | quality-gap | Senior case timeboxed at 6h, shown to candidate | `design.py:26,199,235-237`; `DevHelpers.ts:46-48` |
| sam-dch-02 | major | clarity | confusion | Two contradictory submit paths (editor vs required repo URL) | `page.tsx:79-85`; `DevApplyForm.tsx:30,89-98`; `LiveWorkSurface.tsx:111-132` |
| sam-dch-06 | major | trust | trust | No AI-use disclosure on the dev-case page where AI evaluates him | `page.tsx:58-87`; `AiDisclosure.tsx:7-13` |
| sam-dch-03 | minor | completion | quality-gap | Live-work "editor" is a bare textarea, no run/verify | `LiveWorkSurface.tsx:168-174` |
| sam-dch-04 | strength | senior-quality | strength | Eval grades AI-era judgment from HIS observed process | `evaluate.py:265-304`; `submission_eval.py:9-19` |
| sam-dch-05 | strength | trust | strength | Candidate brief is probe-safe by construction | `page.tsx:44`; `DevHelpers.ts:39-58` |

### Grounding audit

- **Case design** (`design.py:102-388`) receives the REAL need, the reality analysis
  (real stack, true complexity, risk areas) and the JD body — not a sample. It bakes
  covert tooling probes and forces a visible DECISIONS log. Well-grounded.
- **Eval** (`evaluate.py`, `submission_eval.py`) scores the ACTUAL observed reflection +
  probe outcomes, not a reconstructed rubric; `mint_followups` anchors to HIS specific
  decisions; fairness gates ensure AI use is never penalised. This is the senior-quality
  signal Sam came for — protect it.
- **The defect is not thin context; it is calibration.** The grounding is good, but the
  seniority timebox (`_TIMEBOX` senior=6h) produces precisely the half-day take-home that
  loses 40-60% of strong seniors — Sam's headline pet peeve, surfaced verbatim in the brief.

### l2_priority carried forward

1. Author a real senior need; read the live brief — is the surfaced timebox ~6h and does
   it read as a half-day take-home? Confirm nothing bounds case scope short (`devcase-constraints.ts`
   only caps `MAX_CODEBASES=3`).
2. Open a real token: do BOTH submit surfaces render? Can he finish via the editor WITHOUT
   a repo URL? One submission or two?
3. Confirm the live eval cites HIS observed events (files touched, DECISIONS.md) and reads
   evidence-backed, not a generic grade.
4. Confirm the dev-case page renders no AI/GDPR disclosure (gap is dev-case-specific).

---

## Journey: candidate-apply-status — VERDICT: L1-pass

The apply leg is the strongest thing Sam touches: fast conversational apply, a real status
token returned on accept, an honest timeline, explicit AI/human disclosure with GDPR
consent, and natively fluent English. No majors. The status leg is `unreachable` at L1
only because the token-mint fixture is unresolved (designed path is sound).

### Findings

| id | sev | dim | type | title | evidence |
|---|---|---|---|---|---|
| sam-cas-01 | strength | completion | strength | Real status token + self-serve timeline (no ghosting) | `route.ts:29-39`; `ConversationalApply.tsx:443-450`; `status/[token]/page.tsx:77-116` |
| sam-cas-02 | strength | trust | strength | Explicit AI/human disclosure + GDPR consent, fluent English | `AiDisclosure.tsx:24-29`; `en.json aiDisclosure.*` |
| sam-cas-03 | minor | completion | broken-flow | Status leg unreachable at L1 (no token fixture) | `status/[token]/page.tsx:33-42`; `env.md:127,139` |

---

## First-person feedback — in Sam's voice

The apply flow? Honestly, fine. Better than fine. I clicked through in English written by
someone who actually speaks it — no machine-translation smell, no half-Czech buttons. It
told me straight up that AI assists but a human makes every advance/offer/reject call and
I can ask for a human review, plus a 12-month data line with an erasure link. That's the
disclosure I want as an engineer, not buried, not pre-ticked. And at the end it handed me a
link to watch my own status move received -> review -> interview -> offer -> hired. I don't
have to email anyone. That's the no-ghosting promise kept. I'd keep talking to this employer
on the strength of the apply alone.

Then the dev case, which is where I actually decide if these people respect engineers — and
it's a split verdict. The *thinking* behind it is the best I've seen: they assume my code is
100% AI-generated and grade my judgment, my verification, where I overrode the model, the
decisions I logged. The follow-up questions are minted from MY specific choices, not a
question bank. That is the right signal. Someone who's actually thought about LLM-era hiring
built this.

But two things stop me cold. First, the brief tells me it's a **6-hour** timebox. Six hours.
That's the exact half-day take-home I decline on principle — recruiters DM me weekly, my time
is the scarce thing, and "senior" apparently means *more* hours here, not a sharper 30-minute
slice. I'm the 40-60% who walks, and I'd walk. Second, the page can't decide what it wants
from me: there's an in-browser editor that watches my process, and right under it a form that
*requires* a "Solution repository URL" and tells me to push to a public repo. So which is it?
If I work in your editor, what URL do I paste? The editor's own error message even points me
"to the repository-link option below" — so even it doesn't think it's the real path. And that
editor is a plain textarea with no way to run anything, on a case that explicitly grades
whether I verified my change. Make up your mind.

One more: the apply chat disclosed AI use to me, but the dev-case page — the one place where
an LLM literally scores my work — says nothing about AI evaluating me or how long you keep it.
That's backwards.

Would I tell a peer? About the apply flow and the eval philosophy, yes. About the case
itself, not until you cut it to a real brief task, pick ONE submission path, and tell me
plainly that AI is grading me. Right now the machine is excellent and the brief is the trap I
avoid.

---

## Summary

- **dev-case-hire:** L1-conditional — 3 major (6h senior timebox; dual contradictory submit
  paths; missing AI disclosure where AI evaluates), 1 minor, 2 strengths.
- **candidate-apply-status:** L1-pass — 0 major, 1 minor (status `unreachable` w/o token
  fixture), 2 strengths.
- **Strengths to protect:** the AI-era eval philosophy (observed-process, judgment-graded,
  fairness-gated, candidate-specific follow-ups), the probe-safe brief, and the apply leg's
  fluent English + honest disclosure + no-ghosting status timeline.
