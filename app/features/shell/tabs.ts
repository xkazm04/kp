// Tab definitions shared by the interactive Workspace (studio sidebar) and the
// server-rendered deep-link pages (which reuse the sidebar via WorkspaceNav).

// Single source of truth for the tab universe. The WorkspaceTabId union AND the
// runtime allowlist behind isWorkspaceTabId are both derived from this one
// literal array, so the type and the guard can never drift — adding a tab is a
// one-line edit the compiler keeps consistent (an id missing from the guard, or
// an extra one, used to be a silent bug: a deep link to a valid tab 404'd to the
// default with no error).
export const WORKSPACE_TAB_IDS = [
  "pipeline",
  "channels",
  "decisions",
  "schedule",
  "onboarding",
  "interview",
  "profile",
  "match",
  "analyze",
  // Analyze history is a sub-view reached from the Analyze tab (Workspace maps
  // it onto the Analyze nav item); a valid id but intentionally absent from
  // NAV_GROUPS below.
  "history",
  "jobs",
  "library",
  "matrix",
  "analytics",
  "dev",
  "about",
  // Background tasks is a client-only live view reached from the sidebar footer
  // (TasksIndicator), not a deep-link target — so it's a valid tab id here but
  // intentionally absent from NAV_GROUPS below.
  "tasks",
  "billing",
  "models",
  "workspace",
  "organization",
  "branding",
] as const;

export type WorkspaceTabId = (typeof WORKSPACE_TAB_IDS)[number];

// Minimal structural shape of a next-intl `nav`-namespace translator — the value
// returned by both `useTranslations("nav")` (client) and `await
// getTranslations("nav")` (server). Typed generically over the next-intl
// `Translator` (whose call signature only accepts its own NamespacedMessageKeys,
// not a bare string) so this catalog module stays free of a next-intl import and
// works on either side of the boundary; the loose `key: string` is cast to the
// translator's key type internally, as the inline copies did.
type NavTranslator = { (key: never): string; has: (key: never) => boolean };

// Translate a nav catalog key (`tabs.<id>` / `groups.<key>`) through the `nav`
// namespace, falling back to the English label baked into this module for any
// not-yet-translated entry. The has-fallback contract was previously copy-pasted
// inline in both sidebars, the command palette and the shortcuts overlay; this is
// the single owner so a tweak (key prefix, missing-label handling) lands once.
// Mirrors the `useEnumLabel` precedent in app/_lib/use-enum-label.ts. Callers pass
// the translator instance (the hook return or the awaited server translator)
// rather than this calling the hook, so it works in server components too.
export function navLabel<T extends NavTranslator>(t: T, key: string, fallback: string): string {
  const k = key as Parameters<T>[0];
  return t.has(k) ? t(k) : fallback;
}

// SHELL2 — the attention-count buckets /api/attention serves. A nav item opts
// into a badge by declaring which bucket it renders (`badgeKey` below); the
// mapping is declarative here, never positional in the renderers.
export type AttentionKey = "decisions" | "pipeline" | "schedule" | "jobs" | "channels";

export type WorkspaceTabDef = {
  id: WorkspaceTabId;
  label: string;
  badgeKey?: AttentionKey;
  // When set, the badge itself becomes a second click target that opens the tab
  // WITH these deep-link params — landing on the exact slice the count refers to
  // (e.g. Pipeline's stale entries via ?quick=aging) instead of the bare tab.
  // Only declare this when the counted cohort is NOT what the bare tab already
  // shows on landing; Decisions/Schedule open on their queues anyway.
  badgeParams?: Partial<Record<TabScopedParamKey, string>>;
};

// The Pipeline dashboard is the default landing surface.
export const DEFAULT_TAB: WorkspaceTabId = "pipeline";

// The About tab is a dev-only architecture deep-dive (component diagrams,
// internal file paths). In production it's hidden from the nav — and, because
// the command palette and keyboard shortcuts both derive from NAV_GROUPS, from
// those too — and a direct ?tab=about falls back to the default (see Workspace).
// The user-facing concept introduction lives on the public /about page instead.
export const ABOUT_TAB_IN_NAV = process.env.NODE_ENV !== "production";

