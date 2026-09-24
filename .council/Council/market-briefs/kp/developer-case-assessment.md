---
subject: developer-case-assessment
project: kp
researched_at: 2026-09-22
capability: "A seeded, in-browser work-sample the candidate does live, where the AI assistant sits INSIDE the product and its transcript is part of the submission, process artifacts (file opens, edits, paste magnitude, decision log) are the graded evidence rather than a reconstructed git log, and a model grades the result against the case's explicit rubric - with the case's covert probes structurally audited for discriminating power and the judge seat's independence from the generator disclosed - in a self-hosted, single-organisation install."
---

## Scope note, before anything else

Three lookups were spent. **No rival published a semantic version number I could pin.** The
HackerRank AI IDE page was fetched directly and cites an "April release" as live with no
version and no exact date; the others were read through search-result synthesis, not their
own pages. The honest pin for every rival below is therefore **"page state as of
2026-09-22"**, and any claim needing a tighter pin than that is not made here.

The comparison is against **what is built in the span**, not what the feature intends:
`app/devcase/apply/[token]/` (the candidate's whole surface) plus the eight
`app/_lib/devcase-*.ts` evaluation modules. Case authoring, the orchestrator, and the Python
model that actually does the grading are **outside the span** (`evidence/surface.md` §4) and
are not compared.

## Who

| Product | Pinned as | Axis it occupies |
| --- | --- | --- |
| **HackerRank AI IDE** | page fetched 2026-09-22; page cites an "April release" as live, no version number published on it | SaaS; the closest rival on the one capability |
| **CodeSignal** (Cheating & Fraud / Suspicion Score) | vendor page + 2026 comparison as indexed 2026-09-22 | SaaS; the detection-breadth rival |
| **CoderPad** | characterised via a 2026 cross-platform anti-cheat comparison, as indexed 2026-09-22 | SaaS; live-interview-first, light async anti-cheat |
| **Scorix** (AGPL-3.0) on **Judge0** | DEV write-up + `judge0/judge0` master `docker-compose.yml`, as listed 2026-09-22 | The self-hosted / open-source end - the only rival on kp's own deployment axis |

The self-hosting axis is a real product constraint here (`.ai/manifest.yaml` `scope.does`:
"self-hostable (Docker), multi-locale, one organisation per install"). HackerRank, CodeSignal
and CoderPad are SaaS-only on everything I could read; **on that axis they are a different
product**, and nothing below scores them down for it. Scorix/Judge0 is the only rival that
shares the axis.

## What they do that we do not

**HackerRank AI IDE** - a Monaco-based editor with **guarded vs unguarded AI modes**:
"Guarded mode for take-home assessments limits assistance to syntax and navigation;
unguarded mode for live interviews allows complete AI interaction under observation."
kp's assistant channel has no such policy knob - `LiveWorkSurface.sendChat` posts the whole
current file to the assistant on every message and the only limiter is a 429 budget
(`LiveWorkSurface.tsx:460-480`). HackerRank additionally ships an **AI Usage Summary**
metric, an **Automated Code Review Comparison**, and **Proctor Mode** (webcam, screen
capture). kp has none of these, and declines the last one by construction.

**CodeSignal** - a **Suspicion Score** that aggregates similarity scores, pattern detection,
telemetry and paste events across submissions. kp has no cross-submission similarity
anywhere in the span: `devcase-compare.ts` compares candidates only within one case's own
cohort on rubric axes, and `authenticityOf` merely reads a band the Python evaluator
stamped. The session watermark (`LiveWorkSurface.tsx:230-239`) detects **foreign marks** -
work relayed from another kp session - which is a far narrower detector than corpus
similarity.

**CoderPad / Judge0 / Scorix / HackerRank - all four execute the candidate's code.**
Judge0 is a sandboxed multi-language executor; Scorix wires it to per-problem test cases with
instant pass/fail. kp's "live work surface" is a **bare `<textarea>` per file**
(`LiveWorkSurface.tsx:590-605`) - no run, no tests, no terminal, no language server, no
syntax highlighting. This is the single largest functional gap in the comparison.

**Scorix** - full Docker Compose self-host (six services), white-label branding via env vars,
real-time ICPC-scored leaderboard, and published scale evidence (90,000+ requests in a
two-hour window, 120+ concurrent). kp self-hosts but publishes no comparable figure in the
span.

## What we do NOT take, and why

1. **Proctoring - webcam, screen capture, keystroke dynamics, session replay.**
   `LiveWorkSurface.tsx:17-21` states the rule in code: "We observe process artifacts only -
   never keystrokes or the screen." Keep declining it, for three reasons that survive
   scrutiny. (a) **The detector has a published bypass.** The same 2026 anti-cheat
   comparison that describes these signals also records that the assistant "runs as a
   desktop application alongside the browser tab ... they do not interact at all from
   CodeSignal's perspective" - so the surveillance cost buys a detector the market already
   knows how to walk around. (b) **kp's bet removes the thing being hunted**: the assistant
   is inside the product and its transcript is submitted evidence, so there is no outside
   channel to catch. (c) A single-org self-hosted install carries disclosure duties this
   code already models (`AiDisclosure`, `disclosureComplianceFor`, `retentionMonths` at
   `page.tsx:35,121-126`); biometric telemetry raises that burden sharply for a detector
   that is already defeated.

2. **A hard timebox with lockout.** kp's clock is advisory on purpose: past the box it says
   so and "the Submit button never stops working" (`LiveWorkSurface.tsx:543-559`). Decline
   the enforced version. The transport under it is an 8-second flush against a server that
   can answer 403, 404 or 409 (`:304-323`); enforcing a cutoff on top of that turns an
   infrastructure failure into a deleted hour of a candidate's work. Rivals can enforce a
   clock because they own the execution sandbox; kp does not.

3. **Test-case pass/fail as the score** (Judge0/Scorix's core, and a large part of
   CodeSignal's). kp grades **judgment** - a rubric plus observed process - and the whole
   probe apparatus exists to make a case discriminate on *choices*
   (`devcase-probe-audit.ts:9-15`). Adopting auto-graded test cases would re-anchor the
   product on the one thing every rival does better, at the cost of an execution sandbox
   kp does not have.

4. **Leaderboards and ICPC-style ranking** (Scorix). Wrong shape for one-org hiring: ranking
   candidates against each other is an adverse-action surface, and this product deliberately
   keeps the adverse decision human-gated - the auto-feedback brief "carries NO rejection
   wording ... the adverse decision stays human-gated" (`devcase-feedback.ts:6-9`).

5. **CodeSignal's cross-customer similarity corpus - declined by constraint, not by taste.**
   One organisation per install means there is no cross-tenant corpus to score against. This
   is worth writing down rather than leaving as an unbuilt feature: it is structurally
   unavailable here, so kp's authenticity claim will always be narrower than CodeSignal's,
   and the product should say so rather than imply parity.

## Where they are ahead

- **Execution and editor quality - behind all four.** A workspace with no run button and a
  plain textarea is behind CoderPad, Judge0/Scorix, and HackerRank's Monaco IDE both on the
  editing experience and on verifying that the submitted code works at all. The product's
  own one-line summary leads with "completes it in the in-browser live workspace", and this
  is the half of that sentence the rivals win.
- **AI-use policy control - behind HackerRank.** Guarded/unguarded modes are a shipped
  product control; kp has one always-on channel and a rate limit.
- **Detection breadth - behind CodeSignal.** kp's in-span detectors are paste magnitude
  (`LiveWorkSurface.tsx:593-599`), the session watermark, and an authenticity band read from
  a Python bundle. CodeSignal aggregates four signal families.
- **Proven scale - Scorix publishes numbers; kp's span publishes none.** Recorded as market
  maturity only; robustness is another member's question.

## Where this product is ahead

Stated because a teardown needs its direction to be checkable, not because the product wins.
All four claims are **unmatched by all four pinned rivals on what I could read of them**:

1. **Judge-independence as a rendered product fact** (`devcase-judge-independence.ts`). Not
   one rival surfaces whether the model grading the work is the model that produced it.
   HackerRank's nearest artefact is an "Automated Code Review Comparison" and an AI Usage
   Summary - neither is a seat-identity claim. The asymmetric rendering rule (`:14-23`) -
   show `self_grading`, say nothing for `independent`, because "recording the fact is
   honest; advertising it as a pass is not" - is stronger than a green badge would be.
2. **A gate on the ASSESSMENT, not the candidate** (`devcase-probe-audit.ts:109-123`). A case
   whose covert probes cannot discriminate is refused publication with a 422 unless an
   explicit override is passed, and the override is written into the audit trail. Every rival
   gates the candidate; this gates whether the test is worth giving.
3. **Cohort probe-miss calibration** (`devcase-cohort.ts:1-10`): "a probe the entire field
   walks past is usually a MISCALIBRATED case ... not five weak candidates in a row."
4. **The intersection itself.** HackerRank does the in-product-AI-as-evidence half (SaaS
   only); Scorix/Judge0 does the self-hosted half (no AI channel at all). A candidate-facing
   AI channel whose transcript is graded, inside a single-tenant Docker install, is matched
   by neither. A fifth, smaller one: non-adverse automatic feedback to non-promoted
   candidates, written in the candidate's own language with an explicit note when the
   evaluator's bullets are in another one (`devcase-feedback.ts:38-47, 98-101`) - though it
   is weakened by the recruiter never seeing the letter's words before it is queued
   (`evidence/surface.md:90-94`).

## Sources

- https://www.hackerrank.com/writing/hackerrank-ai-ide-vs-standard-coding-assessment-platforms (fetched directly, 2026-09-22)
- https://codesignal.com/cheating-and-fraud/ (search-result synthesis, 2026-09-22)
- https://interviewco.ai/blog/how-interview-anti-cheat-works (search-result synthesis, 2026-09-22)
- https://www.hackerrank.com/writing/best-coding-assessment-tools (search-result synthesis, 2026-09-22)
- https://dev.to/mickyarun/we-built-an-open-source-coding-exam-platform-because-every-vendor-let-us-down-a7m (search-result synthesis, 2026-09-22)
- https://github.com/judge0/judge0 (search-result synthesis, 2026-09-22)
