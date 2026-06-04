# Graduate-friendliness score

`graduate_friendliness` (in `JobEntryProfile`) is a deterministic, LLM-free score
in `[0, 1]` produced by `compute_entry_profile` in `pipeline/jobfit/jobs.py`. It
estimates how realistically a zero-experience student/graduate could land a given
role, and it **directly orders the opportunities an early-career candidate is
shown**. Because that ranking is sensitive (a quiet tweak changes which jobs
students see), every constant below is justified here and pinned by golden-value
tests in `pipeline/jobfit/tests/test_jobs.py` (`GraduateFriendlinessGoldenTest`).

## Inputs

`seniority`, `employment_type`, `min_years` (the ad's required years, may be
absent), the structured `requirements` (each `kind` = `must_have | nice_to_have`,
`hardness` = `prerequisite | learnable`), and the free-text `description`.

## Derived values

- **Assumed years when the ad omits a number.** `min_years` defaults to `0.0`
  for a `junior` title and `3.0` for any non-junior title. Rationale: a "junior"
  ad already declares no experience is needed; a non-junior ad that states no
  number implies a few years by market convention. `3.0` is deliberately chosen
  to land in the ">2 years → no credit" band (see below), so an ad that says
  nothing earns **no** free years-credit rather than being optimistically scored.
- **`entry_signal`.** True when the description contains early-career language
  (CZ + EN: `junior`, `graduate`/`absolvent`, `mentor`, `training provided`,
  `bez praxe`, …) or the employment type looks like `intern`/`trainee`/`working
  student`. An ad that explicitly welcomes beginners is self-declaring openness.

## Eligibility gate (`is_entry_eligible`)

```
is_entry = seniority == "junior"  OR  years <= 1.0  OR  entry_signal
```

This is the candidate-facing gate. **`years <= 1.0`** is the threshold below
which a graduate is a realistic applicant — at most ~one year wanted reads as
"no real experience required". A `junior` title or explicit early-career language
also opens the gate regardless of the stated years.

## Score (additive, then clamped)

| Signal | Weight | Why |
| --- | --- | --- |
| `seniority == "junior"` | **+0.5** | The strongest, clearest invitation — a junior title is the most direct signal a graduate can apply. |
| `seniority == "medior"` | **+0.2** | Mid roles sometimes flex down for a strong graduate, but far less reliably than a junior posting. `senior`/`lead` get nothing. |
| `years <= 1.0` | **+0.2** | ≤1 year ≈ "no real experience needed" — full credit. |
| `1.0 < years <= 2.0` | **+0.1** | A 2-year ask is a stretch a strong graduate can sometimes meet — half credit. (`> 2` years earns nothing.) |
| learnable must-haves | **+0.2 × (learnable / all must-haves)** | A role whose hard requirements are teachable on the job is more graduate-accessible. Scaled by fraction: an all-prerequisite role scores 0 here; an all-learnable role gets the full 0.2. |
| `entry_signal` | **+0.2** | The ad literally invites early-career candidates. |

The raw sum (max 1.1) is `min(1.0, …)` then rounded to 2 decimals.

## Non-entry ceiling

```
if not is_entry:  score = min(score, 0.15)
```

Even when some sub-scores fire (e.g. a senior ad with learnable must-haves), a
role that is **not** entry-eligible must never read as graduate-friendly. Capping
at **0.15** keeps it visibly low so students are not lured into roles they cannot
realistically land, while staying `> 0` so relative ordering among non-entry
roles is preserved.

## Worked examples (these are the golden tests)

| Case | seniority | years | must-haves | ad language | → score | entry? |
| --- | --- | --- | --- | --- | --- | --- |
| Junior, welcoming | junior | 0 | 1 of 2 learnable | "graduates · mentoring" | **1.0** | yes |
| Medior, no number, plain ad | medior | 3 (assumed) | 1 of 2 learnable | none | **0.15** | no (capped) |
| Medior, ≤1y required | medior | 1 | 1 of 2 learnable | none | **0.50** | yes |
| Senior-only | senior | 5 | 0 of 1 learnable | "seasoned engineer" | **0.0** | no |

Junior: `0.5 + 0.2(years) + 0.1(½ learnable) + 0.2(signal) = 1.0`.
Medior/plain: raw `0.2 + 0.1(½ learnable) = 0.3`, but not entry → capped to `0.15`.
Medior/≤1y: `0.2 + 0.2(years) + 0.1(½ learnable) = 0.5`, entry via `years ≤ 1`.
Senior: no seniority/years/learnable/signal credit → `0.0`, not entry → stays `0.0`.