// Grouped structure for the studio left sidebar. A flat tab list, if ever needed
// (e.g. a deep-link breadcrumb), should be derived from NAV_GROUPS.flatMap(g => g.items)
// rather than maintained as a fourth parallel declaration.
// `label` is the English source/fallback; `key` is the i18n key (under the `nav`
// catalog: tabs.<id> for items, groups.<key> for group headers) the renderers
// translate through, falling back to `label` for any not-yet-translated entry.
export type NavGroup = { label?: string; key?: string; items: WorkspaceTabDef[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { id: "pipeline", label: "Pipeline", badgeKey: "pipeline", badgeParams: { quick: "aging" } },
      { id: "channels", label: "Channels", badgeKey: "channels" },
      { id: "decisions", label: "Decisions", badgeKey: "decisions" },
      { id: "schedule", label: "Schedule", badgeKey: "schedule" },
      { id: "onboarding", label: "Onboarding" },
    ],
  },
  {
    label: "Library",
    key: "library",
    items: [
      { id: "jobs", label: "Jobs", badgeKey: "jobs" },
      { id: "library", label: "Job descriptions" },
    ],
  },
  {
    // Phase 6: Profile + Match are standalone tools (reachable from Channels:
    // Match = proactive sourcing, Profile = manual add), de-emphasized here.
    // Dev cases lives here too: it is one more assessment instrument alongside
    // Analyze/Interview sim, not a product line of its own — the former
    // single-item "Dev extension" group was a rail slot spent on one tab.
    label: "Tools",
    key: "tools",
    items: [
      { id: "profile", label: "Profile" },
      { id: "match", label: "Match" },
      { id: "analyze", label: "Analyze" },
      { id: "interview", label: "Interview sim" },
      // Appended last so the flat NAV_GROUPS order (and therefore every derived
      // g-chord) is byte-for-byte what it was under the old group.
      { id: "dev", label: "Dev cases" },
    ],
  },
  {
    label: "Insights",
    key: "insights",
    items: [
      { id: "analytics", label: "Analytics" },
      { id: "matrix", label: "Matrix" },
      ...(ABOUT_TAB_IN_NAV ? [{ id: "about", label: "About" } as WorkspaceTabDef] : []),
    ],
  },
  {
    // Workspace administration: subscription/usage (Billing) and the LLM
    // provider routing + key store (Models). Last in the rail's normal flow
    // (directly below Insights) rather than pinned to the bottom — the bottom
    // slot now belongs to the appearance/language preferences (RailPreferences).
    label: "Settings",
    key: "settings",
    items: [
      { id: "organization", label: "Organization" },
      { id: "branding", label: "Branding" },
      { id: "billing", label: "Billing" },
      { id: "models", label: "Models" },
      { id: "workspace", label: "Workspace" },
    ],
  },
];

// The first NAV_GROUP has no `key` (it's the operational hiring flow); this gives
// it a stable section id + English fallback label so every consumer can treat it
// like any other group. Lives here, beside the catalog it describes, so the
// JSX-free module owns section IDENTITY and the client nav layer (nav-meta.ts)
// owns only the glyphs — the command palette can group by section without
// pulling the lucide icon table into its chunk.
export const HIRING_SECTION = "hiring";
export const HIRING_FALLBACK_LABEL = "Hiring";

/** A group's stable section id: its catalog `key`, or "hiring" for the keyless
 *  operational group. Drives the rail icon and the group label lookup
 *  (nav.groups.<section>) — no parallel section list to keep in sync. */
export function sectionOf(group: NavGroup): string {
  return group.key ?? HIRING_SECTION;
}

// Built from the canonical array above — never re-listed — so it stays in lockstep
// with the WorkspaceTabId union.
const TAB_IDS: ReadonlySet<WorkspaceTabId> = new Set(WORKSPACE_TAB_IDS);

export function isWorkspaceTabId(value: string | null | undefined): value is WorkspaceTabId {
  return typeof value === "string" && TAB_IDS.has(value as WorkspaceTabId);
}

export function tabHref(id: WorkspaceTabId): string {
  return id === DEFAULT_TAB ? "/" : `/?tab=${id}`;
}

// Canonical active/inactive nav treatment, shared by the studio sidebar and the
// deep-link tab bar so the active state reads the same on both surfaces (was
// coral-wash on one, ink-pill on the other).
export function navItemClass(isActive: boolean): string {
  return isActive ? "bg-coral/10 text-coral" : "text-steel hover:bg-stone-50 hover:text-ink";
}

