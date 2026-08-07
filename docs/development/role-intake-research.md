# Role-intake dialog — conversation-design research (Phase 0.5)

Research pass gating Phase 1 of `docs/concepts/role-intake-dialog.md`, run
2026-08-07. Two sweeps: recruiter intake/kickoff methodology (hard data where
it exists) and elicitation psychology (MI, coaching, requirements-engineering,
cognitive-interview literature). This doc is the normative source for the
intake persona in `pipeline/jobfit/intake.py` — change the rules here first,
then the code.

Evidence grades used below: **[strong]** meta-analyses / controlled
experiments · **[moderate]** single studies, small-N · **[lore]** practitioner
consensus. Full source URLs at the bottom.

## 1. What the recruiting field already knows

- **Greenhouse Structured Hiring / Job Kickoff Form** is the canonical intake
  artifact: work BACKWARD from outcomes — "what, a year from now, would tell
  you this hire succeeded?", then 90-day objectives, then attributes split
  skills/traits/qualifications feeding the scorecard. The 90-day-outcome
  question doubles as a **de-spec device**: a requirement that maps to no
  first-90-days outcome gets demoted to nice-to-have.
- **Lou Adler (Performance-based Hiring)**: replace "what they must HAVE" with
  5–6 measurable "performance objectives" (what they will DO/deliver). Each
  must-have must justify itself against a deliverable.
- **LinkedIn's intake checklist** (Browne): drive an explicit must-have vs
  nice-to-have line ("the line gets blurred when you don't drive clarity");
  recruiter is a talent advisor, not an order-taker.
- **Failure modes with data**: requirement laundry lists / degree inflation are
  real and measured — HBS "Dismissed by Degrees" (26M postings): 67% of
  production-supervisor postings demanded a degree only 16% of incumbents had.
  Causes: many stakeholders adding without removing, specs modeled on the
  leaver, aspirational future-role specs. Recruiter counter-moves: push back
  AT intake (not after shortlists), reframe have→do, bring market data, cap
  the scorecard to force rank-ordering.
- **Alignment pays** (vendor-survey grade): Metaview 2026 (n=505): teams with
  excellent recruiter–HM partnership exceed goals 79% vs 36%; still, 58% wish
  they could work around their counterpart. Treat numbers as directional.
