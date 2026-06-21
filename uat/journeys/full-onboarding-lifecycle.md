---
name: full-onboarding-lifecycle
promotion: discovery
surfaces:
  - Jobs, JD Library & Sourcing
  - CV Analysis Workspace
  - Candidate Profile & Job Matching
  - Pipeline Board & Candidate Drawer
  - Screening Decisions & Records
  - Group Evaluation & Fairness
  - Interview Scheduling, Prep & Rubric
  - Offers & Onboarding
  - Candidate Onboarding Hand-off
characters: [all HR cohort 2026-06-20]
language: both
---

# Full candidate lifecycle → onboarding (the HR end-to-end)

The end-to-end thread an **HR / People person runs to take a role from open to a
hired-and-onboarded employee**: post the role → AI screens & matches applicants →
analyze CVs → interview → pick fairly → offer → **onboard**. The real LLM engine
is exercised at every AI step *except* the onboarding hand-off itself (which is
deterministic — checklist / pre-boarding questionnaire / e-sign seam).

> **The lens that matters for this cohort:** the app is **seeded for a Czech retail
> bank (Česká spořitelna)** — `pipeline/jobfit/seed_jobs_csas.py`, `data/seed_jobs/`,
> `data/salary_benchmarks.json`, `data/taxonomy.json`. These 20 Characters are HR in
> **other industries and company sizes** (tech, manufacturing, healthcare, retail,
> hospitality, logistics, pharma, public sector, …; seed-startup → enterprise; US /
> UK / EU / CZ / UAE / SG / IN). For each AI surface the central question is **fit**:
> does the output suit *MY* industry's roles, *MY* market's comp, *MY* size's
> process, and *MY* jurisdiction's compliance — or is it bank-shaped and Czech-shaped?
> "Good machinery fed thin / wrong-domain context" is the predicted defect; score it.

## Goal (in the HR person's words)
"Run one real req end to end in *my* world — post it, let the AI surface and screen
the right people, interview, choose defensibly, send the offer, and hand the new
hire into onboarding — and have every AI output be something I'd put my name on for
*my* industry and *my* company size, not a bank template."

## Definition of done (user POV)
- A role exists/ingests and produces a **ranked, reasoned shortlist** whose reasoning
  fits this Character's industry + role taxonomy (not generic/bank).
- A CV→JD analysis returns **extraction + job-fit + a salary read with a basis** that
  is credible for *this* market/industry.
- Screening runs with **human-in-the-loop + AI disclosure + a decision record** that
  satisfies *this* Character's compliance regime (EU AI Act / EEOC / sector rules).
- Interview prep/rubric, group-eval pick, and the offer are usable as-is for this size
  of company.
- Accept lands on a **concrete onboarding next-step** and the new hire flows into an
  onboarding checklist/questionnaire that fits this industry (e.g. credentialing /
  safety / IP — or at least is editable to it).
- Across the thread: no dead-end, no silent success, no hallucinated/ungrounded claim.

## Entry state / preconditions
- Dev gate on (`kp_dev_authed=1`, `app/_lib/auth/devAuth.ts`) → authed workspace at `/`.
- Seeded **ČS** job corpus + pipeline + analyses (`env.md` fixtures). **Note for L1:**
  the seed is bank/Czech — judge whether this Character could bring *their* data, and
  whether outputs generalize. A bank-only fixture that can't represent their industry
  is itself a finding (`missing` / `quality-gap`, dimension `senior-quality`/`trust`).

## Surface model — stages + code anchors (verify, then judge each in-character)
Build the surface model by following each affordance → handler → the LLM/pipeline
call → its prompt/grounding. Cite `file:line`. Reachability for this cohort = "dev
gate seeded + data behind the tab" (no per-role nav gating, `app/features/tabs.ts`).

1. **Post / ingest the role** — `app/features/sub_jobs/JobsTab.tsx`,
   `app/api/jobs/route.ts`, ingest `app/_lib/job-ingest.ts`; JD authoring
   `app/features/sub_library/JdBuilder.tsx`, `app/_lib/jd-build-run.ts`,
   lint `app/_lib/jd-lint.ts`. *Fit:* role taxonomy `data/taxonomy.json` — does it
   carry this industry's roles, or only bank/office ones?
2. **AI match / shortlist (real LLM)** — `app/features/sub_match/MatchTab.tsx`,
   `app/api/match/reasoning/route.ts` → `app/_lib/reasoning-run.ts` →
   `pipeline/jobfit/match_reasoning.py` (+ `matching.py`, `transferable.py`).
   *Grounding audit:* does the prompt get the real CV + real JD + role context, or thin
   inputs? Does reasoning name concrete CV facts? Is the taxonomy industry-appropriate?
3. **CV analysis / job-fit (real LLM — Gemini)** — `app/features/sub_analyze/AnalyzeTab.tsx`,
   `app/api/analyze/route.ts` → `app/_lib/analyze-run.ts` → `pipeline/jobfit/pipeline.py`,
   `pipeline/jobfit/gemini.py`, `extractors.py`, `soft_signals.py`. Salary read:
   `pipeline/jobfit/salary_band.py` + `data/salary_benchmarks.json`. *Fit:* is the comp
   band right for this market/industry, with a basis — or Czech-bank-anchored?
