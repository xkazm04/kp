# L1 theoretical — Jana Horáková (Senior Sourcer) × jd-to-shortlist

- **Run:** 2026-07-02-full · main @ 3395b4c · cert level: **L1** (no browser)
- **Verdict: L1-conditional** — from a role I reach an actionable, provenance-rich ranked pool
  in one click, and the archetype-fair machinery genuinely surfaces non-obvious people; but
  the per-candidate "why" narrative isn't on this surface (shared major), and a legacy-analysis
  candidate is scored under a DIFFERENT archetype here than on the Match tab — the exact
  black-box inconsistency I hunt for in vendor demos.
- **Journey grounding score:** ranking **4.5/6** · reasoning **6/8 profile / 4/8 analysis**
  (same audit as Petra's report §2 — shared surfaces).
- **Estimated time-saved-if-it-all-worked:** ≈ **3–5 h per role** on the "re-read the saved
  pool / who do we already have" slice of her ~13 h/role sourcing baseline (scan = one click,
  ranking in seconds–minutes) · confidence **low-medium** — this journey covers only the saved
  pool, not external sourcing, and the pool is silently capped (JTS-L1-08).

## 1 Surface model (what I actually touch — deltas from Petra's §1)

Shared with Petra: Jobs tab → `JobPostingModal` → candidates tab → `RecruiterCandidates`
→ `GET /api/jobs/[id]/candidates` → `buildCandidatePool()` → `recruiter_cli` ranking
(file:line map in `petra-recruiter--jd-to-shortlist.md` §1). My binding-specific affordances:

- **Pool Fit filter** — eligible, ≥55, NOT yet in this role's pipeline: the "who should I
  source for this role" subset (`RecruiterCandidates.tsx:43-46,112-119,176-188`). This is a
  real sourcing lens, not decoration.
- **Fair Rank + fairness audit** — rank by robust cross-scheme mean, own-vs-robust delta per
  candidate, full per-scheme CSV export (`RecruiterCandidates.tsx:128-164,189-201,281-345`;
  engine `recruiter.py:28-47`, `matching.py:664-675`). Provenance I can interrogate. ✓
- **"Reach out"** on each row (`RecruiterCandidates.tsx:484-496`, `useReachOut`) — outreach
  itself is out of scope here (sourcing-rediscovery journey); noted as present with persisted
  sent-state (`route.ts:43-54`).
- **Non-obvious leverage in the engine:** early-career/switcher candidates are scored on
  potential with learning signals + transferable skills + domain distance carried per row
  (`recruiter.py:70-78`), and the two fairness tracks are structural, never a flat sort
  (`recruiter.py:19-25,87-90`). A Boolean string cannot do this — this is the part that
  finds "the one whose title doesn't match but whose work does".

## 2 Grounding audit

Same two surfaces as Petra §2 (ranking 4.5/6; reasoning 6/8 profile / 4/8 analysis). My
additions, from the sourcing angle:

- **Pool composition = the grounding.** `buildCandidatePool()` unions v2 profiles (cap 100)
  + saved analyses (cap 60) (`candidate-pool.ts:17-19,46-66`). Above ~160 candidates the
  overflow is **never scored** and the only trace is a server `console.warn`
  (`candidate-pool.ts:51,59`) — invisible to me. At ČS volume that means my "ranked pool"
  silently isn't the pool. → JTS-L1-08.
- **Legacy-analysis archetype fork.** The pool builder hardcodes `archetype: "bau"` for an
  analysis without a v2 profile (`candidate-pool.ts:41`), while the Match/reasoning resolver
  deliberately uses the fail-closed `"unknown"` sentinel for the SAME case — with an explicit
  comment that "bau" *"would apply the seniority KO floor and strip the fairness shield from
  a student/switcher"* (`match-candidate.ts:50-56`; KO behavior `matching.py:256-269`). So a
  student whose analysis lacks a v2 profile can be **KO'd on my job-side shortlist** yet score
  fairly on the Match tab. Two surfaces, two answers, no explanation. → JTS-L1-02.

## 3 Reachability (before judging)

Jana binds to **Channels, Match, Jobs (candidates/outreach/rediscovery)**
(`uat/characters/jana-sourcer.md`). Jobs modal candidates tab + Match tab: **reachable**
(no per-role gating, `tabs.ts:98-153`). Matrix (the only job-side reasoning popover) is
outside my set — same effort penalty as Petra. Fixture gates: non-empty seeded pool
(else `route.ts:21-23` empty note → JTS-L1-07); past-applicant data matters for my
rediscovery journey, not this one. Rediscovery affordances (`RediscoverPanel`,
`RediscoveryFeed`) are visible from the same modal/tab but **out of scope here** —
judged in `sourcing-rediscovery.md`.

## 4 Cognitive walkthrough (in character)

1. *Will I try it?* Role → "Kandidáti" → auto-scored. One click fewer than I expected. ✓
2. *Notice the controls?* Pool Fit and Fair Rank are visible chips with counts and
   aria-pressed states (`RecruiterCandidates.tsx:176-201`). ✓
3. *Label→effect?* "Spravedlivé pořadí" + inline note when active (`:207`) — yes.
4. *Feedback?* Loading, per-row persisted reached/filed state — I can't double-spam a
   candidate I touched yesterday (`RecruiterCandidates.tsx:443-459`, `route.ts:37-54`). ✓
