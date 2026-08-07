# Czech constructions — the rules a glossary can't hold

**How to build the sentence.** The [glossary](./glossary.md) settles *what to call
things* and [`style-cs.md`](./style-cs.md) sets the voice. Neither catches the
failure that actually makes kp's Czech read translated: strings that are
grammatical, glossary-compliant, correctly formal — and still shaped like
English.

That failure has no anchor in a termbase, so `/i18n-translate`'s Pass B audit
(which requires every finding to cite one) reports those strings **clean**. This
file is the missing anchor set. Every rule has an **ID**; Pass B cites the ID,
which turns "this feels translated" from taste into a reportable error.

## How to use it

- **Pass A** — after drafting a Czech string, walk the *Trigger* column. If the
  English matches a trigger, apply the rule before moving on.
- **Pass B** — cite the ID in the error record: `landing.features.heading ·
  "trychtýř" · style · major · CS-CALQUE · → "nábor"`.
- **Pass C** — a finding citing an ID is major by default. Rewrite it.
- **New rule?** A native rejection that no ID explains is a *new row here*, not a
  one-off fix. That is how one review session pays for the other 5 800 strings.

## Provenance

Rules are derived from the **Microsoft Czech Localization Style Guide**
(`ces-cze-StyleGuide.pdf`, 65 pp — free from the [Microsoft Download
Center](https://download.microsoft.com/download/7/b/5/7b57e4a1-d299-4238-9997-f3ac51d6f763/ces-cze-StyleGuide.pdf),
indexed from [Microsoft Learn](https://learn.microsoft.com/en-us/globalization/reference/microsoft-style-guides)),
whose section numbers are cited per rule. The guide is copyrighted: the **rules**
are used, none of its example sentences are reproduced. Every ✗/✓ pair below is a
real string from kp's own catalog with our own rewrite.

**Microsoft is the house authority for Czech, decided 2026-08.** Mozilla's Czech
l10n guide is the other credible source and it *contradicts* Microsoft on
register — Mozilla asks localizers to reach for `jenž`/`avšak` to relieve
`který`, Microsoft rules them out as too formal. Both are native and both are
right for their own product. kp follows **Microsoft**: plain, everyday words,
inside formal address (*vykání*). Do not mix the two guides row by row.

---

## CS-NOM · Unstack noun piles into a verb

> **Trigger** — the English stacks modifiers or `of`-phrases, or its head is a
> nominalisation (*-tion*, *-ment*, *-ing* used as a noun).
> **Rule** — Czech tolerates at most **two** chained prepositionless genitives.
> Break the chain: insert a preposition, or promote the head noun to a finite
> verb or a subordinate clause.
> **Source** — MS §4.1.7 (Nouns), §4.1.17 (Verbs: *"Czech tends to use more
> verbs than English"*).

This is the single highest-yield rule in the file. English builds meaning by
stacking nouns; Czech builds it by conjugating. A string that keeps English's
shape is grammatical and unreadable at the same time.

```
✗ decisions.summary.summaryNote
  Souhrn odvozený ze získaných dat profilu kandidáta a deterministického
  rozkladu shody pro tuto roli.
      → dat · profilu · kandidáta = three genitives, no preposition
✓ Souhrn vychází z profilu kandidáta a z deterministického rozpisu shody
  pro tuto pozici.
```

```
✗ decisions.summary.whereFit — Odkud pochází shoda
✓ Z čeho shoda vychází
```

---

## CS-PASS · Short passive participle → long adjective or reflexive *se*

> **Trigger** — English passive (`is/was/will be` + past participle).
> **Rule** — the short passive participle (*je nastaven*, *byla zrušena*, *budou
> přidány*) reads academic. Use the **long** deverbative adjective
> (*je nastavený*) or the **reflexive** *se* (*nastaví se*).
> **Source** — MS §4.1.9 (Participles), §4.1.17 (prefer the active voice).

```
✗ landing.trust.audit.body
  Každé rozhodnutí AI je zapečetěno do auditní stopy…
✓ Každé rozhodnutí AI se zapečetí do auditní stopy…
```

**Two exceptions — both found by over-applying this rule and having to revert:**

1. A bare **status chip** (*Odesláno*, *Doručeno*, *Vymazáno*). The short neuter
   form is the Czech UI convention for a state label.
2. An **elliptical headline fragment** with no subject — *Stavěno pro regulovaný
   nábor…*, the same shape as *Vyrobeno v Česku*. Here the short passive is the
   idiom, and "fixing" it to a long adjective leaves an adjective agreeing with
   nothing (`landing.trust.subtitle`, reverted 2026-08).

The rule bites on **sentences**, where `být` + participle has a real subject.

---

## CS-PROG · Progressive action takes reflexive *se*, not a verbal noun

> **Trigger** — English `-ing…` progress/status string.
> **Rule** — *Čeká se na server…*, not *Čekání na server…* and not *Probíhá
> kontrola…*. **Exception**: when the subject is unexpressed, the verbal noun is
> correct (*Ukládání…*).
> **Source** — MS §5.7 (Progressive action).

```
✗ Probíhá analýza životopisu…      ✓ Analyzuje se životopis…
✗ Načítání kandidátů…              ✓ Načítají se kandidáti…
✓ Ukládání…                        (subject unexpressed — keep)
```

**Settled 2026-08 — this rule contradicted `style-cs.md` and an auditor could
cite neither.** The style guide endorses `Probíhá…` for ongoing states; this
rule ruled it out. The split now is:

| Situation | Form |
|---|---|
| subject named, control is busy | reflexive *se* — *Načítají se kandidáti…* |
| subject unexpressed | verbal noun — *Ukládání…* |
| status readout, not a control's busy state (aria-label, ledger row) | *Probíhá &lt;noun&gt;* is fine |

---

## CS-POSS · Drop the English possessive

> **Trigger** — `your` / `their` / `its` used as a determiner rather than to
> contrast ownership.
> **Rule** — English uses possessives where Czech uses nothing. Delete it unless
> removing it changes who owns the thing. When the owner *is* the sentence's
> subject, Czech wants *svůj*, never *váš*.
> **Source** — MS §4.1.10 (Pronouns → Possessives).

```
✗ landing.features.voice.body — …ptá se na jejich skutečnou zkušenost…
✓ …ptá se na skutečné zkušenosti…
```

Keep it where it earns its place: *landing.pricing.tiers.byom.tagline* —
"Vaše klíče k modelům, naše mašinerie" — the possessive **is** the contrast.

---

## CS-FORMAL · Plain word, not the bookish one

> **Trigger** — any of the words below.
> **Rule** — kp is formal in *address* (vykání) and plain in *vocabulary*. The
> bookish register is the single loudest "this was translated" signal.
> **Source** — MS §2.1.3 (Words and phrases to avoid).

| Don't | Use |
|---|---|
| avšak | ale |
| již | už |
| nyní | teď |
| nelze | nedá se · nejde |
| nikoli | ne |
| zda | jestli |
| zde | tady |
| poté | potom |
| pouze | jen · jenom |
| nejprve | nejdřív |
| nadále | dál |
| moci (*může, mohou*) | moct (*můžu, můžou*) |
| činit | dělat · (or name the real verb) |
| obdržet | dostat |
| veškerý | všechen |
| rovněž | taky |
| jenž · jež · nichž · jimiž | který · která · které |
| nezdařilo se | nepodařilo se |

```
✗ landing.trust.subtitle — …každé rozhodnutí… činí kvalifikovaný člověk.
✓ …každé rozhodnutí… dělá kvalifikovaný člověk.

✗ landing.trust.footnote — …nikoli právní certifikaci.
✓ …ne právní certifikaci.
```

**Scope — settled 2026-08 after the first full sweep over-reached.** This table
governs **UI chrome**: buttons, labels, inline hints, empty states. It does
**not** reach candidate-facing correspondence (`comms.*`) or legal pages
(`legal.*`), where *zde*, *nikoli* and *veškerý* are the register-correct words
and *tady* reads as spoken. Nor does it reach a **verbless heading fragment**:
`zda → jestli` is right after a verb (*Zvažte, jestli…*) and wrong for a bare
"Whether X" blurb, where Czech opens with *Zda*.

**One row is REJECTED by house decision (2026-08): `moci → moct` does not
apply.** *moci / mohou* stands catalog-wide. Microsoft's guide prefers *moct*,
but kp is B2B and the word lands in Terms of Service, decline letters and
candidate-facing buttons; the catalog was already 10× *mohou* / 0× *můžou*.
This is the documented case of the house overruling the authority — record such
calls here rather than letting each run re-decide.

| Row | Status |
|---|---|
| `nezdařilo se` | the replacement was originally written as *nepovedlo se*, which occurs **0** times in kp against *nepodařilo* **165** and *selhal* **86**. Corrected above — always check the catalog before adopting a guide's token. |

---

## CS-POMOCI · `pomocí` is a formal crutch

> **Trigger** — English `using` / `via` / `with`.
> **Rule** — prefer `přes`, `díky`, or rebuild the clause around a verb.
> **Source** — MS §5.3 (*Phrases using* Pomocí).

```
✗ Pohovor pomocí AI          ✓ Pohovor vede AI
✗ Vyhledávání pomocí filtrů  ✓ Hledejte přes filtry
```

---

## CS-ANTHRO · The product is not a person

> **Trigger** — English makes the product the subject of a mental or volitional
> verb (*tries to*, *thinks*, *wants*, *is looking for*).
> **Rule** — move the action to the user, or to a reflexive/impersonal
> construction. The product may *do* things; it may not *want* them.
> **Source** — MS §5.3 (Anthropomorphism).

```
✗ KandiDate se snaží najít shodu…    ✓ Hledá se shoda…
✗ Systém si myslí, že…               ✓ Podle analýzy…
```

kp's English deliberately anthropomorphises in marketing ("KandiDate assumes the
model was in the room"). In Czech, keep the verb but make it factual — *počítá s
tím, že* is fine; *domnívá se* is not.

---

## CS-ACTIVE · Name the actor

> **Trigger** — English agentless passive or a "there is/are" frame.
> **Rule** — put the actor in the subject slot. It is shorter and it is how
> Czech reports what happened.
> **Source** — MS §4.1.17 (Verbs).

```
✗ Rozhodnutí bylo zaznamenáno do protokolu.
✓ Rozhodnutí jsme zapsali do protokolu.  /  Rozhodnutí se zapsalo do protokolu.
```

---

## CS-CALQUE · Transcreate marketing, don't translate it

> **Trigger** — landing/marketing/empty-state copy: metaphors, wordplay,
> rhythm-carrying headlines.
> **Rule** — carry the *effect*, not the words. A metaphor that has no Czech
> currency must be replaced, not rendered. Microsoft's guide explicitly permits
> departing from the source to preserve voice (§2.1.4, and the note under §4.1.6
> encouraging creativity).
> **Source** — MS §2.1.4 (Word-for-word translation).

```
✗ landing.features.heading — Celý trychtýř, jedno šťastné místo
      "trychtýř" is a kitchen funnel; Czech HR does not use it for a pipeline,
      and "jedno šťastné místo" is meaningless rendered literally.
✓ Celý nábor, na jednom místě
```

```
✗ landing.features.gates.body — …každé rozhodnutí si nechá svou stvrzenku.
      a "stvrzenka" is a paper till receipt; the metaphor does not travel.
✓ …u každého rozhodnutí zůstane doklad.
```

---

## CS-NBSP · Non-breaking space between number and unit

> **Rule** — `12 cm`, `45 min`, `240 Kč`, `23 h`, and three-letter currency
> codes — all with **U+00A0**, so the value never wraps away from its unit.
> **Exception**: when the number+symbol acts as an **adjective**, there is no
> space at all (`50% sleva`). A standalone percentage keeps the space (`87 %`).
> **Source** — MS §4.1.16 (Symbols and nonbreaking spaces).

Mechanically checkable — the only rule in this file that a script can decide.

---

## CS-DASH · The em dash does not exist in Czech

> **Rule** — Czech uses **–** (pomlčka, U+2013) with spaces where English uses
> an em dash, and closed up (`3–7`, `100–240 V`) in ranges. **—** (U+2014) is
> not a Czech character.
> **Source** — MS §4.1.11 (Punctuation → Dashes and hyphens), which states flatly
> that the em dash isn't used in Czech.

kp's Czech landing carried **42** em dashes against English's 39 — the count
travelled with the copy instead of being localized. This rule was missed on the
first pass of this file precisely because a glossary and a voice guide have
nothing to say about a character; it was found by comparing dash counts across
locales, and the same defect turned up in German and French.

```
✗ AI doporučuje, lidé rozhodují — a u každého rozhodnutí zůstane doklad.
✓ AI doporučuje, lidé rozhodují – a u každého rozhodnutí zůstane doklad.
```

Mechanically checkable, like `CS-NBSP`.

---

## CS-QUOTES · Czech quotation marks, and usually none at all

> **Rule** — most quotation marks in the English source can simply be dropped in
> Czech; never wrap a UI reference in quotes. When quotes are genuinely needed,
> they are `„…"` (U+201E / U+201C), never `"…"`.
> **Source** — MS §4.1.11 (Punctuation → Quotation marks).

---

## CS-CTRL · Controls take the infinitive

> **Trigger** — a button, menu item, tab or action label.
> **Rule** — infinitive (*Uložit*, *Zrušit*, *Otevřít frontu rozhodnutí*), not
> the imperative. Imperatives belong in **instructions** (*Vyberte pozici…*),
> not on the control itself.
> **Source** — MS §2.1.3 (the `Storno` → `Zrušit` row) + Windows UI convention.

---

## CS-ONE-WORD · One concept, one word

> **Rule** — before inventing a rendering, check the [glossary](./glossary.md).
> If the concept isn't there and you decide it here, **add the row**. Two
> renderings of one concept across the app is a `terminology` error even when
> both are good Czech.
> **Source** — MS §5.3 (Terminology).

Open drift, tracked in [`review-cs.md`](./review-cs.md): *workspace*
(plocha/prostor), *scorecard* (loanword/hodnoticí karta), *role* → the glossary
says **pozice** but ~155 strings still say *role*.

---

# Rules harvested from the first full-catalog sweep (2026-08)

Proposed by the audit agents when a real defect had **no ID to cite** — the
compounding mechanism working as designed. Each was accepted because it names a
failure the existing rules provably miss.

## CS-GENDER · Never force masculine on an unknown person

> **Trigger** — the English says *they/their/the candidate* and the code cannot
> know the person's gender.
> **Rule** — a participle, adjective or agent noun agreeing with them takes the
> slash form (*postoupil/a*, *zamítnut/a*, *náborář/ka*) or goes impersonal
> neuter (*Zamítnuto*). A bare masculine is a defect, not a default. Never the
> bracket form.
> **Source** — MS §4.1.6/§4.1.9 (agreement); stated in `style-cs.md` but with no
> ID, which is exactly why `pipeline.drawer.timeline.*` forced masculine while
> its sibling `pipeline.board.movedAnnounce` got it right.

Also applies to interpolated values: give a placeholder in the subject slot a
head noun that carries the gender — *pozice {jobTitle}*, not bare *{jobTitle}*.

## CS-NUM · A live count needs an ICU plural, not a frozen form

> **Rule** — any interpolated count standing before a noun, a numeral-agreeing
> quantifier (*všechny/všech*) or an agreeing adjective must sit inside a plural
> with Czech `one/few/many/other`. One frozen form is ungrammatical for 2–4 or
> for 5+.

```
✗ Vybrat všech {count}
✓ {count, plural, one {Vybrat #} few {Vybrat všechny #} other {Vybrat všech #}}
```

## CS-AGREE · The tail outside the plural block must be count-invariant

> **Rule** — the half nobody checks. Branches get expanded correctly, then an
> agreeing verb or a genitive-plural noun is left in the **shared** tail, so the
> `=1` rendering breaks: *"1 kandidát … už nebyli pod hranicí"*. Either move the
> agreeing word inside the branches, or choose a form identical for 1/3/5
> (*vrátí se*, *nedošlo k*).

## CS-PREP · Czech government picks the preposition

> **Trigger** — the English carries *in/on/at/to* before a UI object.
> **Rule** — use the preposition the Czech noun governs, then check the catalog
> for that noun elsewhere before inventing one. The pipeline board is *na
> nástěnce* in 8 keys; 4 analytics keys carried English's "in the board" over as
> *v nástěnce*. Not covered by `CS-CALQUE` (no metaphor), `CS-NOM` (no noun
> pile) or `CS-ONE-WORD` (the noun is already the glossary's word).

## CS-ABLE · An English `-able` adjective needs a verb clause

> **Trigger** — English predicates a capability with no subject (*Reversible*,
> *Exportable*, *Auditable*).
> **Rule** — a Czech deverbative adjective must agree with a noun; standing
> alone it dangles in the neuter and agrees with nothing. Promote to a finite
> verb with the user as actor (*Změnu vrátíte v…*) or attach it to a real noun
> (*Vratná změna*).

## CS-LOANGENDER · One grammatical gender per loanword, catalog-wide

> **Rule** — pin the gender in the glossary (*ten scorecard*, *ten dashboard* —
> masculine inanimate for a consonant-final loan unless a Czech head noun is
> pinned instead) and make every adjective and predicate agree. *"strukturovaný
> scorecard"* beside *"Scorecard je hotová"* audits clean under every other
> rule and is still a terminology error.

## CS-HOMONYM · Don't reuse a settled word for a second concept

> **Rule** — the inverse of `CS-ONE-WORD`. *shoda* is the glossary's **match**;
> it was reused for *tie*. *pole* is a **form field**; it was reused for *a
> field of candidates*.

## CS-SUBSTD · Stay in standard written Czech

> **Rule** — even in playful captions: relative *co* for *který*, protetické
> *v-*, `-ej`/`-ma` endings and other obecná-čeština forms sit below the
> register kp uses with its operators. `CS-FORMAL` only pushes bookish words
> *down*; nothing pushed colloquial forms back *up*, so *"nabídky, co sednou
> napoprvé"* audited clean.

## CS-DEM · A bare demonstrative needs its head noun back

> **Rule** — *Tato slova se objevují…*, not *Tato se objevují…*. Czech tolerates
> a bare demonstrative only when the referent is the immediately preceding
> subject; after a heading in an oblique case it reads as a dangling calque.

## CS-COMMA · Czech commas are obligatory where English's are optional

> **Rule** — every subordinate clause is set off. When a limiting particle
> (*jen, právě, teprve, zejména*) precedes the conjunction, the comma goes
> **before the particle**: *…, jen pokud je máte*.

## CS-HADDONE · English resultative `had X done` is not `mít` + participle

> **Trigger** — *"{name} had an offer sent"*, *"had the dispatch fail"*.
> **Rule** — Czech reports the event with a finite verb (*nepodařilo se odeslat
> nástupní podklady*, *vznikl návrh nabídky*), never *má neúspěšné odeslání*.
> The `mít` + long participle + nominalised head chain is the loudest translated
> pattern in the event log.
> **Deferred**: ~13 `pipeline.events.*` keys share this shape and need one
> coordinated rewrite plus a check of how the event catalog concatenates
> `{name}` with the phrase. Not swept in this pass.

## CS-FORMAL — new row

| Don't | Use |
|---|---|
| dle | podle |
