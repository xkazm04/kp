# French (fr) — native-review queue

Strings the `/i18n-translate review fr` pass left for a **native speaker** to confirm — subjective calls, unsettled domain/legal terms, or house-style decisions. High-confidence fixes were already applied to `messages/fr.json`; these are the remaining judgment calls (AI-flagged, need human sign-off).

| key | note |
|-----|------|
| `library.result.openPipeline` | Same English « Open Pipeline » is rendered « Ouvrir le pipeline » here but « Ouvrir Recrutement » in channels.openPipeline. Glossary localizes the Pipeline nav tab as « Recrutement ». A native should pick one: does this CTA target the tab (→ « Ouvrir Recrutement ») or read as the funnel loanword? |
| `report.panel.candidate` | « Candidat(e) » (inclusive) here vs plain « Candidat » in jobs.candidates.auditCandidate, scheduleTab.transcript.roleCandidate and history.colCandidate. Glossary allows candidat(e); native should standardize one form for these generic labels/column headers. |
| `decisions.groupEval.skillStrongTitle` | The whole decisions namespace omits the narrow NBSP (U+202F) before % that pipeline/analytics/results use consistently. Add U+202F before % in the ~14 percent-bearing keys: recAriaConfidence, recConfidenceSuffix, aiReview.pricingBasis, rules.ruleSentence, compliance.aiCheckIntro/anyAdverse/noAdverse, wave.reasons.rejectWould/rejectDid, summary.skillStrengthTitle, groupEval.skillStrongTitle/skillPartialTitle/salaryOver/salaryUnder/weight. |
| `decisions.reconsiderHelp` | 'remettre en présélection' names the Screened stage via the activity noun, not the stage label 'Présélectionné' (enums.stage.Screened). Decide whether to reference the stage label per the stage-name consistency rule or keep the more natural phrasing. |
| `analytics.log.kinds.rematched` | 'Rematché'/'Matché' (also rematched_from, matched) are franglais; the app renders the match verb natively elsewhere ('mis en correspondance'; pipeline.result.task.rematch = 'Nouveau matching'). Pick a canonical form and apply across these log kinds. |
| `analytics.declinedSub` | '{count} déclinés' vs the app's 'refuser/refusée' for a candidate declining an offer. Unify, but keep the reject (recruiter rejects) vs decline (candidate declines) distinction legible in the stat card. |
| `analytics.log.kinds.onboarding_started` | 'Onboarding démarré' and onboarding_failed ('de l'onboarding') use the raw loanword while the rest of the app — and the sibling onboarding_reminder_sent — use 'intégration'. Glossary sanctions both; choose one for the decision log (mind fem. agreement if switching: 'Intégration démarrée'). |
| `comms.interviewInvite.body` | Masculine forms for unknown-gender recipients ('Vous êtes invité'; offer.expiredBody 'intéressé'; interviewerBrief.body 'prévu') diverge from status.json's inclusive '(e)' convention. Apply neutral phrasing or '(e)' per the FR style guide. |
| `pipeline.tab.selectedCount` | Terse counters ('{count} sélectionné', bulkMoved/bulkAccepted/bulkRejected, passAdvanced) use an invariant singular participle, and '=1 {…} other {# …s}' keys (today.*, offerSent.title/titleQueued, queuedBanner, command.doneCount) render 0 with the plural noun. French wants agreement / singular-for-0 — verify count>0 display guards or move to one/other with agreement. |
| `analytics.log.kinds.outreach_sent` | 'Prise de contact' for outreach vs pipeline's 'approche'/'message d'approche' (pipeline.actions.outreach, result.task.outreach). Minor term inconsistency; unify if desired. |
| `landing.trust.human.body` | 'Aucun candidat n'est fait avancer...' — the passive of the glossary verb 'faire avancer' is non-idiomatic. A native would likely prefer 'Aucun candidat n'avance, ne reçoit d'offre ni n'est rejeté par la machine seule.' Rephrase is a judgment call. |
| `match.shared.koReasonsNote` | French 'one' covers 0 and 1, but the verb/pronoun sit outside the plural block: for count=1 it reads '1 poste ... n'ont pas passé le cap — parce qu'ils {reason}' (number disagreement). Needs an ICU restructure; the {reason} interpolation (likely a plural verb) makes a clean singular branch uncertain — native to decide. |
| `matrix.probes` | 'Interview probes' is rendered 'Questions d'entretien' here but 'Points à creuser en entretien' in match.shared.interviewProbes — same concept, two ways. Unify (direction is a judgment call; matrix is a dense popover where the shorter form may be intentional). |
| `jobMarket.salary.medior` | Seniority 'Medior' kept verbatim here, but enums.seniority.medior is translated 'Confirmé'. Same level rendered two ways across namespaces — pick one (jobMarket may intentionally mirror the ISPV band taxonomy). |
| `match.tab.noAnalyses` | 'lancez-en une dans Analyser' points at the Analyze tab, whose label is 'Analyse' (noun, per nav.tabs.analyze and profile.matrix.emptyBody). Parallel key noProfiles correctly says 'dans Profil'. Consider 'dans Analyse' for navigational consistency. |
| `aboutPage.steps.hired.body` | 'check-list' here vs 'checklist' used throughout the onboarding namespace. Trivial spelling unification — both valid French; pick one house form. |

_16 items._

## Queued by the 2026-08-04 `aboutPage` (/about) review

Namespace-scoped pass over `aboutPage` only. Framing verdict: **product**, not
company. Fixed: missing U+202F before ";" in `steps.screen.body`; "relais
d'intégration" → "passage à l'intégration" (*relais* is the comms delivery relay
per the glossary); « recruté » → « Recruté » to match `enums.stage.Hired`;
"check-list" → "checklist" (resolves the item above); and the stacked
appositives in `steps.interview.body`. Left for a native:

