# French (fr) style guide — kp

**How to sound.** Read before touching `messages/fr.json`. Pair with `glossary.md`.

## Register — formal *vous*, always

kp is a B2B professional tool. Address the operator and the candidate with **vous**
(never *tu*). Possessive **votre/vos** ("votre décision"), imperatives in the
vous-form ("Approuvez", "Démarrez", "Lancez-vous"). Keep the polite tone; don't
add exclamation marks the English lacks.

## Casing — sentence case, French rules

- Capitalize only the **first word** + proper nouns. No English Title Case.
- **Lowercase** languages, nationalities, days, months, and (usually) the word
  after a colon. Job titles lowercase unless a proper noun.

## Typography (French punctuation is strict — the #1 error source)

- **Guillemets** for quotes: **« … »** — with a **narrow non-breaking space**
  inside each guillemet: `« texte »` (U+202F). Not "…".
- **Narrow non-breaking space (U+202F) BEFORE** the two-part marks **; : ! ?** —
  e.g. "Continuer ?", "Attention :", "3 postes ; 2 offres". This is mandatory
  French typography; a plain space or none reads as an error.
- **Ellipsis:** real … (U+2026): "Chargement…".
- **Dash:** none in prose. **—** (U+2014) is not French punctuation and is banned
  outright (`contract.md` §5); the **–** the guide previously allowed is not used
  as a prose dash either. Recast: a full stop and a second sentence, a colon
  before a list, a comma pair for a parenthetical, or des parenthèses in a tight
  label. **–** survives only in number ranges (`3–5 jours`).
- **Apostrophe:** a straight `'` is acceptable in JSON; the typographic `'`
  (U+2019) is nicer where practical ("l'offre").

## Grammar

- **Plurals (CLDR):** French is **one / other**, where **one covers 0 AND 1**
  ("0 poste", "1 poste", "2 postes"). Keep en's plural structure; French agrees
  the noun in "other". `{count, plural, one {…} other {…}}`.
- **Agreement:** adjectives/participles agree in gender+number
  ("candidat retenu" / "candidate retenue" / "candidats retenus"). For
  unknown-gender candidates prefer a neutral phrasing or "candidat(e)".
- **Word order:** adjective usually follows the noun ("décision finale"); don't
  calque English order.

## Loanwords — French resists, tech-HR French tolerates some

Keep where standard in FR tech/HR: **pipeline, matching, score, scorecard,
sourcing, onboarding** (though *intégration* is a fine native alt for onboarding).
Translate the rest: decision→décision, offer→offre, candidate→candidat,
screening→présélection, interview→entretien. Per-term calls in `glossary.md`.

## Market

French-speaking market (FR/BE/CH/CA — default FR-FR). Currency/number/date via
ICU/`Intl` only — never hardcode "1 000 €"; keep the placeholder.
