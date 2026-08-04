# Czech (cs) — native-review queue

Strings the first `/i18n-translate review cs` pass left for a **native speaker**
to confirm — subjective calls, unsettled domain/legal terms, or house-style
decisions. High-confidence fixes were already applied to `messages/cs.json`;
these are the remaining judgment calls (AI-flagged, need human sign-off).

| key | note |
|-----|------|
| `report.factorRole` | Scoring-factor chart label "Role" is left as the bare word "Role" (identical to en) — valid, naturalized Czech noun, but fr renders the same concept "Poste" (glossary's preferred role/position term) and de's "Rolle" was already flagged as ambiguous in the de review. Confirm whether this chart axis means "position fit" (→ "Pozice") or a narrower "role" concept distinct from the Jobs tab's "Pozice". |
| `report.panel.parserAi` | "AI parser" kept as an English compound (two words, no hyphen — fine in Czech). de compounds it "AI-Parser", fr translates to "Analyseur AI". "Parser" is common Czech tech jargon; native call on whether to keep as-is or use "AI analyzátor". |
| `enums.family.*` vs `jobMarket.families.*` | The 14 role-family names are translated slightly differently between the internal taxonomy (`enums.family`, e.g. "Zdravotnictví / klinické", "Služby v první linii") and the public market page (`jobMarket.families`, e.g. "Zdravotnictví", "Služby a obsluha") for the same underlying codes. The English source itself already diverges between these two namespaces ("Healthcare / Clinical" vs "Healthcare & Clinical", "Frontline / Service" vs "Frontline Service"), so this may be an intentional per-surface wording choice inherited from en rather than a cs-specific bug — flagging in case the source divergence itself should be reported upstream. |

_3 items._

## Queued by the 2026-08-04 coverage wave (hardcoded-EN-string sweep)

Externalized 43 previously-hardcoded English UI strings across 4 surfaces (see
run report). Two calls left for a native/house decision — high-confidence
translations were still applied so nothing regresses to English:

| key(s) | severity | note |
|--------|----------|------|
| `onboarding.hireLabel` | minor | Translated "Hire" (a meta-label above the waiting candidate's name in the empty-record card) as "Nový kolega" ("new colleague/hire"). Reads fine but is one word longer than the English label and slightly informal for a stat-card caption; a native may prefer a bare noun like "Nováček" or reuse "Kandidát". |
| `onboarding.firstDayTitle`, `onboarding.preboardQuestions` | minor | New ICU plurals using the "new hire" concept render it as "přijatý kandidát" / "nový kolega" respectively (two different nouns for the same referent, one per string, chosen for what read most naturally in each sentence). Confirm whether the catalog wants one fixed noun for "new hire" across onboarding, or per-sentence flexibility is fine. |

_2 items._

## Deferred to a future wave (not converted this pass)

Found during the same sweep, intentionally left hardcoded because the fix is a
bigger lift than a namespace-scoped externalization (see the run report for
detail):

- `app/_components/GithubAnalysisPanel.tsx` — no i18n wiring at all; extensive
  hardcoded English (headings, status copy, dynamic gap-analysis sentences).
- `app/_components/ErrorBoundary.tsx` — class component; React error boundaries
  can't call hooks directly, needs a hook-wrapper pattern first.
- `app/features/shell/tasks/TasksDoneRow.tsx`, `TasksFilterBar.tsx`,
  `tasksTabHelpers.ts` — no i18n wiring; deep-link labels into pipeline/decisions
  outcomes plus a `STATUS` label map.
- `app/features/hiring/onboarding/OnboardingTab.tsx` — a "prototype scaffold
  (throwaway)" empty-state variant switcher, hardcoded and possibly not meant to
  ship to all recruiters; flagged for a product call before localizing.
- `app/features/hiring/pipeline/PipelineAiActionsGrid.tsx` `ACTIONS.label`/`.note`
  — hardcoded but dead for rendering (real button text comes from
  `tActions(act.id)`); a cleanup candidate, not a live localization bug.
- Admin/dev-tools tree (`app/features/settings/organization/*`,
  `app/control/ControlRoom.tsx`, `app/features/tools/devcases/*`,
  `app/interview-lab/page.tsx`, `app/diagrams/PipelineExplorer.tsx`,
  `app/_components/puml/PlantUml.tsx`) — lower priority per the wave's scope
  order; not swept in depth this pass.

## Queued by the 2026-08 full-catalog review wave (Pass B + Pass C)

Severity is the MQM severity of the underlying error record. Everything here was
**deliberately not applied** — it needs a house/native decision, or the fix
belongs at a call site rather than in the catalog.

| key(s) | severity | note |
|--------|----------|------|
| `pipeline.command.placeholder`, `pipeline.command.examples` | critical | The localized Czech example commands are dead copy: `app/_lib/pipeline-command.ts:44,54,58` matches English keywords only (`/reject\b.*?\bbelow\s+(\d+)/` etc.), so a Czech command never parses. Fixing this is a product decision — either per-locale parser patterns, or mark the two strings non-translatable and say "(anglicky)". Not a translation fix. |
| `comms.theRole` | critical | The generic `{role}` fallback has no value that works in both frames. 10 cs templates frame it as "na pozici {role}" / "o pozici {role}" (needs accusative/locative — today's "danou pozici" fits), while 3 subject lines are bare appositives "Vaše přihláška — {role}" (needs nominative). en/de/fr leave `{role}` bare and dodge this. Needs split subject/body fallback keys, or dropping the "na pozici" frame. |
| `comms.*` greetings (13 keys) | major | All render "Dobrý den {name}," — Czech orthography sets the address off with a comma: "Dobrý den, {name},". Uniform across the namespace, so it is one sweep, and it changes every candidate email. Confirm before applying. |
| `comms.there` (second use) | major | Value is settled, but `comms-dispatch.ts:439,441` reuses the key as the *interviewer's* name fallback and as the `{candidate}` fallback in `interviewerBrief` — producing "Dobrý den kandidáte," addressed to a hiring manager. Needs a separate key, not a value change. |
| **`workspace`** — glossary row vs catalog (~10 keys: `*.eyebrow`, `nav.openWorkspace`, `channels.empty.comms.effort`, `workspaceAdmin.*`) | major | `glossary.md` says *pracovní plocha*; the catalog says *pracovní prostor* almost everywhere ("pracovní plocha" also reads as *desktop* in Czech computing). Four independent auditors flagged the glossary row as the stale side. Decide, then sweep once. |
| **`scorecard`** — glossary row vs catalog (~30 keys across `pipeline`, `decisions`, `scheduleTab`, `jobs`, `analytics`, `interviewSim`) | major | `glossary.md` keeps the loanword; the product UI says *hodnoticí karta* and only `landing`/`aboutPage` marketing copy keeps "scorecard". Same shape as the workspace row. |
| `enums.stage.Accepted` vs `enums.stage.Hired` | major | "Přijato" (intake) and "Přijat/a" (terminal) render as near-identical badges at both ends of the same stage strip. Candidate replacements for the intake end: "Doručeno", "Zaevidováno", "Nová přihláška". Highest-ripple enum in the catalog — needs sign-off. |
| `profile.evidence.*`, `profile.editor.intro`, `devcase.*` | major | The false friend **evidence**: Czech *evidence* = record-keeping/registry, not proof. The catalog is split — `report.panel.*` and `jobs.compare.*` were unified on **důkaz** this pass (a glossary row now exists), but `profile.evidence.*` and the devcase module keep the anglicism, possibly as deliberate jargon. Cross-namespace call. |
| `devcase.evalPanel.authenticityTitle` | major | The interpolated `{reasons}` are English sentences built in `app/_lib/devcase-authenticity.ts:88,97`, so a Czech tooltip wraps an English body. Not fixable in the catalog — needs a codes+params contract with the Python evidence producers. Already a named gap in `DevEvalPanelScores.tsx:61-66`. |
| `offer.deadline` + `offer.deadlineHours` | major | Both keys are correct in isolation (`deadlineHours` is exemplar 6), but `OfferClient.tsx:299` concatenates them, so cs renders "…14:00. zbývá 5 hodin." — a sentence starting lowercase, because the gold Czech form fronts the verb. Fix belongs at the call site. |
| `analytics.calibration.familyLabel` + 4 siblings | minor | "Rodina rolí" vs the glossary's role→pozice. Blocked on the existing `report.factorRole` question above — the taxonomy families are the same surface, settle both together. |
| `fit (result)` — `match.*`, `report.*`, `jobs.compare.*` | minor | Split between **shoda** (glossary) and **vhodnost**. Both are live in scored surfaces; too pervasive for a line-item fix. |
| `pipeline` grammatical gender | minor | The catalog treats the loanword as masculine in a handful of places ("samostatný pipeline", "do stejného pipeline") though standard Czech takes it as feminine ("ta pipeline" — the majority form, and what `aboutPage.steps.intake.*` was corrected to this pass). One sweep once confirmed. |
| `scheduleTab.lifecycle.reminderSent/reminderQueued/reminderPending` | minor | "připomínka" (recruiter side) vs "připomenutí" (candidate side, and `enums.commKind.*`). The `devcase.outboxKind.*` copies were unified on "připomenutí" this pass; the scheduleTab set was left alone pending a call. |
| `integrations.calendar.*`, `scheduleTab.calendar.google` | minor | Unified on **"Google Calendar"** this pass (glossary Do-Not-Translate: product proper nouns). The defensible alternative is Google's own Czech branding **"Kalendář Google"** (cf. "Disk Google"); the one thing that was certainly wrong — the calqued "Google Kalendář" — is gone either way. |
| `report.dispPass` | minor | "Pass" → "Zamítnout", which is the glossary's word for *reject*. Advance/Hold/Pass and Advance/Reject are distinct disposition sets elsewhere; confirm the collapse or pick a softer verb ("Nepokračovat"). |
| `skillProfile.eyebrow`/`.revoked`/`.stale` | minor | "doklad" for a signed, verifiable credential reads like an ID document or a receipt; "osvědčení" is the usual Czech. Public third-party-facing page, namespace-wide call. |
| `shortlist` | minor | Rendered "užší výběr" (`jobs.coach.verdict.*`) and "vybrat" (`match.results.*`, `match.card.*`). Both defensible; needs one call. |
| `landing.*` transcreation leftovers | minor | Landing is the most subjective surface, so only the outright errors were applied (`pricing.enterprise.blurb` "metrovaných", plus three terminology fixes). Left for a native: the headline calques `pricing.heading` ("Nulová matematika tokenů.") and `features.heading` ("jedno šťastné místo"), "stvrzenky" for *receipts* (`features.gates.*`), "Člověk v řídicí smyčce" vs the AI-Act register "lidský dohled" (`trust.human.title`), "ceny, které si zamknete" (`pricing.headingNote`), and the mixed EN/CS job titles in `landing.pile.*`. |
| `about.students.*` — "ražba"/"vyrazit" | minor | The coin-minting metaphor for skill provenance is carried literally into Czech. Comprehensible but unusual; a native may prefer "potvrdit"/"udělit". Cross-cutting, so not changed unilaterally. |
| `pipeline.drawer.fixedRubric`, `humanScorecardNote` | minor | "rubrika" in the assessment sense — in ordinary Czech it means a newspaper column. Confirm Czech HR usage accepts it, or move to "hodnoticí škála"/"kritéria". |
| `landing.pricing.tiers.*.price` | minor | "0 Kč / 240 Kč / 480 Kč / 120 Kč" are hardcoded currency strings, which `style-cs.md` forbids — but the **en source hardcodes them identically**, so this is a source-architecture issue, not a cs defect. See the en-source list in the run report. |

_22 items._

## Fixes applied this pass (for reference — no action needed)

- `comms.there` ("dobrý den" → "kandidáte"): the fallback substitutes directly
  into `"Dobrý den {name},"` when no name is known; the old value produced a
  doubled "Dobrý den dobrý den,". De/fr fallbacks were checked and don't have
  this bug (they use "zusammen"/"à vous", which fit their templates).
- Unified the "Hired" stage on the recruiter/internal side, which consistently
  rendered as "Najat/a" (enums.stage.Hired, pipeline.stageHelp.Hired,
  analytics.statHired/noHires/totalHired/colHired), with "Přijat/a" — the term
  already used on the candidate-facing status page and the one the glossary
  specifies. De and fr each use one root word for both surfaces; cs was the
  only locale split across two.
- `analytics.statTimeToHire` / `analytics.colHireRate`: same "najmutí" →
  "přijetí" root unification, for the same reason.
- `jobMarket.nav.menu` ("Nabídka" → "Menu"): the hamburger-menu aria-label
  collided with the app-wide term for a job offer ("Nabídka" = offer
  everywhere else). De/fr both keep "Menü"/"Menu" as a loanword here.
- `analyze.almostThere` / `analyze.workingOnProfile`: fixed two *tykání*
  (informal "ty") leaks — "tvoji zprávu" → "vaši zprávu", "tvůj profil" →
  "váš profil". Everywhere else in the catalog, and in de/fr, this flow
  addresses the candidate formally.
- `pipeline.tab.degradedBannerBody`: added the missing Czech "few" (2–4)
  plural category and corrected "other" (5+/0) to genitive-plural agreement
  — the existing string reused the "few" form for "other" too, which is
  ungrammatical Czech ("5 je nespárovatelné útržky" → should read "je
  nespárovatelných útržků").
- `analytics.exportCsv` (root) and `analytics.log.exportCsv`: "Export CSV" →
  "Exportovat CSV", matching the other 4 export-button instances in the
  catalog and the de/fr pattern of localizing the verb, not just the noun.
- `channels.relay.*` (6 keys) and `pipeline.tab.bulkDraftOutreachConfirm`:
  unified the untranslated English "relay"/"relay on" with the Czech "relé"
  already used two keys over in `channels.comms.relayNotConfigured` and
  `channels.comms.bouncedAt` — same delivery-relay concept, same Channels tab.
- `decisions.groupEval.interviewProbes`: "Otázky na pohovor" → "Otázky k
  pohovoru", to match the other two renderings of the same concept
  (`matrix.probes`, `match.shared.interviewProbes`).
- `jdPublic.archivedBanner/editJd/archiveTitle/unarchiveTitle/historyTitle`:
  5 keys drifted to "inzerát" (posting/ad) for the JD-editing UI, while the
  namespace's own eyebrow and every other namespace covering the *same*
  "editing a job description" concept (`library.tab.*`, `scheduleTab.prep.*`)
  consistently say "popis"/"popis pozice" — unified on "popis". (The separate
  "JD edited since this candidate was scored" notices in `report`, `pipeline`,
  `decisions`, and `library` correctly keep "Inzerát upraven" — checked against
  de/fr, which independently make the same posting-vs-description split at
  exactly those same points, so that one is a pre-existing, intentional
  cross-locale pattern, not a cs bug.)
- `onboarding.readyEmpty`: "jako Přijatý" → "jako „Přijat/a"" — this sentence
  tells the recruiter to look for the literal stage-badge text, so it now
  quotes the actual enum label instead of a paraphrase (matches de's approach
  of quoting the stage name here).
- `jobs.rediscoveryFeed.swept`: rewrote the plural block for the "jobs
  checked" count — the previous string paired a frozen genitive-plural
  adjective ("publikovaných") with a noun that only correctly declines for
  the genitive-plural count (5+), producing bad Czech for count=1 and
  count=2–4 ("1 publikovaných role" instead of "1 publikovanou roli"). The
  adjective now sits inside the plural block too, with one/few/other each
  getting the grammatically correct case.

## Fixes applied by the 2026-08 review wave (455 keys)

Full Pass B (typed MQM audit, every key, anchored findings only) + Pass C (gated
refine) over all 4,846 keys. Themes, largest first:

- **ICU number agreement (~55 keys)** — flat genitive plurals against live counts
  ("1 aktivních", "3 čeká", "4 týdnů"), and verbs/adjectives frozen *outside* a
  plural block while the noun declined inside it. Expanded to one/few/other with
  the verb or adjective moved into each branch, per exemplar 6.
- **Progress/busy labels (~30 keys)** — 1st-person-singular leaks ("Generuji…",
  "Ukládám…", "Zamítám…") converted to the verbal noun the rest of the catalog
  and `style-cs.md` use. New rule written into the style guide.
- **Terminology unification against the glossary (~90 keys)** — reject→zamítnout
  (odmítnout reserved for the candidate declining), advance→postoupit,
  role→pozice, sourcing→sourcing, board→nástěnka, relay→relé,
  per-hire→"na jedno přijetí", evidence→důkaz, tamper-evident→"odolný proti
  manipulaci", onboarding kept as the loanword, Google Calendar kept verbatim.
- **Percent typography (~12 keys)** — "{pct}%" → "{pct} %" for the nominal
  reading; rule added to `style-cs.md`.
- **Unknown-gender participles** — "nedostavil se" → "nedostavil/a se",
  "navrhl(a)" → "navrhl/a", "postoupil"/"zamítnut" in per-candidate rows.
- **False friends and near-misses caught by the audit** — "metrovaných plánů"
  (metered → *measured in metres*, on the enterprise pricing pitch);
  "Vedoucí" as the group-eval crown pill (reads as *manager*); "evidence" for
  proof; "nezfalšovatelný" for tamper-evident; "Fairness pojistka";
  "rozsahování"; "pokles" inverting a lower-is-better metric;
  "diplomová práce" for a third-year bachelor student's thesis.
- **Call-site-anchored predicate fixes** — 8 `pipeline.events.*` strings that
  render as `{candidateLabel} {verb}` had started a new clause instead of
  continuing the candidate as subject.
- **Placeholder-case defects** — `apply.script.koAuth`/`koModeLocation` put a
  nominative `{location}` behind "v" ("v Praha"); `koLang` used a singular frame
  for a joined language list.
- **`devcase.integrity.backdatedTitle`** — the one plural in the catalog whose
  branches differ by count but had no Czech `few`, so 2–4 fell through to the
  genitive-plural branch.

## Scope note

This pass combined a full-catalog automated sweep (ICU plural-category
completeness, *tykání* leaks, stray literal English, quote/ellipsis
typography, en-identical-value detection) with a complete manual read-through
of every namespace in `messages/cs.json` (~4,100 keys, cross-checked against
`en`/`de`/`fr` wherever a term choice looked inconsistent) — including the
large recruiter-facing ones (`pipeline`, `decisions`, `scheduleTab`, `library`,
`jobs`, `match`, `profile`, `channels`, `analytics`, `matrix`, `analyze`,
`models`, `setup`) that a prior pass had only covered with the automated
sweep. This is now a complete first full-catalog review; a future `sync` pass
only needs to cover keys added or changed after this point.

## Queued by the 2026-08-04 `aboutPage` (/about) review

Namespace-scoped pass over `aboutPage` only, after the page was relabelled
"About the app" / "O aplikaci". Framing verdict: **product**, not company — no
about-us copy in any locale. Six keys fixed; left for a native:

| key(s) | severity | note |
|--------|----------|------|
| `aboutPage.steps.*` — "role" | minor | The page says *role* seven times ("Popište roli", "pásmo role") where the glossary says **pozice**. NOT swept: 150 cs strings use the *role* form catalog-wide and the sibling `landing.features.offer.body` carries the identical "pásmo role × vhodnost". Same shape as the queued *workspace*/*scorecard* rows — one decision, one sweep, or leave. |
| `aboutPage.hero.title` | minor | Changed "celým náborem" → "celou pipeline" so the page's central emphasized term matches de/fr, `steps.intake` ("jedna pipeline") and the glossary's inline-loanword rule. The verb moved with it ("Proveďte jednu posilu" → "Projděte s jednou posilou", instrumental). Confirm it still reads as punchy Czech marketing. |
| `aboutPage.hero.title` — "posila" | minor | *one hire* as "posila" (a new addition to the team) is warm and idiomatic but slightly sportish; confirm it fits a public B2B page. |
| `aboutPage.hero.subtitle`, `closing.title` | minor | "podepsaný nástup" for *a signed hire*. Comprehensible, and de/fr carry the same conceit, but a native may prefer "k podpisu smlouvy". Left alone. |
| `aboutPage.steps.design.title` — "rubrika" | minor | Same open question as `pipeline.drawer.fixedRubric` above; not touched here. |
| `aboutPage.steps.interview.body` — "strukturovaný scorecard" | minor | Loanword kept per the still-open scorecard row; the masculine agreement rides on that decision. |

_6 items._

## Queued by the 2026-08-04 landing-page review (namespace `landing` only)

12 keys fixed in `messages/cs.json`; these were deliberately left alone.

| key(s) | severity | note |
|--------|----------|------|
| `landing.hero.title` | minor | "Nábor, který konečně **funguje**" swaps en's motion metaphor ("actually **moves**") for "works". de ("vorankommt") and fr ("avance") both keep the motion; cs is the only locale that drops it, and the whole page is built on momentum ("Hromada zmizí"). A punchier alternative: "Nábor, který se konečně **hýbe**." Defensible transcreation, so not changed unilaterally. |
| `landing.pile.jana.role` vs `.petr.role` | minor | "React Developer" (EN) next to "Datový analytik" (CS) inside the same three-card hero cluster. Realistic for Czech IT ads, but visibly mixed. de/fr both localize both. Already on this queue from the previous wave; still unsettled. |
| `landing.steps.drop.body` ("rubriky") | minor | Same "rubrika" question as `pipeline.drawer.fixedRubric` — settle together. |
| `landing.features.heading`, `landing.pricing.heading`/`.headingNote`, `landing.features.gates.*` ("stvrzenky"), `landing.trust.human.title` | minor | Carried over unchanged from the previous wave's landing entry — still native calls. |
| `landing.steps.call.body` ("změňte") | minor | "override" → "změňte" (change) loses the override sense; "přehlasujte" is stronger but stiffer on a CTA-ish list. |
| `landing.features.salary.body` / `steps.drop.body` | minor | "mzda" and "plat" both used for salary within one page ("Platový radar" vs "odhadu mzdy", "Mzdová rozpětí"). Both correct Czech; pick one for the landing surface. |
## Queued by the 2026-08 `jobMarket` (/market) review

| key(s) | severity | note |
|--------|----------|------|
| `jobMarket.hero.updated`, `hero.updatedNoPct`, `demand.openings` | critical (worked around) | The call sites pass `n` as an already-formatted **string** (`fmtInt()`, NBSP thousands separator), so an ICU `{n, plural, …}` block evaluates `"38 553" - 0 = NaN` and Czech rendered literally **"NaN volných míst"** on the hero and in the demand list. The plural blocks were replaced with the count-invariant genitive plural ("{n} volných míst", "{n} míst"), which is correct for every value the snapshot actually carries (min 20, national total 38 553) but wrong for a future 1–4. The real fix is at the call site (`MarketPulseApp.tsx:110-111`, `parts.tsx:232,303`): pass the raw number and let ICU format it, then restore one/few/other. |
| `jobMarket.map.median` vs `map.a11yMedian`/`legendSalary`/`hintBody` | minor | The visible tile says "Medián výdělku" (mirroring en's deliberate "Median earnings") while the screen-reader label and legend for the *same* figure say "medián mzdy" (mirroring en, which still says "median salary" there). The split is inherited from the en source; left in place rather than diverging from it. Czech ISPV usage sanctions both ("hrubá měsíční mzda" is the survey's own term). Settle together with the en source. |
| `jobMarket.salary.eyebrow` | minor | "Přehled" → "Průvodce" (en "The field guide", de "Der Wegweiser", fr "Le guide de terrain"). A native may want to carry the field-guide metaphor further ("Terénní průvodce", "Malý průvodce"). |
| `jobMarket.families.hr_people` | minor | "HR a lidé" (a calque of "HR & People") → "HR a personalistika". `enums.family.hr_people` says "HR / lidské zdroje"; the two surfaces still differ, as they do in en. |
| `jobMarket.families.*` vs `enums.family.*` | minor | Still the divergence already queued above; this pass only shortened `life_sciences_research` ("Vědy o živé přírodě a výzkum" → "Věda a výzkum") because the old value overflowed the JD filter chip. |

## Queued by the 2026-08 `simulation` (public guided demo) migration

The guided demo (`/api/demo` → `/?sim=auto`) moved off English into the new
`simulation` namespace. High-confidence translations were applied; these are the
judgment calls.

| key(s) | severity | note |
|--------|----------|------|
| `simulation.status.done` | minor | Transcreated rather than translated: en "Done — candidate hired 🎉" → "Hotovo — pozice obsazena 🎉". A literal read needs the gendered participle ("kandidát/ka přijat/a"), which is heavy on a celebratory one-liner; naming the outcome from the role's side dodges it. Confirm the register — the sibling `pipeline.controlCenter.hired` still says "Přijat/a 🎉". |
| `simulation.phase.*` | minor | The 7 stepper pills are tight, so the chronology is nominalized ("Popis pozice · Sourcing · Příjem · Screening · Pohovor · Nabídka · Přijetí") where en mixes verbs and nouns ("Design JD · Source · Intake…"). Confirm "Příjem" for *Intake* — it is also the everyday word for reception/admission. |
| `simulation.weight.*` | minor | "Klíčová / Střední / Malá" agree with the column header "Váha" (f.). If that header is ever renamed the adjectives must move with it. |
| `simulation.criteria.*.source` | minor | The narrow `whitespace-nowrap` column keeps "CV ↔ JD" untranslated and shortens the qualified forms ("CV ↔ dovednosti", "CV ↔ role"). Native call on whether "JD" is transparent enough in a Czech UI that otherwise says "popis pozice". |
| `simulation.log.*` participles | minor | Uses the house "/a" form for unknown gender ("reagoval/a", "prošel/a", "uvázl/a"). Dense in a log line that already carries a name; an impersonal rewrite is possible but loses the subject. |
