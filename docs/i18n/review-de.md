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
