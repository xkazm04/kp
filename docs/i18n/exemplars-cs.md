# Czech (cs) exemplars — gold EN→cs pairs

**Register by demonstration.** Eight pairs harvested from the strongest strings
already in `messages/cs.json`, one per string class. Write *toward* these — they
show the rhythm the style guide only describes. Pair with `glossary.md` (what to
call things) and `style-cs.md` (how to sound).

Keep this file at eight. Replace a pair only when a demonstrably better one ships.

---

### 1. Button / CTA — `pipeline.tab.runPass`

> **en:** ▷ Run automation pass
> **cs:** ▷ Spustit automatický průchod

*Why:* perfective infinitive for an action button (`Spustit`, not `Spouštíme`),
sentence case, the glossary's "automation pass" → "(automatický) průchod", and the
symbol is content — kept verbatim.

### 2. Heading — `pipeline.controlCenter.title`

> **en:** Control center
> **cs:** Řídicí centrum

*Why:* a bare noun phrase, not a sentence; sentence case (`centrum` lowercase, no
Title-Case calque); the glossary's canonical rendering, used identically wherever
the dock is named.

### 3. Tooltip / hint — `report.panel.strengthsHint`

> **en:** Add quantified outcomes and signature projects so we can flag what stands out.
> **cs:** Doplňte měřitelné výsledky a klíčové projekty, abychom mohli zvýraznit, čím vynikáte.

*Why:* a tooltip may run a full sentence. Formal imperative (`Doplňte`), and the
English purpose clause "so we can…" becomes a real Czech `abychom` subordinate
clause with the comma Czech requires — not a calqued "abychom můžeme".

### 4. Error / status — `apply.networkFailed`

> **en:** Couldn't reach us just now — check your connection and try again. Your answers are saved.
> **cs:** Teď se nám nepodařilo dovolat — zkontrolujte připojení a zkuste to znovu. Vaše odpovědi jsou uložené.

*Why:* calm and actionable, no alarm, no exclamation the source doesn't have.
Impersonal `nepodařilo se` instead of blaming the user; the reassurance sentence
is kept as its own sentence, same as en.

### 5. Empty state — transcreation — `pipeline.tab.emptyBody`

> **en:** Candidates arrive through your channels — the apply page, inbound webhooks, proactive sourcing — or you can add one by hand.
> **cs:** Kandidáti přicházejí přes vaše kanály — stránku s přihláškou, příchozí webhooky, proaktivní sourcing — nebo je můžete přidat ručně.

*Why:* the money example. The em-dash aside keeps its rhythm, but the list items
are re-cased into Czech accusative (`stránku`, not a nominative calque of the
English list), `sourcing` stays a loanword per the glossary, and the final clause
drops English's "one" for the plural `je` Czech actually wants.

### 6. ICU plural, CLDR-expanded — `offer.deadlineHours`

> **en:** {hours, plural, one {# hour} other {# hours}} left.
> **cs:** {hours, plural, one {zbývá # hodina} few {zbývají # hodiny} other {zbývá # hodin}}.

*Why:* en's two branches become Czech's three, and — the part a machine misses —
**the verb moves inside the plural block** because `zbývá`/`zbývají` agrees with the
count too. Nominative sg / nominative pl / genitive pl across one·few·other.

### 7. Candidate-facing — `apply.subtitle`

> **en:** A quick chat — no forms, no logins. A few questions and you're done.
> **cs:** Krátký rozhovor — žádné formuláře, žádné přihlašování. Pár otázek a máte hotovo.

*Why:* warm but still *vykání* (`máte`, never `máš`). Verbal nouns
(`přihlašování`) where Czech prefers them over English's plural noun, and the
clipped two-beat rhythm of the source survives.

### 8. Legal / consent — `aiDisclosure.dataConsent`

> **en:** By submitting, you agree we may process your personal data for this role for up to {months, plural, one {# month} other {# months}}. You can review or request erasure of your data anytime via the link in our messages.
> **cs:** Odesláním souhlasíte, že můžeme zpracovávat vaše osobní údaje pro tuto pozici po dobu až {months, plural, one {# měsíc} few {# měsíce} other {# měsíců}}. Své údaje můžete kdykoli zkontrolovat nebo požádat o jejich výmaz přes odkaz v našich zprávách.

*Why:* GDPR wording stays sober and precise — `osobní údaje`, `výmaz` are the
statutory terms, not casual synonyms (`data`, `smazání`). Nothing is softened or
made clever, the plural is CLDR-correct, and the reflexive `Své údaje` fronts the
object the way a Czech legal notice does.
