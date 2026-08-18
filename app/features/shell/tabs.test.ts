// Pins the single-source tab-id contract (idea-bd5196ea): the WorkspaceTabId
// union, the runtime guard (isWorkspaceTabId), and the nav structure must all
// agree because they derive from ONE canonical array. The bug this guards
// against is silent drift — a real tab id missing from the runtime allowlist, so
// a deep link to a valid tab 404s to the default with no error.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTabSwitchUrl,
  buildUrl,
  clearedTabScopedParams,
  DEFAULT_TAB,
  isWorkspaceTabId,
  LEGACY_TAB_ALIASES,
  NAV_GROUPS,
  resolveTabParam,
  tabHref,
  TAB_SCOPED_PARAM_KEYS,
  WORKSPACE_TAB_IDS,
} from "./tabs.ts";

// buildUrl/buildTabSwitchUrl take the current query as an explicit `search` string
// (the React-tracked useSearchParams().toString()), so these tests pass it directly
// — no DOM/window to simulate. The leading "?" is optional: URLSearchParams strips
// it, and useSearchParams().toString() emits none.

// Parse a "/?a=b&c=d" href (or "/") back into a URLSearchParams for assertions.
function paramsOf(href: string): URLSearchParams {
  return new URL(href, "http://localhost").searchParams;
}

test("every canonical tab id passes the runtime guard (union ↔ guard cannot drift)", () => {
  for (const id of WORKSPACE_TAB_IDS) {
    assert.equal(isWorkspaceTabId(id), true, `${id} must pass isWorkspaceTabId`);
  }
});

test("the canonical array has no duplicate ids", () => {
  assert.equal(new Set(WORKSPACE_TAB_IDS).size, WORKSPACE_TAB_IDS.length);
});

test("isWorkspaceTabId rejects non-members and nullish input", () => {
  for (const bad of ["nope", "Pipeline", "", "tab", null, undefined]) {
    assert.equal(isWorkspaceTabId(bad), false, `${String(bad)} should be rejected`);
  }
});

test("the default tab is itself a valid tab id", () => {
  assert.equal(isWorkspaceTabId(DEFAULT_TAB), true);
});

test("every NAV_GROUPS item id is a valid tab id", () => {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      assert.equal(isWorkspaceTabId(item.id), true, `nav item ${item.id} must be a valid tab id`);
    }
  }
});

test("history and tasks are valid ids but intentionally absent from NAV_GROUPS", () => {
  const navIds = new Set(NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id)));
  for (const id of ["history", "tasks"] as const) {
    assert.equal(isWorkspaceTabId(id), true, `${id} is a valid tab id`);
    assert.equal(navIds.has(id), false, `${id} is not a deep-link nav target`);
  }
});

// The Tools rebrand (profile → archetypes, dev → assignments) changed ids that were
// already in bookmarks and pasted links. Dropping them would have landed those on
// Overview — a silent "the feature is gone". These three tests pin the redirect.
test("legacy tab ids resolve to their renamed tab", () => {
  assert.equal(resolveTabParam("profile"), "archetypes");
  assert.equal(resolveTabParam("dev"), "assignments");
});

test("every alias target is a live tab id, and no alias shadows one", () => {
  for (const [legacy, live] of Object.entries(LEGACY_TAB_ALIASES)) {
    assert.equal(isWorkspaceTabId(live), true, `alias ${legacy} must point at a live tab id`);
    // An alias whose own key is still a live id would be dead code that also
    // silently overrides nothing — a sign the rename was never finished.
    assert.equal(isWorkspaceTabId(legacy), false, `${legacy} is retired, so it must not also be a live id`);
  }
});

test("resolveTabParam passes live ids through and rejects everything else", () => {
  for (const id of WORKSPACE_TAB_IDS) assert.equal(resolveTabParam(id), id);
  for (const bad of ["nope", "Profile", "", null, undefined]) assert.equal(resolveTabParam(bad), null);
});

test("tabHref points the default tab at / and every other tab at /?tab=<id>", () => {
  assert.equal(tabHref(DEFAULT_TAB), "/");
  for (const id of WORKSPACE_TAB_IDS) {
    if (id === DEFAULT_TAB) continue;
    assert.equal(tabHref(id), `/?tab=${id}`);
  }
});

