---
name: i18n-translate
category: Maintenance
description: Copywriting-grade, context-aware localization for any managed app — a transcreation loop (draft → typed MQM estimate → gated refine) with an engineering guardrail. Portable across i18n stacks via a per-repo contract artifact; keeps a glossary, per-locale style guides, and gold exemplar pairs in the target repo so run N+1 stays consistent with run N. Invoke with /i18n-translate <mode> [locale] [scope].
argument-hint: <mode> [locale] [scope]
memory: project
contexts: tracked
version: 1.1
---

# i18n-translate — copywriting-grade, context-aware localization

Translate an app's source-language catalog into its other locales the way a
bilingual copywriter on the product team would — not a machine. The job is to
make each non-source locale read as if it were written first in that language,
in the product's voice, using the right domain terms, and never breaking the
format contract the target repo's build enforces.

This is a **transcreation** loop with an engineering guardrail, not a
find-and-replace. Word-for-word is the failure mode.

This skill is **portable**: nothing repo-specific lives in this file. Every
repo-specific fact — where the catalogs are, what the placeholder syntax is,
which commands gate correctness — lives in the target repo's
`docs/i18n/contract.md`, which the first run bootstraps (Phase 0). The method
below is the same everywhere; the contract is not.

---

## When to use

- "Translate the app to X" / "add language X" (a new locale).
- "Review/improve the Czech (or any) translations."
- "The German is machine-y, make it read natively."
- A periodic sweep for strings that drifted out of parity, were added in the
  source language only, or sit in a locale file as verbatim source-language text.

## When NOT to use

- Adding/renaming **source-language** keys — that's normal feature work. This
  skill *consumes* the source catalog as truth; it doesn't invent source copy.
  If the source copy is wrong or ambiguous, flag it, don't silently rewrite it.
- Non-user-facing strings: backend logs, telemetry breadcrumbs, console output.
- Content owned by another subsystem (e.g. email/SMS template bodies living
  outside the catalog) unless the contract says they're in scope.

---

## Phase 0 — the repo contract (`docs/i18n/contract.md`)

**Read it first. If it doesn't exist, discover and write it before translating
anything.** The contract is the repo-specific half of this skill: what would be
hardcoded in a vendored copy. It must answer, with verified paths and commands:

1. **Catalog layout** — where locale files live, which locale is the source of
   truth, how keys are structured (nested vs flat, sections/namespaces).
2. **Format system** — ICU MessageFormat? A bare `{var}` regex interpolator?
   gettext? Suffixed plural keys (`_one`/`_other`) selected by the call site?
   Spell out exactly what a translator may and may not touch: placeholder
   names, plural/select keywords, rich-tag names, HTML, emoji, separators.
3. **Plural mechanism** — whether the translator *expands* plural branches to
   the target language's CLDR categories (ICU) or the key set is **frozen** and
   a missing category must be *flagged*, never faked (suffixed keys).
4. **Fallback behavior** — does a missing/untranslated key fall back to the
   source language *silently*? If yes, key parity proves nothing about
   translatedness, and the `gaps` mode + an untranslated-values check are
   load-bearing.
5. **The gates** — every command that must pass before finishing (parity/ICU
   checks, typecheck, untranslated-value scan), plus any **post-edit build
   step** without which the edit is a silent no-op (e.g. a chunk-splitting or
   codegen script the runtime actually loads from).
6. **Do-not-translate seeds** — brand names, product proper nouns, technical
   identifiers; note any product-name-vs-common-noun traps ("Personas" the app
   vs "personas" the plural noun — judge by call site, not spelling).
7. **Call-site lookup** — how to find where a key renders (the `t()` idiom to
   grep for).
8. **Operational notes** — worktree/parallel-safety rules, dead-key detection,
   anything "learned the hard way" in this repo.

To discover it: read the i18n runtime source (the `t()` implementation and the
interpolator tell you the real rules, whatever the docs claim), the check
scripts, `package.json` scripts, and any existing `docs/i18n/`. Verify each
claim against code before writing it down. When a later run finds the contract
wrong or stale, fix the contract in the same change — it is a doc like any
other.

---

## The five artifacts (create once, maintain forever)

The memory that makes run N+1 consistent with run N. All live in the target
repo under `docs/i18n/` — they are project truth, not skill-internal state:

1. **`contract.md`** — the engineering contract (Phase 0, above).
2. **`glossary.md`** — the termbase. *What to call things.* One canonical
   translation per domain term per locale, plus the Do-Not-Translate list.
   Seed it from the product's domain nouns on bootstrap; add a row whenever you
   make a term decision mid-run so it sticks. One decision per term, applied
   everywhere.
