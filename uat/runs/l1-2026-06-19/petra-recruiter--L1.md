# L1 UAT — Petra Nováková (Corporate Recruiter / TA Specialist)

**Run:** l1-2026-06-19 · **Level:** L1 (theoretical, code-grounded, no browser)
**Character file:** `uat/characters/petra-recruiter.md`
**Surface binding:** authed workspace tabs (`app/features/tabs.ts`) via dev gate `kp_dev_authed=1` — no per-role nav gating, so Jobs/Match/Analyze/Pipeline/Schedule/Interview/Onboarding are all reachable. Tokenized candidate pages (`/offer/[token]`, `/onboarding/[token]`, `/interview/[token]`) are **outside** her set — findings there tagged `unreachable` and deferred to L2 reachability.

## Scorecard

| Journey | Verdict | blocker | major | minor | strengths |
|---|---|---|---|---|---|
| jd-to-shortlist | **L1-pass** | 0 | 0 | 3 | 3 |
| cv-analysis-jobfit | **L1-conditional** | 0 | 1 | 0 | 3 |
| pipeline-advance | **L1-pass** | 0 | 0 | 1 | 3 |
| voice-interview | **L1-pass** | 0 | 0 | 2 | 1 |
| offer-onboarding | **L1-conditional** | 0 | 1 | 1 | 1 |
| guided-simulation | **L1-conditional** | 0 | 1 | 0 | 1 |

Reachability resolved first: the dev gate seeds the workspace with no per-role gating (`tabs.ts:98-153`), so every tab Petra uses is reachable; her journeys' only reachability dependencies are data fixtures (seeded pool / analyses / pipeline / interview calendar) and AI keys — flagged per journey, not blockers at L1.

---

## Journey: jd-to-shortlist — *Z inzerátu k odůvodněnému shortlistu* — **L1-pass**

| id | type | sev | dim | title |
|---|---|---|---|---|
| petra-jd2sl-reasoning-grounded | strength | polish | trust | Reasoning narrates over pre-computed deterministic facts (full profile + real JD + score breakdown) |
| petra-jd2sl-degrade-disclosed | strength | polish | trust | Template-vs-AI degrade disclosed with a 'pravidlové' badge |
| petra-jd2sl-score-drivers | strength | polish | senior-quality | Score carries per-dimension drivers + confidence 'why', not a bare number |
| petra-jd2sl-empty-state-en-leak | quality-gap | minor | language | Jobs-side candidate-scan empty state is a hardcoded English string |
| petra-jd2sl-reasoning-no-comp-band | quality-gap | minor | senior-quality | Reasoning prompt omits the role salary band the card shows |
| petra-jd2sl-reachability-empty-pool | broken-flow | minor | completion | Shortlist depends on a seeded candidate-pool fixture |

> *Tohle je poprvé, co mi „AI matching" nepřijde jako fulltext v převlékacím kabátě.* The client sends an ID, but the server pulls the **whole** profile and ranks it against the **live** job record — so an ingested role actually shows up, not just the seed corpus. The thing that wins me over is the score: it's not a naked 78, it gives me the contribution and weight per dimension and tells me *why* the confidence band is wide ("early-career, thinner record") right there, not in a tooltip. The partial-match `~` mark is exactly the honesty I want — "matched: Kubernetes" doesn't get to masquerade as proven Kubernetes. And when the AI rationale degrades to a template (no key, over allowance), it *says so* — "pravidlové" — instead of passing a canned sentence off as reasoning. That one detail is the difference between a tool I trust and one I babysit. Two nits I'd fix before I lean on it daily: the empty-pool note comes back in English, and the rationale can't speak to comp fit even though the band is right there on the card. Worth the wait? If the reasoning lands in seconds from cache and only the first cold run is slow, yes — this is faster than me hand-writing "why these three." **I'd adopt it.**

---

## Journey: cv-analysis-jobfit — *Analýza jednoho CV proti konkrétní roli* — **L1-conditional**

| id | type | sev | dim | title |
|---|---|---|---|---|
| petra-cvfit-salary-basis | strength | polish | trust | Salary gauge anchored in a sourced role-band benchmark with a stated basis |
| petra-cvfit-skill-hallucination-seam | **quality-gap** | **major** | **trust** | Headline matched/missing skill chips are pure LLM lists with no taxonomy gate |
| petra-cvfit-verdict-jd-bound | strength | polish | senior-quality | Verdict generated against the supplied JD (must_prove_evidence) or nulled |
| petra-cvfit-report-language | strength | polish | language | Report-language override flows end-to-end and is language-keyed in cache |

