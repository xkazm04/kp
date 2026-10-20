---
id: "0016"
title: A dev_audit row records the outcome and the outcome key, never a candidate label
status: accepted
date: 2026-10-07
supersedes: []
superseded-by: null
tags: [compliance, erasure, audit, candidate-data]
sources:
  - app/_lib/db/pipeline.ts
  - app/_lib/dev-control.ts
  - app/_lib/offer-finalize.ts
  - app/api/devcase/outcomes/route.ts
  - app/_lib/dev-audit-no-candidate-label.test.ts
  - app/_lib/erasure-full-scrub.test.ts
---

## Context

Two duties pull against each other on one table. `dev_audit` is the control
room's decision log: who decided what, and when, with the outcome, performance
and prediction in `reason`. An erasure request (GDPR Art. 17) obliges us to
remove a candidate's name from everything we hold about them, and
`anonymizeEntry` is the one door that does it.

Three writers put the candidate label first in `dev_audit.reason`: the outcomes
route (`POST /api/devcase/outcomes`, which wrote `candidateRef`), the reject
auto-record in `actOnPipelineEntry`, and the accept auto-record in
`respondToOffer` (`offer-finalize.ts`). No erasure path reached `dev_audit`, so
a name survived an erasure in a table nobody had listed as a home for it. The
council's robustness lens found it (the test header says "Council lite r1").

The constraint that forced a choice: the table must keep the record of the
control decision, so it cannot simply be emptied of a candidate's rows, and it
must not keep the name.

## Decision

**A `dev_audit` row records the outcome in `reason` and the `dev_outcomes` key in
`ref`. It never carries a candidate label.**

- The three writers now write `rejected (predicted N)`, `hired (predicted N)`, or
  `<outcome> (perf <p>)`, and set `ref` to the outcome key (a submission id or
  `pe:<entryId>`, via `hireOutcomeRef`; the route passes `outcome.ref`).
- `anonymizeEntry` (through `scrubEntryLinkedPii`, which now receives the
  entry's label) masks the label inside `reason` for rows whose `ref` is one of
  the erased refs, and for legacy rows with no `ref` whose `reason` begins
  `<label>:`. The row stays; the name goes.
- The legacy match is deliberately not workspace-scoped: the unattributed
  writers stamp the default workspace whatever tenant the hire was in, so a
  tenant filter would miss them. Masking a same-named candidate's reason as well
  is the safe direction (code comment in `pipeline.ts`).
- `recordAudit`'s catch now logs `[dev-control] audit write failed` instead of
  swallowing. It still does not throw: audit must never break the pipeline, but a
  lost decision record is one an operator acts on.

## Alternatives considered

1. **Delete the candidate's `dev_audit` rows on erasure.** Loses who decided what
   and when, which is the table's purpose. The code comment says the audit is
   "DE-IDENTIFIED, never deleted: ... a name is not part of [the decision
   record]". Whether a specific legal basis was weighed for this table is **not
   recorded**; the compliance README states the trail is retained.
2. **Hash or pseudonymise the label in `reason`.** **Not recorded.** Neither the
   commit, its tests nor the compliance README mention it. What the record does
   show is the chosen alternative: keep no label at all, so nothing needs
   un-hashing or masking for new rows.
3. **Mask on erasure only, leaving the writers alone.** Rejected in effect: the
   commit does both halves ("the writers stop recording the label ... and
   anonymizeEntry de-identifies what is already there"). A reason beyond that is
   **not recorded**.

## Consequences

- **The rule for any new `dev_audit` writer:** `reason` carries the outcome and
  no candidate label, name, contact or free text a candidate authored; a row
  about a candidate sets `ref` to the `dev_outcomes` key so erasure can find it.
  A change can be checked by asking whether `reason` interpolates a label, and
  whether `ref` is the key `anonymizeEntry` collects (submission ids plus
  `pe:<entryId>`).
- **Erasure rewrites audit rows.** They are masked, not deleted; the chain of
  decisions stays readable without the person.
- **Legacy rows are masked by prefix only.** A legacy row whose label is not the
  leading text of `reason` is not found. The tests cover the leading-label shape.
- **The legacy match can over-mask** a same-named candidate's reason, by choice.
- **A lost audit write is now visible** in the server log, still not fatal.
- Pinned by `dev-audit-no-candidate-label.test.ts` (each writer driven for real
  against a throwaway DB) and `erasure-full-scrub.test.ts`. Described in
  `docs/features/compliance/README.md`.

## What would change our mind

- **A regulator or customer needing the name in the audit trail** for a
  legal-claims purpose; that would be a retained, access-controlled field with its
  own retention clock, not a label in free text.
- **A `dev_audit` writer whose subject has no `dev_outcomes` key.** `ref` could
  not point erasure at it, and the table would need its own entry or candidate
  key.
- **A finding that legacy rows hide the label anywhere but the start of `reason`**,
  which would make the prefix match leak and call for a wider scrub.
