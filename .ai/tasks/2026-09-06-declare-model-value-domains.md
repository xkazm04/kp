---
kind: task
status: first-step-landed
opened: 2026-09-06
run: intake-acestep-0906
registry_subject: software-engineering/llm-agent/prompt-and-context/structured-output
registry_technique: enumerable-domain-decoding
size: 6-9 files, ~120-180 lines net
gate: py -m unittest pipeline.jobfit.tests.test_decoder_domain_gap; npm run schemas:check
measurable: declared-domain fields in the exported analysis schema (1 of 153 today) and imperative domain repairs in the pipeline (17 today)
---

# Declare the model's value domains where both boundaries can read them

## The state today, measured

`py -m pipeline.jobfit.decoder_domain_gap` reports:

```
exported fields            153
with a declared domain     1 (0.7%)
repaired in code           17
```

The one declared domain is `KeywordHit.status`, and it is declared only
incidentally — as an `anyOf` union that happens to carry an enum. Every other
value domain in the analysis contract is enforced imperatively: `confidence`
clamped to 0-100 at `pipeline/jobfit/automation.py:909`, `scope_rung` clamped
into 0..2 by a validator at `pipeline/jobfit/appmaster.py:165-173` (and again
at `:672-682`), `potential_score` by a validator at
`pipeline/jobfit/matching.py:126`, probabilities at
`pipeline/jobfit/calibration_drift.py:65`, and thirteen more.

## Why that shape has a cost

The analysis contract is already written twice — the Pydantic models, then the
TypeScript emitted from them by `pipeline/jobfit/codegen.py:153`. The *shape*
crosses that boundary. The *value domains* do not, because they live in
expressions rather than in field declarations. Two consequences:

1. **The producer is never told the bound.** `response_schema` appears zero
   times in this repository. Every model call sets `response_mime_type` only
   (`pipeline/jobfit/gemini.py:452-453`), so the model is asked for JSON syntax
   and nothing about the ranges. The clamps exist because the model returns
   out-of-domain values, and the model returns them because nothing told it
   the domain — the loop is closed and nobody is holding the end that would
   open it.
2. **The TS side cannot narrow either.** A domain in a clamp cannot become a
   union type or a branded number, so the same check is written a fourth time
   in TypeScript or not at all.

A clamp is also the weakest available response. It silently substitutes a
plausible value for an implausible one, which means a model that has genuinely
misunderstood the task produces a boundary value that reads as a real
judgment. `appmaster.py:678` is the honest form — it clamps *and* records the
clamp in `notes` — and it is the minority.

## The work

**Step 1 (LANDED).** `pipeline/jobfit/decoder_domain_gap.py` plus
`pipeline/jobfit/tests/test_decoder_domain_gap.py` (13 tests, green). The
instrument counts the three figures above so the rest of this item has a
number to move, and so a regression is visible. It asserts a known-present
clamp rather than trusting an empty scan.

**Step 2.** Lift the domains into the field declarations, model by model, on
the fields the pipeline already repairs. `Field(ge=0, le=100)` for the score
and confidence fields, `Literal[0, 1, 2]` for `scope_rung`, `Field(ge=0.0,
le=1.0)` for the probabilities. The validators stay where they carry a *reason*
beyond the bound; the ones that only clamp become redundant and are removed in
step 4, not here. Re-run `npm run schemas:check` — the generated TS changes,
and that diff is the point.

**Step 3.** Send the schema. Thread a `response_schema` through
`pipeline/jobfit/gemini.py` beside the existing `response_mime_type`, built
from the same Pydantic model the caller is going to parse into. Respect the
existing shed: `schema_enforced` already reports when grounding drops the
mime-type constraint (`gemini.py:443-451`), and the response schema contends
for the same surface — so it is shed together with the mime type and the
existing flag already names it. Do not add a second flag.

**Step 4.** Turn the surviving clamps into assertions. A domain enforced at the
decoder should make its clamp unreachable; a clamp that still fires is now
evidence the schema was shed or ignored, which is worth a log line rather than
a silent substitution. Convert them to a recorded refusal in the
`appmaster.py:678` style, and delete the ones whose domain is now declared and
enforced.

## The measurable, and what would falsify this

`declared` rises from 1 toward the count of genuinely bounded fields;
`repairs` falls. The instrument prints both, and
`test_reports_a_nonzero_gap_today` becomes the regression guard once the gap
closes.

**What would make this work wrong:** if the model's out-of-domain rate is
already near zero, the clamps are dead code and steps 2-4 buy nothing but
churn. That is measurable before step 3 and should be measured: count how
often each clamp actually changes its input on recorded analyses. If a clamp
has never fired on real traffic, the honest outcome is to delete it and
declare the domain for the TS boundary's sake alone — a smaller item than this
one, and this plan should shrink to it rather than proceed as written.

**What is out of scope.** This does not change any score, weight or threshold,
and no clamp's numeric bound moves. A domain that is currently wrong stays
wrong and is a separate item; this one only moves where the domain is written.
