# L1 — Jana Horáková (Senior Sourcer / Talent Researcher)

**Run:** l1-2026-06-19 · theoretical, code-grounded, no browser
**Character file:** `uat/characters/jana-sourcer.md`
**Surface binding:** authed workspace → Channels, Match, Jobs (no role gating). All
panels she needs are reachable: the Jobs tab renders the standing **RediscoveryFeed**
(`JobsTab.tsx:103`), and opening a role opens **JobPostingModal** with **Candidates**,
**Rediscover** and **Campaign** sub-tabs (`JobPostingModal.tsx:344-348`). Reachability ✔.

---

## Journey 1 — `jd-to-shortlist` ("Z inzerátu k odůvodněnému shortlistu")

**Verdict: L1-conditional** (completes structurally; one major quality gap carries forward.)

### Surface model + grounding audit
- Jana opens a role → the **Candidates** tab auto-loads the ranked pool
  (`RecruiterCandidates`, `JobPostingModal.tsx:346`, `autoLoad`). The scan hands the
  **live DB job** to the ranker (`candidates/route.ts:30`), so an *ingested* role ranks,
  not just the seed corpus — confirmed strength.
- Each card is **legible and auditable**: score badge, confidence range + band,
  matched skills *with provenance* (self-declared vs verified), partial-match marks,
  missing skills, KO/near-miss reasons, a cross-scheme **Fair Rank** + CSV export
  (`RecruiterCandidates.tsx:441-548`, `280-341`). This is the opposite of a black box —
  exactly what she asks for on the "interrogate the basis" axis.
- **The gap:** the **LLM reasoning** (verdict + strengths + gaps + interview probes) she
  wants to "repeat to a hiring manager" is wired **only to the Match tab's MatchCard**
  (`MatchCard.tsx:128`, "Explain fit" → `runReasoning`). Grep confirms `reasoning` lives
  only under `app/features/sub_match`. The Jobs-side scan she actually uses has **no
  per-candidate verdict** — only the deterministic engine output. And the Match tab runs
  the *reverse* direction (one candidate → many jobs), not her role → candidates need.
- **Degrade seam — disclosed (strength).** Where reasoning *does* run, the
  AI-vs-rule-based source is shown on every verdict (`MatchShared.tsx:73`), and the
  template fallback past the `ai_candidates` allowance is honest and uncached so it
  upgrades later (`reasoning-run.ts:63,98`). The verdict is content-addressed on both the
  candidate and the job payload (`reasoning-run.ts:73`) — bound to real inputs.

### Cognitive walkthrough (her lens)
She *can* finish: she gets a defensible ranked list with a real per-candidate basis (skills,
provenance, KO reasons). But the headline "reason I'd repeat to a manager" — the narrative
verdict — isn't reachable from the role where she's standing. She'd have to leave the role,
go to Match, re-pick the candidate, and run Explain fit one at a time. That's friction that
blunts the time-saved win on the exact artifact she values most.

### Scored criteria
- completion ✔ · trust ✔ (provenance, AI disclosure) · time-saved ✔ (minutes vs 13 hrs,
  and the pool returns non-obvious people via Fair Rank / Pool Fit)
- **senior-quality ✗ (major):** the reasoned verdict isn't on her surface → `jana-jobs-scan-no-llm-reasoning`

---

## Journey 2 — `sourcing-rediscovery` ("Stříbrní medailisté")

**Verdict: L1-conditional** (the loop completes, but the WHY-NOW promise and the send-without-preview are majors.)

### Surface model + grounding audit
- **Rediscovery machinery is sound and honest about its limits.** It ranks the whole pool
  against THIS job, floors at the "promising" threshold, filters to silver medalists not
  already in the role, sorts by score, caps with a `more` count, and **surfaces `skipped`**
  unscorable profiles so strong people aren't silently dropped (`rediscover.ts:59-103`,
  `RediscoverPanel.tsx:54`). The standing feed raises hits on publish + on-demand sweep
  (`RediscoveryFeed.tsx`). Compliance: outreach to a rejected candidate is **consent /
  anonymization gated before send** (`comms-dispatch.ts:164`) — a real GDPR safety on the
  re-touch path. Both strengths.
