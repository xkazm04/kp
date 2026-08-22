# Localization — the cross-cutting contract

kp ships in four languages (en · cs · de · fr) from one codebase. Catalogs live
in `messages/{en,cs,de,fr}.json`; `en` is the source of truth for meaning.

This document covers the contracts that span features. Per-area copy decisions
live with the feature (see [`docs/features/marketing/README.md`](../features/marketing/README.md)
for the public pages); the translation method itself is the `/i18n-translate`
skill plus `docs/i18n/`.

## Where English is allowed to exist

Exactly three places, and each is structural rather than a matter of taste:

1. **`messages/en.json`** — the source catalog.
2. **Server-side canonical strings** written for the server log and for API
   consumers, never for a screen: `STORE_ERRORS` in `app/_lib/api-response.ts`,
   thrown `Error` messages, `console.error` detail.
3. **Named constants that are deliberately not copy** — a brand name, an
   illustrative figure in a mockup, a technology name. Held as a constant, not
   as JSX text, so the lint can tell them apart (see
   `app/landing/spark/Wordmark.tsx`).

Anything else that a user can read goes through `useTranslations()`.

## API errors: resolve the code, never show the `error`

Route handlers answer failures with **`{ error, code }`**:

```ts
return safeJsonError(err, "api:jds", "JD_SAVE_FAILED");
// → { error: "Could not save the JD. Please try again.", code: "JD_SAVE_FAILED" }
```

- `error` is **canonical English**. It exists for the server log and for API
  consumers. It is never the right thing to render.
- `code` is a stable machine identifier. The UI resolves it through the
  **`errors`** catalog namespace, in the reader's language.

### Two registries emit codes, and the distinction matters

| Registry | Class | Helper | Logs? |
| --- | --- | --- | --- |
| `STORE_ERRORS` | A store-backed **500** — an accident. The real error carries `SQLITE_*` codes and absolute paths, so it is logged and a safe generic is sent. | `safeJsonError(err, route, code)` | yes |
| `REFUSAL_ERRORS` | A deliberate **4xx business rule** — a decision. The message *is* the information: the intake closed, the offer lapsed, this link isn't yours. | `jsonRefusal(code, status)` | no — an expected outcome is not a fault, and logging every closed posting is noise |

Refusals were the gap. They returned a bare `{ error }`, so the client had no
code to resolve and `useErrorMessage()` fell through to a generic "something
went wrong" — in all four languages, on public token-authenticated candidate
surfaces where the specific reason is the entire point. Keeping them out of
`STORE_ERRORS` is deliberate: that registry's whole contract is *hide the real
message*, which is the opposite of what a refusal needs.

Some candidate pages already handled the terminal cases with dedicated UI —
`/offer/[token]` swaps to an expired card on 410, `LiveWorkSurface` shows a
"your work is safe on this device" state on 403 — and those keep their own
copy. The code still travels, so a second consumer, an API client, or a future
surface gets the same specific reason rather than re-deriving it from a status.

The client seam is `app/_lib/use-error-message.ts`:

| Export | Use |
| --- | --- |
| `useErrorMessage()` | Components and hooks. Returns `(payload, fallback) => string`. |
| `resolveErrorMessage(payload, fallback, has, translate)` | The pure form, for plain non-React helper modules. |
| `ErrorMessageResolver` | The bound resolver's type — thread it into a plain helper as a parameter rather than turning that helper into a hook. |

```ts
const errMsg = useErrorMessage();
// …
if (!r.ok) setError(errMsg(body, t("saveFailed")));
```

The bound resolver has a **stable identity** — it is memoized on next-intl's
translator, so it only changes when the locale or the catalog does. That makes
it safe to name in a `useCallback` / `useMemo` / `useEffect` dependency array,
which matters because most call sites resolve a failure *inside* a fetching
callback. The same contract holds for the other bound-formatter hooks
(`useGithubErrorMessage`, `useEnumLabel`, `useRelativeTime`, `useNumberFormat`,
`useSlotLabel`, `useRubricStrings`): a formatter whose identity churns every
render is not a formatter, it is a render loop waiting for someone to list it
as a dependency.

### The trap this replaced

