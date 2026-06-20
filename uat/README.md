# uat/ — Simulated UAT overlay for **kp**

This is the **per-app overlay** for the portable `/uat` engine
(`.claude/skills/uat.md`). The engine is stack-agnostic; everything app-specific
— routes, run recipe, auth, seed, language, the Characters and journeys — lives
here.

**What `/uat` does:** evaluative (not verification) testing. Representative
**Characters** (durable, repo-committed users with jobs-to-be-done) walk real
journeys and judge whether they could finish their job *and* whether it clears
their bar — through two chronological certification levels:

- **L1 — theoretical** (over a code-derived surface model; cheap, mass-parallel, no browser).
- **L2 — empirical** (real browser against the live app; serial, long-running).

Each Character judges through a **consistent lens** (its own scored criteria),
adding two dimensions to the classic five: **time-saved** (vs the LLM-less way)
and **senior-quality** (output ≥ what this person would produce as a senior).

## Layout

```
uat/
  README.md            # this file — templates, roster, journey index, research digest
  env.md               # run recipe, ports, auth, seed, language (THE per-app file)
  rubric.md            # the 7-dimension evaluation lens + severity + finding types
  characters/*.md      # the 10 durable users
  journeys/*.md        # goals (NOT scripts) + user-POV definition-of-done
  accepted-gaps.md     # baseline of known-and-accepted issues
  driver/drive.mjs     # portable L2 browser driver
  runs/<date-slug>/    # journals, findings.json, report.md (+ gitignored shots/)
```

## Run it

```
/uat run --l1                 # cheap broad theoretical sweep across all Characters
/uat run                      # full L1 → L2 on survivors
/uat run --surface /          # scope to the workspace dashboard
/uat run jd-to-shortlist      # one journey, all its Characters
/uat update                   # diff-aware refresh after code changes
/uat promote <journey>        # freeze an L2-pass journey into an acceptance gate
```

See `env.md` for the dev server / port / auth / seed / language specifics, and
**resolve its "Open env questions" before relying on L2.**

---

## Roster (10 Characters) — language: BOTH

Target group derived from the product itself: a **Czech retail bank's talent-
acquisition org** (seeded to **Česká spořitelna** / Erste Group), plus the
**candidates** it hires and the **economic buyer** who'd adopt it. Internal bank
users operate in **Czech**; the external buyer + the international dev candidate
operate in **English** (this also exercises the bilingual switch).

| # | File | Character | Role | Lang | Primary journeys |
|---|---|---|---|---|---|
| 1 | `petra-recruiter.md` | **Petra Nováková** | Corporate Recruiter / TA Specialist (core daily user) | cs | jd-to-shortlist, cv-analysis-jobfit, pipeline-advance, voice-interview, offer-onboarding |
| 2 | `jana-sourcer.md` | **Jana Horáková** | Senior Sourcer / Talent Researcher | cs | sourcing-rediscovery, jd-to-shortlist |
| 3 | `marek-coordinator.md` | **Marek Beneš** | Recruiting Coordinator / Screening Ops | cs | screening-decisions, interview-schedule-prep, pipeline-advance |
| 4 | `tomas-hiring-manager.md` | **Tomáš Dvořák** | Hiring Manager (line manager, retail/ops) | cs | group-eval-fairness, interview-schedule-prep, offer-onboarding |
| 5 | `eva-eng-hiring-lead.md` | **Eva Marešová** | Engineering Hiring Lead (dev-extension owner) | cs | dev-case-hire, cv-analysis-jobfit |
| 6 | `lucie-dpo-compliance.md` | **Lucie Procházková** | DPO / Fairness & Compliance Officer | cs | screening-decisions, group-eval-fairness, analytics-calibration |
| 7 | `katerina-ta-analytics.md` | **Kateřina Svobodová** | TA Operations & Analytics Manager | cs | analytics-calibration, jd-to-shortlist |
| 8 | `tereza-candidate.md` | **Tereza Králová** | Job candidate (Czech retail/branch role) | cs | candidate-apply-status, voice-interview, offer-onboarding |
| 9 | `sam-dev-candidate.md` | **Sam Okafor** | International senior software-engineer candidate | en | dev-case-hire, candidate-apply-status |
| 10 | `helena-buyer.md` | **Helena Bauer** | Head of Talent Acquisition (Erste/ČS) — prospect **buyer** | en | evaluate-and-buy, guided-simulation |

> Why this mix and not a generic roster: this is a *bank TA org buying an AI
> hiring platform under EU AI-Act constraints, hiring both branch staff and
> engineers, while candidates expect fast, human, transparent treatment*. Swap the
> domain and every Character changes — that's the point.

## Journey index (all `promotion: discovery` at init)

