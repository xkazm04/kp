// The Assignments studio's three sub-tab definitions, split out of DevTab.tsx: the
// assignment library first (read + operate), creation second, comms third. Local
// state only — the tab owns its own sub-navigation, the workspace-level ?tab=
// param stays untouched.
//
// ONE THREAD (gap 7), closed. This module used to hold the only user-facing copy on
// this surface that was NOT in the four catalogs, which is exactly why it kept saying
// "Cases" long after the nav tab, the table header and the empty ledger said
// Assignment — no locale gate reads a string literal, so nothing could notice, and
// `devcase-vocabulary.test.ts` had to source-guard the WORD while the LANGUAGE stayed
// English for every cs/de/fr reader. It now carries catalog KEYS instead of copy: the
// word is guarded by the ordinary catalog walk (one gate, not two) and the headings
// render in the reader's own language.
//
// Keys, not sentences, is the whole point — a component that holds a key cannot drift
// from the catalog without `tsc` saying so, because next-intl keys are typed.

/** The sub-tabs, in the order they are offered. `id` is STATE (it selects a view and
 *  is not copy — "cases" must not move); `labelKey` names the word on the chip,
 *  resolved under `devcase.studio`. */
export const DEV_VIEWS = [
  { id: "cases", labelKey: "views.cases.label" },
  { id: "define", labelKey: "views.define.label" },
  { id: "outbox", labelKey: "views.outbox.label" },
] as const;
export type DevView = (typeof DEV_VIEWS)[number]["id"];

/** The page header for each view, as KEYS under `devcase.studio`. The define blurb
 *  takes `max` — the codebase cap comes from `devcase-constraints.ts`, so the number a
 *  reader is promised and the number the form enforces cannot disagree. */
export const VIEW_HEADING = {
  cases: { titleKey: "views.cases.title", blurbKey: "views.cases.blurb" },
  define: { titleKey: "views.define.title", blurbKey: "views.define.blurb" },
  outbox: { titleKey: "views.outbox.title", blurbKey: "views.outbox.blurb" },
} as const satisfies Record<DevView, { titleKey: string; blurbKey: string }>;
