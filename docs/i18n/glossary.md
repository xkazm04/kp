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
| role family (the taxonomy) | rodina rolí | Berufsfamilie | famille de postes | The locked 16-family occupational taxonomy, NOT a job opening — this is the one place the *role → pozice* sweep does not apply. Added 2026-08-12: de was running *Berufsfamilie* (11), *Rollenfamilie* (7) and *Berufsfeld* (10) for one concept; swept to *Berufsfamilie* |
| pipeline (funnel) | pipeline | Pipeline | pipeline | loanword kept. Pipeline nav TAB = "Nábor"/"Recruiting"/"Recrutement" (product area) |
| stage | fáze | Phase | étape | pipeline stage |
| screening / to screen | prověřit / screening | Screening / prüfen | présélection / évaluer | noun kept as loanword; verb translated |
| match (activity) | párovat / párování | Matching / abgleichen | matching (noun) / rapprocher (verb) | Match tab: "Párování" / "Matching" / "Matching". fr: *rapprochement* is never a standalone noun here. **cs scope:** "match a filter/search" is the ordinary verb (*odpovídat*), NOT *párovat* — sweeping those is an error |
| match / fit (result) | shoda | Match / Eignung | correspondance | "great match" = skvělá shoda / gutes Match / bonne correspondance. fr: *adéquation* was considered and **rejected** — it had crept into `report.verdict.*`; it is plausible French, so it will return unless this row says no |
| decision | rozhodnutí | Entscheidung | décision | Decisions tab accordingly |
| offer | nabídka | Angebot | offre | job offer |
| hire / hired | přijmout / přijat | einstellen / eingestellt | recruter / recruté(e) | status "Hired". The **person** ("a new hire") is a different word: cs *posila*, fr *(nouvelle) recrue*. Metric labels nominalize: cs *přijetí* ("míra přijetí", "na jedno přijetí") |
| schedule (verb/area) | plánování | Planung / planen | planification / planifier | Schedule tab |
| interview | pohovor | Interview / Gespräch | entretien | "first round" = první kolo / erste Runde / premier tour |
| scorecard | scorecard | Scorecard | scorecard | loanword kept |
| sourcing | sourcing | Sourcing | sourcing | loanword kept |
| automation pass | (automatický) průchod | Automatiklauf / Durchlauf | passe d'automatisation | "Run pass" = Spustit… / Automatiklauf starten / Lancer la passe |
| advance (candidate) | postoupit | weiterleiten | faire avancer | stat line uses count-invariant form (see style guides). **cs split, not drift:** labels, dispositions and the noun are *postoupit / postup*; the explicitly transitive form ("advance {name} to…") takes *posunout*, which Czech idiom prefers. Do not sweep either direction |
| reject | zamítnout | ablehnen | rejeter | cs: reserve **odmítnout** for the *candidate* declining (an offer/a role) — the recruiter/system side is always "zamítnout" |
| hold | pozdržet | zurückhalten | mettre en attente | |
| flag / alert | označit / upozornění | markieren / Hinweis | signaler / alerte | |
| consent | souhlas | Einwilligung | consentement | GDPR |
| workspace | pracovní plocha | Arbeitsbereich | espace de travail | |
| recruiter | recruiter / náborář | Recruiter | recruteur | |
| onboarding | onboarding | Onboarding | onboarding / intégration | loanword kept on **operator** surfaces and the nav tab. cs **candidate-facing** copy says *nástup* ("nástupní podklady", "do nástupního procesu") — a deliberate audience split, not drift |
| CV / résumé | CV / životopis | Lebenslauf / CV | CV | body prose may spell out; short labels keep CV |
| control center | řídicí centrum | Kontrollzentrum | centre de contrôle | pipeline.controlCenter dock |
| guided tour / demo | řízená prohlídka / ukázka | geführte Tour / Demo | visite guidée / démo | the simulation. cs: **"živé demo" is retired** — *živá ukázka* everywhere for the simulation. The loanword survives only for a project's own demo link and the "(demo)" tag on course material |
| operations | provoz | Betrieb | opérations | ops-deck subtitle |
| board (pipeline board) | nástěnka | Board | tableau | cs: never "tabule" — unified 2026-08 |
| evidence (proof) | důkaz | **CONTESTED** | preuve | cs **false friend**: "evidence" = record-keeping, not proof. `profile.evidence.*` still uses it — queued. cs: never *údaje*, *podklady* or *doklad* for this sense; *podklady* is reserved for briefs/materials. **de is contested** — *Nachweis* (39) and *Beleg* (27) both carry the proof sense in large coherent blocks, and part of the Nachweis count is the unrelated credential sense in `skillProfile`. Do not sweep until a native rules |
| tamper-evident | odolný proti manipulaci | manipulationssicher | inviolable | never "nezfalšovatelný" (overclaims) or "neměnný" (= immutable) |
| relay (delivery) | relé | Relay | relais | the comms delivery relay; not left in English |
| lead (group-eval top candidate) | favorit | Favorit | favori | cs: "vedoucí" reads as *manager*; "lídr" was a third variant — unified 2026-08. de corrected 2026-08-12: the row said *Spitzenkandidat/in*, which had **zero sites** in the catalog while all 8 group-eval keys said *Favorit* — the glossary was wrong, not the catalog. Other senses keep their own words: the `lead` seniority slug (DNT), a sales lead from an ad form, "team lead" |
| per hire | na jedno přijetí | pro Einstellung | par recrutement | cs: not "na nábor" (= per recruitment drive); cf. hire → přijmout/přijat |
| Google Calendar | Google Calendar | Google Calendar | Google Calendar | product proper noun, kept verbatim (not "Google Kalendář") |
| screening wave | vlna screeningu | Screening-Welle | vague de présélection | the first automated decision pass (`simulation.wave.*`, `decisions.wave.*`) |
| decision criteria | kritéria rozhodování | Entscheidungskriterien | critères de décision | the explainer drawer's table (`simulation.explainer.criteriaTitle`) |
| intake (candidates) | příjem | Erfassung | réception | the pipeline's front door — candidates arriving from all channels; distinct from *sourcing* (proactive only). de corrected 2026-08-12: *Eingang* appeared **nowhere** in `de.json`; the catalog uses *Erfassung* at 14 sites |
| role intake (the RoleBrief dialog) | zadání pozice | Rollenaufnahme | cadrage (de poste) | **A DIFFERENT FEATURE** from candidate intake, sharing the English word. Scoped to `library.tab.intake.*`, `errors.INTAKE_*`, `models.routing`/`useCaseDesc.role_intake*`. Rendering these as *příjem / Erfassung / réception* would be actively wrong |
| organization | organizace | Organisation | organisation | the customer company; the tenancy root above *team*/*workspace* |
| member (of the org) | člen | Mitglied | membre | a seat on the roster, not a candidate |
| owner (role) | vlastník | Inhaber | propriétaire | the `owner` role slug — the only one carrying `org:manage` |
| admin (role) | administrátor | Administrator | administrateur | the `admin` role slug |
| hiring manager (role) | hiring manažer | Hiring Manager | hiring manager | half-loanword in all three; matches `setup.steps.team.blurb` |
| viewer (role) | čtenář | Betrachter | lecteur | read-only seat; cs deliberately *čtenář*, not *prohlížející* |
| invite (noun/verb) | pozvánka / pozvat | Einladung / einladen | invitation / inviter | |
| revoke (an invite) | odvolat | zurückziehen | révoquer | cs: **odvolat**, never *zrušit* — *zrušit* is the Cancel button beside it |
| permission | oprávnění | Berechtigung | autorisation | the per-user overrides in the Organization console |
| capability | oprávnění | Berechtigung | autorisation | the RBAC `Capability` slug **only**; folded into *permission* in the UI — the split is internal only. The human-**skill** sense (`skillProfile.*`) is a different concept and must not be swept to *oprávnění*: same class of error as sweeping the RBAC sense of *role* |
| kill switch | nouzová brzda | Not-Aus | coupe-circuit | the control room's pause; matches `landing.features.gates.body` |
| reconcile (lifecycles) | synchronizovat | abgleichen | synchroniser | cs follows `tasks.system.reconcileFailures` ("synchronizace"), NOT "srovnat" |
| floor / threshold (a score cut-off) | práh | Schwelle | seuil | promote floor, screening floor, match floor — one word everywhere |
| score band | pásmo skóre | Score-Band | tranche de score | the calibration table's rows; matches `analytics.calibration.bandsTitle` |
| hire rate | míra přijetí | Einstellungsquote | taux de recrutement | share of a band that converted to a hire |
| outcome (recorded) | výsledek | Ergebnis | résultat | what actually happened to a promoted candidate; the `control.outcomes.value.*` triple is neuter/impersonal in cs (*přijato · zamítnuto · staženo*) |
| salary radar (feature) | mzdový radar | Gehalts-Radar | radar des salaires | cs: **mzdový**, never *platový* — *plat* is public-sector pay; the card body and Market Pulse both say *mzda*. Unified 2026-08 |
| applicant (public apply portal) | uchazeč | Bewerber/in | candidat(e) | cs: *uchazeč* is reserved for the PORTAL name (`Portál pro uchazeče`); the person inside the pipeline is always **kandidát** |
| control room | řídicí centrum | Kontrollzentrum | centre de contrôle | `/control`; deliberately the same term as *control center* — one dock, one room, one word |
| rubric (scoring rubric) | rubrika | Rubrik | grille | fr deliberately NOT *rubrique* — a false friend meaning a column/section. The FR HR term is *grille (d'évaluation)*. Settled 2026-08-12 |
| cohort | kohorta | Kohorte | cohorte | cognate in all three; pinned so nobody swaps in cs *skupina* / fr *groupe* and breaks the pairing with *rubric* |
| coachability | trénovatelnost | Feedbackfähigkeit | réceptivité au feedback | the interview-phase construct; aligned with the rubric label already shipped |
| graduate lens | absolventská optika | Absolvent/innen-Perspektive | prisme jeune diplômé | the early-career routing view (`jobs.tab.intro`, `jobs.table.caption`, `jobs.ingest.pasteIntro`) |
| dead letter (undeliverable comms row) | nedoručená zpráva | Dead-Letter | message non distribué | cs/fr spell out the head noun; mail-server jargon does not survive into a recruiter's chip |
| stub (thin candidate record) | neúplný záznam | Stub | ébauche | a record created from CV text too thin to parse |
| decline (recruiter refusing proposed times) | zamítnout | ablehnen | refuser | cs: **zamítnout**, matching *reject*. *odmítnout* stays reserved for the CANDIDATE declining |
| n/a (no measurement) | n/a | k. A. | n.d. | the empty-metric cell. Replaced a bare `—` glyph that carried meaning as punctuation |

**cs grammatical gender of loanwords:** *pipeline* is **feminine** (*ta pipeline*,
"v její pipeline", "samostatná pipeline"). The catalog was already overwhelmingly
feminine; a stray neuter ("v jejím pipeline") was corrected 2026-08-12. Pin the
gender of any new loanword here on first use (see `constructions-cs.md`
CS-LOANGENDER).

## Do-Not-Translate

Keep verbatim in every locale: **KandiDate**, **Kandidate**, **Candi**, **KP**,
**AI**, **ATS**, **SSO**, **SCIM**, **DPO**, **STAR** (method), **ElevenLabs**,
**OpenAI**, **Gemini**, product/model proper nouns, URLs, code identifiers, enum
codes, and every ICU placeholder name (`{count}`, `{role}`, `{label}`, …) and
keyword (`plural`, `select`, `#`).

## Notes on inconsistency in the source

## House decisions (2026-08) — settled, do not re-litigate

| Decision | Ruling |
|---|---|
| **AI is universal** | `AI` in every locale. German `KI` (24 sites) and French `IA` (24 sites) are retired — the catalog already ran 112 / 111 the other way, and both were logged as MAJOR open items. |
| **cs role → pozice** | Swept, 138 strings. **Scoped**: an RBAC role (owner/admin/viewer/hiring manager) is a different concept and keeps *role* — 9 strings deliberately untouched. Sweeping those would be the `CS-HOMONYM` error. |
| **cs moci → moct** | **Rejected.** *moci / mohou* stands. See `constructions-cs.md` → CS-FORMAL. |

Still open, needing one decision then one clean sweep (a half-sweep is worse
than none — the first full run proved it): fr `Impossible de…` vs
`Nous n'avons pas pu…` (189 sites, currently split), fr semicolons (95 sites,
MS bans them outright), fr `JD → offre` vs `fiche`, cs/de *scorecard* and
*workspace*.

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
