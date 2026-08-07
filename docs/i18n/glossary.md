# i18n glossary (termbase) — kp

**What to call things.** One canonical translation per domain term, per locale, so
the same concept never gets two words across the app. Maintained by the
`/i18n-translate` skill; add a row whenever you make a term decision.

Columns: **en** · **cs** · **de** · **fr** · note. Add a column per new locale.

## Domain terms

| en | cs | de | fr | note |
|----|----|----|----|------|
| candidate | kandidát | Kandidat/in | candidat(e) | de+fr agree gender; use inclusive form when unknown |
| role / position / job | pozice | Position / Stelle | poste | Jobs tab: cs "Pozice", de "Stellen", fr "Postes". Prefer this over "role". |
| job description (JD) | popis pozice | Stellenbeschreibung | fiche de poste | JD tab: "Popisy pozic" / "Stellenbeschreibungen" / "Fiches de poste" |
| pipeline (funnel) | pipeline | Pipeline | pipeline | loanword kept. Pipeline nav TAB = "Nábor"/"Recruiting"/"Recrutement" (product area) |
| stage | fáze | Phase | étape | pipeline stage |
| screening / to screen | prověřit / screening | Screening / prüfen | présélection / évaluer | noun kept as loanword; verb translated |
| match (activity) | párovat / párování | Matching / abgleichen | matching / rapprochement | Match tab: "Párování" / "Matching" / "Matching" |
| match / fit (result) | shoda | Match / Eignung | correspondance | "great match" = skvělá shoda / gutes Match / bonne correspondance |
| decision | rozhodnutí | Entscheidung | décision | Decisions tab accordingly |
| offer | nabídka | Angebot | offre | job offer |
| hire / hired | přijmout / přijat | einstellen / eingestellt | recruter / recruté(e) | status "Hired" |
| schedule (verb/area) | plánování | Planung / planen | planification / planifier | Schedule tab |
| interview | pohovor | Interview / Gespräch | entretien | "first round" = první kolo / erste Runde / premier tour |
| scorecard | scorecard | Scorecard | scorecard | loanword kept |
| sourcing | sourcing | Sourcing | sourcing | loanword kept |
| automation pass | (automatický) průchod | Automatiklauf / Durchlauf | passe d'automatisation | "Run pass" = Spustit… / Automatiklauf starten / Lancer la passe |
| advance (candidate) | postoupit | weiterleiten | faire avancer | stat line uses count-invariant form (see style guides) |
| reject | zamítnout | ablehnen | rejeter | |
| hold | pozdržet | zurückhalten | mettre en attente | |
| flag / alert | označit / upozornění | markieren / Hinweis | signaler / alerte | |
| consent | souhlas | Einwilligung | consentement | GDPR |
| workspace | pracovní plocha | Arbeitsbereich | espace de travail | |
| recruiter | recruiter / náborář | Recruiter | recruteur | |
| onboarding | onboarding | Onboarding | onboarding / intégration | loanword kept (nav tab too) |
| CV / résumé | CV / životopis | Lebenslauf / CV | CV | body prose may spell out; short labels keep CV |
| control center | řídicí centrum | Kontrollzentrum | centre de contrôle | pipeline.controlCenter dock |
| guided tour / demo | řízená prohlídka / ukázka | geführte Tour / Demo | visite guidée / démo | the simulation |
| operations | provoz | Betrieb | opérations | ops-deck subtitle |

## Do-Not-Translate

Keep verbatim in every locale: **KandiDate**, **Kandidate**, **Candi**, **KP**,
**AI**, **ATS**, **SSO**, **SCIM**, **DPO**, **STAR** (method), **ElevenLabs**,
**OpenAI**, **Gemini**, product/model proper nouns, URLs, code identifiers, enum
codes, and every ICU placeholder name (`{count}`, `{role}`, `{label}`, …) and
keyword (`plural`, `select`, `#`).

## Notes on inconsistency in the source

- The **Pipeline** tab is localized (cs "Nábor") while inline "pipeline" stays a
  loanword — intentional: the tab names the product area, the inline word names
  the technical funnel. Keep both in every locale.
- "screen" splits verb vs noun (screening) — mirror the source; don't force one.
- Per-language voice/typography/plural rules live in `style-<locale>.md`
  (de capitalizes ALL nouns; fr needs narrow-NBSP before `; : ! ?` and guillemets
  `« … »`; cs/de use `„…"`).