4. **Applicants in the pipeline** — `app/features/sub_pipeline/PipelineTab.tsx`,
   `app/api/pipeline/route.ts`, drawer `CandidateDrawer.tsx`, consent/AI-disclosure
   `app/api/pipeline/[id]/consent/route.ts`, `app/_lib/consent.ts`.
5. **Screening decisions (real LLM)** — `app/features/sub_decisions/DecisionsTab.tsx`,
   screen-wave `app/api/decisions/screen-wave/route.ts` → `app/_lib/screen-wave.ts`;
   config `app/_lib/decision-config-schema.ts`; record + attribution
   `app/_lib/decision-record-store.ts`, `app/_lib/decision-attribution.ts`. *Compliance
   fit:* human-in-the-loop, AI disclosure, auditable record — does it satisfy THIS
   jurisdiction (EU AI Act high-risk vs US EEOC vs sector rules)?
6. **Interview schedule + prep + rubric (real LLM)** — `app/features/sub_schedule/ScheduleTab.tsx`,
   `app/_lib/interview-prep-run.ts`, `app/_lib/interview-rubric.ts`,
   `app/_lib/schedule-slots.ts`, `app/_lib/timezone.ts`. *Fit:* timezone/market, rubric
   relevance to this role family.
7. **Group-eval / fair pick (real LLM)** — `app/features/sub_decisions/GroupEvalModal.tsx`,
   `app/api/decisions/group-eval/route.ts` → `app/_lib/group-eval-run.ts`, fairness
   `app/_lib/automation-fairness.ts`, sanity `app/_lib/sanity-checks.ts`.
8. **Offer** — `app/_lib/offer-finalize.ts`, `app/_lib/offer-policy.ts`,
   `app/_lib/offers-store.ts`, candidate page `app/offer/[token]/page.tsx`
   (accept→onboarding link `:194-200`, deadline `:227`). *Fit:* comp/letterhead/terms
   for this company size + market.
9. **Onboarding hand-off (deterministic)** — recruiter `app/features/sub_onboarding/OnboardingTab.tsx`,
   `app/api/onboarding/route.ts`, `/api/onboarding/[id]`; core `app/_lib/onboarding.ts`
   (`DEFAULT_ONBOARDING_TASKS` :13+, `ENTRY_QUESTIONNAIRE_FIELDS`), store
   `app/_lib/onboarding-store.ts` (tables `onboarding_runs/templates/intake/task_states/signatures`);
   candidate `app/onboarding/[token]/page.tsx` → `/api/onboarding/candidate/[token]`,
   bridge `app/_lib/onboarding-candidate.ts`; reminders `app/_lib/offer-reminders.ts`.
   *Fit:* are the default tasks/questionnaire generic-office, or editable to this
   industry's real pre-boarding (healthcare credentialing, manufacturing safety, IP/equity
   for startups, background/licensing for finance)? E-sign is a **provider seam**
   (`markSigned`) — audit-stamped, not itself eIDAS — name that ceiling.

## What L1 must check (structural, code-grounded)
- **Completion thread:** every stage hands to the next with no dead-end / re-entry loop.
- **Grounding score per AI surface** (`grounding N/M`): how many of {real CV, real JD,
  role/industry taxonomy, market/industry comp, company size, jurisdiction, prior
  pipeline history, this Character's own data} actually reach each prompt.
- **Industry/size fit:** for each AI output, is it shaped by bank/Czech defaults the
  Character can't override? Flag bank-locked taxonomy, comp, compliance framing, or
  onboarding tasks as `quality-gap`/`missing` (dimension `senior-quality`/`trust`).
- **Compliance fit per jurisdiction:** human-in-the-loop + AI disclosure + decision
  record present and adequate for THIS Character's regime.
- **No silent success:** every action confirms what happened and to whom.
- **Onboarding fit + the e-sign ceiling:** default tasks/questionnaire editability;
  candidate token chain (accept → minted onboarding token → questionnaire → answers
  surface on the recruiter tab).

## What L2 must confirm (live-only — l2_priority)
- **Real LLM output quality on the non-default/industry path:** run match-reasoning,
  CV analysis, screen-wave, interview-prep, group-eval against the seeded data and judge
  whether the prose is specific + grounded (names real CV facts; no hallucinated skill),
  and how it reads for THIS industry. Assert the salary read carries a basis.
- **Latency:** budget 30–130s per AI call; an early client timeout is itself a finding.
- **The onboarding chain end-to-end** for the subset where a token can be minted.
- **Rendering** in both themes where UX is theme-sensitive; **language** (cs/en) correct.

## Out of scope / known
- Bare tokenized-page 404 without a minted token (`accepted-gaps.md`).
- Multi-tenant isolation is locked to the default workspace (`app/_lib/workspace-lock.ts`)
  — a Character can't truly bring a 2nd-company dataset; treat as a known ceiling, not a
  fresh defect (note it where it bounds the "my data" fit question).
- Deep offer-policy edge cases + downstream Hired automation — backlog.