`body.error ?? t("saveFailed")` reads like a sensible fallback chain and is
backwards. `error` is almost always present, so the localized fallback almost
never runs and **every locale gets English**. It frequently flowed indirectly
too — `throw new Error(d.error || fallback)` and then `catch (e) { setError(e.message) }` —
which hides the leak from a reader of either line on its own.

That pattern was on **84 call sites across 26 directories**, including surfaces
the eslint i18n rule already held at `error` level. It could: that rule reads
**JSX text nodes**, so English arriving through a variable is invisible to it.
The lint level of an area is not evidence that the area is localized.

### Two guards, in `npm run i18n:check`

- **Leak guard** — fails on `x.error || …`, `x.error ?? …`, and the ternary
  spelling `typeof x.error === "string" ? x.error : …` anywhere under the UI
  directories. The ternary form was added after it turned out to hide 8 live
  leaks the first pattern could not see.
- **Code parity** — every code in **both** registries (`STORE_ERRORS` and
  `REFUSAL_ERRORS`) must have an `errors.<CODE>` message in `en.json`. Without
  it, `useErrorMessage` silently falls through to the caller's generic fallback
  and the specific reason is lost in all four languages. The check parses the
  registries out of `api-response.ts`, so adding a code without its message
  fails the gate rather than degrading quietly — and it fails loudly if either
  registry's shape changes under it.

`ERROR_LEAK_ALLOW` in the script lists the verified exceptions. Two kinds
qualify, and both are commented at the entry:

- **Not an API envelope** — e.g. a background `Task` record's own diagnostic
  field. There is no `code`, so there is nothing to resolve.
- **Deliberate verbatim detail** — a business-rule refusal or an upstream
  provider message (a GitHub rate-limit note, a stage-move refusal) whose *text
  is the information the user needs*. Localizing these properly means giving
  the emitters (`app/_lib/pipeline-entry-action.ts` and friends) real codes
  first; until then the honest state is documented English, not a silent
  generic.

Adding to that list is a decision, not a formality — re-verify that the value
truly never reaches a user, or that its detail genuinely cannot be dropped.

### A route's own code namespace

`errors` is the app-wide namespace for `STORE_ERRORS` codes, and the parity check
above binds the two together. A feature whose failures are entirely its own —
`/api/github-analysis` answers with `NOT_A_PERSON`, `RATE_LIMITED`,
`REQUEST_THROTTLED`, … — keeps them beside the rest of that feature's copy, in
`results.github.errors`, and binds them with its own thin resolver
(`app/_lib/use-github-error.ts`, 12 lines around the same pure
`resolveErrorMessage`). The rule does not change; only where the words live.

## Findings: analysis output that is data, not copy

A third case sits between the two above: a server-computed **result** that reads
like a sentence but is drawn from a closed set. Six complexity signals, three
complexity verdicts, four contribution lines, five limitations, five
evidence-basis lines — the analysis is not writing prose, it is reporting which of
a fixed list happened, with some numbers attached.

Those travel as **`{ kind, params }`** and the component renders them:

```ts
// server (app/_lib/github/heuristics.ts)
{ kind: "contribution.repos", params: { count: ownedRepos.length } }
// client (GithubAnalysisPanel)
t(note.kind, note.params)   // results.github.finding.contribution.repos
```

Why not a server-side `namespaceTranslator`? Because the reader here IS the person
holding the browser — there is no document with a language field. Server-rendering
the sentence would pin it to the request that computed it, and the payload is
**cached and persisted** (`analyses.github_json`), so a run computed under one
locale would be read back under another. Keeping counts as raw params also lets
ICU do the plural agreement Czech needs on every one of them.

Two rules that fall out of it:

- **Enumerable ⇒ code or finding; free text ⇒ string.** The model's own review
  prose stays a string because nothing can enumerate it. Everything the app itself
  has to say about that review is a `reason` code and a `partial` flag.
- **A sealed or persisted field keeps its canonical English, and the UI renders
  the localized mirror.** `codeReview.summary` is frozen into a pipeline entry's
  evidence record and logged, exactly like an envelope's `error`; the panel shows
  `results.github.review.<reason>` instead. Same split as `approvedBy` /
  `reasonCode` in the decision chain.