5. *Does it advance my job at my bar?* Mostly. Every surfaced match carries a basis I can
   repeat: matched skills vs THIS job's requirements with provenance badges, missing
   must-haves, KO reasons, confidence drivers, potential/transferable evidence for the
   non-obvious profiles. What it does NOT carry is the narrative "why he fits" sentence —
   for that I detour per candidate (shared JTS-L1-01). And "found these — found them how?"
   I can actually answer here (deterministic scoring + visible drivers + audit CSV), which
   is rare and worth saying.
6. *Trust?* High on the scoring layer; dented by the archetype fork (JTS-L1-02): if I ever
   see the same person KO'd here and "promising" on Match, I stop trusting both.

## 5 Scored acceptance criteria

| Criterion | L1 result |
|---|---|
| completion — role → actionable matches, outreach + rediscovery initiable, no dead-end | **✓ (scoped)** — matches + initiation affordances present; outreach/rediscovery quality judged in their own journey |
| senior-quality/trust — every match shows a reason tied to THIS role, grounded in the real profile | **~** — skills-vs-requirements + KO + drivers ✓ on-surface; narrative why lives one detour away (JTS-L1-01) |
| missing/senior-quality — rediscovered candidate carries why-now | **n/a here** — rediscovery is `sourcing-rediscovery.md`'s DoD |
| senior-quality — outreach copy send-ready under ČS name | **n/a here** (out of scope per journey file) |
| trust — provenance/basis I can interrogate, no black box | **✓ with one crack** — provenance badges, fairness audit + per-scheme CSV (`RecruiterCandidates.tsx:281-345`) ✓; the cross-surface archetype fork is a black-box crack (JTS-L1-02) |
| time-saved — minutes vs ~13 h/role, leverage beyond the obvious | **✓ conditional** — one-click ranked pool ✓; leverage = potential/transferable/fair-rank ✓; bounded by the silent 160 pool cap (JTS-L1-08) |
| clarity — dispatch confirms what/whom | **✓** — persisted reached state + per-row feedback (outreach content itself out of scope) |
| language — cs UI + cs copy | **~** — UI cs ✓; engine fragments English (shared JTS-L1-05) |

## 6 Findings (this character; full schema in jd-to-shortlist.findings.json)

- **JTS-L1-02 · major · trust** — legacy-analysis candidates get `archetype: "bau"` in the
  job-side pool (`candidate-pool.ts:41`) but fail-closed `"unknown"` on the Match/reasoning
  path (`match-candidate.ts:56`): seniority KO + fairness-shield stripping on one surface,
  fair scoring on the other, for the same person.
- **JTS-L1-08 · minor · missing (scale ceiling)** — pool caps (100 profiles + 60 analyses)
  silently exclude older candidates from every ranking; warn is server-log-only
  (`candidate-pool.ts:17-19,51,59`). At bank scale my shortlist quietly isn't the pool.
- Co-signed: JTS-L1-01 (no reasoning on shortlist — my "reason I'd repeat to a manager"),
  JTS-L1-05 (English fragments), JTS-L1-07 (empty-pool note dropped). Strengths JTS-S2/S3.

**What passed (protect):** fairness tracks + robust-mean audit with CSV (the anti-black-box
artifact); provenance badges incl. `observed`; skipped candidates surfaced with reasons
(`recruiter_cli.py:66-71`); persisted outreach/filed state so I never re-touch someone.

## 7 l2_priority

1. Same legacy-analysis candidate on both surfaces: KO'd here vs scored there (JTS-L1-02) —
   confirm live with a v2-profile-less analysis fixture.
2. Does the ranking ever show me someone my Boolean string wouldn't have found (a switcher /
   early-career with high potential ranked prominently)? That's my adoption test.
3. Seed >160 candidates and confirm the silent cap (JTS-L1-08) — does the UI say anything?
4. Pool Fit filter against a role with an existing pipeline — counts reconcile with the board.

## 8 Character feedback — Jana, first person (cs)

> Řeknu to narovinu: tohle je první nástroj, kde na otázku „našel je — a JAK?" existuje
> odpověď na obrazovce. U každého vidím, co sedí proti téhle roli, co chybí, proč je skóre
> nejisté, a když kliknu na audit, dostanu celou matici vah do CSV. To se mi u Eightfoldu
> ani SeekOutu nestalo. A ten dvoukolejný žebříček — zkušení zvlášť, potenciál zvlášť,
> s přenositelnými dovednostmi u přeskakujících obory — to je přesně ta páka, kterou můj
> boolean string neumí. Tam bych mohla najít člověka, kterého bych sama minula.
>
> Co mi vadí: ten příběh „proč zrovna on" si musím doklikat oklikou přes Match, kandidáta
> po kandidátovi. A jednu díru jsem našla v kódu, ne v marketingu: kandidát ze staré analýzy
> bez v2 profilu se tady skóruje jako „BAU" — takže studenta může vyřadit senioritní filtr,
> zatímco na Match kartě projde férově. Dva panely, dvě pravdy. Jestli tohle uvidím naživo,
> je to pro mě konec důvěry v oba. A pozor na strop poolu — nad ~160 lidí se zbytek tiše
> neskóruje a dozví se to jen server log. U nás v bance to není edge case, to je úterý.
> Zatím: chci to používat, ale nejdřív mi ukažte, že obě obrazovky říkají totéž.
