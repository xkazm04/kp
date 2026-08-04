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
| reject | zamítnout | ablehnen | rejeter | cs: reserve **odmítnout** for the *candidate* declining (an offer/a role) — the recruiter/system side is always "zamítnout" |
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
| board (pipeline board) | nástěnka | Board | tableau | cs: never "tabule" — unified 2026-08 |
| evidence (proof) | důkaz | Nachweis | preuve | cs **false friend**: "evidence" = record-keeping, not proof. `profile.evidence.*` still uses it — queued |
| tamper-evident | odolný proti manipulaci | manipulationssicher | inviolable | never "nezfalšovatelný" (overclaims) or "neměnný" (= immutable) |
| relay (delivery) | relé | Relay | relais | the comms delivery relay; not left in English |
| lead (group-eval top candidate) | favorit | Spitzenkandidat/in | favori | cs: "vedoucí" reads as *manager*; "lídr" was a third variant — unified 2026-08 |
| per hire | na jedno přijetí | pro Einstellung | par recrutement | cs: not "na nábor" (= per recruitment drive); cf. hire → přijmout/přijat |
| Google Calendar | Google Calendar | Google Calendar | Google Calendar | product proper noun, kept verbatim (not "Google Kalendář") |
| screening wave | vlna screeningu | Screening-Welle | vague de présélection | the first automated decision pass (`simulation.wave.*`, `decisions.wave.*`) |
| decision criteria | kritéria rozhodování | Entscheidungskriterien | critères de décision | the explainer drawer's table (`simulation.explainer.criteriaTitle`) |
| intake | příjem | Eingang | réception | the pipeline's front door — candidates arriving from all channels; distinct from *sourcing* (proactive only) |
| organization | organizace | Organisation | organisation | the customer company; the tenancy root above *team*/*workspace* |
| member (of the org) | člen | Mitglied | membre | a seat on the roster, not a candidate |
| owner (role) | vlastník | Inhaber | propriétaire | the `owner` role slug — the only one carrying `org:manage` |
| admin (role) | administrátor | Administrator | administrateur | the `admin` role slug |
| hiring manager (role) | hiring manažer | Hiring Manager | hiring manager | half-loanword in all three; matches `setup.steps.team.blurb` |
| viewer (role) | čtenář | Betrachter | lecteur | read-only seat; cs deliberately *čtenář*, not *prohlížející* |
| invite (noun/verb) | pozvánka / pozvat | Einladung / einladen | invitation / inviter | |
| revoke (an invite) | odvolat | zurückziehen | révoquer | cs: **odvolat**, never *zrušit* — *zrušit* is the Cancel button beside it |
| permission | oprávnění | Berechtigung | autorisation | the per-user overrides in the Organization console |
| capability | oprávnění | Berechtigung | autorisation | the `Capability` slug; folded into *permission* in the UI — the split is internal only |

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
- **Two rows below are contested by the catalog itself** and are queued for a
  native/house decision in `review-cs.md`, not silently applied: **workspace**
  (glossary says *pracovní plocha*, the catalog overwhelmingly says *pracovní
  prostor*) and **scorecard** (glossary keeps the loanword, the product UI says
  *hodnoticí karta* in ~30 keys and only `landing`/`aboutPage` marketing copy
  keeps "scorecard"). Do not unify either until it is settled — a half-sweep is
  worse than the split.
- Per-language voice/typography/plural rules live in `style-<locale>.md`
  (de capitalizes ALL nouns; fr needs narrow-NBSP before `; : ! ?` and guillemets
  `« … »`; cs/de use `„…"`).
