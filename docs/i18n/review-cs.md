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