- **Accept the old shape.** Anything persisted before findings existed holds the
  frozen English sentence of that run, so the schema takes `string | Finding` and
  the renderer passes a legacy string straight through.

The second instance of this shape is the **calibration rationale**. `calibrate()`
in `app/_lib/dev-outcomes.ts` reaches one of five fixed conclusions about the
promote floor — not enough data, weakly predictive, raise, lower, well-calibrated —
and used to return each as an English sentence with the numbers already
interpolated. It now returns `CalibrationRationale` (`{ kind, params }`) and
`app/control/CalibrationPanel.tsx` renders `control.calibration.rationale.<kind>`.
Nothing persists a `Calibration` — it is recomputed on every `GET
/api/devcase/outcomes` — so unlike the GitHub payload there is no legacy string
branch to keep. The `MIN_RESOLVED` gate is a named constant because the
`insufficient` message quotes it; a literal `4` in two places is how a message and
the rule it describes drift apart.

## Numbers, dates and money

`app/_lib/format.ts` is the single presentation seam — 31 exports, deliberately
one file. Format through it rather than calling `toLocaleString` inline.

Two rules that are easy to get wrong:

- **The formatting locale follows the reader.** A hardcoded `"cs-CZ"`,
  `"en-US"`, or a bare `undefined` (which silently uses the *OS* locale, not
  the app's) is a bug. The exception is `Intl` used as a *parsing pivot* rather
  than for display — `app/_lib/schedule-slots.ts` and `app/_lib/timezone.ts` do
  this correctly and are meant to stay `"en-US"`.
- **The currency does not.** `APP_CURRENCY = "CZK"` and the single-currency
  Czech-market assumption are deliberate and documented in `format.ts` itself.

### How the locale is threaded

There is **one** mechanism, and every formatter in `format.ts` uses it: the
active locale is an **optional trailing argument** (`options.locale` for
`formatSalaryRange`), defaulting to English so a non-UI caller — a test, a log
line, a stored artifact with no reader — keeps working. Formatters are cached
per resolved app locale (`resolveFormatLocale` narrows any tag to one of the
four `LOCALES`), so the caches stay bounded.

Call sites thread it in exactly two ways:

| Caller | Threads via |
| --- | --- |
| Client component | `useNumberFormat()` (`app/_lib/use-number-format.ts`) → `n.grouped` / `n.money` / `n.salaryRange`; `useRelativeTime()` for "x ago" |
| Server component / route | `await getLocale()` passed to the helper directly |
| Locale-dumb module (`jdsLibrary.shortDate`, `matchTypes.formatBandCompact`, `jobsCoachSalary.fmtBand`) | Takes a `locale` parameter; the client consumer passes `useLocale()` |

### Ordering follows the reader too

Collation is the third locale-dependent operation, after formatting and copy,
and the easiest to overlook because a wrong order still *looks* like an order.
Czech treats `č`, `ř`, `š` and `ž` as their own letters placed after their base
letter, so an `en` collation of a candidate roster puts "Švec" above "Sýkora"
where a Czech reader expects the reverse.

`compareCells` in `app/_components/table/useTableSort.ts` — the shared table
sort — therefore takes the locale as an **optional trailing argument**, exactly
like `format.ts`, and `useTableSort` threads `useLocale()` into it. Passing
nothing falls back to the runtime default, which is the *server's* locale during
SSR and the *browser's* after hydration: the same "bare `undefined`" bug the
rule above names, with the extra sting that the two renders can disagree.
`Intl.Collator` instances are cached per locale rather than built per
comparison. Modules that sort outside this hook
(`analyticsDecisionLogTypes.ts`, `profileRosterView.ts`) hold their own
collator and take the locale as a parameter for the same reason.

Some places format for a reader who is **not** the UI user, and take the
*document's* language rather than the app's: `jobsMarkdown.ts` (`numberLocale`
in its posting-strings table) and `marketSalaryLabel` in `salary-band.ts`, which
`jd-build-run.ts` calls with the JD build's `lang`. A published posting must not
carry one language's prose under another's digit grouping. That is the same split
the next section draws for *copy*.

## Choosing the app language

`LOCALES` in `i18n/locales.ts` is the **only** enumeration of languages. Three
surfaces let a user pick one, and all three write the same two authorities:

| Surface | File |
| --- | --- |
| Sidebar rail toggle (studio) | `app/features/shell/nav/NavRailPreferences.tsx` |
| Public candidate pages (`/apply`, `/status`) | `app/_components/LanguageSwitcher.tsx` |
| Organization settings + first-run wizard | `app/features/settings/organization/OrganizationGeneralPanel.tsx`, `app/features/shell/setup/SetupLanguageSwitch.tsx` |

The public switcher writes only the UI cookie (`setLocale`, `i18n/actions.ts`).
The two **org-level** surfaces write both authorities through `setOrgLanguage`
(`app/_lib/org-actions.ts`), because an org's language has to reach code that
runs with no request cookie:

1. the **`NEXT_LOCALE` cookie** — the UI and request-scoped generation (CV
   analysis, JD build, match reasoning);
2. the **workspace default locale** (`setWorkspaceDefaultLocale`) — background
   automation passes and candidate-comms fallback.

Either way the caller follows with `router.refresh()` so the server re-renders
under the new locale.

### `AppLanguage` is `Locale`, not a subset of it

`APP_LANGUAGES` in `app/features/shared/memberUi.ts` carries each language's own
**endonym** ("English", "Čeština", "Deutsch", "Français"). Endonyms are proper
nouns, so they are deliberately not translated — see "named constants that are
not copy" above.

That list was pinned at `en`/`cs` while the `de`/`fr` catalogs were still
landing, and stayed that way after they shipped. The result was an org-language
control and an onboarding wizard offering **two of the four languages the app
actually ships** — a picker that silently could not reach half the product.
`AppLanguage` is now `Locale` itself, and a type-level exhaustiveness check in
`memberUi.ts` turns a locale added to `LOCALES` without an endonym row into a
`tsc` error. The two vocabularies cannot drift again.

**In the first-run wizard, language lives in the left rail**
(`SetupLanguageSwitch.tsx`), visible on every step, and it switches the app
immediately. Two earlier positions were both wrong: step 2 as a draft value that
only reached the server at `finish()` (a reader who could not read English picked
their language and then watched the wizard stay in English for three more steps),
then step 1 above the value props — better, but gone the moment you pressed
Continue, so realising on step 3 meant navigating back to find it. In the rail it
is a four-code strip (`EN CS DE FR`, the `TOGGLE_GROUP` recipe, same shape as the
studio switcher) under an *App language* label, with each button's endonym as its
accessible name, so the "labelled in its own language" property survives the
shrink. Below `md` the rail is hidden and the step header repeats the strip
compactly, there with the active language spelled out beside it (that layout has
the width for it) — and that reader is exactly the one who needs it. The wizard's draft
seeds from the live locale
(`useLocale()` in `OnboardingExperience`) rather than a hardcoded `"en"`, so
finishing never silently switches a Czech browser back to English. Preview mode
is the one exception: it moves the local draft only, because its ribbon promises
that nothing persists.

## House style: no em dashes in catalog copy

`—` (U+2014) must not appear in any value in any catalog. The dash-as-aside habit
is a written-web tic rather than sentence structure. kp's UI copy recasts instead:
a full stop and a second sentence, a colon before a list or an expansion, a
comma pair for a real parenthetical, or parentheses inside a tight label. `–`
(U+2013) survives only between digits (`3–5 days`).

The rule, its recast table, and the reasoning live in
[`docs/i18n/contract.md`](../i18n/contract.md) §5, which is also where the
per-locale style guides now defer for dash policy. It applies to catalog values
only: code comments, `docs/`, and commit messages are not user-facing and are out
of scope.

## Two readers: the UI user and the document reader

Every string belongs on one of two sides, and the side decides the mechanism.

| | Who reads it | Language comes from | Mechanism |
| --- | --- | --- | --- |
| **UI user** | whoever has the screen open | the request (cookie/`getLocale()`) | `useTranslations()` / `getTranslations()` |
| **Document reader** | someone the artifact reaches later | a field ON the artifact | `namespaceTranslator(locale, ns)` |

Getting this wrong is invisible in a single-locale session and obvious in
production: a recruiter running the studio in English who copies a posting for a
Czech job board, or a background task that has no cookie to read at all.

`app/_lib/catalog-translator.ts` is the one loader + cache for the
document-reader side. `namespaceTranslator(locale, namespace)` returns a
locale-pinned callable (`t(key, values)` plus `t.has(key)`); it works on the
server AND in a client component, and the catalogs load as separate lazy chunks
so a page never bundles four of them up front. `commsTranslator(locale)`
(`comms-translator.ts`) is the thin wrapper that adds the one comms-specific
concern — resolving *which* language a candidate hears from us in, through the
workspace row — and delegates the loading here. That split exists because the
comms locale resolution reads SQLite and therefore cannot go client-side.

Document-reader surfaces today:

| Artifact | Language field | Copy in |
| --- | --- | --- |
| Candidate email / SMS | the pipeline entry's `locale` | `comms` |
| Dev-case feedback letter | the submission's `locale` | `comms` |
| Copy-to-job-board posting | the Posting tab's toggle (any of the four) | `jobs.posting.doc` + `enums.*` |
| JD template scaffolding | the JD build's `lang` | `library.templates.token` |
| Interview-prep pack | the `lang` stamped on the stored payload | `scheduleTab.prep.plan` / `.studentPlan` |

Two shape rules keep this from leaking back into the modules:

- **A pure builder takes its copy as a parameter.** `buildRunOfShow`,
  `studentPrepRunOfShow`, `renderTemplate` and `jobToMarkdown` all receive a
  resolved strings object; the loaders (`interview-prep-strings.ts`,
  `jd-template-tokens.ts`, `buildJobMarkdownStrings`) are separate modules. This
  is what keeps `run-of-show.ts` unit-testable in isolation and keeps a catalog
  import out of the client-bundled `student-interview.ts`.
- **A shared vocabulary reads from `enums.*` in a document too.** The posting's
  role family, seniority and work mode resolve through the same enum catalog the
  app uses, so a job board and the pipeline board never name the same slug
  differently.

English-only strings group in English on purpose — the `templateErrorMessage`
fallback in `renderTemplate.ts` and `validateJdFields` in `jd-limits.ts` are
documented English API/consumer fallbacks, so `toLocaleString("en-US")` inside
them is consistent, not a leak.

#### A downloaded file is not automatically a document

The table above is about artifacts that **travel**, and the giveaway is the
middle column: a language *field*. A `.md` or `.csv` the user downloads for
themselves has no such field, so it is still the **UI user's** — the mechanism is
the request locale, and the only thing the document-reader machinery contributes
is `namespaceTranslator` where a route handler sits outside React.

Each downloadable artifact was decided on its own reader (F15):

| Artifact | Reader | Language | Copy in |
| --- | --- | --- | --- |
| Hiring metric pack (`metric-pack.ts`) | whoever pressed Download, on that request | request — `getServerLocale()` in the route, threaded through `metricPackStrings(locale)` | `analytics.metricPack` |
| Dev-case interview kit (`devcase-interview-kit.ts`) | the interview panel, colleagues in the same tenant | request — the panel's own `useTranslations()` | `devcase.interviewKit.doc` |
| Fair-Rank fairness CSV (`jobsRecruiterCandidatesLogic.ts`) | the recruiter who exported the on-screen audit table | request — reuses the table's own `jobs.candidates.audit*` labels | `jobs.candidates` |
| **Provenance dossier** (`provenance-dossier.ts`) | a hiring panel or an EU AI-Act review | **canonical English, by decision** | — |

The dossier is the interesting one and the reasoning generalizes. It is a
**sealed record**, and the sealed-record rule above already applies to its
neighbours (`approvedBy`, the screening `rationale`, `codeReview.summary`). Three
things follow: `AnalysisResult` carries no `lang`, so the only available language
is the request's — and a record that exports differently on Tuesday than on Monday
because someone flipped the appearance menu is not auditable; the substance under
those ~20 headings (CV evidence quotes, the model's `explanation`, `jobFit.summary`,
soft-signal detail, sanity-check texts) is frozen payload that cannot be translated
at export time, so localizing only the headings yields a document in no language at
all; and the recruiter-facing **mirror** of the whole thing — the results panels —
is localized already. The honest way to change this is upstream: stamp a `lang` on
the analysis at run time, the way `jd-build-run` does, and the dossier becomes an
ordinary row in the table above.

Two localized headings and an English body is the failure mode to watch for in any
of these. The metric pack is the worked example: its `basis` prose travels *inside*
the pack (it is on the JSON response too), so it is resolved at **build** time, not
render time, and `metric-pack.test.ts` asserts a Czech pack contains no English
basis sentence.

Picking the right catalog is only half of localizing a downloaded artifact; the
**encoding it lands in** is the other half. `downloadFile`
(`app/_lib/export-utils.ts`) prefixes a UTF-8 BOM to every `text/csv` download,
because Excel on Windows ignores the Blob's `charset=utf-8` — that is a Blob type,
not part of the file — and decodes a double-clicked `.csv` with the machine's ANSI
codepage. Without the BOM the Fair-Rank fairness CSV above, and the ranked-matches
and decision-log exports beside it, opened as `Å árka NovÃ¡kovÃ¡` on exactly the
Czech and German desktops this ships to, and could not be pasted back into an ATS
or a mail merge. The BOM is scoped to CSV on purpose: the `.ics`, `.md` and `.json`
downloads through the same helper stay byte-exact. `export-utils.test.ts` pins both
halves.

The old `TasksSystemCard` used to be listed here as a sanctioned "untranslated
admin readout". It is not one any more, and the reasoning it rested on is worth
recording because it recurs: the card's own comment justified English "like the
rest of this surface", the sibling cards justified it "like SystemCard", and the
circle held after the surface around them was localized. An operator reading a
health panel is a UI user. Those three panels have since moved to the surfaces
that own them — the health readout into Models → Usage & cost
(`models.system`), backup/restore into Settings → Organization
(`workspaceAdmin.org.backup`), the ATS write-back webhook into Settings →
Integrations (`integrations.webhook`) — and each moved WITH its catalog subtree,
so the namespace still names the surface. What stays English is machine payload:
`/api/ops`'s `degradedReasons` (canonical server diagnostics, no `code` to
resolve), engine and table names, stage keys, task-kind slugs, and the env-var /
PATH preflight tooltips.

