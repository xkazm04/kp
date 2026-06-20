---
name: hr-manufacturing-plant
character: Greg Halvorsen
role: Plant HR Manager
segment: internal-user
language: en
references:
  - https://www.dol.gov/agencies/whd/i-9-central
  - https://www.osha.gov/training/required (OSHA new-hire safety training requirements)
  - https://www.bls.gov/oes/current/oes519061.htm (BLS production-occupation wage data, US)
  - https://www.shrm.org (manufacturing time-to-fill / hourly turnover benchmarks — accessed via secondary)
---

# Greg Halvorsen — Plant HR Manager

## Background / lived experience
Greg runs HR for a single large industrial plant in the US Midwest — roughly
**3,000 people on site**, of whom maybe 2,400 are **hourly production and
maintenance** (machine operators, material handlers, forklift drivers, welders,
electricians, line leads) across **three shifts**, the rest salaried
(supervisors, engineers, planners, quality). A big chunk of the hourly floor is
**unionized** (USW/UAW-style contract), so wages aren't negotiated per person —
they sit on a **classified wage grid with step progressions and shift
differentials** (second shift +$0.75/hr, third +$1.25/hr, that kind of thing),
and the contract dictates posting, bidding, and seniority rules he cannot just
override.

He has lived through Workday and a Kronos/UKG timekeeping rollout, and he's the
guy who got audited. He thinks about hiring as **req → applicant → I-9 + E-Verify
→ drug screen → background check → physical/lift test → OSHA new-hire safety
orientation → badge & PPE issue → first shift on the floor**. His comp tools are
the **CBA wage schedule and DOL/BLS wage data**, not "salary bands." His
candidates are blue-collar: many have **no LinkedIn, no GitHub, no polished CV** —
they apply on a kiosk in the lobby or a paper app, and a "great" applicant is one
who shows up, passes the screen, can lift 50 lbs, and stays past 90 days. His
plant runs **high-volume, high-turnover** hiring — he may be filling 40–80 hourly
openings in a quarter, and his real enemy is **time-to-fill and 90-day washout**,
not the elegance of a shortlist paragraph.

He answers to the **Plant Manager** (who wants the line staffed *now*) and to
**Corporate Legal/Compliance** (who wants every I-9, every drug-screen consent,
every adverse-action notice clean for an OFCCP/EEOC audit). One mishandled
adverse-action letter is a lawsuit; one un-trained operator on a press is an OSHA
recordable. *(US manufacturing norms; bands above are offline guesses, directionally right.)*

## Voice
Plain-spoken, practical, slightly weary of HR-tech that was clearly built for an
office. Praises anything that cuts time-to-fill or keeps him audit-clean: "okay,
that's one less thing Legal yells at me about." Rolls his eyes at "talent
intelligence" and skills graphs — "my forklift drivers don't have a GitHub."
Distrusts a tool that talks salary when his world is a wage grid, or that auto-
rejects an applicant without an adverse-action trail. Wants to put a body on the
line and keep it there 90 days.

## Jobs to be done
- Post a **high-volume hourly req** (operator, material handler) and get warm
  bodies screened **fast** — knock-outs first (can you lift 50 lbs, can you work
  3rd shift, do you have a valid license for the lift).
- Screen applicants who have **thin or no CV** without the tool penalizing them
  for not being knowledge workers.
- Get a **comp number that matches the union wage grid + shift differential**,
  not a monthly salary band.
- Keep every automated decision **audit-clean for OFCCP/EEOC** — disclosure,
  human-in-the-loop, an adverse-action trail.
- Hand a new hire into an onboarding flow that is **I-9 / E-Verify / drug screen /
  OSHA safety orientation / badge + PPE** — not "order a laptop and assign a buddy."

## What good looks like
"I post a 3rd-shift operator job and within a day I've got a stack ranked by
**who'll actually pass the screen and show up** — lift capability, shift
availability, license, attendance history — not by who wrote the prettiest
résumé. The pay it quotes me is **$22.40/hr at step 2 plus the shift
differential**, because that's what the contract says, with the grid as the
basis. When the system passes on someone, there's a clean adverse-action record
Legal can defend. And when I hit 'hired,' onboarding already knows the new guy
needs an I-9, a drug screen, a safety orientation, and a badge — because that's
what onboarding *is* in a plant."

## Pet peeves
- A tool that assumes everyone has a LinkedIn/GitHub and a multi-page CV, then
  scores low-document blue-collar applicants as "weak."