// --- Tab-scoped param survival contract (idea-2ddf7368) ----------------------
// A tab switch must clear the deep-link params that scope one tab's view and
// leave everything else alone. Pinning the exact allowlist here makes adding or
// dropping a tab-scoped param a deliberate, reviewed edit instead of a silent
// cross-tab state leak.

test("the tab-scoped allowlist is exactly the known deep-link params", () => {
  assert.deepEqual(
    [...TAB_SCOPED_PARAM_KEYS].sort(),
    ["arm", "coachEdit", "edit", "jdCompany", "jdFamily", "jdNeed", "jdSeniority", "jdTask", "jdTitle", "job", "profile", "q", "quick", "score", "sort", "source", "stage"]
  );
});

test("the allowlist has no duplicates", () => {
  assert.equal(new Set(TAB_SCOPED_PARAM_KEYS).size, TAB_SCOPED_PARAM_KEYS.length);
});

test("clearedTabScopedParams nulls every tab-scoped key and nothing else", () => {
  const cleared = clearedTabScopedParams();
  assert.deepEqual(Object.keys(cleared).sort(), [...TAB_SCOPED_PARAM_KEYS].sort());
  for (const key of TAB_SCOPED_PARAM_KEYS) assert.equal(cleared[key], null);
});

test("a tab switch clears every tab-scoped param but preserves the rest", () => {
  // Every tab-scoped key is present, plus an unrelated global param.
  const current =
    "tab=archetypes&" + TAB_SCOPED_PARAM_KEYS.map((k) => `${k}=x`).join("&") + "&theme=dark";
  const params = paramsOf(buildTabSwitchUrl("jobs", current));
  assert.equal(params.get("tab"), "jobs");
  for (const key of TAB_SCOPED_PARAM_KEYS) {
    assert.equal(params.get(key), null, `${key} must be cleared on a tab switch`);
  }
  // A param NOT on the allowlist survives the switch by design.
  assert.equal(params.get("theme"), "dark");
});

test("switching to the default tab names it and clears the tab-scoped params", () => {
  // CHANGED DELIBERATELY (UAT TOM-ANA-1) — this used to assert the whole href
  // collapsed to "/". See the buildUrl contract note below for why an explicitly
  // requested tab now survives; buildTabSwitchUrl is rendered as an href by the
  // command palette and the empty-state CTAs, so it is a navigation like any other.
  const params = paramsOf(buildTabSwitchUrl(DEFAULT_TAB, "tab=jobs&job=j1&profile=cand1"));
  assert.equal(params.get("tab"), DEFAULT_TAB);
  for (const key of TAB_SCOPED_PARAM_KEYS) {
    assert.equal(params.get(key), null, `${key} must be cleared on a tab switch`);
  }
});

test("selectTab's old literal would have leaked the params added since", () => {
  // Reproduces the original buildUrl({ tab, profile: null, job: null }) call and
  // proves it leaks the deep-link params introduced after it (edit, jd*) — the
  // regression this contract exists to prevent.
  const leaked = paramsOf(buildTabSwitchUrl("jobs", "tab=archetypes&edit=cand1&jdTitle=Staff%20Eng"));
  assert.equal(leaked.get("edit"), null);
  assert.equal(leaked.get("jdTitle"), null);
});

// --- buildUrl composes off the PASSED search, never window.location (idea-1239fb8f)
// The race this fixes: router.replace/push don't update window.location in the same
// tick, so a second buildUrl that read window would compose off the pre-first-nav URL
// and clobber the first update. Pin that buildUrl ignores window entirely and patches
// the explicit (React-tracked) search string instead.

test("buildUrl patches the passed search string and ignores window.location", () => {
  const g = globalThis as { window?: unknown };
  const prev = g.window;
  // A stale window.location.search that, if read, would clobber the patch below.
  g.window = { location: { search: "?tab=archetypes&profile=STALE" } };
  try {
    // Compose off the *committed* state (tab=matrix) — the stale window must not leak in.
    const href = paramsOf(buildUrl({ profile: "fresh" }, "tab=matrix"));
    assert.equal(href.get("tab"), "matrix");
    assert.equal(href.get("profile"), "fresh");
  } finally {
    if (prev === undefined) delete g.window;
    else g.window = prev;
  }
});