> *Mzda má konečně základ.* The salary number isn't a number from a hat — it's anchored to a sourced ČR role×seniority band (Platy.cz, Kitalent…), the prompt is told to cite that anchor, and the panel shows me the rationale and a confidence badge. That's a figure I can put in front of a manager. The verdict is built against the actual JD and goes null if I don't give it one — good, no generic rubric pretending to be job-fit. And the Czech report override threads all the way to the model, so I get a Czech narrative, not English filler. **But** — and this is the one that decides whether I keep my name on it — the headline matched/missing **skill chips come straight from the LLM with nothing stopping it from listing a skill the CV never mentions.** There's a separate deterministic keyword-coverage panel that mitigates it, but the chips a manager's eye lands on first are the un-gated ones. One hallucinated "matched: Spring Boot" on a CV that never said it and I'm done — that's my hard line. So: strong machinery, real salary basis, but I need the matched chips cross-checked or visibly marked LLM-vs-verified before I'd stop re-reading every CV myself. **Conditional — fix the chips.**

---

## Journey: pipeline-advance — *Posun kandidátů pipeline a kandidátská zásuvka* — **L1-pass**

| id | type | sev | dim | title |
|---|---|---|---|---|
| petra-pipeline-unified-timeline | strength | polish | completion | Drawer timeline merges 5 cross-surface sources + stage events, chronological |
| petra-pipeline-move-integrity | strength | polish | trust | Moves are CAS-guarded (expectedStage + IMMEDIATE lock) — no silent revert/clobber |
| petra-pipeline-handoff-not-deadend | strength | polish | completion | Advancing reaches real next-steps (mint voice/schedule link, extend offer) |
| petra-pipeline-silent-move | confusion | minor | clarity | A plain stage move closes the drawer + reloads with no explicit confirmation |