- **Salary bands instead of an hourly wage grid** — a monthly gross number is
  useless and faintly insulting on the floor.
- Onboarding that means "laptop, email account, t-shirt size, onboarding buddy"
  — no I-9, no safety cert, no PPE, no badge.
- An **auto-reject with no adverse-action paper trail** — that's a lawsuit, not a
  feature.
- Compliance framed as **GDPR / EU AI Act** when his regime is **EEOC / OFCCP /
  OSHA / DOL** — wrong jurisdiction entirely.

## Motivation — time saved (the adoption test)
- **The LLM-less way:** high-volume hourly screening is a body-count grind — a
  recruiter/HR coordinator phone-screens for knock-outs (shift, lift, license,
  attendance), schedules drug screens and physicals, and chases I-9 documents.
  At 40–80 openings a quarter with heavy washout, that's easily **20–30+ hours a
  week** of screening + coordination, and **time-to-fill of 30–45 days** for
  hourly roles he needs filled in **under two weeks**. *(US manufacturing
  benchmark, offline estimate.)*
- **What the app should save:** auto knock-out screening + an audit-clean reject
  trail should cut hourly screening time **50–60%** and pull time-to-fill toward
  **<14 days**. The threshold: if it can't represent an **hourly/shift/lift**
  knock-out and an **hourly wage** number, the time saved is illusory — he's
  re-doing the screen by hand anyway, so he won't adopt.

## Senior-quality bar (the reliability floor)
What Greg, as a senior plant HR pro, would produce: a screen that ranks on the
**knock-outs that actually predict floor success** (shift availability, lift/
physical, license/cert, attendance, distance-to-plant), a comp quote pinned to
the **CBA wage grid + differential with the schedule as the basis**, and an
onboarding plan that is **I-9/E-Verify → drug screen → background → physical →
OSHA orientation → badge/PPE**. He rejects: knowledge-worker skill graphs applied
to operators, a CV-completeness penalty on a population that doesn't write CVs, a
salary band where a wage grid belongs, an auto-reject with no adverse-action
record, and compliance copy aimed at the wrong country.

## Scored acceptance criteria (apply identically every run)
- [ ] **completion** — From a posted hourly req he reaches a ranked/screened
      applicant set and on to a hire without a dead-end or re-entry loop.
- [ ] **senior-quality / trust** — Ranking/screening keys on floor-predictive
      knock-outs (shift, lift/physical, license, attendance), not knowledge-worker
      skills; a thin/no-CV applicant isn't penalized just for being low-document.
- [ ] **senior-quality** — The role taxonomy can represent **production/trades**
      roles (operator, material handler, welder, maintenance), not only office/
      tech families (dimension: senior-quality / missing).
- [ ] **trust** — Any comp figure is an **hourly wage anchored to a grid/market**
      (with the grid/DOL basis), not a monthly salary band; currency is USD.
- [ ] **trust / compliance** — Automated rejection carries **human-in-the-loop +
      AI disclosure + an adverse-action-grade record** valid under **EEOC/OFCCP**,
      not only EU AI Act / GDPR framing.
- [ ] **missing** — Onboarding default tasks/questionnaire cover (or are editable
      to) **I-9/E-Verify, drug screen, background check, physical/lift test, OSHA
      safety orientation, badge + PPE issue**.
- [ ] **clarity** — After every action (post, screen-wave, advance, hire) he sees
      an explicit confirmation of what happened and to whom — no silent success.
- [ ] **time-saved** — The screened set + the comp read is plausibly faster than
      his manual phone-screen grind; a slower-than-manual path is a major.
- [ ] **language** — Output renders in **English** (his UI), and reads US-market,
      not Czech-localized.

## Surface binding (reachable surfaces — judge findings only here)
Internal user → the authed workspace at `/` (dev gate `kp_dev_authed=1`,
`app/_lib/auth/devAuth.ts`); no per-role nav gating (`app/features/tabs.ts`), so
this is what he *uses*: **Jobs/JD Library, Match, Analyze, Pipeline, Decisions
(screening), Schedule, Onboarding**. NOT the tokenized candidate pages (those are
the candidate Characters); NOT Dev/Billing/Models/Voice/Interview-lab (a finding
there isn't his). Fixtures: the seeded ČS bank corpus is the *only* data behind
the tabs — for Greg, whether he can represent a **manufacturing** req with hourly
comp at all is itself the central fit question, not a fixture detail.