### A third case: a string written with no reader at all

A background task's `label` is composed by `app/_lib/tasks.ts` when the task is
enqueued — synchronously, on the server, with no request locale, into a DB row
that is later read by the sidebar dock, the tab and the history pager, each in
whatever language its reader has chosen. Neither mechanism above fits: there is
no request to read and no language field on the artifact.

The row therefore stores a **reference, not a sentence** —
`encodeTaskLabel(key, values)` (`app/_lib/task-label.ts`) writes
`kp.tl:{"k":…,"v":…}`, and `renderTaskLabel(t, task)` resolves it against
`tasks.kind.*` at render time. Values keep their raw JS types, so a count reaches
the ICU plural as a number. Rows written before the seam decode to `null` and
render verbatim, so no migration was needed.

The same shape applies to any user-visible string a server module composes ahead
of its reader. Prefer it to threading a locale into a synchronous write path.

#### The second instance of it was the onboarding presets (module since removed)

Kept as a worked example, because the shape recurs and the next one will not
announce itself. The post-hire onboarding module has been removed — kp ends at
Hired — so none of the paths below exist any more; read this for the reasoning,
not for the code.

`ONBOARDING_PRESETS` looked like config and was not: its ~70 labels were **copied
into a DB row** when a recruiter saved a template, and that row was then read by
the recruiter, by any colleague in the same workspace (templates were
workspace-scoped), and months later by the **new hire** on a public page in their
own browser's language. Materializing them in whoever pressed Save's language pins
all three to that one language forever, so the answer was the same as the task
label's: the row keeps the **reference** it already had — the task `id` / field
`key` — and the render sites resolve it.