3. **`style-<locale>.md`** — the voice guide. *How to sound.* Register (a B2B
   or developer tool usually takes formal address: Czech *vykání*, German
   *Sie*, French *vous*, Japanese *です・ます*), sentence case vs Title Case
   (most non-English UIs use sentence case), punctuation/typography (Czech
   `„…"` quotes, French narrow NBSP before `;:!?` and `« »` guillemets, CJK
   full-width punctuation, real ellipsis `…`, NBSP conventions), tone, loanword
   policy (decide per term IN THE GLOSSARY, be consistent), grammar traps a
   mechanical translation gets wrong (number agreement, aspect, gender for
   unknown referents), and length discipline for UI chrome.
4. **`source-defects.md`** — the defects you found in the SOURCE catalog while
   translating, and did not fix. Concatenated sentences, flat strings that need
   plurals, hardcoded currency or dates, one value carrying four claims,
   ambiguous copy that forced three locales to guess three different ways. These
   cap quality for every locale and are the user's to fix, so they need a durable
   home rather than a line in a chat message that scrolls away. Append per run,
   grouped by defect class, each row naming the key and the problem. A run that
   reports zero source defects over thousands of keys did not look.
5. **`exemplars-<locale>.md`** — the gold pairs. *Register by demonstration.*
   ~8 source→locale pairs harvested from the locale's best already-reviewed
   strings, one per string class: button/CTA, heading, tooltip, error/status,
   empty-state **transcreation** (the money example — show the rhythm, not the
   words), a correctly localized plural, a public/end-user-facing string, a
   legal/consent string. Each pair carries a one-line "why this is right" note.
   In-domain exemplars are the best-evidenced quality lever after the glossary —
   a style guide *describes* the voice, exemplars *demonstrate* it. Keep the
   file at ~8; replace a pair only when a better one ships.

Before translating anything, **read all four**. Bootstrap any that are missing
(for exemplars on a brand-new locale: translate the 8 class-examples first,
polish them hard, seed the file from those).

---

## Modes (dispatch on the argument)

- **`review <locale> [scope]`** — audit EXISTING translations and fix them.
  The default when a locale already exists. `review` = Pass B + Pass C only.
  Optional key-prefix scope (e.g. `pipeline.controlCenter`).
- **`gaps [locale|all]`** — translate values that are still verbatim source
  language. Only meaningful when the contract says fallback is silent — there,
  **run `gaps` before `review`**: a polished 76% under a raw-English 24% is the
  wrong order.
- **`full <locale>`** — (re)translate every key for one locale (Pass A → B → C).
- **`sync [locale|all]`** — the incremental heartbeat: keys missing from the
  locale, plus keys whose source value CHANGED since the locale was last
  touched (`git log -1 --format=%cI <locale file>`, then diff the source
  catalog over that window; when history is ambiguous, review the whole
  namespace the changed key sits in — siblings move together).
- **`new <locale>`** — adopt a language: bootstrap `style-<locale>.md` + the
  glossary column + exemplars, register the locale wherever the contract says
  locales are declared, then translate every key.

If no locale is given, operate on every non-source locale. **Log what you
skip** — a capped run that doesn't say so reads as "fully synced".

---

## The method — a three-pass loop per namespace batch

Single-pass translation is a ceiling. Run every batch through
**draft → estimate → refine**: translate it, audit it with a typed error
rubric, then rewrite ONLY what the audit flagged. The gate is the point —
unanchored "look again and improve" loops measurably *degrade* strings that
were already right.

### Pass A — Translate

Machine translation fails because it translates the *string*; you translate the
string **in its place in the product**. Batch by namespace/section so a whole
surface stays coherent. For each key:

1. **Locate the use.** Grep the call site (the contract says how). Read enough
   of the component to answer:
   - **Element type** → register + length. A button wants a short imperative; a
     heading a noun phrase; a tooltip a fuller hint; an `aria-label` a
     descriptive sentence; an error calm and actionable; a placeholder an
     example, not a command.
   - **Audience** → operator vs end-user/public pages (often different warmth).
   - **Siblings** → keys in the same object form one UI cluster; translate them
     as a set so terms and grammar agree.
   - **Length budget** → chip/pill/narrow column? Prefer the shorter idiomatic
     form; don't let a button wrap. German and French run 20–35% longer than
     English; plan for it.
