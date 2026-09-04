// Pure unit coverage for the saved-view collection logic (views-earn-their-name):
// the localStorage-shape migration/normalization and the default-precedence
// decision, plus the upsert/rename/set-default transforms. No React, no DOM — runs
// under `node --test` via the alias loader.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeStoredViews,
  defaultViewId,
  defaultViewToApply,
  withDefault,
  toggleDefault,
  upsertViewByName,
  renameStoredView,
  nameCollides,
} from "./pipelineViews.ts";
import { type SavedView } from "./pipelineBoardFilters.ts";

const view = (over: Partial<SavedView> & { id: string; name: string }): SavedView => ({
  query: "",
  ...over,
});

test("normalizeStoredViews: a legacy bare array with NO flags loads intact", () => {
  const stored = [view({ id: "a", name: "Aging", quick: "aging" }), view({ id: "b", name: "Interview" })];
  const out = normalizeStoredViews(JSON.parse(JSON.stringify(stored)));
  assert.equal(out.length, 2);
  assert.equal(out[0].name, "Aging");
  assert.equal(defaultViewId(out), null, "an old store carries no default");
});

test("normalizeStoredViews: a non-array (corrupt / legacy object) → empty list", () => {
  assert.deepEqual(normalizeStoredViews(null), []);
  assert.deepEqual(normalizeStoredViews({ views: [] }), []);
  assert.deepEqual(normalizeStoredViews("[]"), []);
});

test("normalizeStoredViews: rows missing id/name are dropped, valid ones kept", () => {
  const out = normalizeStoredViews([
    view({ id: "ok", name: "Keep" }),
    { name: "no id" },
    { id: "no name" },
    42,
    null,
  ]);
  assert.deepEqual(out.map((v) => v.id), ["ok"]);
});

test("normalizeStoredViews: at most ONE default survives — the first flag wins", () => {
  const out = normalizeStoredViews([
    view({ id: "a", name: "A" }),
    view({ id: "b", name: "B", isDefault: true }),
    view({ id: "c", name: "C", isDefault: true }),
  ]);
  assert.equal(defaultViewId(out), "b");
  assert.equal(out.find((v) => v.id === "c")!.isDefault, false, "the second default is demoted");
});

test("defaultViewToApply: an explicit shared/deep link WINS — no default applied", () => {
  const views = [view({ id: "d", name: "Default", isDefault: true })];
  assert.equal(defaultViewToApply(views, true), null, "URL carries explicit params → link wins");
  assert.equal(defaultViewToApply(views, false)?.id, "d", "bare visit → the default opens");
});

test("defaultViewToApply: a bare visit with no marked default applies nothing", () => {
  const views = [view({ id: "a", name: "A" })];
  assert.equal(defaultViewToApply(views, false), null);
});

test("withDefault: marks exactly one, clears the rest; passing null clears all", () => {
  const views = [view({ id: "a", name: "A", isDefault: true }), view({ id: "b", name: "B" })];
  const bDefault = withDefault(views, "b");
  assert.equal(defaultViewId(bDefault), "b");
  assert.equal(bDefault.find((v) => v.id === "a")!.isDefault, false);
  assert.equal(defaultViewId(withDefault(views, null)), null, "null clears every flag");
});

test("upsertViewByName: overwrites the same-named view and carries its default marking", () => {
  const views = [view({ id: "old", name: "Aging", quick: "aging", isDefault: true })];
  const next = upsertViewByName(views, view({ id: "new", name: "Aging", quicks: ["interview"] }));
  assert.equal(next.length, 1, "same name replaces, not appends");
  assert.equal(next[0].id, "new");
  assert.deepEqual(next[0].quicks, ["interview"]);
  assert.equal(next[0].isDefault, true, "re-saving the default view keeps it default");
});

test("upsertViewByName: a new name appends (insertion order)", () => {
  const views = [view({ id: "a", name: "A" })];
  const next = upsertViewByName(views, view({ id: "b", name: "B" }));
  assert.deepEqual(next.map((v) => v.id), ["a", "b"]);
});

