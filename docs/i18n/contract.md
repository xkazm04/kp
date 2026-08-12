# i18n contract — kp

**The engineering half of `/i18n-translate`.** Everything repo-specific the skill
needs: where the catalogs are, what a translator may touch, and which commands
must be green before a run finishes. The *method* lives in the skill; the *facts*
live here. Verified against the code on 2026-08-12.

---

## 1. Catalog layout

| | |
|---|---|
| Files | `messages/en.json`, `messages/cs.json`, `messages/de.json`, `messages/fr.json` |
| Source of truth | **`en`** (`DEFAULT_LOCALE` in `i18n/locales.ts`) |
| Locale universe | `LOCALES = ["en", "cs", "de", "fr"]` — one literal array, `Locale` union + `isLocale()` guard derived from it |
| Structure | Nested JSON objects, flattened to dotted keys by the checker. ~6,400 keys across 66 top-level namespaces |
| Key order | Identical across locales. Keep it — it is what makes the diffs reviewable |
| Indentation | 2 spaces, UTF-8, no trailing commas |

Adding a locale is a one-line edit to `LOCALES` plus a `messages/<x>.json`.
Nothing else enumerates locales.

## 2. Format system — ICU MessageFormat (next-intl 4.13, no i18n routing)

Messages are real **ICU MessageFormat**, compiled at runtime by
`intl-messageformat` (next-intl's own parser). `scripts/i18n-check.mjs` compiles
every message in every locale with the *same* parser, so anything that would
throw on render fails the gate instead.

A translator **may** change: the prose, word order, and the *position* of a
placeholder (target grammar usually wants it somewhere else than English does).

A translator **may not** change:

- **Placeholder names.** `{count}`, `{name}`, `{pct}` are byte-identical across
  locales. The checker extracts the real argument names from the ICU **AST**
  (not a `{…}` regex), so `{n, plural, one {…} other {…}}` branch literals are
  correctly not treated as variables — but a renamed `{pocet}` is a hard failure,
  as is a placeholder present in one locale and absent in the other.
- **Rich-tag names.** `<b>…</b>` is compared as `<b>` by the same AST walk.
- **ICU keywords.** `plural`, `select`, `selectordinal`, `one`, `few`, `many`,
  `other`, `#`, `offset:` are syntax, never copy.
- **Braces.** Balance is checked separately as a dependency-free fast-fail.

Emoji and symbols in a value are content — keep them.

## 3. Plurals — expand to the target's CLDR categories

169 messages use `{…, plural, …}`. This is **ICU**, not suffixed keys, so the
translator **expands the branches** to whatever CLDR categories the target
language actually has:

- `cs` — `one` / `few` (2–4) / `many` (decimals) / `other` (0, 5+). Czech needs
  `few`; an `en`-shaped `one`/`other` message is a real defect even though it
  compiles. See `style-cs.md` for the noun *and verb* agreement trap.
- `de`, `fr` — `one` / `other`. French puts 0 in `one`.

The key set is **frozen** (parity is gated); only the branch set inside a value
expands.

## 4. Fallback behavior — none, and that is load-bearing

There is **no silent fallback to English.** A missing key is:

1. a `tsc` error — `global.d.ts` augments next-intl's `AppConfig` with
   `Messages: typeof en`, so every `t("…")` key is typed and an unknown key does
   not compile; and
2. an `i18n:check` failure — missing keys, and orphan keys the source lacks.

Consequence for the skill: **key parity is real here**, so `gaps` mode is *not*
the load-bearing first step it is in silent-fallback repos. What key parity does
*not* prove is translatedness — a value can sit in `cs.json` as verbatim English.
Current state (2026-08-12): `cs` 152, `de` 224, `fr` 205 values identical to
`en` (~3%), most of them legitimately Do-Not-Translate. Scan for those with a
value-equality pass, not a key pass.

Locale resolution at request time (`i18n/request.ts` → `i18n/server.ts`):
`NEXT_LOCALE` cookie → `Accept-Language` primary subtag → `en`. The cookie is
written by the `setLocale` server action (`i18n/actions.ts`, 1-year, `sameSite:
lax`) and by the `?lang` middleware proxy.

## 5. House style rule — no em dashes (adopted 2026-08-12)

**U+2014 `—` must not appear in any catalog, in any locale.** The dash-as-aside
habit is a written-web tic, not sentence structure; kp's UI copy uses real
sentence syntax instead. When you hit one, recast:

| Instead of | Write |
|---|---|
| `Score is provisional — rerun to confirm.` | `Score is provisional. Rerun to confirm.` |
| `Three channels — email, ATS, and referral` | `Three channels: email, ATS, and referral` |
| `The pass — which runs nightly — skips holds` | `The pass, which runs nightly, skips holds` |
| `Draft — not sent` | `Draft, not sent` (or `Draft (not sent)`) |

Prefer a full stop and a second sentence; a colon when what follows is a list or
an expansion; a comma pair for a genuine parenthetical; parentheses for an aside
in a tight label. Never leave a bare hyphen `-` standing in for the dash.

`–` (en dash, U+2013) survives **only between numbers** (`3–5 days`, `2024–2025`).
It is not a prose dash in any locale here, which overrides the older "em dash for
asides, as in en" line that `style-cs.md` / `style-de.md` / `style-fr.md` carried
before this rule existed.

This rule applies to catalog **values**. Code comments, `docs/`, and commit
messages are out of scope — they are not user-facing.

## 6. Do-not-translate seeds

**Brand / product:** kp, CandiDate, KandiDate, KP studio, Spark, Studio Light,
Spark Dark, Polar.

**Third-party proper nouns:** Google Calendar (never "Google Kalendář"), ElevenLabs,
OpenAI, Azure, OpenRouter, Gemini, Claude, Ollama, GitHub, Playwright, Next.js.

**Technical identifiers:** enum slugs (`junior`/`medior`/`senior`/`lead`, role
slugs, stage ids), HTTP verbs, file extensions, `NEXT_LOCALE`, env var names,
URLs, code fragments inside a value.

**Trap:** a term can be a product noun *or* a common noun in the same catalog —
judge by call site, not spelling. Loanword decisions (`pipeline`, `scorecard`,
`sourcing`, `onboarding` are kept; `relay`, `board`, `lead` are translated) live
in `glossary.md` and are decided **once per term**, not per string.

## 7. Finding the call site

Keys are looked up through `useTranslations("<namespace>")` in client components
and `getTranslations` on the server, then called as `t("sub.key")`. To locate a
key `pipeline.controlCenter.runPass`:

```bash
grep -rn 'useTranslations("pipeline' app --include=*.tsx     # find the namespace holders
grep -rn 'controlCenter\.runPass\|"runPass"' app             # then the leaf
```

Namespaces map closely to `app/features/<area>/`. Read enough of the component to
answer: element type (button / heading / tooltip / `aria-label` / error), audience
(operator vs. public tokenized candidate surface — `apply`, `schedule`,
`interview`, `status`, `offer`, `devcase`, `data` are **end-user facing** and
warmer), sibling keys in the same object, and the length budget of the control.

## 8. Gates — all must pass

```bash
npm run i18n:check     # parity + ICU compile + placeholder/tag match, both directions
npm run typecheck      # runs schemas:gen (Python) first, then tsc; typed message keys
npm run lint           # eslint, incl. the no-literal-string i18n rule
npm run design:check   # only if you touched UI
npm run test:unit      # only if you touched app code
```

`i18n:check` also enforces four things beyond the catalogs, which a translation
run can trip:

- no hardcoded `aria-label` in `app/_components/**` (shared primitives),
- no hardcoded `aria-label|title|placeholder|alt` in `app/landing`, `app/about`,
  `app/market`,
- every `STORE_ERRORS` / `REFUSAL_ERRORS` code in `app/_lib/api-response.ts` has
  a matching `errors.<CODE>` key in `en.json`,
- no UI file rendering the server's English `.error` string instead of resolving
  the machine `code` (`app/_lib/use-error-message.ts`).

**There is no post-edit build step.** `i18n/request.ts` dynamically imports
`messages/<locale>.json` directly, so an edited catalog is live on the next
request — no chunk-split or codegen to re-run.

## 9. Operational notes

- **Shared checkout, parallel agents.** Stage with `git add <paths>` only, never
  `-A`/`.`/`-u`. Check `git diff --cached --stat` before committing.
- **Never edit a catalog concurrently.** A multi-agent sweep must have agents
  *return* their proposed values and a single writer apply them; two agents
  writing `cs.json` will silently lose keys.
- **Dead keys.** There is no dead-key checker. `grep -rn '"<leaf>"' app` before
  spending effort on a suspicious key; report a dead key rather than translating
  it.
- **The source is the source of truth.** Do not edit `en` values to make a
  translation easier. Keep a source-defect list (concatenated sentences, flat
  strings that need plurals, hardcoded currency) and report it. The one standing
  exception is the §5 no-em-dash rule, which is an explicit, user-authorized
  rewrite of source copy.
- **Diacritics are real characters** — `č`, `ř`, `ž`, `ü`, `é`. Never ASCII folds.
- **Numbers, dates and currency** are formatted at runtime. Never hardcode a
  localized number; keep the placeholder.
- **A parallel fan-out needs a terminology pass afterwards.** Agents working
  disjoint namespace batches cannot see each other, so the same concept picks up
  two words in two namespaces and individual batches quietly diverge from the
  glossary. The 2026-08-12 run proved this: twelve careful reviewers still left
  `JD` as both *inzerát* and *popis pozice* in cs, and split *floor* between
  *hranice* and the glossary's *práh*. Always finish a fan-out with one
  consolidating pass per locale.
- **Find drift mechanically, rule on it with judgment.** The cheap detector: for
  each glossary row, find keys whose ENGLISH value uses the term, then check
  whether the locale value contains the canonical rendering (match on a
  diacritics-folded *stem*, so Czech/German inflection still hits). Misses are
  candidates, not violations — the 2026-08-12 scan produced ~1,400 candidates of
  which about 75 were real. The rest were inflection the matcher missed, a
  different sense of the same English word, or a legitimate restructure. Never
  let a script rewrite from this signal; hand it to a reviewer as evidence.
- **The glossary can be the thing that is wrong.** Two rows in it described
  words that appeared *nowhere* in the catalog (`de` *lead* = Spitzenkandidat/in,
  `de` *intake* = Eingang). When the catalog is coherent and the glossary is
  aspirational, fix the glossary. Verify a row against real counts before
  sweeping the catalog to match it.

## 10. The other artifacts

- `glossary.md` — the termbase, all locales in one table. One decision per term.
- `style-<locale>.md` — register, casing, typography, grammar traps.
- `constructions-<locale>.md` — recurring sentence patterns for that locale.
- `exemplars-cs.md` — ~8 gold source→target pairs. (`de`/`fr` have none yet;
  seed them from their best reviewed strings on the next run.)
- `review-<locale>.md` — strings queued for a native speaker, with typed error
  records.
- `source-defects.md` — defects in `messages/en.json` itself, found while
  translating. These are the user's to fix, not the translator's (see §9). A
  sweep appends to this file; it never edits the source to make its own job
  easier.