- **AI-led HM intake is an active category** (Phenom Intake Agent, Metaview,
  LinkedIn Hiring Assistant): the convergent patterns are async-beats-meeting,
  adaptive probing on vague answers, example-profile calibration ("would you
  interview this person?"), and always converting the conversation into
  machine-actionable artifacts (scorecard, sourcing filters). No independent
  effectiveness studies yet.

## 2. What the elicitation literature says

- **Motivational interviewing** [strong in-domain]: the causal path runs
  through *evocation* — MI-consistent interviewer behavior increases the
  speaker's own "change talk," which predicts outcomes. Practice ratio ≈ 2
  reflections per question. Transfers as: make the requestor produce the
  reasoning; never argue with a stated requirement — reflect it and let the
  contradiction surface.
- **Active listening vs advice** [moderate]: reflective responses make
  speakers feel *more understood* than advice; felt understanding is what
  keeps people unpacking. Suggestions come after accurate reflection.
- **Cognitive interview** [strong]: ~34% more correct recall, no more errors —
  via context reinstatement ("think back to the last week the team was
  underwater — walk me through it"), uninterrupted narrative, open-before-
  specific.
- **Paraphrase style matters** [moderate]: *expansion* read-backs ("…so the
  last two hires drowned in on-call — what else was going on?") yield more and
  more-accurate detail than yes/no confirmation read-backs, which yield
  compliance nods.
- **Requirements-engineering interviews** [strong taxonomy]: 34 catalogued
  interviewer mistakes; novices don't self-correct. Top: leading/technical
  questions, failing to ask why, no end-of-session summary. Ambiguity events,
  when explored, are where **tacit knowledge** surfaces — a contradiction is a
  dig site, not noise. **Laddering** (attribute → consequence → value)
  reliably uncovers motivation behind stated preferences. Premature solutions
  ("I need a senior React dev") get a problem-side detour before entering the
  spec. LLM interviewers (LLMREI) already beat humans at prioritization and
  final summaries; weaker at adaptive depth.
- **Talking to an AI** [moderate]: disclosure advantage appears where
  *evaluation anxiety* is salient ("honestly I don't know what level I need")
  — so say the non-judgment out loud. Interview chatbots with active-listening
  skills (n=206 live) produced higher-quality responses than baseline.
  Offering X-vs-Y contrast hypotheses is supported once free narrative stalls
  — framed as disposable, after the narrative (contrasts anchor).
- **Short beats deep for transactional goals** [moderate]: for goal-oriented
  exchanges users want the shortest path; depth must be *earned by detected
  ambiguity*, or the therapeutic framing becomes the annoying framing.

## 3. The persona spec (normative — encoded in `pipeline/jobfit/intake.py`)

Register: **coaching session, not interrogation; nothing to pass, nothing to
fail.** Warmer and more collegial than the candidate interviewer (whose
withholding stance — no feedback, no scores — does NOT transfer). The agent
reads back, confirms, proposes, and lets the requestor correct it.

1. **Open with context reinstatement, not a form.** "Think about the last
   month — where did the team feel the missing person most?"
2. **Triage in turns 1–2** (session shape, §5): concrete answer + ladder
   bottoms out → collapse to the short transactional path.
3. **Reflect ≈2× per question**; expansion paraphrases, not yes/no read-backs.
4. **Reuse the requestor's exact words** until they've unpacked them
   ("firefighter type" stays "firefighter" until explained).
5. **Ladder every hard requirement once**: skill → what goes wrong without it
   → what it protects. Requirements that survive laddering are `must_have`;
   the rest demote.
6. **Quarantine premature solutions**: park the stated solution visibly,
   explore the problem, then reconcile.
7. **Name contradictions aloud** — "I'm hearing two different things about
   seniority; can we pull that apart?"
8. **X-vs-Y contrasts only after free narrative stalls**, disposable
   ("neither is fine").
9. **Say the non-judgment out loud** — "vague is fine; that's what this
   session is for."
10. **Always end with a structured summary + open correction invitation**,
    then the read-back maps to the RoleBrief (provenance `stated` only for
    what the requestor actually said/confirmed; agent proposals stay
    `inferred` until confirmed).

Plus the recruiting-side devices: the **90-day-outcome question** as the
de-spec filter, have→do reframes, and a **soft cap** pushing rank-ordering
when must-haves exceed ~6.

## 4. Requestor-persona bank (for the eval harness, Phase 2)

Mirrors `interview_scenarios.json`'s role — behavioral coverage for the
intake agent. Personas × the shape axis:

| id | behavior | what it tests |
| --- | --- | --- |
| `power_unit_backfill` | "Jarda left, need the same again, here's the old JD" | shape triage → short path, no forced coaching |
| `power_unit_scaling` | "second React dev, same squad" | short path + still captures 90-day outcome |
| `vague_requester` | "we need someone senior-ish for the platform… stuff" | evocation, context reinstatement, patience |
| `over_specifier` | 12 must-haves incl. 3 clouds + PhD | laddering + soft cap + demotion without arguing |
| `solution_jumper` | "I need a senior React dev" (actual problem: nobody owns deploys) | premature-solution quarantine |
| `contradicts_self` | wants "junior we can shape" + "owns architecture day 1" | contradiction named aloud, not smoothed |
| `leaver_template` | describes the person who quit, not the role | have→do reframe, outcome questions |
| `cant_articulate_level` | "good, but not expensive-good?" | X-vs-Y disposable contrasts |
| `evaluation_anxious` | embarrassed they don't know; short answers | explicit non-judgment, inverted funnel (easy wins first) |
| `budget_evader` | deflects compensation twice | facet captured as `context` with low confidence, not forced |
| `derailer` | drifts into reorg politics | gentle agenda pull-back, relevant detail still harvested as facets |
| `llm_era_confused` | "do we even need a junior now that we have Copilot?" | agent leads: proposes role archetypes, marks them `inferred` |

## 5. Session-shape heuristic (`power_unit` vs `story`)

Deterministic triage after the first 1–2 requestor turns; LLM may override
with justification, never silently.

Signals for **power_unit** (short path): names an existing role/JD to clone or
backfill ("same as", "another", "backfill", "the old JD", a `jd_slug`
reference); first answer is concrete (title + team + 2+ specific skills);
the first ladder probe returns the same content restated (the "why" bottoms
out). → Confirm-and-generate: one context question, one 90-day-outcome
question, read-back, done — target ≤ 8 turns.

Signals for **story** (coaching path): hedging density ("not sure", "kind
of", "we think", "maybe"), contradiction between stated level and stated
scope, solution words with no problem behind them (ladder probe yields a
restatement of the solution), new-role/first-hire markers ("we've never had",
"new team", "not sure if one role or two"). → Full register, GROW as hidden
macro-structure (Goal → Reality → Options → Will), target 15–25 turns.

Undetected after 2 requestor turns → default `story` but keep the exchange
tight; a late concrete signal may still collapse to the short path.

## 6. Sources

MI: [Burke meta-analysis](https://pubmed.ncbi.nlm.nih.gov/14516234/) ·
[Rubak](https://pubmed.ncbi.nlm.nih.gov/17716083/) ·
[process-outcome meta-analysis](https://pubmed.ncbi.nlm.nih.gov/28639815/) ·
[MINT reviews](https://www.motivationalinterviewing.org/sites/default/files/mi_research_reviews_2017.pdf).
Coaching: [GROW meta-analysis](https://www.researchgate.net/publication/404264520_Implementing_the_GROW_Coaching_Model_in_Developing_Competencies_of_Educators_A_Meta-Analysis) ·
[Clean Language](https://cleanlanguage.com/publications-using-david-grove-ideas/) ·
[Socratic questioning](https://pubmed.ncbi.nlm.nih.gov/25965026/) ·
[active listening vs advice](https://www.tandfonline.com/doi/full/10.1080/10904018.2013.813234).
RE: [interview-mistake taxonomy](https://dl.acm.org/doi/10.1007/s00766-019-00313-0) ·
[Ferrari ambiguity/tacit knowledge](https://openportal.isti.cnr.it/data/2016/353983/2016_353983.postprint.pdf) ·
[question typology](https://www.yorku.ca/liaskos/Papers/RE2021/RE2021.pdf) ·
[LLMREI](https://arxiv.org/html/2507.02564v1) ·
[laddering review](https://pmc.ncbi.nlm.nih.gov/articles/PMC7786779/).
Questioning: [NN/g funnel](https://www.nngroup.com/articles/the-funnel-technique-in-qualitative-user-research/) ·
[cognitive-interview meta-analysis](https://www.researchgate.net/publication/247523329_The_Cognitive_Interview_A_Meta-Analysis) ·
[expansion paraphrasing](https://www.sciencedirect.com/science/article/abs/pii/S0145213410001420).
AI-specific: [Lucas et al.](https://www.researchgate.net/publication/262527118_It's_only_a_computer_Virtual_humans_increase_willingness_to_disclose) ·
[active-listening chatbot](https://arxiv.org/abs/2002.01862) ·
[LLM clarifying questions](https://arxiv.org/abs/2510.12015) ·
[task-oriented dialog](https://arxiv.org/pdf/2112.11176).
Recruiting: [Greenhouse kickoff](https://www.greenhouse.com/guidance/how-to-implement-structured-hiring-step-1-role-kick-off-meeting) ·
[Job Kickoff Form](https://www.greenhouse.com/blog/set-your-structured-hiring-process-up-for-success-with-the-job-kickoff-form) ·
[LinkedIn intake checklist](https://www.linkedin.com/business/talent/blog/talent-strategy/checklist-to-improve-intake-meetings) ·
[Adler](https://www.louadlergroup.com/about-us/performance-based-hiring/) ·
[HBS Dismissed by Degrees](https://www.hbs.edu/managing-the-future-of-work/Documents/dismissed-by-degrees.pdf) ·
[Metaview 2026 report](https://www.metaview.ai/resources/blog/recruiter-hiring-manager-relationship) ·
[Phenom Intake Agent](https://www.phenom.com/blog/intelligent-intake-assistant-built-recruiters).
