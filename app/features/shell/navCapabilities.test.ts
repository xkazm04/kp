import { test } from "node:test";
import assert from "node:assert/strict";
import {
  capabilityForTab,
  capabilityLabelKey,
  commandAllowed,
  lockedCapability,
  lockedTabsFor,
  TAB_CAPABILITY,
  TOUR_CAPABILITY,
  visibleNavFor,
} from "./navCapabilities.ts";
import { NAV_GROUPS, WORKSPACE_TAB_IDS, type WorkspaceTabId } from "./tabs.ts";
import { MEMBER_ROLES, roleCapabilities, type Capability } from "@/app/_lib/auth/roles.ts";

const capsOf = (role: (typeof MEMBER_ROLES)[number]): Capability[] => [...roleCapabilities(role)];

// The whole point: before this table the rail and the palette offered a viewer
// every settings door, and wave 18a's server gates then refused each one.
test("a viewer is locked out of exactly the settings doors their role cannot open", () => {
  const locked = lockedTabsFor(capsOf("viewer"));
  assert.deepEqual(
    [...locked].sort(),
    ["billing", "hiring", "integrations", "models", "organization", "workspace"]
  );
});

test("an owner is locked out of nothing", () => {
  assert.equal(lockedTabsFor(capsOf("owner")).size, 0);
});

test("a recruiter keeps the pipeline composer but not the org/billing doors", () => {
  const locked = lockedTabsFor(capsOf("recruiter"));
  assert.equal(locked.has("hiring"), false); // pipeline:write
  assert.equal(locked.has("billing"), true); // org:manage
  assert.equal(locked.has("organization"), true); // members:manage
});

test("an admin keeps members + teams but not billing (org:manage is owner-only)", () => {
  const locked = lockedTabsFor(capsOf("admin"));
  assert.equal(locked.has("organization"), false);
  assert.equal(locked.has("workspace"), false);
  assert.equal(locked.has("billing"), true);
});

// Fail OPEN while unknown: hiding an owner's Billing tab because one GET blipped
// would be a worse failure than the one this table closes.
test("an unknown capability set locks nothing", () => {
  assert.equal(lockedTabsFor(null).size, 0);
  assert.equal(lockedTabsFor(undefined).size, 0);
  assert.equal(lockedCapability("billing", null), null);
  assert.equal(commandAllowed(TOUR_CAPABILITY, null), true);
});

test("lockedCapability names the capability that locked the tab", () => {
  assert.equal(lockedCapability("billing", capsOf("viewer")), "org:manage");
  assert.equal(lockedCapability("billing", capsOf("owner")), null);
  assert.equal(lockedCapability("pipeline", capsOf("viewer")), null); // read-only surface
});

test("the tour command is a pipeline write, offered only to a caller who may write", () => {
  assert.equal(TOUR_CAPABILITY, "pipeline:write");
  assert.equal(commandAllowed(TOUR_CAPABILITY, capsOf("viewer")), false);
  assert.equal(commandAllowed(TOUR_CAPABILITY, capsOf("hiring_manager")), true);
});

// The table can only mirror authority that exists — an id that is not a tab, or a
// capability that is not in the role model, is a table that has drifted.
test("every gated id is a real tab id", () => {
  const ids = new Set<string>(WORKSPACE_TAB_IDS);
  for (const id of Object.keys(TAB_CAPABILITY)) assert.equal(ids.has(id), true, `${id} is not a tab`);
});

test("visibleNavFor annotates without removing — a locked door is never silently missing", () => {
  const view = visibleNavFor(capsOf("viewer"));
  assert.equal(view.length, NAV_GROUPS.length);
  for (const [i, g] of view.entries()) {
    assert.equal(g.items.length, NAV_GROUPS[i].items.length);
  }
  const settings = view.find((g) => g.group.key === "settings");
  assert.ok(settings);
  const billing = settings.items.find((it) => it.def.id === "billing");
  assert.equal(billing?.locked, "org:manage");
  const branding = settings.items.find((it) => it.def.id === "branding");
  assert.equal(branding?.locked, null, "branding's door is requireOperator, not a capability");
});

test("capabilityForTab is null for the read surfaces the whole team shares", () => {
  for (const id of ["pipeline", "decisions", "schedule", "channels", "jobs", "analytics"] as WorkspaceTabId[]) {
    assert.equal(capabilityForTab(id), null);
  }
});

// Capability ids carry a ":", next-intl paths are dot-separated.
test("capabilityLabelKey maps every capability onto a dot-safe catalog key", () => {
  assert.equal(capabilityLabelKey("org:manage"), "capabilities.orgManage");
  assert.equal(capabilityLabelKey("pipeline:write"), "capabilities.pipelineWrite");
  for (const cap of Object.values(TAB_CAPABILITY)) {
    if (cap) assert.equal(capabilityLabelKey(cap).includes(":"), false);
  }
});
