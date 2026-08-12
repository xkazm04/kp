# German (de) style guide — kp

**How to sound.** Read before touching `messages/de.json`. Pair with `glossary.md`.

## Register — formal *Sie*, always

kp is a B2B professional tool. Address the operator and the candidate with the
formal **Sie** (never *du*). Possessive **Ihr/Ihre** ("Ihre Entscheidung"),
imperatives in the Sie-form ("Genehmigen Sie", "Starten Sie", "Legen Sie los").
Don't add exclamation marks the English doesn't have.

## Casing — capitalize ALL nouns (the #1 mechanical-translation error)

German capitalizes **every noun**, not just the first word — a machine or a
sentence-case habit gets this wrong constantly. "die Entscheidung", "der
Kandidat", "das Angebot", "Kandidaten prüfen". Otherwise sentence-style: verbs,
adjectives, adverbs lowercase mid-sentence. Buttons/labels: capitalize the noun
("Angebot senden", "Automatiklauf").

## Length — German is the longest; guard UI overflow

German runs materially longer than English and blows out tight controls. Prefer
the shortest correct term ("Planung" not "Terminplanung" on a pill). Use
established short compounds; hyphenate only when a compound gets unwieldy. If the
faithful translation won't fit a chip/column, shorten the label, not the meaning.

## Typography

- **Quotes:** German „…" (low-opening, high-closing) — same glyphs as Czech.
- **Ellipsis:** real … (U+2026): "Wird ausgeführt…".
- **ß vs ss:** use ß after long vowels/diphthongs ("Schließen", "groß"); ss after
  short vowels. Never fold ß to "ss" in a label that wants ß.
- **Dash:** none in prose. **—** (U+2014) is an English device and is banned
  outright (`contract.md` §5); the German Gedankenstrich **–** is correct German
  but kp does not use it as a prose dash either. Recast: a full stop and a second
  sentence, a colon before a list, a comma pair for a parenthetical, or Klammern
  in a tight label. **–** survives only in number ranges (`3–5 Tage`).

## Grammar

- **Plurals (CLDR):** German is **one / other** (like English). Keep en's plural
  branches; just translate the words. `{count, plural, one {…} other {…}}`.
- **Compounds:** German prefers one compound noun where English uses two words
  ("Entscheidungswarteschlange" = decision queue) — but readability wins; if a
  compound is a monster, a genitive/hyphen form is fine ("Warteschlange für
  Entscheidungen").
- **Verb-final** in subordinate clauses; don't calque English word order.

## Loanwords — German tech/HR keeps many English terms

Keep: **Pipeline, Screening, Match/Matching, Score, Scorecard, Onboarding,
Sourcing, AI/KI** (prefer **KI** only if the source is generic; keep **AI** for
product/brand consistency — see glossary). Translate the genuinely translatable:
decision→Entscheidung, offer→Angebot, candidate→Kandidat. Per-term calls in
`glossary.md`.

## Market

German-speaking market (DE/AT/CH). Currency/number/date via ICU/`Intl` only —
never hardcode a formatted number; keep the placeholder.
