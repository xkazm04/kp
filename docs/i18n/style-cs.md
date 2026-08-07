# Czech (cs) style guide — kp

**How to sound.** Read this before touching `messages/cs.json`. Pair it with
`glossary.md` (what to call things). Calibrated from the existing catalog.

## Register — formal *vykání*, always

kp is a B2B professional tool. Address the operator (recruiter) and the candidate
with the **formal second person plural (*vy*)**, never *ty*.

- Possessive: **vaše / váš / vašich**, not *tvoje*. ("vaše rozhodnutí", "na svých
  pozicích").
- Imperatives: formal plural — **"Schvalte", "Dejte nám vědět", "Vyzkoušejte",
  "Začněte"**, not *schval / vyzkoušej*.
- Polite hedges are welcome where the source has them: **"prosím"**, "rádi
  pomůžeme". Don't add exclamation marks the English doesn't have.

## Casing — sentence case

Capitalize only the **first word** and proper nouns. No English-style Title Case
on buttons/labels/headings. ("Popisy pozic", "Vývojové případy", "Řídicí centrum"
— not "Popisy Pozic".)

## Typography

- **Quotes:** Czech curly quotes **„…"** (low-opening, high-closing), not "…" or
  '…'. The catalog already uses them ("…kalendáře plného třicetiminutových
  „možná"").
- **Ellipsis:** real **…** (U+2026), not three dots. Progress states end with it:
  "Spouštění…", "Probíhá průchod…".
- **Dashes:** em dash **—** for asides (as in en). Number ranges use **–** (en
  dash) or "až".
- **Non-breaking space** before units and after single-letter prepositions
  (v, k, s, z, o, u) where practical: "5 min", "k rozhodnutí".

## Grammar traps a mechanical translation gets wrong

- **Number agreement (the big one).** A count changes the noun AND the verb:
  - 1 → singular: "1 kandidát čeká"
  - 2–4 → *few*: "3 kandidáti čekají"
  - 0, 5+ → *other*: "16 kandidátů čeká"
  When a string interpolates `{count}` before a noun/verb, use an **ICU plural**
  with Czech CLDR categories — never a single fixed form:
  `{count, plural, one {# čeká} few {# čekají} other {# čeká}} na vás`.
  (`many` is only for decimals — optional for integer counts.) English's flat
  `{count} awaiting` is NOT a licence to write flat Czech.
  - Escape hatch when the number sits in a *separate* UI element (a badge next to
    the text, so the string has no `{count}`): use a **count-invariant** form —
    a neuter verb before the number ("postoupilo {n}", "zamítnuto {n}") or an
    invariant noun ("rozhodnutí" is the same in 1/3/16). Avoids the agreement bug
    entirely.
- **Aspect:** pick perfective vs imperfective deliberately. Actions/CTAs are
  perfective ("Spustit", "Přejít", "Zavřít"); ongoing states imperfective
  ("Probíhá…", "Spouštění…").
- **Word order:** Czech is freer than English but not English. Don't calque SVO
  when a fronted object/verb reads more naturally.
- **Gender:** where a status refers to a person of unknown gender, prefer the
  neuter/impersonal ("Přijato") or the "/a" form ("Přijat/a").

## Loanwords — keep the ones Czech HR-tech keeps

The catalog already keeps: **pipeline, screening, scorecard, onboarding, sourcing,
AI, CV**. Don't over-Czech these. But translate the genuinely translatable:
decision→rozhodnutí, offer→nabídka, match(result)→shoda. See `glossary.md` for the
per-term call.

## Length

Buttons/labels/chips must not wrap. Czech runs ~10–20% longer than English —
prefer the shorter idiom in tight controls (a tile, a pill, a table header). If
the only faithful translation is long, shorten the label, not the meaning.

## Market

Czech market (Česká spořitelna is a real target). Currency **CZK**, but always via
ICU/`Intl` formatting — never hardcode "1 000 Kč" into a string; keep the
placeholder.
