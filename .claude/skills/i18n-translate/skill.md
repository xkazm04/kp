# i18n-translate — copywriting-grade, context-aware localization (kp)

Translate the app's `messages/en.json` into other languages the way a bilingual
copywriter on the product team would — not a machine. The default English is
strong; the job here is to make each *other* locale read as if it were written
first in that language, in kp's voice, using the right domain terms, and never
breaking the ICU/format contract the build enforces.

This is a **transcreation** loop with an engineering guardrail, not a
find-and-replace. Word-for-word is the failure mode.

---

## When to use

- "Translate the app to X" / "add language X" (a new locale).
- "Review/improve the Czech (or any) translations."
- "The German is machine-y, make it read natively."
- A periodic sweep to catch strings that drifted out of parity or were added in
  English only.

## When NOT to use

- Adding/renaming **English** keys — that's normal feature work (edit
  `messages/en.json` + the `t()` call site). This skill *consumes* en as the
  source of truth; it doesn't invent English copy (if the English itself is
  wrong, flag it, don't silently rewrite it).
- Candidate-facing **email/SMS comms** bodies (those live in the comms layer,
  `app/_lib/comms-*`, not `messages/`). Out of scope unless asked.

---

## The contract you must never break (this repo)

`messages/<locale>.json`, default `en`. next-intl, nested catalogs flattened to
dotted keys. Two gates enforce correctness — run BOTH before finishing:

1. **`npm run i18n:check`** (`scripts/i18n-check.mjs`) asserts, for every
   non-`en` locale:
   - **Key parity** — no key missing vs en, no orphan/typo key not in en.
   - **Valid ICU** — balanced `{ }` and a clean `intl-messageformat` compile
     (so a malformed `{n, plural, …}` fails here exactly as it would at render).
   - **Placeholder parity** — the *same* argument names and rich-tag names as en
     (`{count}` in en must stay `{count}`, never `{počet}`; `<b>` stays `<b>`).
2. **`npm run typecheck`** — `global.d.ts` augments next-intl `Messages` from the
   en catalog, so an unknown/misspelled key is a compile error.

Consequences for how you translate:
- **Keys and structure are frozen.** You translate *values* only. Same nesting,
  same key names, in every locale.
- **Never translate**: placeholder names (`{count}`, `{label}`), `plural`/
  `select`/`selectordinal` keywords, rich-tag names, URLs, code, or enum codes.
- **Do translate the plural CATEGORIES correctly.** English has `one`/`other`.
  Czech needs `one` / `few` / `many` / `other`; Polish `one`/`few`/`many`;
  Slovak like Czech; German/French `one`/`other`. Getting the categories wrong
  is an ICU compile failure (a hard gate), not a nuance. Use CLDR plural rules
  for the target language — expand, don't copy en's two branches.
- Keep `{placeholders}` where the *target* grammar wants them, which is often a
  different position than English.

---

## The four artifacts (create once, maintain forever)

