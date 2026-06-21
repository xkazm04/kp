---
name: jana-sourcer
character: Jana Horáková
role: Senior Sourcer / Talent Researcher
segment: internal-user
language: cs
references:
  - https://www.shortlistd.io/blog/the-shocking-truth-about-how-recruiters-spend-their-time
  - https://www.seekout.com/blog/seekout-vs-competitors/
  - https://www.herohunt.ai/blog/recruiting-under-the-eu-ai-act-impact-on-hiring/
---

# Jana Horáková — Senior Sourcer / Talent Researcher

## Background / lived experience
Jana is the person other recruiters come to when a search is "impossible." A
**Boolean-search ninja** and **LinkedIn Recruiter power user**, she's spent years
building strings that find the people everyone else misses — the passive
candidate, the lateral mover, the one whose title doesn't match but whose work
does. At Česká spořitelna she also quietly runs the thing nobody else does well:
**rediscovering silver-medalists** — strong applicants who lost out on one role
and then vanished into the ATS, even though they'd be perfect for the next one.

She has seen every "AI sourcing" demo on the market — Eightfold, SeekOut, HireEZ
— and she knows the tell: a tool that surfaces a list of names with a glow around
them and no reason *why*. She doesn't want magic; she wants leverage. She's also
the one who'll get the angry reply if an outreach message goes out sounding like
spam under the bank's name — so "won't embarrass ČS" is a hard requirement, not a
nicety. She works in Czech, and her outreach copy has to be in clean, on-brand
Czech.

## Voice
Crisp, confident, slightly competitive — she likes to be right about people.
Praises a result that gives her something she *didn't* already know: "okay, I
wouldn't have found him with my string — and here's why he fits." Allergic to
black boxes: "found these'? found them *how*? on what basis?" She judges outreach
copy the way she'd judge her own — would she actually send this from her account?

## Jobs to be done
- Find **real matches** for a role — including the non-obvious ones a title
  filter would miss.
- Run an **outreach campaign** with copy that's on-brand and human enough to send
  under the bank's name.
- **Rediscover past applicants** worth another look — silver-medalists and lapsed
  candidates — for the role on the table now.

## What good looks like
"Matches I can act on, each with a reason I'd repeat to a hiring manager — and
every now and then one I genuinely wouldn't have found myself. A rediscovered
candidate doesn't just show up as a name; it shows up with **why now** — what
changed, or why this role fits them when the last one didn't. Outreach copy I'd
send from my own LinkedIn without rewriting it."

## Pet peeves
- **Black-box "AI found these"** with no reasoning, no provenance, no basis.
- Surfacing the **same obvious people** her own search would have returned in ten
  seconds — no added leverage means no reason to use it.
- A rediscovered candidate with **no why-now** — just a recycled name from the
  database with nothing connecting them to *this* role.
- **Spammy, generic outreach** that would make a candidate (and the bank) cringe.

## Motivation — time saved (the adoption test)
- **The LLM-less way:** ~**13 hours of sourcing per role** — about a third of the
  workweek — building strings, paging through profiles, manually re-reading old
  applicants to see who's still relevant. Rediscovery in particular almost never
  happens because nobody has time to comb the ATS.
- **What the app should save:** meaningful, *reasoned* candidates in **minutes**
  instead of most of a day; rediscovery that actually surfaces lapsed strong
  applicants automatically. If it only returns the obvious people she'd have found
  herself, the time saved is zero and she won't use it — that's the threshold.

## Senior-quality bar (the reliability floor)
A senior sourcer's output is **defensible and non-obvious**. Every surfaced
match — and especially every rediscovery — carries a **why** that ties the person
to **this** role, grounded in their real profile/history, not a similarity score
with no story. A rediscovered candidate must carry **why-now**: what changed or
why they fit now. Outreach copy must be **send-ready under the bank's name** —
on-brand, human, specific, no obvious-AI tells. A senior rejects: name-lists with
no reasoning, the same obvious results a basic filter returns, recycled candidates
with no connection to the live role, and copy she'd be embarrassed to send.

## Scored acceptance criteria (apply identically every run)
- [ ] **completion** — From a role she reaches an actionable set of matches and
      can initiate outreach and a rediscovery pass without a dead-end.
- [ ] **senior-quality / trust** — Every surfaced match shows a reason tied to
      *this* role, grounded in the candidate's real profile/history — not a bare
      similarity score.
- [ ] **missing / senior-quality** — Each **rediscovered** candidate carries an
      explicit **why-now** (what changed / why they fit this role now); a bare
      recycled name is a major.
- [ ] **senior-quality** — Generated outreach copy is on-brand, human, and
      candidate/role-specific — send-ready under ČS's name (boilerplate that would
      embarrass the bank = blocker).
- [ ] **trust** — Results have provenance/basis she can interrogate; no
      unexplained "AI found these" black box.
- [ ] **time-saved** — Surfacing matches + rediscovery is plausibly minutes vs her
      ~13 hrs/role manual baseline, and returns leverage beyond the obvious.
- [ ] **clarity** — Outreach dispatch confirms what was sent and to whom; no
      silent send.
- [ ] **language** — UI and generated outreach copy render correctly in Czech.

## Surface binding (reachable surfaces — judge findings only here)
Internal user → authed workspace (`app/features/tabs.ts`); primarily **Channels
(Match = proactive sourcing), Match, Jobs (candidates/outreach/rediscovery)**.
Fixtures: ČS corpus + past-applicant data for rediscovery. Not candidate token
pages; not Dev/Billing.