2. **Classify → strategy.** *UI chrome*: concise, conventional, match the
   target OS/app idiom. *Body/marketing/empty-state*: **transcreate** — carry
   the feeling and rhythm, not the words; this is where literal dies.
   *Legal/consent*: precise, sober, preserve legally-loaded meaning.
   *Status/errors*: plain, non-alarming, actionable.
3. **Apply glossary + style guide + exemplars.** Canonical term for every
   domain word; the locale's register, casing, punctuation, plural rules; write
   *toward* the gold pairs' voice. Keep the translating frame terse — a
   one-line persona ("bilingual product copywriter for a <locale> B2B SaaS")
   beats a long translation brief, and chain-of-thought does not help the
   translate step.
4. **Preserve the format skeleton** exactly as the contract defines it: every
   placeholder byte-identical, plural branches expanded or frozen per the
   contract, tags/HTML/emoji kept. Move placeholders to where the target
   grammar wants them — that is usually a different position than English.
5. **Sanity-read as a native.** Would a native speaker write this on a real
   product, or does it smell of source-language word order? If unsure, mark it.

### Pass B — Estimate (typed MQM audit)

Fresh eyes on the batch Pass A just wrote — or, in `review` mode, on the
existing catalog. Audit each key and emit **zero or more typed errors**, not a
holistic verdict — error spans with category+severity correlate with native
judgment; "rate this 1–10" does not.

Per error record: `key · quoted span · category · severity · anchor · fix`.

Categories (MQM-derived):
- **accuracy** — mistranslation, omission, addition; wrong meaning in context.
- **terminology** — glossary term ignored, or one concept rendered two ways
  across the app.
- **fluency** — grammar (case, aspect, agreement), calque/source word order,
  register break (informal where the tool needs formal; stiff where an
  end-user page should be warm).
- **style** — reads translated rather than written; misses the exemplars' voice.
- **locale-convention** — Title Case aped from the source, wrong quote glyphs,
  straight `...` for `…`, missing NBSP, wrong/missing plural handling per the
  contract.
- **format** — lost/renamed placeholder, brace imbalance, translated syntax
  keyword, changed tag name. Always **critical**.
- **length** — visibly longer than source in a tight control.
- **leftover-source** — untranslated source text or a wrongly-translated brand
  term.

Severity: **critical** (wrong meaning, format break, legal/consent distortion) ·
**major** (a native speaker would stumble or be confused) · **minor** (polish).

**Every finding must cite an anchor** — a glossary row, a style-guide rule, an
exemplar, the contract's placeholder rules, a call-site length budget. A
finding with no anchor is taste, not an error; drop it or queue it for a
native. For high-visibility surfaces (nav, landing, empty states), ask one
extra localizer question per string: *would a native product team ship this
wording on this control?* — a style finding if the answer is no.

### Pass C — Refine (gated)

- Rewrite **only** keys with ≥1 **critical/major** error, feeding the error
  records into the rewrite. Re-check what you changed.
- **Minor**-only keys: apply the fix if mechanical (typography, casing);
  otherwise leave and note.
- Clean keys: **do not touch.** No drive-by rephrasing — churn on already-good
  strings is regression, not improvement.
- For genuinely ambiguous strings (a pun, a domain term with no settled local
  equivalent, a legal phrase), **don't guess silently**: apply your best
  version AND record it in `docs/i18n/review-<locale>.md` with its error
  record and severity, so a native speaker can triage. The user is not a
  native reviewer by default — surface these.

---

## Working at scale

- **Batch by namespace/section, not by string.** Load one section's source
  values + call sites, run the three passes on the whole cluster, write, move
  on. Keeps sibling grammar consistent and dodges the "lost in the middle"
  failure of one giant prompt. ~60–90 keys per batch is a good ceiling.
- Keep key order identical to the source catalog for reviewable diffs; edit
  namespace-block by namespace-block.
- **Skip dead keys** if the contract provides a dead-key check — never spend a
  token on a string no user can see.
- A **workflow / ultracode** fan-out is the natural shape for a full
  multi-locale sweep: one agent per (locale × section) chunk, each fed the
  artifacts + call sites. Don't spin it up unprompted — offer it for big jobs.
- Never machine-blast a whole file in one edit; that's how silent format breaks
  and terminology drift ship.

### The central writer (non-negotiable in a fan-out)

**Agents never edit a catalog.** Two agents writing one JSON file silently lose
keys. Each agent writes its own scratch file; one script merges them and is the
only writer. Prefer **sparse patches** (only the keys and locales that changed)
for review passes, so a clean value cannot be accidentally rewritten and the
merge stays reviewable.

