# German (de) — native-review queue

Strings the `/i18n-translate review de` pass left for a **native speaker** to confirm — subjective calls, unsettled domain/legal terms, or house-style decisions. High-confidence fixes were already applied to `messages/de.json`; these are the remaining judgment calls (AI-flagged, need human sign-off).

| key | note |
|-----|------|
| `apply.script.greeting` | 'Bewerben wir Sie für {jobTitle}…' is non-idiomatic: 'bewerben' is reflexive (sich bewerben) or transitive 'to advertise', so this reads as 'let's advertise you'. Suggest 'Starten wir Ihre Bewerbung für {jobTitle} bei {company}.' Same issue in apply.script.greetingCompany. Left as-is because the natural rewrite is a copywriting/tone choice. |
| `match.dims.skills` | 'skills' is rendered 'Skills' throughout match (dims.skills, csv.matchedSkills/missingSkills, card 'Skill'), but 'Fähigkeiten' in profile/analyze/apply/jobMarket for the same concept. Style guide's kept-loanword list omits Skills, yet 'Skills' is idiomatic in DE tech/HR — pick one term app-wide. |
| `matrix.probes` | 'Interview probes' = 'Interview-Fragen' here but 'Interview-Nachfragen' in match.shared.interviewProbes. Same concept, two renderings — unify (both are acceptable German). |
| `match.tab.candidate` | Whole DE consistently uses generic-masculine 'Kandidat/Kandidaten', but glossary specifies inclusive 'Kandidat/in' when gender is unknown, and apply.json example placeholders mix in '/in' forms ('Entwickler/in', 'Analyst/in'). Decide one gender-form policy and apply it app-wide. |
| `channels.intro / channels.received / channels.items.*` | Pipeline stage labels render as „Angenommen" (Accepted) and „Geprüft" (Screened). These read consistently within channels, but the enums.stage.* namespace was not in this audit set — verify these match the canonical enum labels so prose and chips agree app-wide. |
| `report.factorRole` | "Role" scoring factor is "Rolle"; glossary prefers Position/Stelle over "Rolle". As a scoring-dimension label (role fit) it may be intentional — confirm with a native whether "Rolle" or "Position" is wanted here. |
| `interviewSim.simulating` | "Simuliere <b>{name}</b>{job}" uses a first-person/casual progress form, while the rest of this file uses passive ("… wird erstellt/geladen"). Consider "Simulation: <b>{name}</b>{job}" or "Simuliert <b>{name}</b>{job}" for register consistency. |
| `scheduleTab.humanLedChip` | "Human-led" → "Persönlich geführt" may be misread as "in person"; the concept (human vs AI) is elsewhere "Von Menschen geführt" (jobs.compare). Native check on the shortest chip-safe wording. |
| `jobs.tab.allModes / jobs.table.colMode / jobs.tab.filterWorkMode` | Work mode (remote/hybrid/onsite) is "Modell"/"Alle Modelle"/"Arbeitsmodell". Standalone "Alle Modelle" is loose and could be confused with AI "Modelle"; consider "Arbeitsmodus"/"Arbeitsweise". Judgment call for a native. |
| `pipeline.board.rankCandidates` | 'ranken' is an anglicism/false friend (standard German 'ranken' = plants climbing). Consider 'reihen', 'einstufen' or 'nach Eignung ordnen'; replacement is a judgment call. |
| `comms.there` | Fallback 'zusammen' produces 'Hallo zusammen,' — a group greeting — in a 1:1 candidate email. Template forces a token, so it needs a native-approved singular fallback. |
| `comms.interviewerBrief.body` | 'Live-Bewertungsmatrix' renders 'rubric' differently from pipeline (fixedRubric/humanScorecardNote use 'Bewertungsraster'). Pick one term for 'rubric'. |
| `pipeline.drawer.humanScorecard` | 'Manuelle Scorecard' vs decisions.aiReview.tagHumanScorecard 'Menschliche Interview-Scorecard' — 'human (scorecard)' rendered two ways; the app elsewhere uses 'menschlich/Mensch' for 'human'. |
| `analytics.declinedSub` | 'declined' = 'abgesagt' here but 'abgelehnt' in log.kinds.offer_declined; 'abgesagt' usefully disambiguates from 'rejected'='abgelehnt' in the adjacent stat, but confirm the intended term. |
| `status.notSelectedBody` | Doubled preposition: 'sich für diese Position für andere Kandidatinnen … entschieden' reads awkwardly; consider 'bei dieser Position'. Stylistic. |
| `decisions.row.candidateCount` | Gendering inconsistency across namespaces: pipeline uses inclusive 'Kandidat/in', but decisions/analytics use generic 'Kandidat', and status/comms use 'Kandidatinnen und Kandidaten'. Glossary asks for inclusive form; needs one contentious house-style decision (pervasive, not fixed here). |
| `pipeline.tab.searchLabel` | 'role/position' is 'Position(en)' in pipeline but 'Stelle(n)' in decisions/analytics. Glossary sanctions both, so confirm whether the split is intentional or should be unified. |

_17 items._

## Queued by the 2026-08-04 `aboutPage` (/about) review

Namespace-scoped pass over `aboutPage` only. Framing verdict: **product**, not
company. One key fixed (`steps.screen.body`: Rolle → Stelle, and the colloquial
"rausgehen" → "verschickt werden"). Left for a native:

| key | note |
|-----|------|
| `aboutPage.steps.source.title/body` | "eine gerankte Shortlist" / "rankt sie" — the same *ranken* anglicism already queued for `pipeline.board.rankCandidates`. This is a public marketing page, so it is the strongest argument for settling that row ("sortierte Shortlist" / "stuft sie ein"). Not changed unilaterally. |
| `aboutPage.steps.design.title` | "Stelle beschreiben. Rubrik erhalten." is infinitive-headline German while the rest of the page uses Sie ("Begleiten Sie", "Scrollen Sie"). Idiomatic as a headline; confirm the register mix is wanted. |
| `aboutPage.steps.interview.title` | "Dann spricht es mit Menschen" — the *es* has no antecedent in German (en's "it" = the system). fr has the same issue. Consider naming the subject. |
| `aboutPage.steps.screen.body` | "Jede Bewerbung" where en says *each candidate*; fr made the same swap independently. Minor accuracy drift that reads better — confirm. |

_4 items._

## Queued by the 2026-08-04 landing-page review (namespace `landing` only)

8 keys fixed in `messages/de.json`; these were deliberately left alone.

| key(s) | severity | note |
|--------|----------|------|
| **AI vs KI, catalog-wide** | major | `landing` was unified on **AI** this pass (nav.trust, features.cases.body, previews.cases.note), because the same page already said AI in ~8 places and the section rail put "Verantwortungsvolle KI" directly beside "Leistungsstarke AI". But the split is app-wide: 92 AI vs 26 KI across `messages/de.json` (`library.tab.*`, `devcase.*`, `agentFit.*`, `setup.*`, `decisions.*` all say KI). Needs one house decision plus a single sweep — do not half-sweep further. |
| `landing.nav.trust` | minor (length) | "Verantwortungsvolle AI" is 22 chars in the SectionRail, whose label column is capped at `max-w-[12rem]` (192px) with `overflow-hidden`. It fits at 15px bold but with no margin. "Verantwortliche AI" (18) is shorter but reads as *liable* rather than *responsible*. |
| `landing.nav.market` | minor | Changed "Market Pulse" → **"Marktpuls"** (cs/fr both localize it; it is descriptive, not on the glossary Do-Not-Translate list). Revert if "Market Pulse" is meant as a sub-brand — in which case cs/fr need reverting too. |
| `landing.trust.human.title` | minor | "Human in the Loop" left in English. Standard in German AI-governance writing, but cs/fr both translate it. |
| `landing.features.score.body` | minor | "mit belegbaren Nachweisen" is a pleonasm (provable proofs); "mit den Nachweisen dazu" is tighter. |
| `landing.features.offer.body` ("Rollenband") | minor | "Passung" → "Eignung" was fixed; "Rollenband" still uses *Rolle* where the glossary prefers Position/Stelle (de uses "Stelle" elsewhere on this page). Same open question as `report.factorRole`. |
| `landing.hero.pileHint` | minor | Mixes a Sie-imperative with a bare infinitive ("Probieren Sie's — über den Stapel fahren"). Fine as a handwritten aside; flag only. |
| `landing.pricing.heading` | minor | "Winzige Preise" is a literal read of "Tiny prices"; "Mini-Preise" is the more usual German marketing form. |
## Queued by the 2026-08 `jobMarket` (/market) review

| key(s) | severity | note |
|--------|----------|------|
| `jobMarket.map.legendScale` | critical (fixed) | "(Mittelwert {mid})" claimed an **arithmetic mean**; `{mid}` is the midpoint of the colour scale (`(min+max)/2` in `MarketPulseAtlas.tsx:56`). Changed to "(Mitte {mid})". Confirm the wording; "Mittelwert" on a page publishing real wage statistics is a factual claim. |
| `jobMarket.orgTypes.subtitle`, `footer.coverage` | major (rewritten) | Both were rewritten for the ÚP-counts / ISPV-earnings split. The ISPV wage spheres (Czech *mzdová sféra* / *platová sféra*) are rendered "Unternehmens-" / "öffentliche Lohnsphäre"; RSCP is glossed with its Czech name. A native economist should confirm the German sphere terminology. |
| `jobMarket.map.median` "Medianverdienst" vs `map.a11yMedian` "Mediangehalt" | minor | Same figure, two words — inherited from the en source, which likewise says "Median earnings" on the tile and "median salary" in the a11y label. Left aligned to en. |
| `jobMarket.map.topRegions` | minor | "Meiste Stellen" is telegraphic; "Die meisten Stellen" or "Top-Regionen" may read better in the card heading. |
| `jobMarket.families.data_ai` | minor | "Daten & AI" here, "Data / AI" in `enums.family`. Same open AI/KI + loanword question as elsewhere. |

## Queued by the 2026-08 `simulation` (public guided demo) migration

| key(s) | severity | note |
|--------|----------|------|
| `simulation.phase.design` | minor | "Ausschreibung", not the glossary's "Stellenbeschreibung": the phase pills sit seven across and the glossary term overflows the row. The style guide sanctions shortening the label rather than the meaning, but this is the one place de departs from the termbase — confirm, or pick a shorter faithful alternative. |
| `simulation.status.done` | minor | "Fertig — Stelle besetzt 🎉" reframes en's "candidate hired" from the role's side, matching the cs call. `pipeline.controlCenter.hired` still says "Eingestellt 🎉". |
| `simulation.diagram.*` | minor | Diagram node labels are capped by the SVG box width, so compounds were kept short ("Multifaktor-Scoring", "Stellen-Entwurf", "Pool: Angenommen"). A native may prefer fuller forms if the renderer wraps them acceptably. |
| `simulation.criteria.*` | minor | Keeps the English loans the de style guide sanctions ("Skills-Match", "Karriere-Fit", "Kontext-Fit", "Interview-Scorecard") in a table that otherwise reads German. Consistent with the glossary, but a dense cluster. |
