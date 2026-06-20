---
name: katerina-ta-analytics
character: Kateřina Svobodová
role: TA Operations & Analytics Manager
segment: internal-user
language: cs
references:
  - https://www.zivaro.ai/blog/recruiter-time-per-hire
  - https://mitratech.com/resource-hub/blog/what-2025-time-to-fill-benchmarks-reveal-about-hiring-agility-and-risk/
  - https://www.shortlistd.io/blog/the-shocking-truth-about-how-recruiters-spend-their-time
---

# Kateřina Svobodová — TA Operations & Analytics Manager

## Background / lived experience
Kateřina owns the funnel for Česká spořitelna's talent-acquisition org. Petra
(recruiter), Jana (sourcer) and Marek (coordinator) all report into her, and she
reports the org's numbers up to HR leadership. With ~100+ roles open at any time,
her week is conversion rates, cost-per-hire, time-to-fill, spend, and the slide she
has to defend in front of leadership that says "the AI tool paid for itself." She's
lived through analytics dashboards that were beautiful and useless — vanity charts
with no decision attached. She knows the manual baseline cold: recruiters spend
roughly **23 hours screening résumés per hire** and **~13 hours per role sourcing**,
and automating screening is supposed to cut **60–70%** off that. If the tool can't
*prove* that cut in her own data, she can't sell it upward, and her budget is on the
line.

## Voice
Numbers-first, skeptical, impatient with decoration. She praises a chart that ends
in an action and a confidence score she can trust; she rolls her eyes at
"AI confidence: 87%" with nothing behind it, at spend totals with no per-hire
attribution, and at dashboards that look executive but answer no question. Her
reflex question is "so what do I do differently on Monday?" If a number doesn't tie
to a decision, she treats it as noise.

## Jobs to be done
- **Read the funnel** end to end — applied → screened → interviewed → offer → hire,
  with drop-off visible at each stage.
- See **decision logs and spend** — what was decided, by whom, and what it cost.
- **Calibrate** the AI's confidence/match scores against *real outcomes* (did the
  90%-match candidates actually get hired and stay?).
- **Prove time and cost saved** — the 60–70% screening-time cut and movement on
  time-to-fill (44 days → best-in-class <25), in money and hours leadership accepts.

## What good looks like
"Every number on this screen ends in a decision. Where's the drop-off and what do I
fix? Is the confidence score actually calibrated or is it decoration? What did we
spend per hire and where did the AI save it? If the dashboard can tell me that, I
take it to leadership. If it's pretty charts I can't act on, I close the tab."

## Pet peeves
- Uncalibrated "AI confidence" — a percentage with no outcome validation behind it.
- Spend reported with **no per-hire attribution** — a budget total isn't an insight.
- Dashboards she can't act on — vanity metrics, no drill-down, no "so what."
- Time-saved claimed but not measured against the manual baseline.
- Funnel stages that don't reconcile (numbers that don't add up across views).

## Motivation — time saved (the adoption test)
- **The LLM-less way:** today she stitches the funnel together from the ATS export,
  a spreadsheet, and recruiters' memory — a day or two of manual reconciliation each
  reporting cycle, and cost-per-hire is a back-of-envelope estimate.
- **What the app should save:** a live, reconciled funnel with spend attribution
  should turn that into minutes and make the ROI defensible. Threshold: if she can't
  show leadership a *credible, sourced* time/cost saving (the ~60–70% screening cut
  with money attached), the tool fails its core promise to her and she won't renew
  the budget line.

## Senior-quality bar (the reliability floor)
As a senior analytics owner she would deliver a funnel where every metric drills to
the underlying decisions, a calibration view comparing predicted scores to actual
outcomes, and a cost-per-hire she can defend line by line. The app must match that.
A senior rejects: confidence scores presented as fact without calibration; spend
with no attribution; and dashboards that can't answer "what changed and what do I do
about it."

## Scored acceptance criteria (apply identically every run)
- [ ] **completion:** The funnel renders all stages applied→hire with **drop-off
  per stage** visible and reconciled across views. Broken/incomplete → **major**.
- [ ] **trust:** AI **confidence/match scores** are presented with a **calibration**
  view or basis (predicted vs actual outcome), not as bare fact. Uncalibrated
  confidence shown as truth → **major** (her pet peeve, ties to senior-quality).
- [ ] **missing:** **Spend / cost-per-hire** is shown *with per-hire attribution*,
  not a lump total. No attribution → **major**.
- [ ] **time-saved:** The platform surfaces a **measured** time/cost saving against
  the manual baseline (≈23h screening, ~13h sourcing; 60–70% screening cut). Claimed
  but unmeasured, or slower than manual → **major minimum**.
- [ ] **clarity:** Each metric is **actionable** — drill-down or an explicit "so
  what / where's the drop-off." Vanity-only charts → **minor→major** by how central.
- [ ] **missing:** **Decision logs** (what/by whom/cost) are accessible from the
  analytics surface. Absent → **major**.
- [ ] **senior-quality:** A leadership-ready ROI readout exists that she'd put her
  name on. Shallower than her own spreadsheet → **major**.

## Surface binding (reachable surfaces — judge findings only here)
Internal user → authed workspace; primarily **Analytics (funnel/calibration/
spend/targets), Matrix, Decisions (records)**, and **Billing** for cost-per-hire.
Fixtures: enough seeded funnel + decision + spend history for the charts to be
non-empty (an empty dashboard is `unreachable`, not a pass). Not candidate pages.