test("upsertViewByName: overwriting keeps the view's POSITION (map-replace, not drop-to-end)", () => {
  const views = [view({ id: "a", name: "A" }), view({ id: "b", name: "B" }), view({ id: "c", name: "C" })];
  const next = upsertViewByName(views, view({ id: "b2", name: "B", quick: "aging" }));
  assert.deepEqual(next.map((v) => v.name), ["A", "B", "C"], "B stays in the middle, not moved to the end");
  assert.equal(next[1].id, "b2", "the middle slot now holds the overwriting view");
  assert.equal(next[1].quick, "aging", "…with its new contents");
});

test("upsertViewByName: a stray same-named duplicate collapses into the first slot", () => {
  const views = [view({ id: "a", name: "Dup" }), view({ id: "b", name: "B" }), view({ id: "c", name: "Dup" })];
  const next = upsertViewByName(views, view({ id: "d", name: "Dup" }));
  assert.deepEqual(next.map((v) => v.id), ["d", "b"], "both duplicates collapse into the first position");
});

test("renameStoredView: keeps identity — same id, filters, and default marking", () => {
  const views = [view({ id: "keep", name: "Old", quick: "aging", isDefault: true, stage: "Interview" })];
  const next = renameStoredView(views, "keep", "  New name  ");
  assert.equal(next[0].id, "keep", "id (identity) is preserved");
  assert.equal(next[0].name, "New name", "name is trimmed");
  assert.equal(next[0].quick, "aging", "encoded filters are untouched");
  assert.equal(next[0].stage, "Interview");
  assert.equal(next[0].isDefault, true, "default marking survives a rename");
});

test("renameStoredView: an empty/whitespace name is a no-op", () => {
  const views = [view({ id: "a", name: "A" })];
  assert.equal(renameStoredView(views, "a", "   ")[0].name, "A");
});

test("nameCollides: detects an existing name, excluding the edited view itself", () => {
  const views = [view({ id: "a", name: "Aging" }), view({ id: "b", name: "Interview" })];
  assert.equal(nameCollides(views, "Aging"), true);
  assert.equal(nameCollides(views, "  Aging  "), true, "trimmed comparison");
  assert.equal(nameCollides(views, "Aging", "a"), false, "the view being renamed doesn't collide with itself");
  assert.equal(nameCollides(views, "Fresh"), false);
});

test("toggleDefault: marking a non-default view makes it THE default", () => {
  const views = [view({ id: "a", name: "A", isDefault: true }), view({ id: "b", name: "B" })];
  const out = toggleDefault(views, "b");
  assert.equal(defaultViewId(out), "b", "the marking moves — never two defaults");
  assert.equal(out.find((v) => v.id === "a")?.isDefault, false);
});

test("toggleDefault: clicking the CURRENT default clears it (a board may have none)", () => {
  const views = [view({ id: "a", name: "A", isDefault: true }), view({ id: "b", name: "B" })];
  assert.equal(defaultViewId(toggleDefault(views, "a")), null);
});

test("toggleDefault: marking from a board with no default at all", () => {
  const views = [view({ id: "a", name: "A" }), view({ id: "b", name: "B" })];
  assert.equal(defaultViewId(toggleDefault(views, "a")), "a");
});

test("toggleDefault: an unknown id clears the marking rather than inventing one", () => {
  const views = [view({ id: "a", name: "A", isDefault: true })];
  const out = toggleDefault(views, "gone");
  assert.equal(defaultViewId(out), null);
  assert.equal(out.length, 1, "no view is added or dropped");
});

test("toggleDefault: inputs are untouched (the rule is a transform, not a mutation)", () => {
  const views = [view({ id: "a", name: "A", isDefault: true })];
  toggleDefault(views, "a");
  assert.equal(views[0].isDefault, true);
});
