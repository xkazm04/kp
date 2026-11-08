# Keyless rating: hiring with no LLM key

A workspace with no provider configured can take a real candidate from a job ad to Hired.
The rating is made **by hand**: a recruiter files the human interview scorecard, and that
scorecard is the basis for the offer. No AI score or rating is fabricated, and a human
rating is never presented as AI output.

Proven by `e2e/journey-job-to-accept.spec.ts`, which walks the path through the UI with
`KP_OFFLINE=1`.

## The path

| Step | Door | Keyless behaviour |
| --- | --- | --- |
| Job ad to job | Jobs tab, Import position (`POST /api/jobs/ingest`) | Deterministic parse (`source: "deterministic"`) |
| Publish | `POST /api/jobs/[id]/publish` | No model involved |
| Application | `/apply/[id]` or `/apply/[id]/quick` | Quick apply files an entry with no analyzed profile |
| Rating | Candidate modal, **Prep & scorecard** (`POST /api/interview-prep/scorecard`) | The person's own ratings and verdict; raises `scorecard_review` |
| Offer draft | Candidate modal, **Draft offer by hand** (`draft_offer` on `POST /api/pipeline/[id]`) | Figure typed by the recruiter, else the job's band midpoint (`normalizeSalaryBand`), else none |
| Send | Decisions, Send offer (`offer_review` accepted, `extendDraftedOffer`) | Unchanged; `offer-policy` validates the terms |
| Accept | `/offer/[token]` (`POST /api/offer/[token]`) | Entry moves to Hired |

## Why this path

Tracing a real entry keyless found two dead ends, both behind doors that worked on their own:

1. **The scorecard form had no way in on the default plan.** The Schedule tab opens it only
   from its human-round branch, and the shipped plan runs an AI round alone. The door now
   lives on the candidate modal's action bar for any active candidate on an interview step.
2. **A candidate with no analyzed profile could not be prepared or offered.** The prep and
   offer automation tasks refuse them (`AUTOMATION_ENTRY_NO_PROFILE`). A rating now files
   without a generated plan: the first save creates a minimal pack (`source: "human_only"`,
   no questions, no model output). An offer can be drafted by hand.

The `/api/sim` offer doors stay closed to real entries: they guard offer capability tokens.
A hand draft stops at the same `offer_review` approval as an AI draft, so a person still
extends every offer. It writes no `offer_drafted` event, because the decision log attributes
that kind to automation.

## What a keyless user does not get

- No AI screening verdict, voice interview, synthesized scorecard or role-run rating. The
  role-run scorecard stays `unrated` without a sealed session.
- No tailored interview plan. A candidate with a profile gets a template run-of-show,
  disclosed as a fallback. A candidate without one gets only the rubric form.
- No tailored offer letter or fit-scaled figure on a hand draft: a template letter with no
  salary in its text, and the band midpoint unless the recruiter types a figure. With no
  band on the job and no typed figure the draft is unpriced; no number is invented.

## Known gaps

- A failed Generate in the prep modal returns to the empty state without saying why.
- A human scorecard still writes an `interview_scorecard` event, which the decision log
  attributes to automation.