The three-sided version of the rule, which is what makes it worth keeping:

- **Read side** resolves the id against the catalog with a `t.has()` fallback to
  the stored label, so an unknown id degrades instead of throwing.
- **Two readers can want different sentences from one id.** The hire was *asked*
  "Confirm your start date" and the recruiter *read* "Confirmed start date", so
  the two sides resolved against deliberately separate catalog maps.
- **Write side** sends the canonical id only while the user has left the text
  alone, and drops it the moment they edit — otherwise the catalog silently
  overwrites their wording on the next read.
- Because the id doubled as the catalog key, a preset that said something
  different needed its own id (`equipment-badge` vs `equipment-tools` vs
  `equipment`), pinned by a test asserting no id carried two different sentences
  and that every id resolved in all four locales.

Nothing persisted had to be rewritten — the same no-migration property
`task-label.ts` has.

## ICU: pass raw numbers into plurals

A plural message must receive a **number**, never a pre-formatted string.
`intl-messageformat` computes `value - offset`, so a pre-formatted `"38 553"`
becomes `NaN`, `Intl.PluralRules.select(NaN)` falls through to `other`, and `#`
renders the literal word **`NaN`**. That shipped to the Czech `/market` page,
where values under 1000 happened to parse and larger ones did not — so the page
showed a mix of correct rows and `NaN míst`.