// Build a "/?…" href by patching `search` (the current query string, e.g. from
// useSearchParams().toString()) with `updates` (null/"" clears a key).
//
// `search` MUST be the React-tracked searchParams string — callers pass it in
// rather than letting this read window.location. router.replace/push
// (next/navigation) do NOT update window.location in the same tick, so when two
// navigations fire close together — a programmatic SimulationProvider.nav() during
// a sim run, or a user clicking a deep link then a tab — a window.location read on
// the second call would see the pre-first-navigation URL and clobber the first
// update (lost profile/job/tab params). Composing off the committed router state
// (useSearchParams) instead makes successive patches stack correctly.
//
// Components still pass the result to next/navigation's router so App Router's
// useSearchParams reliably re-renders — a raw history.pushState does NOT trigger
// that in Next 16, which is why sidebar clicks weren't switching content.
export function buildUrl(updates: Record<string, string | null>, search: string): string {
  const params = new URLSearchParams(search);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === "") params.delete(key);
    else params.set(key, value);
  }
  if (params.get("tab") === DEFAULT_TAB) params.delete("tab");
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

// The deep-link query params that scope a tab's view to a specific selection or
// prefill — a candidate (`profile`), a job (`job`), the profile editor's target
// (`edit`), the JD-builder draft (`jd*`). Unlike a future global/filter param,
// these must NOT survive a bare tab switch: otherwise the destination tab
// inherits the previous tab's selection (Profile's ?edit= or the JD-builder
// prefill silently leaking onto Jobs). This is the single canonical declaration
// of which params are tab-scoped — `buildTabSwitchUrl` clears every key here, the
// simulation reuses it to wipe the JD prefill, and the unit test pins the exact
// set so adding a deep-link param is a deliberate, reviewed edit rather than a
// silent leak. Anything NOT listed here survives a tab switch by design.
export const TAB_SCOPED_PARAM_KEYS = [
  "profile",
  "job",
  "edit",
  "jdTitle",
  "jdCompany",
  "jdSeniority",
  "jdFamily",
  "jdNeed",
  // The tasks tab's jd_build outcome link (?jdTask=<id>): JdBuilder rehydrates
  // the finished build's result from it. Tab-scoped like the other jd* prefills
  // — switching away must not replay the restore on a later sidebar return.
  "jdTask",
  // Board filter deep-link params (ANA1): analytics charts link into the
  // pipeline board pre-filtered (?q= text, ?quick= chip, ?stage= funnel stage).
  // Tab-scoped like any selection — switching away must not let a stale filter
  // silently re-apply when the user later returns via the sidebar. The board's
  // compound filters (perfect-board) extend this: ?quick= is now a CSV, and
  // ?score=/?source= (CSV bands + channels) and ?sort= join the same scoped set.
  "q",
  "quick",
  "stage",
  "score",
  "source",
  "sort",
  // shortlist-to-group-eval — the Decisions pre-armed group-eval selection
  // (?arm=<entryId,entryId,…>, grammar in sub_decisions/group-eval-arm.ts).
  // One-shot by design: DecisionsTab consumes it at mount then strips it via
  // history.replaceState; tab-scoped like any selection so a bare tab switch
  // can never carry a stale pre-arm along.
  "arm",
  // winnability-apply — the Library ledger's staged JD edit handoff from the
  // winnability coach (?coachEdit=<kind~slug~delta~value>, grammar in
  // sub_jobs/coach-apply.ts). One-shot like ?arm=: LibrarySavedJdsLedger consumes
  // it at mount (opens the JD in edit mode with a suggestion banner) then strips it
  // via history.replaceState; tab-scoped so a bare tab switch can't re-stage it.
  "coachEdit",
] as const;

export type TabScopedParamKey = (typeof TAB_SCOPED_PARAM_KEYS)[number];

// A `{ key: null }` patch that clears every tab-scoped param. Spread into
// buildUrl (or the simulation's nav) to wipe a tab's selection/prefill from one
// place instead of hand-listing keys — re-listing them at a call site is exactly
// the literal that rots as new deep-link params are added.
export function clearedTabScopedParams(): Record<TabScopedParamKey, null> {
  return Object.fromEntries(TAB_SCOPED_PARAM_KEYS.map((key) => [key, null])) as Record<TabScopedParamKey, null>;
}

// Href for a bare tab switch (sidebar nav, TasksIndicator): select `tab` and
// clear every tab-scoped param so the destination opens on a clean view. `search`
// is the React-tracked searchParams string (see buildUrl) — threaded through so the
// switch composes off the committed router state, not a stale window.location read.
export function buildTabSwitchUrl(id: WorkspaceTabId, search: string): string {
  return buildUrl({ tab: id, ...clearedTabScopedParams() }, search);
}