| File | Goal (one line) | Owners |
|---|---|---|
| `jd-to-shortlist.md` | Open/ingest a role → a ranked, reasoned shortlist of matching candidates | Petra, Jana, Kateřina |
| `cv-analysis-jobfit.md` | Analyze one CV vs a JD → extraction, salary gauge, job-fit, soft signals, verdict | Petra, Eva |
| `sourcing-rediscovery.md` | Find matches for a role, run an outreach campaign, rediscover past applicants | Jana |
| `screening-decisions.md` | Configure screening rules, run an AI screen-wave, reconsider, with a defensible decision record | Marek, Lucie |
| `group-eval-fairness.md` | Side-by-side group evaluation of a shortlist → a defensible, fair pick | Tomáš, Lucie |
| `pipeline-advance.md` | Move candidates across pipeline stages, open the drawer, advance to interview/offer | Petra, Marek |
| `interview-schedule-prep.md` | Send a self-scheduling invite → candidate picks a slot → prep pack + rubric | Marek, Tomáš |
| `voice-interview.md` | Run / review an in-browser AI voice first-round interview | Petra, Tereza |
| `offer-onboarding.md` | Generate → send → finalize an offer via the tokenized page → onboarding next step | Petra, Tomáš, Tereza |
| `candidate-apply-status.md` | Candidate applies (conversational/quick), tracks status, gets comms, consents to AI use | Tereza, Sam |
| `dev-case-hire.md` | Author a dev case from a role need → candidate does the live work → evaluate real signal | Eva, Sam |
| `analytics-calibration.md` | Review funnel analytics, decision logs, spend; calibrate scores vs outcomes | Kateřina, Lucie |
| `evaluate-and-buy.md` | Prospect lands on marketing/about/pricing → assesses credibility/ROI/compliance → decides to adopt | Helena |
| `guided-simulation.md` | Keyless guided JD→Hired demo as a first-touch "does this actually work" tool | Helena, Petra |

---

## Character template

Every `characters/*.md` follows this shape. The **scored acceptance criteria** are
the consistency harness — apply them identically every run.

```markdown
---
name: <slug>
character: <Full Name>
role: <job title>
segment: internal-user | candidate | buyer
language: cs | en
references: [<url-or-source>, ...]
---

# <Full Name> — <role>

## Background / lived experience
<Their history; tools they've used and been burned by; who they answer to; what's
at stake for them; the org context (Česká spořitelna / Erste, or candidate world).>

## Voice
<How they actually talk — register, what they praise, what makes them roll their
eyes. 2–3 lines so first-person feedback sounds like THEM, not generic.>

## Jobs to be done
- <JTBD 1> …

## What good looks like
<Their bar for a great outcome, in their words.>

## Pet peeves
<Specific things that make them distrust or abandon a tool.>

## Motivation — time saved (the adoption test)
- **The LLM-less way:** <how this job is done today, and how long it takes>
- **What the app should save:** <target — and the threshold below which they won't adopt>

## Senior-quality bar (the reliability floor)
<What output THIS person, as a senior in their role, would produce — the app must
match it. What a senior would reject.>

## Scored acceptance criteria (apply identically every run)
- [ ] <explicit pass/fail check 1 — tie to a dimension>
- [ ] <check 2> …

## Surface binding (the reachable surface set — judge findings only here)
<The exact surfaces THIS Character can reach, so a finding is never mis-attributed
to a Character who can't open it. fix *landed* ≠ fix *reachable* ≠ fix *unblocks
the job*. For kp specifically:>
- **Internal users** (recruiter/sourcer/coordinator/manager/eng-lead/DPO/analytics):
  the authed workspace at `/` and its tabs (`app/features/tabs.ts` — pipeline,
  channels, decisions, schedule, onboarding, jobs, library, profile, match,
  analyze, interview, dev, analytics, matrix, billing, models, workspace).
  Dev-gate on (`kp_dev_authed=1`); **no per-role nav gating exists** — so binding
  = the tabs this role actually *uses*, not what they're permitted. Name them.
- **Candidates** (Tereza, Sam): NOT the workspace — only the **tokenized public
  pages** (`/apply/[id]`, `/status/[token]`, `/schedule/[token]`,
  `/offer/[token]`, `/onboarding/[token]`, `/interview/[token]`,
  `/devcase/apply/[token]`). **Requires a minted token fixture** (see `env.md`).
- **Buyer** (Helena): the **public marketing** surfaces (`/landing`,
  `/landing/spark`, `/about`) + the **guided simulation** (keyless) + the Billing
  tab. Never the seeded internal data.
```

## Journey template

Goals, **not step scripts** — getting lost is a finding.

```markdown
---
name: <slug>
promotion: discovery        # discovery | candidate | acceptance | retired
surfaces: [<route or context>, ...]
characters: [<character-slug>, ...]
language: cs | en | both
---

# <Journey title>

## Goal (in the user's words)
<What the Character is here to accomplish.>

## Definition of done (user POV)
- <observable outcome 1 that means "I finished my job"> …

## Entry state / preconditions
<What must be true to start — seed/auth/token, per env.md.>

## What L1 must check (structural, code-grounded)
<Affordances/flow/grounding to verify in the surface model.>

## What L2 must confirm (live-only)
<l2_priority: actual output quality, latency, rendering, real-data behaviour.>

## Out of scope / known
<scope_note items — demo disclaimers, backlog, things in accepted-gaps.md.>
```

