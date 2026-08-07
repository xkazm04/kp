# JD Authoring Library & Templates — bug-hunter + ui-perfectionist scan

> Context: Author, lint, version and render job descriptions from reusable templates (Library tab, JD builder/ledger, template manager, public JD detail pages).
> Files reviewed: 16 of 33
> Total: 5

## 1. Public JD share links are login-gated in production — the proxy allow-list omits `/jds/`

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: trust-boundary / broken-core-flow
- **File**: `proxy.ts:17-18` (allow-list) vs `app/jds/[slug]/page.tsx:81-102`, `app/api/jds/[slug]/route.ts:12-23`
- **Scenario**: A recruiter shares a JD link (`/jds/<slug>?lang=cs`) with a candidate, or Slack/Twitter fetches it for an unfurl. In production `KP_OPERATOR_PASSWORD` is set, so `proxy()` runs the fail-closed gate on every non-public path. `PUBLIC_PAGES` lists `/apply/`, `/offer/`, `/interview/`… but **not** `/jds/`, and `PUBLIC_API_PREFIXES` omits `/api/jds`. The anonymous request fails `isPublic()` and is 302'd to `/login`.
- **Root cause**: The page and its GET route were deliberately built as candidate-facing artifacts — `generateMetadata` exists precisely for shared-link unfurls (`page.tsx:28-51`), the Apply CTA renders for anonymous visitors, and `canManage`/PATCH gate the operator-only bits server-side. But the edge auth gate was never told this surface is public, so the whole "shareable JD" feature is unreachable without a session.
- **Impact**: Every shared JD link dead-ends at a login wall in prod; OG unfurls show a login page; the JD→Apply bridge (JDL2) is broken for exactly the audience it targets. Silent — nothing in the feature code reveals it.
- **Fix sketch**: Add `/jds/` to `PUBLIC_PAGES` and `/api/jds` (GET) to the public API set; keep write verbs operator-gated (PATCH already calls `requireOperator`; add it to `generate`/`retry-analysis`). Add a proxy test asserting `/jds/<slug>` is public so this class of "designed-public but gate-omitted" regression fails CI.

## 2. Switching the Library sub-tab (or Duplicate) unmounts the builder and silently discards a typed JD draft

- **Severity**: Medium
- **Lens**: bug-hunter, ui-perfectionist
- **Category**: state-corruption / missing-ui-state
- **File**: `app/features/sub_library/LibrarySavedJdsLedger.tsx:183-186,173-176`; `app/features/sub_library/JdBuilder.tsx:36-56`
- **Scenario**: A recruiter is on the "Generate" tab and hand-writes a long role title + "Describe the need" body in the rich editor. They click the "Saved" segment (to check an existing role, or a mis-click) and back to "Generate". Everything they typed is gone.
- **Root cause**: The ledger renders `tab === "generate" ? <LibraryGeneratePanel/> : <table/>` — a hard XOR. All builder inputs (`title`, `needText`, `company`, `repoUrl`…) live in `JdBuilder`'s local `useState`, so flipping the segment unmounts the component and drops that state; remounting starts empty (prefill is null on a manual switch). There is no unsaved-changes guard, no draft persistence, no confirm.
- **Impact**: Real, unrecoverable loss of composed work with zero warning — the exact content the feature exists to capture. Only workaround is "never touch the segment mid-compose."
- **Fix sketch**: Lift the builder's draft into the parent (or a `sessionStorage`-backed hook) so it survives the tab swap, or render both panels and hide the inactive one with `hidden` to preserve state; at minimum, warn before discarding a dirty form.

## 3. The saved-JD ledger is hardcoded English — cs/de/fr recruiters get an untranslated core surface

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: i18n / visual-consistency
- **File**: `app/features/sub_library/LibrarySavedJdsLedger.tsx:15` (`eslint-disable i18next/no-literal-string`), e.g. `:179,217-279,286-287,328-336,383-392,616-620`
- **Scenario**: A Czech-locale recruiter opens the Library. Every column header ("Role/Field/Seniority/Status/Analyzed/Saved/Actions"), the "Search roles" placeholder, filter "All / No values yet", the "Analyzing/Building this job description…/Retry build" copy, the detail-rail buttons ("Open public page", "Analyze a CV") and tooltips render in English, while the rest of the app (and the `library.tab`/`library.builder` keys this file already imports) is localized.
- **Root cause**: The file was shipped with a blanket lint-disable and a "i18n is a follow-up" note; new strings were written as literals instead of `t()` keys. This is not the intentionally-English Dev Studio (`sub_dev`) — it is a primary recruiter surface in the localized app (en/cs/de/fr).
- **Impact**: A visibly half-translated flagship table breaks the localization promise (JDL5 even generates JDs in the recruiter's language) and reads as unfinished for every non-English tenant.
- **Fix sketch**: Move the literals into the existing `library.tab` message namespace across `messages/{en,cs,de,fr}.json`, thread `t()`, and drop the file-level lint-disable so `i18n-check.mjs` keeps parity enforced.

## 4. Column-header filter declares a `listbox` but breaks its keyboard/ARIA contract

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: a11y
- **File**: `app/features/sub_library/LibrarySavedJdsLedger.tsx:412-496` (`ColumnHeaderFilter` / `FilterRow`)
- **Scenario**: A keyboard or screen-reader user filters the JD table by Field/Seniority/Status. The trigger is `aria-haspopup="listbox" aria-expanded`, the popup is `role="listbox"`, and each option is a `<button role="option" aria-selected>`. Opening the menu does not move focus into it, there is no Up/Down arrow navigation, no `aria-activedescendant`, and no `aria-controls` linking trigger to list.
- **Root cause**: The listbox pattern was applied visually but not behaviorally — a `role="option"` on a focusable `<button>` mixes two conflicting interaction models, and the expected roving-focus/arrow-key handling of a listbox was never implemented (only outside-click + Escape are wired).
- **Impact**: SR users hear "listbox" and expect arrow navigation that isn't there; the active option isn't announced on open; the semantics mislead assistive tech on three filters used on every visit.
- **Fix sketch**: Either implement the full listbox (focus first/selected option on open, arrow-key roving via `aria-activedescendant`, `aria-controls`), or drop `role="listbox"/"option"` and treat it as a plain `role="menu"`/button group whose native button semantics already work. Extract as a shared filter-menu primitive so the three headers stay consistent.

## 5. Lint panel's kind ladder silently mislabels any unknown finding as "missing place"

- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: silent-failure / edge-case
- **File**: `app/features/sub_library/JdLintPanel.tsx:27-40`; kinds defined in `app/_lib/jd-lint.ts:13-19`
- **Scenario**: `lintJd` ever gains a new `JdLintFinding` kind (the union is already open — `vague | missing | exclusionary | manyMustHaves`). The panel's nested ternary handles `vague`/`exclusionary`/`manyMustHaves`, then falls through to `f.what === "salary" ? lintMissingSalary : lintMissingPlace`.
- **Root cause**: The final branch assumes "anything not matched above is a `missing` finding," so it is exhaustive only by luck. A future kind (no `.what`) is not a type error here and renders the wrong translated string ("This JD is missing a place of work") for an unrelated problem — a silent wrong result in the inclusivity/quality signal recruiters trust.
- **Impact**: Today it renders correctly; the risk is a latent mislabel that no compiler catches when the lint rules grow (they were recently extended once already, per the `7469c05f` comments).
- **Fix sketch**: Make the switch exhaustive with a `default: assertNever(f)` (or a `Record<kind, renderer>` map keyed off `f.kind`) so adding a kind without updating the panel fails the build instead of shipping a wrong label.