That merge script is a **gate, not a pipe.** It refuses to write unless, for
every proposed value: the key exists in the source catalog; every locale is
present and a string; the value compiles under the project's real ICU parser;
its placeholder and rich-tag set is byte-identical to the SOURCE value's; and
any house typography rule holds. Run it dry first, read the problem list, and
only then write. Nothing else in this method catches a renamed placeholder
before it ships.

Before scripting any bulk edit, check that the catalog **round-trips
byte-exactly** through your writer (for JSON: `JSON.stringify(obj, null, 2)`
plus the file's trailing newline). If it does not, edit surgically instead. A
reformatted catalog buries the real change in thousands of noise lines, and some
sibling files (a scoring source shared with another language) must not be
reformatted at all.

### Finish a fan-out with a terminology consolidation pass

Agents on disjoint namespace batches cannot see each other, so **the same concept
reliably picks up two words in two namespaces**, and individual batches quietly
diverge from the glossary. This is not a risk to watch for; it is what happens.
Budget the pass.

Find the drift mechanically, then let judgment rule on it:

1. For each glossary row, find keys whose SOURCE value uses the term, and check
   whether the locale value contains the canonical rendering. Match on a
   **diacritics-folded stem**, not the whole word, or inflection (Czech cases,
   German compounds) will drown you in false hits.
2. Hand the misses to one agent per locale as **candidates, not violations**,
   and say so in the prompt. Most will be legitimate: a different sense of the
   same source word, a sanctioned verb/noun split, an implied subject, a
   restructured sentence. In the run that produced this section, ~1,400
   candidates yielded ~75 real fixes, and the agents' most valuable output was
   the reasoned "no sweep" on term after term.
3. Never let the script rewrite from this signal. A wrong sweep destroys a
   correct distinction, and a half-sweep is worse than the split it replaces.

### Coverage is self-reported, so verify it

An agent asked to audit 190 keys may audit 130 and report honestly that it did.
Ask each batch to return the number it actually reviewed, compare against the
batch size, and **re-run the short batches** with inputs regenerated from the
CURRENT catalog (never the original snapshot, or the second pass will revert the
first pass's fixes). Tell the second pass plainly that its job is completeness,
that the values it sees are already fixed, and that finding little is a success.
Report the honest coverage number; a sweep that quietly covered 85% while
sounding complete is the failure this paragraph exists to prevent.

---

## Guardrails (learned the hard way)

- **The source locale is the source of truth.** Don't edit source values to
  make a translation easier. Keep a running **source-defect list** instead and
  report it: hardcoded currency in translatable strings, sentences assembled by
  concatenation, flat strings that need plurals, duplicated catalogs — these
  cap quality for *every* locale and are the user's to fix.
- **Don't clobber good human translations.** In `review`/`sync`/`gaps`, change
  only what is wrong or missing; a wholesale overwrite of a reviewed catalog
  needs the user's OK first.
- **File hygiene** — valid JSON/format, UTF-8, real diacritics (`č`, `ř`, `ž`,
  not ASCII folds), the file's existing indentation, no trailing commas.
- **Emoji/symbols** in a value are content — keep them.
- **Numbers/dates/currency** are formatted at runtime — never hardcode a
  localized number; keep the placeholder and let the formatter do it.
- **Verify, don't assume.** A catalog that "looks translated" can still fail a
  gate on one plural — or silently render 24% source-language. Run every gate
  the contract lists, including post-edit build steps.
- **Read the gate's exit code, not its tail.** `npm test | tail -5` reports the
  exit status of `tail`, which is always 0. Redirect to a file and check `$?`,
  or you will report a green suite that is failing. This has burned a run.
- **The glossary can be the thing that is wrong.** A row can name a word that
  appears NOWHERE in the catalog while the catalog is coherent and correct
  (an aspirational entry someone wrote and never applied). Before sweeping a
  catalog to match a row, count the row's actual occurrences. If the catalog
  wins, fix the glossary and say so in the row.
- **Look for a catalog duplicated outside the catalog.** Some projects copy
  source-language strings into a second file (a scoring rubric, a schema, a
  config shared with another language) and pin the two byte-identical with a
  test. Grep a distinctive phrase before you change source copy; the contract
  should name any such file.
- **Some findings are the source's bug, not the translation's.** When a locale
  looks wrong, check the call site before rewriting: a value concatenated as
  `{name} {predicate}` will read as gibberish in any language whose translation
  supplied its own subject, and the fix is the predicate form, not the words.
- **Known non-levers — don't drift into these.** Back-translation as a quality
  gate (fluent mistranslations round-trip cleanly; use it only as an
  omission/placeholder sanity check). Holistic 1–10 scoring (use typed errors).
  Long translation briefs (measured worse than a one-line persona). Extra
  refine loops beyond Pass C without new anchors (churn, not quality).

---

## Exit checklist

- [ ] Every gate in `docs/i18n/contract.md` passes, including post-edit build
      steps (a missed chunk-split/codegen ships a no-op).
- [ ] Touched locale files valid, same key order as source, proper diacritics.
- [ ] `docs/i18n/glossary.md` + `style-<locale>.md` updated with any new
      term/voice decisions; `exemplars-<locale>.md` exists and still holds the
      locale's best ~8; `contract.md` corrected if a run proved it stale.
- [ ] `docs/i18n/review-<locale>.md` updated: the strings worth a native second
      look, each with its typed error record and severity; anything
      capped/deferred named explicitly.
- [ ] The source-defect list written to `docs/i18n/source-defects.md` AND
      surfaced to the user (flag only — never fixed silently).
- [ ] If the run fanned out: a terminology consolidation pass ran, and its
      rulings (including every "no sweep" and why) are recorded in the glossary.
- [ ] Coverage counted, not assumed: reviewed-vs-batch-size compared, short
      batches re-run, and the honest percentage stated in the summary.
- [ ] One-line summary: locale(s), keys audited/translated/fixed by severity,
      # queued for native review, and % of the catalog actually covered.

When every box is checked, the locale should read like it was written by a
person who uses the product every day — and the build stays green.

---

## Periodic operation

`sync` (plus `gaps`, where fallback is silent) is the heartbeat:
- **On change**: wire the contract's parity + untranslated checks into
  pre-commit/CI; any finding is the cue to run `/i18n-translate sync`.
- **On a schedule** (weekly / before a release): `/loop` or `/schedule` around
  `/i18n-translate sync all`.
- **New market**: `/i18n-translate new <locale>` once; it then joins the
  rotation automatically.

ARGUMENTS: `<mode> [locale] [scope]` — e.g. `review cs pipeline.controlCenter`,
`gaps all`, `full de`, `sync all`, `new pl`. Default with no mode: `review`
every non-source locale (after `gaps`, where the contract makes it relevant).

---

## Skill Reflection

After the run’s real work is done, reflect twice — autonomously, without asking the user. Be honest about volume: most runs produce NOTHING for lane 2. An empty reflection is a valid result; a forced lesson is pollution. Calibration: nothing (common) / one line (sometimes) / a lesson entry (occasionally) / a redesign proposal (rare).

Lane 1 — PROJECT learnings (what the next session in THIS repo needs): write via the MEMORY BLOCK contract if this prompt carries one, else append node lines to `.personas/memory-outbox.jsonl` per that contract. Project-specific insight only.

Lane 2 — METHOD learnings (what would improve THIS SKILL for every project):
1. If nothing generalizes beyond this repo, stop here.
2. Append an entry to `LESSONS.md` in this skill’s directory: `## <version-used> — <YYYY-MM-DD> — <project-name>` followed by `- ` bullets (create the file with a `# Lessons — <skill>` heading if absent). Record the version the run USED, not a bump target. Wrap a bullet in a `### Redesign proposal` sub-block when it argues for a methodic redesign you are NOT applying now.
3. Version bump — ONLY when you also edit SKILL.md to apply the improvement in the same change: minor (1.2 → 1.3) for a prompt/step refinement, major (1.x → 2.0) for a methodic redesign. Update the `version:` frontmatter field (add `version: 1.1` if the file had none — absent means 1.0). Never bump without an applied edit; never edit the method without a bump.
4. Sync ritual (only when you bumped): (a) commit the skill directory as a STANDALONE commit on the current branch — message `skill(<name>): v<new> — <one-line reason>` — containing nothing but this skill’s files; (b) copy the updated skill directory to `~/.claude/skills/<name>/` (overwrite) so sibling projects can adopt it. EXCEPTION: read `.personas/skill-registry.json` first — if the library already carries a HIGHER version than yours, do not overwrite it; keep your lesson in LESSONS.md and note the version conflict in the entry.

Sibling awareness: `.personas/skill-registry.json` (repo root, when present) lists this skill’s installed version, the workspace library version, and which sibling projects run it at which version with recent usage. Use it to judge whether a lesson is worth a bump (heavily-used siblings raise the bar for majors) and to notice you are BEHIND (library newer than yours → prefer recording the lesson over editing a stale method).