---

## Research digest (grounds the Characters — cite these in `references:`)

Gathered at init (2026-06-19) via web search; where offline, marked. Use these
numbers as the **time-saved** and **senior-quality** anchors.

### Target org — Česká spořitelna / Erste Group
- Large Czech retail bank, subsidiary of **Erste Group**; Erste has a *Global Head
  of Employer Branding & Talent Acquisition*. ČS runs its own recruiting ops and
  career site (kariera.csas.cz / csas.jobs.cz).
- Hiring volume: on the order of **~100+ open roles** at a time (one listing
  snapshot showed 105).
- **Process:** recruiting dept reviews all CVs → 1st interview (recruiter +
  manager) → 2nd round (meet the team **or a case study**) → sometimes a 3rd round.
  *(This maps directly to the app's screening → interview → group-eval → offer flow,
  and to the dev-case extension as the "case study" round.)*

### Time anchors (the time-saved baseline)
- **Time-to-fill:** US avg **44 days** (up 24% since 2021); good 30–45d;
  best-in-class **<25d**. Engineering **50–62d**; entry-level 30–60d.
- **Time-to-hire:** **28–35 days**; now **~20 interviews per hire** (up 42% from 14 in 2021).
- **Recruiter manual effort:** ~**23 hrs screening résumés per hire**
  (30–90s/résumé); **~13 hrs/role sourcing** (≈⅓ of the workweek); **40–51 hrs
  total per hire** manually. **Automating screening → 12–16 hrs (a 60–70% cut).**
  → *This is the headline time-saved promise the app must credibly deliver.*

### Competitor norms (what "good" looks like by domain)
- **Eightfold** — talent-intelligence, skills-based matching, build/buy/borrow.
- **SeekOut** — AI sourcing + vetted, interview-ready candidates; "hiring confidence".
- **HireEZ** — outbound at scale, 800M+ profiles, contact discovery; speed/volume.
- **Beamery** — skills gaps, role-vulnerability, labor-market insight, "Ray" assistant.
- Axis the buyer weighs: **speed/volume vs outcomes/confidence**. kp's edge is
  *reasoned, grounded, defensible* matching — so thin/sample-grounded output is an
  existential finding, not a polish item.

### Candidate experience (the external lens)
- **58%** expect a response within **1 week**, **75%** within **2 weeks**.
- **81%** say regular **status updates** would significantly improve their experience.
- **53%** have been ghosted; **61%** post-interview ghosting; **72%** say job
  search hurts their mental health (long cycles + inconsistent comms).
- Interview scheduling inside the **first week** = above-average experience.
  → *Comms cadence, status visibility, and scheduling speed are first-class
  acceptance criteria for the candidate Characters.*

### EU AI Act / GDPR (the compliance lens)
- AI that **ranks / filters / scores CVs = high-risk**. Compliance deadline
  **2 Aug 2026**. Requires **human oversight** (no solely-automated final
  decision), data governance, documentation, **transparency/disclosure to
  candidates**, and registration.
- **GDPR Art. 22** bars solely-automated significant decisions absent
  consent/contract/law. → *Maps to the app's consent/provenance/AI-disclosure +
  decision-audit + human-in-the-loop contexts; their absence is a blocker for the
  compliance Character.*

### Technical hiring in the AI era (the dev-extension lens)
- AI-generated applications **flood** inboxes; **71%** of eng leaders say AI makes
  coding skill **harder to assess**. Take-home cheating is trivial with LLMs.
- The skill that now matters is **human–AI collaboration** — assess it directly;
  move to **AI-allowed interviews with a clear rubric**. Keep assessments **brief
  (<30 min)**; long take-homes lose **40–60%** of strong senior candidates.
  → *The dev case must measure real, AI-era signal — not a puzzle a bot solves.*

### Sources
- https://www.erstegroup.com/en/career/career-team · https://kariera.csas.cz/ · https://csas.jobs.cz/
- https://mitratech.com/resource-hub/blog/what-2025-time-to-fill-benchmarks-reveal-about-hiring-agility-and-risk/ · https://www.shrm.org (2025 Benchmarking, via secondary)
- https://www.zivaro.ai/blog/recruiter-time-per-hire · https://www.shortlistd.io/blog/the-shocking-truth-about-how-recruiters-spend-their-time
- https://www.seekout.com/blog/seekout-vs-competitors/ · https://www.greenhouse.com/blog/best-ai-recruiting-software
- https://recruitbpm.com/blog/candidate-experience-statistics · https://blog.theinterviewguys.com/the-2025-ghosting-index/
- https://www.herohunt.ai/blog/recruiting-under-the-eu-ai-act-impact-on-hiring/ · https://artificialintelligenceact.eu/what-the-act-means-for-staffing-businesses/
- https://jobsbyculture.com/blog/take-home-vs-live-coding-2026 · https://fullscale.io/blog/take-home-coding-tests-vs-live-coding-interviews/
