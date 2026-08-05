# German constructions — the rules a glossary can't hold

**How to build the sentence.** Companion to [`constructions-cs.md`](./constructions-cs.md);
read that file's "How to use it" section first — the mechanism is identical.
Every rule has an **ID** that `/i18n-translate` Pass B cites, which turns "this
reads translated" from taste into a reportable `construction` error.

## Provenance

Derived from the **Microsoft German Localization Style Guide**
(`deu-deu-StyleGuide.pdf`, 77 pp, free from the [Microsoft Download
Center](https://download.microsoft.com/download/e/f/9/ef9f6d8e-cd8b-420c-8696-afd98b4a367d/deu-deu-StyleGuide.pdf)),
section numbers cited per rule. **Microsoft is the house authority for German**,
matching the Czech decision. Where the Microsoft guide defers to general German
grammar — it explicitly points at Duden for verbs and nouns — the rule below is
marked **(house)** and is kp's own decision, not a Microsoft citation. The guide
is copyrighted: rules only, none of its examples. Every ✗/✓ below is a real
string from kp's catalog.

**Notable:** German's guide is *thinner* on syntax than Czech's, because it
delegates to Duden. Its distinctive contribution is §5.4 — how English loanwords
must be bent to German grammar — which matters enormously for kp, whose German
keeps *Screening*, *Pipeline*, *Matching*, *Sourcing*, *Scorecard* and *Funnel*
as loanwords.

---

## DE-DASH · The Gedankenstrich is an en dash, not an em dash

> **Rule** — German uses **–** (Halbgeviertstrich, U+2013) with spaces as the
> Gedankenstrich. **—** (U+2014) is an English device.
> **Source** — MS §4.1.15 (Punctuation → Dashes and hyphens), which lists the em
> dash under English usage and names the en dash as the German Gedankenstrich.

kp's German landing carried **41** em dashes against English's 39 — the count
travelled with the copy instead of being localized. Mechanically fixable.

```
✗ …angepasst an den Unternehmenstyp — damit Ihr Angebot gleich beim ersten Mal sitzt.
✓ …angepasst an den Unternehmenstyp – damit Ihr Angebot gleich beim ersten Mal sitzt.
```

---

## DE-LOANWORD · English loanwords take German grammar

> **Trigger** — any English term kept as a loanword (kp keeps many by design).
> **Rule** — the word stays English; its **grammar becomes German**. Decline it
> (*des Screenings*, *mit dem Matching*), pluralise it (`-s`: *Clients*,
> *Websites*, *Downloads*; `-er` loans unchanged: *Server*, *Manager*; `-y` →
> `-ys`: *Proxys*), conjugate borrowed verbs weakly (*chatten, sie chattet, wir
> haben gechattet*). Assign one gender per term and keep it — see the glossary.
> **Source** — MS §5.4 (English terminology and the German language system).

Keeping the English word is allowed. Leaving it grammatically un-German is the
error the guide calls a *stylistic anglicism*, and it ranks those with false
friends as major translation mistakes.

---

## DE-HYPHEN · Don't hyphenate because English did

> **Trigger** — an English compound or noun stack rendered with a hyphen.
> **Rule** — avoid unnecessary hyphenation. A complex compound is usually
> resolved by **German syntax** — reorder the words or introduce a preposition —
> not by stapling the English order together with hyphens.
> **Source** — MS §4.1.15 (Hyphen), §4.1.5 (Compounds).

kp's German landing has **50** hyphenated compounds against English's 29. Some
are correct German; the surplus is English word order preserved by punctuation.

```
✗ landing.features.score.body — 0–100 Eignungs-Score pro Lebenslauf
✓ …Eignungsscore pro Lebenslauf        (closed compound, no hyphen needed)
```

---

## DE-CALQUE-PREP · The preposition is not the English one

> **Trigger** — an English verb+particle or verb+preposition pattern
> (*scored against*, *sealed into*, *based on*).
> **Rule** — German verbs govern their own prepositions. Translating the English
> preposition produces a sentence that parses and still isn't German.
> **Source** — MS §5.5 (Frequent errors — troublesome or conflictive words);
> §4.1.13 (Prepositions).

```
✗ landing.hero.subtitle — jeder Lebenslauf wird gelesen und gegen die Rolle bewertet
✓ …wird gelesen und anhand der Position bewertet
      ("gegen … bewerten" is English "scored against"; German bewertet *anhand*)

✗ landing.proof.cards.sealed.body — wird in eine manipulationssichere Audit-Kette versiegelt
✓ …wird in einer manipulationssicheren Audit-Kette festgeschrieben
```

---

## DE-FORMAL · Plain word, not the bureaucratic one

> **Rule** — kp is formal in *address* (Siezen) and plain in *vocabulary*.
> **Source** — MS §2.1.2 (Words and phrases to avoid).

| Don't | Use |
|---|---|
| Unterstützung bieten | unterstützen · helfen |
| partiell | teilweise |
| erfordern | benötigen |
| durchführen (*einen Anruf*) | tätigen · führen |
| mittels | mit · über |
| seitens · hinsichtlich · bezüglich | von · zu · für |
| sämtliche | alle |

---

## DE-PLEONASM · Don't say it twice

> **Trigger** — an English intensifier rendered with a German word that already
> carries the meaning.
> **Rule (house)** — German compounds are dense; an added adjective often
> repeats what the noun says.

```
✗ landing.features.score.body — mit belegbaren Nachweisen
      "Nachweis" already IS the proof; "belegbar" repeats it.
✓ mit nachvollziehbaren Belegen
```

---

## DE-NOMINALSTIL · Prefer the verb (house)

> **Trigger** — a chain of `-ung` nouns joined by genitives or `von`.
> **Rule (house)** — *Die Durchführung der Aktualisierung erfolgt…* is
> Behördendeutsch. Conjugate instead. Microsoft's German guide does not legislate
> this (it defers to Duden), but it is the loudest register break in B2B German
> and kp treats it as an error.

```
✗ Die Bewertung der Bewerbungen erfolgt automatisch.
✓ Bewerbungen werden automatisch bewertet.  /  Wir bewerten Bewerbungen automatisch.
```

---

## DE-NBSP · Non-breaking space between number and unit

> **Rule** — `45 min`, `240 Kč`, `23 h`, currency codes — all U+00A0.
> **Source** — MS §4.1.18 (Symbols & nonbreaking spaces).

---

## DE-ANTHRO · The product is not a person

> **Rule** — as `CS-ANTHRO`. The product may *do*; it may not *want*, *think* or
> *try*.
> **Source** — mirrors the Czech guide §5.3; the German guide handles the same
> ground under §2.1 Microsoft voice.

---

## DE-ONE-WORD · One concept, one word

> **Rule** — check the [glossary](./glossary.md) before inventing a rendering;
> add the row when you decide one.

Open drift found on the landing: the glossary says role/position → **Position /
Stelle**, but `hero.subtitle` says *Rolle* and `features.offer.body` says
*Rollenband*. Same failure as Czech's *role* vs *pozice*.