- **WHY-NOW is missing (her #1 pet peeve).** The wire row is
  `{candidateId,label,archetype,score,prior}` (`rediscover.ts:27`). `prior` is *backward*
  ("Rejected · <old role>", `rediscover.ts:41`); the feed copy is "X splňuje laťku pro
  <role>" (`cs.json:1909`) — a **score restatement**. Nothing says *what changed* or *why
  this role now*. The panel is even thinner than the candidate scan — score + name + prior
  chip, no matched-skill evidence (`RediscoverPanel.tsx:67`).
- **Outreach is drafted *and sent* in one click — she never reads it.** "Oslovit" →
  `useReachOut` POSTs to `/candidates/outreach` (`useReachOut.ts:29`) → the route drafts
  *and* `dispatchOutreach` delivers in the same call (`automation-run.ts:286`,
  `comms-dispatch.ts:160`). There is **no draft-review state** (no `outreach_drafted` event
  exists anywhere). The only feedback is "first-touch message is on its way".
- **Outreach copy is generic, not ČS-branded.** The prompt gets title + company + a skills
  list only; both the LLM prompt and the deterministic body sign off **"Náborový tým" /
  "The hiring team"**, never the bank (`automation.py:321-339`). The deterministic Czech body
  itself is clean and human (a relative strength) — but it's a generic recruiter template
  with no bank voice, no JD-grounded hook, and no `--lang` pin for outreach
  (`automation_cli.py:132` passes none, unlike `prep`).

### Cognitive walkthrough (her lens)
The discover→contact loop *completes* — and the compliance gate genuinely protects her from
the "angry reply / embarrassed bank" scenario she fears. But two things hit her hardest
peeves at once: a rediscovered name shows up with **no why-now** (a recycled name with a
backward label), and the outreach **goes out under the bank's name before she's read a word
of it**. Her single hardest requirement is "would I actually send this from my account?" —
and the design never lets her answer that question before it's sent.

### Scored criteria
- completion ✔ · trust (compliance gate, skipped-surfacing) ✔ · language ✔ (clean Czech UI + deterministic CZ body)
- **missing / senior-quality ✗ (major):** no why-now → `jana-rediscovery-no-whynow`
- **trust ✗ (major):** sent without preview → `jana-outreach-sent-without-preview`
- **senior-quality ✗ (major):** thin, un-branded outreach → `jana-outreach-no-brand-grounding`

---

## Findings table

| id | journey | type | severity | dimension | title |
|---|---|---|---|---|---|
| jana-rediscovery-no-whynow | rediscovery | missing-feature | **major** | missing | Rediscovered candidates carry no WHY-NOW, only a score + backward prior label |
| jana-outreach-sent-without-preview | rediscovery | trust | **major** | trust | "Reach out" sends under the bank's name in one click — no draft review |
| jana-outreach-no-brand-grounding | rediscovery | quality-gap | **major** | senior-quality | Outreach prompt is thin + un-branded; signs off generic "Náborový tým" |
| jana-jobs-scan-no-llm-reasoning | jd-to-shortlist | quality-gap | **major** | senior-quality | Role→candidates scan has no per-candidate verdict/strengths/gaps/probes |
| jana-outreach-no-locale-pin | rediscovery | quality-gap | minor | language | Outreach language keyed off candidate profile, not pinned to ČS locale |
| jana-rediscovery-empty-state | rediscovery | broken-flow | minor | completion | Rediscovery depends on a seeded pool w/ rejected history (fixture/reachability) |
| jana-match-reasoning-provenance-disclosed | jd-to-shortlist | trust | polish | trust | **STRENGTH** — AI-vs-rule-based labeled, verdict bound to real inputs |
| jana-rediscovery-compliance-gate | rediscovery | trust | polish | trust | **STRENGTH** — outreach consent/anonymization-gated before send |
| jana-rediscovery-skipped-surfaced | rediscovery | trust | polish | trust | **STRENGTH** — unscorable past candidates surfaced, not dropped |
| jana-ingested-job-ranks | jd-to-shortlist | broken-flow | polish | completion | **STRENGTH** — ingested (non-seed) roles rank end to end |

---

## First-person feedback — in Jana's voice

Tak. Strukturálně to drží — a pár věcí mě upřímně potěšilo, což se u "AI sourcing" demíček
nestává často.

Začnu tím dobrým, protože si to zaslouží. Když otevřu roli a pustím scan kandidátů, nedostanu
glowující seznam jmen — dostanu **skóre, pásmo spolehlivosti, matched skills s provenance**
(self-declared vs ověřeno!), důvody proč někdo vypadl, a Fair Rank s exportem. *To* je
páka. To je věc, kterou si dokážu obhájit před manažerem, aniž bych musela věřit nějaké
černé skříňce. A Explain fit, kde existuje, poctivě říká, jestli to psal model nebo šablona.
Tohle nechte být — přesně tohle jsem od takového nástroje vždycky chtěla a nikdy nedostala.

Ale teď to, kvůli čemu bych ho dnes ještě nenasadila.

**Rediscovery — moje srdcová záležitost — mi nedává PROČ TEĎ.** Vyjede mi jméno, skóre, a
cedulka "Zamítnut · stará role". To je *minulost*. Já potřebuju vědět, co se *změnilo* — že
zavřel ten chybějící skill, že tahle role sedí tam, kde ta minulá ne. "Splňuje laťku pro X"
není důvod, to je jen to skóre řečené slovy. Tohle je přesně ta recyklované-jméno-bez-příběhu
věc, kterou nesnáším. A panel rediscovery je ještě hubenější než normální scan — ani matched
skills tam nevidím.

A co mě dostalo nejvíc: kliknu **Oslovit**, a ono to ten dopis **rovnou pošle** — pod jménem
banky — a já si ho **nikdy nepřečtu**. Moje úplně první otázka u jakékoli zprávy je "poslala
bych tohle ze svého účtu?", a tenhle design mi tu otázku nedovolí ani položit. A když se na
ten draft podívám v kódu: podpis "Náborový tým", žádný hlas ČS, jen titul a seznam skillů.
Ta česká šablona je slušná, lidská — ale je generická. Pod tohle se nepodepíšu naslepo.

Co mě naopak uklidnilo: než zpráva odejde rejectnutému kandidátovi, **systém zkontroluje
souhlas a anonymizaci** a jinak ji nepošle. To je přesně ta pojistka proti naštvané odpovědi
a trapasu pro banku, které se bojím. Děkuju za to.

Verdikt? **Skvělý stroj, krmený příliš tenkým kontextem — a s jedním "pošli to" tlačítkem,
co mi bere kontrolu.** Dejte mi (1) why-now u každého stříbrného medailisty, (2) náhled a
schválení outreache než odejde, a (3) ten odůvodněný verdikt přímo u kandidátů role, ne jen
v Match tabu obráceně. Pak to peerovi doporučím. Teď bych řekla: "skóre mu věř, ten dopis si
napiš sama."