> *Konečně jedna časová osa.* The drawer pulls everything — analysis, the voice interview, schedule invites, the offer, the sent comms — into **one** ordered feed, and it even tells me the honest limit (it joins analyses by exact name so it won't invent history for a same-named stranger). That's the "whole candidate in one place" I've never had in Teamio or SuccessFactors. Moving someone sticks: the optimistic-concurrency guard means a stale second tab can't quietly stomp on a move I made — it gets a clean 409, not a silent overwrite. Hand-off isn't a dead-end either; from the drawer I can mint a voice screen or a schedule link, or extend the offer. My one gripe is the small one I always have: when I just drag someone a stage forward, the drawer closes and the board reloads but **nothing tells me "moved Nováková to Interview."** The AI actions get a nice green badge; a plain move gets silence. It's not lost — I can see it on the board — but it brushes my "*a stalo se vůbec něco?*" nerve. Minor. **I'd adopt it.**

---

## Journey: voice-interview — *Run / review an AI first-round screen* — **L1-pass**

| id | type | sev | dim | title |
|---|---|---|---|---|
| petra-voice-consent-dow-guards | strength | polish | trust | Consent-gated server-side, single-use, denial-of-wallet guarded; transcript+result land on the entry |
| petra-voice-grounding-analysis-derived | quality-gap | minor | senior-quality | Candidate interview grounding is analysis-derived, not full-CV or comp-band |
| petra-voice-reachability | broken-flow | minor | completion | The end-to-end review loop depends on a completed real-token session + a voice key |

> *Důležitější je, že rozhodne pořád člověk.* The screen produces a transcript and a scorecard attached to the right entry — I review it in the modal, I see the turns and the cited evidence, and crucially it doesn't auto-advance anyone; I still move the candidate. Consent is enforced on the **server**, not just a greyed-out button, and a finished link can't be replayed — that matters when Legal asks how an AI-run interview is lawful. The transcript comes back in the language it was spoken, so a Czech screen reads Czech. What I can't fully judge on paper: the agent is grounded from the **analysis summary** (JD must-haves, prior signals) rather than the full CV or the comp band — fine for a first round, but I want to hear live whether the questions feel like they read *this* person or just the role. And the whole loop only proves out with a voice key and a minted token (a fixture/L2 thing). Structurally I'm satisfied; the quality verdict is L2's. **I'd pilot it.**

---

## Journey: offer-onboarding — *Offer → onboarding* — **L1-conditional**

| id | type | sev | dim | title |
|---|---|---|---|---|
| petra-offer-accept-deadend | **broken-flow** | **major** | **missing** | Candidate offer-accept card is a 'People team will be in touch' thank-you with no onboarding link *(unreachable for Petra — Tereza's surface)* |
| petra-offer-handoff-roundtrip | strength | polish | completion | Petra's hand-off round-trips: draft/send from Decisions, watch Hired in OnboardingTab, answers surface back |
| petra-offer-no-proactive-accept-signal | confusion | minor | clarity | No proactive 'offer accepted' signal — she infers it from the stage / OnboardingTab |

> *Moje strana sedí.* I draft and send the offer from Decisions — the real, persisted comp goes onto the tokenized link, not a placeholder — and the accepted candidate lands in my Onboarding tab with their pre-boarding answers pre-filled. The e-signature step is honestly marked a "provider seam" instead of faking a signature, which I respect more than a fake green check. So *my* job completes without re-keying. **The crack is on the candidate's screen, not mine:** I read the accept card the new hire sees, and despite the changelog saying "accept lands on a concrete onboarding next-step," it still renders the literal "*náš personální tým se vám brzy ozve*" thank-you with **no link to the onboarding questionnaire** (the `/onboarding/[token]` page exists and is wired server-side, but the offer page never surfaces a button to it). That's the exact dead-end the work was supposed to kill. I've tagged it `unreachable` for me — it's Tereza's tokenized page, outside what I touch, and my hand-off still gets the hired candidate — but it's the journey's whole promise, so L2 must accept a real token and confirm. Smaller thing: nobody *tells* me an offer was accepted; I find out by looking. **Conditional — verify the candidate next-step link live.**

---

## Journey: guided-simulation — *Keyless JD→Hired run that builds belief* — **L1-conditional**

| id | type | sev | dim | title |
|---|---|---|---|---|
| petra-sim-real-clicks-isolated | strength | polish | trust | Drives REAL surfaces (opens the actual /offer/[token] to click Accept), keyless, isolated from tenant data |
| petra-sim-english-only-chrome | **quality-gap** | **major** | **language** | The entire SimBar controller chrome is hardcoded English |

> *Že to nejsou kulisy, to mě přesvědčilo.* The sim genuinely opens the **real** offer page in a frame and clicks Accept inside it — it's the actual pipeline driving itself, not a screen recording — and it's marker-isolated ("(SIM)"), so it can't touch our seeded candidates and resets clean. Keyless, so I can show it without burning credits. For proving "this is a real product, not a mockup" to a stakeholder, that's exactly right. **But I can't run this in front of a Česká spořitelna room as-is, because the whole controller is in English** — "Start simulation," "Pause," "Next," "Explain," the phase labels, and the climax CTA are all hardcoded literals with no Czech. It was clearly built for the English-speaking buyer (Helena), and for *her* it's fine. For *my* Czech demo it leaks English in every button — embarrassing in front of the bank. The walk itself is sound; it's the chrome that isn't localized. **Conditional — localize the SimBar before I'd present it.**

---

## L2 hand-off (what the browser must confirm)

1. **cv-analysis-jobfit / skill chips (major):** adversarially verify every "matched" chip is findable in the CV text; check whether SkillChips distinguishes deterministic-verified from LLM-asserted. Any unqualified hallucinated skill = blocker for Petra.
2. **offer-onboarding / accept dead-end (major, unreachable for Petra):** accept a real offer token live — does the accepted card render ANY onward onboarding link, or is it still a bare thank-you? Confirm separately that Petra's OnboardingTab receives the hired candidate regardless.
3. **guided-simulation / English chrome (major):** confirm the cs session renders the SimBar in English and quantify the explain-drawer/phase-label leakage.
4. **jd-to-shortlist:** assert the live reasoning names this CV's skills + this JD's gaps (not boilerplate); confirm cached verdicts return fast and a cold one doesn't client-timeout; check the en empty-state leak surfaces in cs.
5. **voice-interview:** run a real candidate-token grounded session — do the questions reference this candidate, or just the role? Confirm transcript+scorecard land on Petra's entry in cs.
6. **pipeline-advance:** confirm a plain drag move's board change is salient enough to not read as silent success; spot-check the unified timeline shows a scheduled interview AND a prior analysis together.
7. **Fixtures:** seeded candidate pool + seeded analyses + seeded pipeline + interview calendar + a minted offer/interview token + Gemini/voice keys must be present, or quality findings drop to `scope_note`.