test("buildUrl preserves unrelated params already in the search string", () => {
  // The exact lost-nav symptom: a prior nav set job=j1; the next patch (profile=c1)
  // must STACK on it, not drop it.
  const href = paramsOf(buildUrl({ profile: "c1" }, "tab=matrix&job=j1"));
  assert.equal(href.get("tab"), "matrix");
  assert.equal(href.get("job"), "j1");
  assert.equal(href.get("profile"), "c1");
});

test("buildUrl clears a key on null or empty string", () => {
  const href = paramsOf(buildUrl({ job: null, profile: "" }, "tab=matrix&job=j1&profile=c1"));
  assert.equal(href.get("job"), null);
  assert.equal(href.get("profile"), null);
  assert.equal(href.get("tab"), "matrix");
});

// --- The default tab must still be REACHABLE by link (UAT TOM-ANA-1) ----------
// These two tests replace one that read:
//
//   test("buildUrl drops the tab param when it equals the default tab", () => {
//     assert.equal(buildUrl({ tab: DEFAULT_TAB }, "tab=jobs"), "/");
//
// It was a deliberate assertion and it passed for good reasons — the default tab
// lives at "/", so `/?tab=pipeline` was noise worth deleting. What changed under it
// is the OTHER half of the contract: since 2d02a388 the active tab is app state and
// `?tab=` is an inbox that only adopts a value when the param ARRIVES
// (nav/useUrlInboxState.ts). Deleting the default from an explicit patch therefore
// stopped being canonicalization and became the deletion of a navigation: all five
// Analytics `boardHref` call sites emitted `/?stage=Interview` with no tab, so the
// click rewrote the address bar and left the reader on Analytics (clicked live —
// `urlAfterClick: "/?stage=Interview"`, `looksLikeBoard: false`). `tab=decisions`,
// `"jobs"` and `"channels"` were unaffected, which is why it stayed silent.
//
// The rule is now scoped by intent rather than dropped: a tab NAMED IN THE PATCH is
// a navigation and survives; a tab merely carried in `search` is still canonicalized
// away. The address bar still settles on "/" — the inbox strips `?tab=` on arrival.

test("buildUrl keeps an explicitly requested default tab — the patch is a navigation", () => {
  const href = paramsOf(buildUrl({ tab: DEFAULT_TAB }, "tab=jobs"));
  assert.equal(href.get("tab"), DEFAULT_TAB);
});

test("buildUrl still drops a leftover default tab carried in the search string", () => {
  // No `tab` in the patch: the value is residue from a consumed arrival, and its
  // canonical form is absence. This half of the old assertion is unchanged.
  assert.equal(buildUrl({ q: "" }, `tab=${DEFAULT_TAB}`), "/");
  assert.equal(buildUrl({}, ""), "/");
  // Clearing it explicitly still clears it.
  assert.equal(buildUrl({ tab: null }, `tab=${DEFAULT_TAB}&stage=Interview`), "/?stage=Interview");
});

test("a chart's board deep link carries BOTH the tab and its cohort filter", () => {
  // The exact shape every analytics `boardHref` builds (AnalyticsTab, DecisionLog,
  // DecisionRecordsPanel, CalibrationPanel, ScoreBands): clear the other tab-scoped
  // params, name the board, add the cohort. PipelineTab hydrates ?stage=/?q= from
  // these at mount (usePipelineFilters.ts:50-65), so both halves must be on the wire.
  const href = paramsOf(
    buildUrl({ ...clearedTabScopedParams(), tab: DEFAULT_TAB, stage: "Interview" }, "sec=performance&win=90&profile=STALE")
  );
  assert.equal(href.get("tab"), DEFAULT_TAB);
  assert.equal(href.get("stage"), "Interview");
  assert.equal(href.get("profile"), null, "the prior tab's selection must not ride along");
  // Not tab-scoped by design: the analytics cohort window survives the trip so a
  // return to the tab reads the same period.
  assert.equal(href.get("win"), "90");
});

test("every non-default tab link still names its tab (the branches that never broke)", () => {
  for (const id of ["decisions", "jobs", "channels"] as const) {
    assert.equal(paramsOf(buildUrl({ tab: id, q: "Nováková" }, "")).get("tab"), id);
  }
});