Let ICU do the formatting:

```ts
t("openings", { n: count })            // ✅ raw number
t("openings", { n: fmtInt(count) })    // ❌ NaN in any locale with plurals
```

Czech needs `one` / `few` / `other` (and `many` where the catalog uses it).
`i18n:check` compiles every message with the same parser next-intl uses at
runtime, so a malformed plural fails the gate rather than the page.

## What the lint can and cannot see

| Tool | Sees | Blind to |
| --- | --- | --- |
| `i18next/no-literal-string` (`jsx-text-only`) | Visible JSX **text nodes** | JSX **attributes**; strings in `.ts`; English arriving via a variable |
| `i18n:check` attribute grep | `aria-label` / `title` / `placeholder` / `alt` literals | Only where it is pointed (see below) |
| `i18n:check` leak guard | The English-error patterns above | Other indirection |

This is why an area is migrated by **reading it**, not by trusting a green lint.
The guided demo is the worked example: `/api/demo` → `/?sim=auto` is where the
four-language landing page's "Try the live demo" CTA lands, and the tour it
opened was English-only even though the dock around it was localized. Almost
none of that copy was JSX text — it was step titles and spotlight captions built
in `useSimulationWalk.ts`, phase labels in a `constants.ts` array, criterion rows
in `simCriteria.ts`, PlantUML label text in `simDiagrams.ts`, and the demo JD
body in `simCompanyTemplate.ts`. All of it now reads from the **`simulation`**
namespace, and `app/features/shell/simulation/**/*.tsx` is held at `error`.

