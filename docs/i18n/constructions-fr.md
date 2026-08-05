# French constructions — the rules a glossary can't hold

**How to build the sentence.** Companion to [`constructions-cs.md`](./constructions-cs.md);
read that file's "How to use it" section first — the mechanism is identical.
Every rule has an **ID** that `/i18n-translate` Pass B cites, which turns "this
reads translated" from taste into a reportable `construction` error.

## Provenance

Derived from the **Microsoft French (France) Localization Style Guide**
(`fra-fra-StyleGuide.pdf`, 53 pp, free via
[aka.ms/french-france-styleguide](https://aka.ms/french-france-styleguide)),
section numbers cited per rule. **Microsoft is the house authority for French**,
matching the Czech and German decisions. Copyrighted: rules only, none of its
examples. Every ✗/✓ below is a real string from kp's catalog.

---

## ⚠ Read this before reusing a Czech rule

**French is the mirror image of Czech on the single most important rule.**

`CS-NOM` says: unstack English noun piles into verbs, because Czech wants finite
verbs. The French guide says the opposite outright — French **prefers noun
forms more often than English does**, and gives *"How to use X"* → *"Utilisation
de X"* as the model (§4.1.10, Nouns).

So a nominalisation that is an error in Czech is often the *correct* French.
Applying one locale's constructions file to another actively damages the
translation. This is the reason the artifact is per-locale and not shared.

---

## FR-APOS · Curly apostrophes, always

> **Rule** — use **’** (U+2019). The straight `'` is a typewriter artifact.
> **Source** — MS §4.1.14 (Punctuation → Apostrophe): use curly apostrophes in
> general; straight ones only when a developer requires it.

kp's French landing scored **59 of 245 keys with straight apostrophes and zero
curly** — total non-compliance, and the single most visible typographic tell
that the copy came through an English pipeline. Mechanically fixable.

```
✗ À propos de l'app        ✓ À propos de l’app
✗ tout l'entonnoir         ✓ tout l’entonnoir
```

---

## FR-SPACE · Narrow no-break space before `; : ! ?` and inside guillemets

> **Rule** — French sets a narrow no-break space (**U+202F**) before the
> two-part punctuation marks, and inside `«  »`. It must not break the line.
> **Source** — MS §4.1.14 (Punctuation).

kp's French landing is **inconsistent**: 9 keys use U+202F correctly, 6 use a
plain breaking space, 0 use U+00A0. Pick U+202F and normalise.

---

## FR-DASH · The em dash is not French punctuation

> **Rule** — replace **—** with a period, a comma, or parentheses. Where the
> emphasis is worth keeping, the **en dash –** is the French device; the guide
> calls it more fluid and more casual than a colon.
> **Source** — MS §4.1.14 (Punctuation → dashes).

kp's French landing carried **38** em dashes against English's 39 — copied, not
localized. The safe mechanical step is `—` → `–`; converting the weaker ones to
commas or parentheses is a judgement call worth a human pass.

---

## FR-SEMICOLON · Don't

> **Rule** — no semicolons. Two short sentences read better.
> **Source** — MS §4.1.14 (Punctuation), stated flatly.

---

## FR-ANACOLUTHON · Give the participle a subject

> **Trigger** — English "Once installed, the user will…", "When enabled, you
> can…" — a participle whose implied subject is not the clause's subject.
> **Rule** — standard French treats this as a grammar mistake. Introduce the
> subject explicitly, or rebuild as a subordinate clause.
> **Source** — MS §4.1.17 (Syntax → Anacoluthon).

---

## FR-SELON · `selon` promises a choice

> **Trigger** — English "according to / depending on X, you can…".
> **Rule** — a French sentence opening with *selon* leads the reader to expect
> at least two alternatives. When there is only one outcome, rebuild with *si*.
> **Source** — MS §4.1.17 (Syntax → According to/Depending on).

```
✗ Selon vos droits, vous pouvez accéder à ces fichiers.
✓ Si vous disposez des droits nécessaires, vous pourrez accéder à ces fichiers.
```

---

## FR-IMPERSONAL · Address the reader, don't hide behind a construction

> **Rule** — avoid *on*, *il y a*, *il faut*, *c’est*, and *impossible de…*.
> Where English says "We were unable to", match it (*Nous n’avons pas pu*)
> rather than reaching for an impersonal form.
> **Source** — MS §2.1.4 (Words and phrases to avoid).

**Not** a violation: temporal *il y a* (*il y a huit mois* = "eight months
ago"). The rule targets existential *il y a* = "there is/are". kp's
`features.rediscover.body` was flagged by a naive probe and is correct as
written.

---

## FR-FORMAL · Plain verb, not the periphrasis

> **Source** — MS §2.1.4 (Words and phrases to avoid).

| Don't | Use |
|---|---|
| avoir la possibilité de · avoir l’opportunité de | pouvoir |
| requérir | demander |
| nécessiter | devoir |
| faire une recommandation | recommander · conseiller |
| impossible de… | *match the source*: nous n’avons pas pu… |

---

## FR-PLURAL · Acronyms and brands take no `-s`; avoid `(s)`

> **Rule** — *des PC*, *des iPad* — no plural `-s` on acronyms or brand names.
> Write *le ou les périphériques*, not *le(s) périphérique(s)*; the parenthesised
> plural is tolerated only where UI space genuinely forces it.
> **Source** — MS §4.1.10 (Nouns → Plural forms).

---

## FR-ONE-WORD · One concept, one word

> **Rule** — check the [glossary](./glossary.md) before inventing a rendering;
> add the row when you decide one.

Flagged for a native call, not swept: `landing.hero.subtitle` renders "funnel"
as **entonnoir**. Unlike Czech *trychtýř* — which is simply wrong — *entonnoir*
is established in French marketing (*entonnoir de conversion*), so it may well
be right here. Confirm before changing.
