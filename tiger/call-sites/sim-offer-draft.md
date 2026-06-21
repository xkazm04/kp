---
id: sim-offer-draft
type: tiger/call-site
modality: none
file: app/api/sim/offer-draft/route.ts:11-37
wrapper: n/a — DETERMINISTIC, no LLM
provider: none  model: none
schema: n/a (literal object, persisted via setApproval)
grounding: n/a
quality_score: "—"  code_score: 5
recommended_model: "—"
status: assessed
last_scanned: 2026-06-20
characters: ["[[eva-eng-hiring-lead]]", "[[helena-buyer]]"]
---
## What it does
Offer draft for the guided keyless simulation. **Not an LLM call site** — by explicit design (route.ts:8-10: "Deterministic offer draft for the simulation spine — NO LLM … so the keyless run doesn't depend on the Claude CLI offer task"). Salary = job band midpoint, subject/body are string templates, writes an offer_review approval the recruiter then extends (18-33).

## Prompt & grounding
No prompt/model/grounding. The "rationale" string "Salary positioned at the role-band midpoint, scaled by fit." (31) is a static literal — but the math is a pure midpoint (22-23) with no fit input, so the copy slightly overstates the code.

## Code quality (wrapping · logging · caching)
Clean for what it is. Validates entryId (13-14), 404s a missing entry (16), sanitizes the salary band through normalizeSalaryBand (swaps reversed range, rejects non-finite/non-positive, falls back to demo defaults). Errors via jsonError. Hardcoded "CZK" (28) — the known industry-lock, irrelevant to LLM plumbing. No wrapper concerns (no model).

## Findings
- [value] **LOW — rationale copy overstates the logic** (31). Says "scaled by fit" but the value is a plain midpoint. Small trust ding if surfaced. Fix: drop "scaled by fit" or actually weight the midpoint by fit.
- [code] **INFO — correctly NOT an LLM call.** No wrapper action. CZK hardcoded (28) is the industry-lock, out of scope here.