These are the memory that makes run N+1 consistent with run N. They live in the
repo (they're project truth, not skill-internal) under `docs/i18n/`:

1. **`docs/i18n/glossary.md`** — the termbase. *What to call things.* A table of
   kp's domain nouns/verbs with the canonical translation per locale + a note.
   One decision per term, applied everywhere. Seed it from the recruiting domain:
   candidate, role/position, pipeline, stage, screening, match/fit, decision,
   offer, hire/hired, schedule, interview, scorecard, sourcing, automation pass,
   consent, workspace, recruiter. Plus **Do-Not-Translate**: `KandiDate`,
   `Kandidate`, `Candi`, `KP`, product tab proper-nouns kept in English, ICU vars.
2. **`docs/i18n/style-<locale>.md`** — the voice guide. *How to sound.* Register
   (kp is a **B2B professional** tool → Czech/German use the **formal** address:
   Czech *vykání*, German *Sie*), sentence case vs Title Case (most non-English
   UIs use sentence case — Czech capitalizes only the first word + proper nouns),
   punctuation/typography (Czech quotes `„…"`, real ellipsis `…`, non-breaking
   space before units), tone (calm, direct, no exclamation spam), loanword policy
   (Czech HR-tech keeps some English: "pipeline", "screening", "match" are often
   left/adapted — decide per term IN THE GLOSSARY and be consistent), and
   length discipline for UI chrome.

3. **`docs/i18n/exemplars-<locale>.md`** — the gold pairs. *Register by
   demonstration.* ~8 EN→locale pairs harvested from the locale's best
   already-reviewed strings, one per string class: button/CTA, heading, tooltip,
   error/status, empty-state **transcreation** (the money example — show the
   rhythm, not the words), an ICU plural expanded to the locale's CLDR
   categories, a candidate-facing string, a legal/consent string. Each pair gets
   a one-line "why this is right" note. Few-shot in-domain exemplars are the
   best-evidenced quality lever after the glossary — a style guide *describes*
   the voice, exemplars *demonstrate* it. Keep the file small (quality over
   quantity); replace a pair when a better one ships.

4. **`docs/i18n/constructions-<locale>.md`** — the **anchor set for translationese**.
   *How to build the sentence.* This is the artifact the other three cannot
   replace, and skipping it is why a reviewed catalog still reads translated.
   A glossary settles words; a style guide settles voice; both can be fully
   satisfied by a string that is grammatical, correctly formal, and still shaped
   like English. Pass B **requires an anchor for every finding**, so with no
   constructions file it reports those strings CLEAN — the audit is structurally
   blind to the dominant failure class.

   Each rule gets an **ID** (`CS-NOM`, `CS-PASS`, `CS-CALQUE`…), a *trigger*
   (what English shape sets it off), the rule, a source citation, and a ✗/✓ pair
   **taken from this repo's own catalog**. The negative half does the work: the
   failure is "plausible but English-shaped", and only a contrast makes it
   visible. Derive rules from the locale's authoritative professional style
   guide — Microsoft publishes free per-language localization style guides whose
   section structure maps almost 1:1 onto these rule classes (Czech: word-for-
   word translation, nouns/genitive chains, participles, pronouns, progressive
   action, anthropomorphism, nonbreaking spaces). **Name one house authority per
   locale and say so in the file**: for Czech, Microsoft and Mozilla directly
   contradict each other on register, so mixing them row by row produces an
   incoherent voice. Those guides are copyrighted — use the *rules*, never their
   example sentences.

   **Rules do NOT transfer between locales — check before you reuse one.** The
   Czech file's headline rule `CS-NOM` says *unstack English noun piles into
   finite verbs*. The Microsoft French guide states the opposite outright:
   French **prefers noun forms more often than English does** (*"How to use X"*
   → *"Utilisation de X"*). A nominalisation that is an error in Czech is often
   the correct French. Copying one locale's constructions file to another
   actively damages the translation; derive each from that locale's own
   authority. What DOES generalise is the *method* and the ID discipline.

   **Typography is where English leaks hardest, and it is cheapest to fix.**
   The em dash is the tell: kp's landing carried ~39 em dashes in English and
   42 / 41 / 38 into cs / de / fr — the count travelled with the copy. None of
   those languages uses it (cs: the em dash is not a Czech character; de: the
   Gedankenstrich is the Halbgeviertstrich; fr: replace with a period, comma or
   parentheses). French additionally had **zero** curly apostrophes across
   1 834 sites. These rules need no context, so run them over the WHOLE catalog
   as a script — never key by key through a model.

   When a native rejects a string and no ID explains it, that is a **new row
   here**, not a one-off fix. That is what makes a review session compound.
   Over-applying a rule and having to revert is also a row — record the
   exception (see `CS-PASS`, which does not apply to elliptical headline
   fragments).

Before translating anything, **read all four**. If any doesn't exist yet, the
first run creates it (bootstrap — for exemplars, pick from the existing catalog's
strongest strings; if the catalog is new, translate the 8 class-examples first,
polish them hard, and seed the file from those). When you make a new term
decision mid-run, write it to the glossary so it sticks.

---

## Modes (dispatch on the argument)

- **`review <locale> [namespace]`** — audit EXISTING translations for quality and
  fix them. The default when a locale already exists. Optional dotted-namespace
  prefix (e.g. `pipeline.controlCenter`) scopes it.
- **`full <locale>`** — (re)translate every key for one locale. Use for a
  thorough pass or a suspected-bad catalog.
- **`sync [locale|all]`** — the **periodic / incremental** mode. Translate only
  the DELTA: keys present in en but missing in the locale, plus keys whose English
  source CHANGED since the locale was last touched. This is what a schedule or a
  pre-PR hook runs.
- **`new <locale>`** — adopt a language: bootstrap `docs/i18n/style-<locale>.md`
  + the glossary column, then create `messages/<locale>.json` with every key
  translated. Ends with the same gates as any other mode.

If no locale is given, operate on every non-`en` locale.

---

## Finding the delta (for `sync`)

1. Missing keys: `npm run i18n:check` lists `missing key "<k>"` per locale — that
   IS the missing set. (Or diff flattened key sets.)
2. Changed English source: `git log`/`git diff` on `messages/en.json` since the
   locale file's last commit (`git log -1 --format=%cI messages/<locale>.json`)
   → the en keys whose value changed in that window are stale in the locale.
   When git history is ambiguous, fall back to reviewing the whole namespace the
   changed key sits in (siblings often need to move together).
3. Translate only that set; leave good existing translations untouched.
4. **Log what you skipped** — if you cap a run (e.g. one namespace), say so; a
   silent partial run reads as "fully synced" when it isn't.

---

## The method — a three-pass loop per namespace batch

Single-pass translation is a ceiling. Run every namespace batch through
**draft → estimate → refine** (the TEaR shape): translate it, audit it with a
typed error rubric, then rewrite ONLY what the audit flagged. The gate is the
point — unanchored "look again and improve" loops measurably *degrade* strings
that were already right.

### Pass A — Translate

Machine translations fail because they translate the *string*; you translate the
string **in its place in the product**. For each key (batch by namespace so a
whole surface stays coherent — see below):

1. **Locate the use.** `Grep` the key's leaf path (or the namespace) across `app/`
   for the `t("…")` call site. Read enough of the component to answer:
   - **Element type** → register + length. A `<button>`/label wants a short
     imperative; a heading a noun phrase; a tooltip/`title` a fuller hint; an
     `aria-label` a descriptive sentence; an `error`/`alert` calm and clear; a
     `placeholder` an example, not a command.
   - **Audience** → recruiter (operator, in-app) vs candidate (public token
     pages, gentler/2nd-person). kp mixes both.
   - **Siblings** → the other keys in the same object usually form one UI cluster;
     translate them as a set so terms and grammar agree (e.g. a row of buttons).
   - **Length budget** → does it sit in a chip/pill/narrow column? Prefer the
     shorter idiomatic form; don't let a button wrap.
2. **Classify → strategy.**
   - *UI chrome* (buttons, labels, tabs, menu): concise, conventional, match the
     target OS/app idiom. Segment-level but context-aware.
   - *Body / marketing / empty-state* (landing, intros, taglines): **transcreate**
     — carry the feeling and rhythm, not the words. This is where literal dies.
   - *Legal / consent / compliance* (GDPR strings): precise, sober; preserve any
     legally-loaded meaning; don't get clever.
   - *Status / errors*: plain, non-alarming, actionable.
3. **Apply the glossary + style guide + exemplars.** Canonical term for every
   domain word; the locale's register, casing, punctuation, plural rules; write
   *toward* the gold pairs' voice. Keep the translating frame terse — a one-line
   persona ("bilingual product copywriter for a Czech B2B SaaS") beats a long
   translation brief, and chain-of-thought does not help the translate step.
4. **Preserve the ICU skeleton.** Copy every `{var}`, expand `{n, plural, …}` to
   the target's CLDR categories, keep `<tags>`/HTML, keep the placeholder NAMES.
   Move placeholders to where the target grammar wants them.
5. **Sanity-read it as a native.** Would a native speaker write this on a real
   product, or does it smell of English word order / calque? If unsure, mark it.

---

### Pass B — Estimate (typed MQM audit)

Fresh eyes on the batch Pass A just wrote — or, in `review` mode, on the
existing catalog (**`review` = Pass B + Pass C**; there is no Pass A). Audit
each key and emit **zero or more typed errors**, not a holistic verdict — error
spans with category+severity correlate with native judgment; "rate this 1–10"
does not.

Per error record: `key · quoted span · category · severity · anchor · fix`.

Categories (MQM-derived, mapped to this product):
- **accuracy** — mistranslation, omission, addition; wrong meaning in context.
- **terminology** — glossary term ignored, or the same concept rendered two ways
  across the app.
- **fluency** — grammar (case, aspect, agreement), calque/English word order,
  register break (Czech *ty* where *vy* is required; stiff where a candidate
  page should be warm).
- **style** — reads translated rather than written; misses the exemplars' voice.
- **construction** — grammatical but English-shaped: a rule in
  `constructions-<locale>.md` applies and was not followed. **Cite the rule
  ID.** This is the category the audit previously had no words for, which
  is why re-running `review` on a clean-looking catalog changed nothing.
- **locale-convention** — Title Case aped from English, wrong quote glyphs,
  straight `...` for `…`, missing NBSP, wrong/missing CLDR plural category.
- **format** — lost/renamed placeholder, brace imbalance, translated `select`
  keyword, changed rich-tag name. Always **critical**.
- **length** — visibly longer than en in a tight control (chip, button, column).
- **leftover-en** — untranslated English or a wrongly-translated brand term.

Severity: **critical** (wrong meaning, format break, legal/consent distortion) ·
**major** (a native speaker would stumble or be confused) · **minor** (polish).

**Every finding must cite an anchor** — a **constructions rule ID**, a glossary row, a style-guide rule, an
exemplar, the placeholder inventory, a call-site length budget. A finding with
no anchor is taste, not an error; drop it or queue it for a native. For
high-visibility surfaces (nav, landing, empty states), add one extra localizer
question per string: *would a native product team ship this wording on this
control?* — that's a style finding if the answer is no.

### Pass C — Refine (gated)

- Rewrite **only** keys with ≥1 **critical/major** error, feeding the error
  records into the rewrite. Re-run Pass B's checks on what you changed.
- **Minor**-only keys: apply the fix if mechanical (typography, casing);
  otherwise leave and note.
- Clean keys: **do not touch.** No drive-by rephrasing — churn on already-good
  strings is regression, not improvement.
- For genuinely ambiguous strings (a pun, a domain term with no settled local
  equivalent, a legal phrase), **don't guess silently**: apply your best version
  AND add it to `docs/i18n/review-<locale>.md` with its error record, so a
  native speaker can confirm. The user is not a native reviewer by default —
  surface these, now with severities so they can triage.

---

## Working at scale (3000+ keys)

- **Batch by namespace, not by string.** Load one top-level (or nested) namespace's
  en values + its call sites, translate the whole cluster in one coherent pass,
  write, move on. This keeps sibling grammar/terms consistent and dodges the
  "lost in the middle" failure of one giant prompt.
- Prefer editing the locale JSON namespace-block by namespace-block; keep the
  key order identical to en for reviewable diffs.
- If a **workflow / ultracode** run is available and the user opted in, a full
  multi-locale scan is a natural fan-out: one agent per (locale × namespace)
  chunk, each fed the glossary + style guide + call sites, then a parity/QA merge.
  Don't spin that up unprompted — offer it for big jobs.
- Never machine-blast the whole file in one edit; that's how silent format breaks
  and terminology drift ship.

### Fanning out across the whole catalog

Once a locale's `constructions-<locale>.md` exists **and has been validated on
one visible surface with a human**, the rest of the catalog is a clean fan-out.
Do not skip the validation: an unvalidated rule applied by twenty agents is the
same mistake made six thousand times. `CS-PASS` needed an exception after being
over-applied exactly once — catch that on 245 keys, not on 6 000.

1. **Script the mechanical rules first** (dashes, apostrophes, non-breaking and
   narrow spaces, quote glyphs) over the entire catalog. Agents must never spend
   a token on what a regex decides, and doing it first stops every agent
   reporting the same typographic finding.
2. **Batch by namespace, one agent per (locale × namespace).** Give each agent
   the four artifacts, the namespace's `en` and current target values, and the
   call sites. Require **a JSON patch plus an error log keyed by rule ID** — not
   a rewritten catalog. Keys with no finding come back untouched.
3. **Merge centrally**, then run `npm run i18n:check` + `npm run typecheck`
   once. Never let agents write `messages/*.json` concurrently — one file per
   locale, and they will clobber each other.
4. **Harvest**: every new rule or exception an agent proposes goes into the
   constructions file before the next batch, so batch N+1 is smarter than N.
5. Surface the review list — the findings agents flagged as needing a native.

---

## Guardrails (learned the hard way)

- **en is the source of truth.** Don't edit en values to make a translation
  easier. If en is wrong/ambiguous, note it for the user.
- **Don't clobber good human translations.** In `review`/`sync`, change only what
  is actually wrong or missing; a wholesale overwrite of a reviewed catalog needs
  the user's OK first.
- **JSON hygiene** — valid JSON, UTF-8, real diacritics (`č`, `ř`, `ž`, not ASCII
  folds), no trailing commas. Match the file's existing indentation.
- **Emoji/symbols** in a value (e.g. `🎉`) are content — keep them.
- **Numbers/dates/currency** are formatted by ICU/`Intl` at runtime — don't
  hardcode a localized number; keep the placeholder and let the format do it.
- **Verify, don't assume.** A catalog that "looks translated" can still fail the
  ICU gate on one plural. Run the checks.
- **Known non-levers — don't drift into these.** Back-translation as a quality
  gate (fluent mistranslations round-trip cleanly; use it only as an
  omission/placeholder sanity check). Holistic 1–10 scoring (use typed errors).
  Long translation briefs (measured worse than a one-line persona). Extra
  refine loops beyond Pass C without new anchors (churn, not quality).

---

## Exit checklist

- [ ] `npm run i18n:check` → OK, all locales in parity (keys, ICU, placeholders).
- [ ] `npm run typecheck` clean (no unknown-key regressions).
- [ ] Touched locale JSON is valid, same key order as en, proper diacritics.
- [ ] `docs/i18n/glossary.md` + `docs/i18n/style-<locale>.md` updated with any new
      term/voice decisions made this run; `docs/i18n/exemplars-<locale>.md`
      exists (bootstrap if not) and still holds the locale's best 8.
- [ ] `docs/i18n/constructions-<locale>.md` exists, and every construction
      rule you had to invent — or every exception you hit by over-applying
      one — is written back into it.
- [ ] A short **review list** surfaced to the user: the handful of strings worth a
      native second look (with why), and anything capped/deferred.
- [ ] One-line summary: locale(s), # keys translated/reviewed/fixed, # flagged.

When every box is checked, the locale should read like it was written by a person
who uses kp every day — and the build stays green.

---

## Periodic operation

`sync` is the heartbeat. Wire it to run on a cadence or before merges:
- **On a schedule** (weekly/before a release): `/schedule` or `/loop` around
  `/i18n-translate sync all`.
- **On change**: a pre-PR/CI step that runs `npm run i18n:check`; any `missing
  key` finding is the cue to run `/i18n-translate sync`.
- **New market**: `/i18n-translate new <locale>` once, then it joins the `sync`
  rotation automatically.

ARGUMENTS: `<mode> [locale] [namespace]` — e.g. `review cs pipeline.controlCenter`,
`full de`, `sync all`, `new pl`. Default with no mode: `review` every non-en locale.