Two shape rules that migration established for `.ts` modules:

- **A module a server imports cannot hold copy.** `simulation/constants.ts` is
  imported by the analytics filters and the sim store, so it keeps ids, tabs,
  enum codes and numbers; `SIM_PHASES` lost its `label` field and each renderer
  reads `simulation.phase.<id>` instead.
- **A pure builder takes its copy as a parameter.** `applyCompanyTemplate` has no
  strings of its own — headings and prose arrive in a `copy` object the caller
  fills from the catalog, alongside the `locale` it threads into
  `formatSalaryRange`.

`app/control/**/*.tsx` (F8) is the third, and the clearest case of an operator
console that was English "by default rather than by decision". The 462-line
`ControlRoom.tsx` is now a shell plus four panels — `AutonomyBar`, `GatesPanel`,
`AuditPanel`, `CalibrationPanel` — reading from the **`control`** namespace. Six of
the strings the old file held were attributes this rule structurally cannot see
(two `placeholder`s, four `aria-label`s including a templated *"Rate performance 3
of 5"*), and five more were the calibration rationale sentences in
`app/_lib/dev-outcomes.ts`, which no JSX lint could ever reach. What deliberately
stays English is **audit payload**: the lifecycle `stage` and `detail`, and the
audit row's `actor` / `action` / `reason` (`set_promote_floor`, `floor → 70 (from
calibration)`). Those are fields of a sealed, machine-readable record, and an audit
trail that reads differently depending on who opened the page is not an audit
trail — the same split as `approvedBy` / `reasonCode` in the decision chain. The
outcome enum (`hired`/`rejected`/`withdrawn`) goes the other way: the **value** on
the wire stays English, the **label** comes from `control.outcomes.value.*`.

`app/features/shell/tasks/**/*.tsx` is held at `error` for the same reason, and
is the sharper example of the table's right-hand column: almost nothing that was
wrong there was JSX text. It was the status→label map in `tasksTabHelpers.ts`,
the deep-link labels built inside `outcomeLink()`, thirteen task-label builders
in `app/_lib/tasks.ts` (one with a hand-rolled English plural), a
`toLocaleString("en-US")`, and a dozen `title`/`aria-label`/`placeholder`
attributes. The green lint that preceded the migration was measuring nothing.

The attribute grep matters most for `aria-label`: an untranslated one is
invisible in review and is the *only* thing a screen-reader user hears. It
currently covers `app/_components` plus the sealed marketing tree. Widening it
to all of `app/` is the right end state and is blocked only by a known backlog
of attribute literals elsewhere.

## Known gaps

- ~79 hardcoded JSX **attributes** outside the covered directories (21
  `aria-label`, 43 `title`, 15 `placeholder`), less the eight the control room
  closed (four `aria-label` incl. one templated, two `Select` `ariaLabel` props
  the attribute grep cannot see either, two `placeholder`).
- User-facing strings built in `.ts` files, which no lint covers: enum→label
  maps and parts of the dev-case studio (the latter deliberately outside the
  strict lint). The guided demo used to be the largest of these and is closed;
  the downloadable artifacts are closed too (see "A downloaded file is not
  automatically a document" above), and the onboarding presets went away with
  their module — `provenance-dossier` stays English by
  decision rather than by omission, and is documented as such in the file
  itself. Three shapes of the remainder recur, and each has a settled
  fix: a map that is *already* a `t.has()` fallback is fine and should say so in
  a comment (`APPLIED_LABEL`, `STAGE_HELP`); a map that duplicates a vocabulary
  the app already owns should be values-only and read `enums.*` at the render
  site (`SENIORITY_VALUES`); a label field nothing renders should just go
  (`jdsLibrary.SORTS`). A grammar constant that a parser round-trips
  (`ScheduleTypes.DEFAULT_SLOT`) is not copy at all — comment it and leave it.
- `ERROR_LEAK_ALLOW` in `scripts/i18n-check.mjs` still lists
  `usePipelineCandidateDrawerState.ts`, `analyzeRunAnalysis.ts` and
  `useDevSubmissionRow.ts`, whose GitHub call sites now resolve a real code. The
  entries are stale and can be dropped, which would re-arm the guard on those
  files.
- The demo's **audit-side** strings stay English by design, not by omission: the
  `approvedBy` actor on the screening approval and the persisted screening
  `rationale` are sealed-record fields, so they are stable and machine-readable
  in every locale. The UI renders the localized mirror from `reasonCode` via
  `waveReasonText` (`app/_lib/decision-attribution.ts`) instead.
- `LoadStatus` (`app/_components/LoadStatus.tsx`) composes its own English
  sentence around a caller-supplied `label` ("Couldn't refresh **the control
  room** — showing data from 4m ago"). Every call site is dev-facing today, so
  the banner is coherently English; the moment one of them is localized the
  component must take the whole sentence from a catalog rather than a fragment.
  `app/control/ControlRoom.tsx` passes an English `label` deliberately for this
  reason, and is the only ERROR-level caller.
- A running task's **`progressMsg`** is still English. Task labels are now
  catalog references, but the live progress line is written by each handler
  (`analyze-run`, `jd-build-run`, `devcase-orchestrator`, …) mid-run and is a mix
  of copy ("Starting…", "Nothing to screen") and data (a candidate name). Closing
  it means giving the handlers the same reference shape `task-label.ts` gives the
  label; the fallbacks the tab supplies when a handler sets nothing are localized.
