# Fixes — Wave 3: Candidate-facing i18n (Theme C, candidate half) (2026-06-10)

> 6 findings: SIM3, SCH4, JOB3, APP4, DEVP5, JDL5. All implemented.
> Gates per fix: catalogs JSON-valid, tsc 0, unit 660 (+3 SIM3), py 500, lint clean.
> Wave verification: full `npm run build` + `test:python` 500 OK.

One mental model for the wave: **7922fbe made every candidate-facing PAGE
bilingual; this wave makes everything those pages REFERENCE bilingual too** —
the emails between the pages, the slot/salary formatting on them, the posting
and JD documents copied out of them, the link that opens them, and the
dev-case artifacts they render. The candidate never sees English they didn't
choose.

---

## 1. SIM3 — Localize candidate comms + persist applicant locale (`29a012f`)

**Where**: `pipeline_entries.locale` (new column), `comms-dispatch.ts`,
`comms.*` catalog, apply route, schedule-store/interview-create (locale reach)

The 8 candidate emails were hardcoded English; no locale was stored on the
entry. New nullable `locale` column (idempotent ALTER, the APP2 seam) captured
from `getServerLocale()` at apply; the templates moved to a `comms.*` namespace
and render through a locale-pinned `createTranslator` (the core next-intl API +
the same relative-path catalog import the request config uses, cached per
locale). LLM-authored bodies (outreach, offer letter) stay as written — only
their deterministic chrome localizes. Locale reaches the two partial-entry
dispatchers via a `dueReminders` join + an entry lookup in interview-create.
`comms-dispatch.test.ts` pins the catalog (every key in both locales; no
unresolved ICU placeholder — guards the apostrophe-vs-`{slot}` hazard).

## 2. SCH4 — Slot times + offer salary in the candidate locale (`d84bf38`)

**Where**: `use-slot-label.ts` (new), `SchedulePicker.tsx`, `offer/[token]/page.tsx`

The schedule page's most prominent content — every slot's date/time — stayed
English ("Tue 10 Jun") inside Czech copy. `useSlotLabel()` formats a slot's ISO
via `Intl.DateTimeFormat(activeLocale)`; the server-minted English label stays
the canonical stored value (recruiter feed + emails), the same split as enum
labels. Offer salary passes the active locale to `toLocaleString`.

## 3. JOB3 — Localize the publish-ready posting markdown (`0cb3ad5`)

**Where**: `jobMarkdown.ts`, `JobPostingModal.tsx`

`jobToMarkdown` (the copy-to-job-board artifact) was the last candidate-facing
surface in hardcoded English. It now takes a strings table; `JOB_MARKDOWN_STRINGS`
holds a small self-contained EN/CS table (incl. family labels) in the module —
NOT the catalog — so the new posting-language toggle can render a language
other than the active app locale without bundling the full catalog client-side.
Recruiter-authored body text stays verbatim; salary stays cs-CZ/CZK.

## 4. APP4 — Lang pin on the apply link + apply-page switcher (`355486e`)

**Where**: `JobPostingModal.tsx`, `apply/[id]/page.tsx`

The `?lang` proxy existed but nothing exposed it. `copyApplyLink` appends
`?lang=<postingLang>` (reusing the JOB3 toggle), and the public apply page
mounts `LanguageSwitcher` in its header — the candidate is the one user who
couldn't reach the recruiter switcher.

## 5. DEVP5 — Dev-case artifacts in the candidate's language (`bb4941a`)

**Where**: devcase CLI `--lang`, `design.py` (design_case), `seed_materializer.py`,
`dev_lifecycle.lang` (new column), `devcase-run.ts`, the orchestrator

`scenario_from_case` already accepted `lang` but no caller reached it; design
and seed had none. A `--lang` arg (normalize_lang-guarded) threads into
design_case, materialize_seed and scenario_from_case, each appending the shared
`language_directive`. Language captured at need intake → persisted on a new
`dev_lifecycle.lang` column → threaded by the orchestrator to all three runners
(and the redesign path). Deterministic fallbacks stay English.

## 6. JDL5 — Generate JDs in the chosen language (`ad2038f`)

**Where**: `design.py` (design_role), devcase CLI, `jd-build-run.ts`, `JdBuilder.tsx`

`design_role` gains `lang` + the directive (its responsibilities/must-haves ARE
the JD body), so `design-artifacts` is now fully lang-aware. `runJdBuild`
threads lang to `runDesignArtifacts` and `runMarketSalary` (the salary CLI
already had `--lang`); `composeMarkdown` localizes its headings from a
self-contained bilingual table. JdBuilder gains a "JD language" select
defaulting to the active locale.

---

## Patterns worth keeping (→ harness-learnings)

1. **A locale-specific server lib uses `createTranslator`, not
   `getTranslations`** (SIM3): the request API resolves to the request locale;
   the core `createTranslator({locale, messages, namespace})` renders an
   explicit locale. Load the catalog via the same relative-path dynamic import
   the request config uses (bundler-enumerable), cache per locale.
2. **ICU apostrophe hazard** (SIM3): a lone `'` before a `{placeholder}` can
   swallow it; pin every comm key with a "no unresolved `{…}` survives" test.
3. **Self-contained bilingual string table for copy-out artifacts** (JOB3/JDL5):
   when a document can be rendered in a language other than the active app
   locale (a toggle), keep its ~10 headings in the module, not the catalog —
   the toggle then needs no cross-locale catalog access and no client bundle of
   all messages.
4. **Localize narrative, keep code values verbatim** (DEVP5/JDL5): the shared
   `language_directive` lets design/case/seed prose localize while skill names,
   role-family ids and seniority codes stay exact — so matching, the rubric and
   cache keys never break. One flag (`--lang`) per CLI; deterministic fallbacks
   documented as English.
5. **Display in the active locale, store the canonical English** (SCH4): the
   server-minted slot label stays the stored/emailed value; the page formats
   from the ISO for display — the same split as enum labels.