| key | note |
|-----|------|
| `aboutPage.steps.screen.body` | "un exercice pratique … — un exercice qui présuppose" repeats *exercice* inside one sentence. The resumptive is grammatical; a copywriter might elide it. |
| `aboutPage.steps.interview.title` | "Puis il parle aux gens" — *il* has no antecedent (en's "it" = the system). Same issue in de. |
| `aboutPage.*` apostrophes | Kept the straight `'` used by ~87 % of the fr catalog (1466 straight vs 216 typographic). A catalog-wide switch to U+2019 is a separate sweep. |

_3 items._

## Queued by the 2026-08-04 landing-page review (namespace `landing` only)

9 keys fixed in `messages/fr.json`; these were deliberately left alone.

| key(s) | severity | note |
|--------|----------|------|
| **AI vs IA, catalog-wide** | major | `landing` was unified on **AI** this pass (nav.trust, features.cases.body, previews.cases.note) — the same page already said AI in ~10 places, and the section rail put "IA responsable" beside "Une AI puissante". But the split is app-wide: 93 AI vs 25 IA across `messages/fr.json`. A native French product would almost certainly prefer **IA** everywhere; the glossary Do-Not-Translate list says AI. One house decision, then one sweep. |
| `landing.nav.about` | minor | "À propos de l'app" is a mild anglicism; "À propos de l'application" is the correct professional register. Left as-is only because `jobMarket.nav.about` carries the identical value and that namespace is owned elsewhere — change both together. |
| `landing.pricing.enterprise.blurb`/`capabilities[1]` | minor | "cloisonnée par **locataire**" for multi-tenant scoping reads as an apartment renter. French SaaS usually keeps "par tenant" or says "par organisation". de solves it with "mandantenbezogen". |
| `landing.pricing.tiers.*.features` ("cas dev conçu(s)") | minor | Renders the metered unit "dev case **design**" as a past participle ("designed"), shifting the meaning. "1 / 5 / 20 conception(s) de cas dev" is accurate but heavier in a bullet. |
| `landing.hero.ctaPrimary` | minor | "Présélection gratuite" is a noun phrase where en is an imperative; the fr style guide asks for vous-form imperatives. French CTAs tolerate noun phrases ("Essai gratuit"), so left. |
| `landing.pile.jana.role` | minor | "Développeuse React" is feminized to the named candidate while de keeps the generic masculine — the same gender-form policy question already queued for `match.tab.candidate`. |
| `landing.cta.body` | minor | "Laissez KandiDate l'en sortir" is grammatical but literary; "aller la chercher" is warmer for a closing CTA. |
## Queued by the 2026-08 `jobMarket` (/market) review

| key(s) | severity | note |
|--------|----------|------|
| `jobMarket.map.median` | major (fixed) | Was "Revenu médian" — *revenu* is income in general (household, capital), while the figure is an ISPV employment wage. Changed to "Salaire médian"; `salary.subtitle` and `orgTypes.subtitle` moved off "Revenus/Revenu" for the same reason. Confirm "salaire" over "rémunération" as the house term for this page (the tile label is very tight, which is why "rémunération médiane" was not used). |
| `jobMarket.demand.share`, `demand.shareTiny`, `orgTypes.subtitle`, `footer.coverage` | minor (fixed) | Missing U+202F before `%` and `:` — the same gap logged for the `decisions` namespace. Now aligned with `hero.updated`/`map.range`. |
| `jobMarket.map.range` | minor | "Les 50 % du milieu" → "Les 50 % centraux". A statistician may prefer "La moitié centrale gagne entre {lo} et {hi}", which reads better but restructures the sentence. |
| `jobMarket.families.frontline_service`, `.sales_marketing` | minor | Shortened for the JD filter chip and aligned to `enums.family` ("Service de terrain", "Vente et marketing"). `education_academic` ("Éducation et milieu universitaire") is still ~50 % longer than its English source in the same chip row — left alone for want of a shorter faithful form. |
| `jobMarket.salary.medior` | minor | Still the open item above: "Medior" verbatim here vs "Confirmé" in `enums.seniority`. |

## Queued by the 2026-08 `simulation` (public guided demo) migration

| key(s) | severity | note |
|--------|----------|------|
| `simulation.criteria.skills.name` | minor | "Correspondance des compétences" is about twice the width of en's "Skills match" in a three-column table. Faithful, but if the column wraps, "Compétences" alone would do — the header already says "Critère". |
| `simulation.status.done` | minor | "Terminé — poste pourvu 🎉" reframes en's "candidate hired" from the role's side (and avoids the gender agreement of *recruté(e)*), matching the cs/de call. `pipeline.controlCenter.hired` still says "Recruté 🎉". |
| `simulation.log.*` past participles | minor | "bloqué", "rejetés", "avancés", "matchés" take the generic masculine for candidates of unknown gender — the same policy question already queued for `match.tab.candidate`. |
| `simulation.diagram.*` | minor | Narrow-NBSP typography is applied to diagram TITLES ("Sourcing : publier…") but not to node labels, which carry no two-part punctuation. Nothing to fix; noted so a later pass does not "correct" it. |
