import { test } from "node:test";
import assert from "node:assert/strict";
import { arrivalAdoption, initialInboxValue, shouldEmptyInbox } from "./urlInbox.ts";

// /perfect wave 17 (shell-nav): useUrlInboxState's three rules were inline in a
// render body and an effect, so nothing checked them. The one that matters is
// "an absent param is never an arrival": the hook empties its own inbox, so
// treating absence as the default arriving would bounce every deep link back to
// Overview one frame after it landed.

type Tab = "overview" | "pipeline" | "decisions";
const TABS: Tab[] = ["overview", "pipeline", "decisions"];
const parseTab = (raw: string | null): Tab | null => (TABS.includes(raw as Tab) ? (raw as Tab) : null);

test("a cold load with the param already present renders it on the first frame", () => {
  assert.equal(initialInboxValue("decisions", parseTab, "overview"), "decisions");
  assert.equal(initialInboxValue(null, parseTab, "overview"), "overview");
  assert.equal(initialInboxValue("nonsense", parseTab, "overview"), "overview");
  assert.equal(initialInboxValue("", parseTab, "overview"), "overview");
});

test("an arrival is adopted exactly once, not on every render", () => {
  const first = arrivalAdoption("pipeline", null, parseTab, "overview");
  assert.deepEqual(first, { isArrival: true, value: "pipeline" });
  // Same param, now seen: no second adoption, so a later in-app switch is not undone.
  assert.deepEqual(arrivalAdoption("pipeline", "pipeline", parseTab, "decisions"), {
    isArrival: false,
    value: "decisions",
  });
});

test("the param going ABSENT is an arrival to record but never a value change", () => {
  // This is the hook emptying its own inbox one render later. It must not read as
  // "the default arrived" — that would bounce the deep link straight back.
  const cleared = arrivalAdoption(null, "decisions", parseTab, "decisions");
  assert.equal(cleared.isArrival, true, "the transition must be recorded so it fires once");
  assert.equal(cleared.value, "decisions", "…but the view stays where the link put it");
});

test("an unparseable arrival leaves the current value alone", () => {
  assert.deepEqual(arrivalAdoption("nonsense", null, parseTab, "pipeline"), {
    isArrival: true,
    value: "pipeline",
  });
  // A vocabulary gate (a tab the viewer may not see) is the same shape: parse
  // returns null, the reader keeps the view they were on.
  const gated = (raw: string | null) => (raw === "decisions" ? null : parseTab(raw));
  assert.equal(arrivalAdoption("decisions", null, gated, "overview").value, "overview");
});

test("re-arriving at the SAME value is still an arrival", () => {
  // The bug the inbox design exists to fix: with the URL as state, a second link
  // to `?tab=pipeline` was not a change and looked broken. After the inbox
  // emptied, `seen` is null, so the identical param arrives again.
  assert.deepEqual(arrivalAdoption("pipeline", null, parseTab, "pipeline"), {
    isArrival: true,
    value: "pipeline",
  });
});

test("only a present param needs emptying", () => {
  assert.equal(shouldEmptyInbox("pipeline"), true);
  assert.equal(shouldEmptyInbox("nonsense"), true, "junk is cleared too, or a later valid link looks dead");
  assert.equal(shouldEmptyInbox(""), true, "an empty-string param is still in the bar");
  assert.equal(shouldEmptyInbox(null), false);
});
