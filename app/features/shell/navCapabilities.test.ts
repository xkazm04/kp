import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  capabilityForTab,
  capabilityLabelKey,
  commandAllowed,
  lockedCapability,
  lockedTabsFor,
  navItemMode,
  panelFor,
  tabArrival,
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
    ["billing", "branding", "hiring", "integrations", "models", "organization", "workspace"]
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
  assert.equal(branding?.locked, "org:manage", "branding renders locked, not missing, for a seat that cannot save it");
});

// PUT /api/brand asks org:manage (challenge-r07 shell-setup-wizard/A). Before this
// row the rail still offered the editor to an admin, who could edit every field and
// then meet a 403 on save — the shell inviting them through a door it knew was locked.
test("branding is offered only to a seat that can save it", () => {
  assert.equal(capabilityForTab("branding"), "org:manage");
  assert.equal(lockedCapability("branding", capsOf("admin")), "org:manage", "an admin lacks org:manage");
  assert.equal(lockedTabsFor(capsOf("admin")).has("branding"), true);
  assert.equal(lockedTabsFor(capsOf("recruiter")).has("branding"), true);
  assert.equal(lockedCapability("branding", capsOf("owner")), null, "an owner saves the brand");
  // Open/dev mode and an operator session fold to OWNER_CAPS server-side
  // (current-user.ts), so the keyless first run keeps its branding editor.
  assert.equal(lockedTabsFor(capsOf("owner")).has("branding"), false);
  // Unknown caps still lock nothing.
  assert.equal(lockedCapability("branding", null), null);
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

// ---- Every door converges on one authority (challenge-r08 workspace-shell-core/B) ----
//
// The rail and the palette read the lock; a g-chord, a ?tab= arrival (a checkout
// return, a calendar callback, a shared link) and programmatic selectTab did not, and
// opened the tab into a 403 rendered as a failed load. The lock is now decided at the
// DESTINATION: WorkspaceTabPanel renders through panelFor over the exhaustive
// TAB_PANELS registry (idea-47b71431), so every entrance lands on the same answer.
test("tabArrival: one authority for every entrance", () => {
  assert.deepEqual(tabArrival("billing", ["read"]), { kind: "locked", needs: "org:manage" });
  assert.deepEqual(tabArrival("billing", null), { kind: "open" }, "unknown caps fail open");
  // PUT /api/brand asks org:manage (9c226bc38) and TAB_CAPABILITY carries branding
  // (36bb74cd3): a read-only seat arriving on ?tab=branding is LOCKED, not opened
  // onto an editor whose every save would 403.
  assert.deepEqual(tabArrival("branding", ["read"]), { kind: "locked", needs: "org:manage" });
  assert.deepEqual(tabArrival("hiring", ["read", "pipeline:write"]), { kind: "open" });
  assert.deepEqual(tabArrival("pipeline", ["read"]), { kind: "open" });
});

const REGISTRY = Object.fromEntries(WORKSPACE_TAB_IDS.map((id) => [id, `panel:${id}`])) as Record<WorkspaceTabId, string>;

test("panelFor: a gated tab renders the lock for a seat without its capability", () => {
  assert.deepEqual(panelFor(REGISTRY, "models", ["read"]), { kind: "locked", needs: "org:manage" });
  assert.deepEqual(panelFor(REGISTRY, "organization", capsOf("recruiter")), { kind: "locked", needs: "members:manage" });
  assert.deepEqual(panelFor(REGISTRY, "pipeline", ["read"]), { kind: "open", panel: "panel:pipeline" });
});

test("panelFor: fail open while unknown, then swap to the lock when caps resolve", () => {
  assert.deepEqual(panelFor(REGISTRY, "billing", null), { kind: "open", panel: "panel:billing" });
  assert.deepEqual(panelFor(REGISTRY, "billing", ["read"]), { kind: "locked", needs: "org:manage" });
  assert.deepEqual(panelFor(REGISTRY, "billing", capsOf("owner")), { kind: "open", panel: "panel:billing" });
});

// The registry is exhaustive BY TYPE: a registry missing one id is not assignable to
// panelFor's parameter, so adding a tab id to tabs.ts without a panel fails tsc
// instead of rendering a silently blank main panel. Checked by tsc (this file is in
// the project), with no suppression comment.
type PanelRegistryParam = Parameters<typeof panelFor<string>>[0];
type AcceptsPartial = Omit<Record<WorkspaceTabId, string>, "templates"> extends PanelRegistryParam ? true : false;
type AcceptsFull = Record<WorkspaceTabId, string> extends PanelRegistryParam ? true : false;
const partialAccepted: AcceptsPartial = false;
const fullAccepted: AcceptsFull = true;

test("the panel registry type refuses a registry missing a tab id", () => {
  assert.equal(partialAccepted, false);
  assert.equal(fullAccepted, true);
});

const CHUNKS_SRC = readFileSync(new URL("./WorkspaceTabChunks.tsx", import.meta.url), "utf8");

// Shape fixture: the probe must fire on the pre-registry text it replaces.
const OLD_CHAIN = `{navActive === "billing" ? <BillingTab /> : null}`;

test("WorkspaceTabChunks mounts every tab through panelFor over one exhaustive registry", () => {
  const chain = /navActive === "[a-z]+" \?/g;
  assert.equal(chain.test(OLD_CHAIN), true, "shape fixture: the probe recognises the old ternary chain");
  chain.lastIndex = 0;
  assert.equal(CHUNKS_SRC.match(chain)?.length ?? 0, 0, "no navActive === ternary survives");
  assert.match(CHUNKS_SRC, /const TAB_PANELS: Record<WorkspaceTabId, /, "the registry is typed exhaustive");
  assert.match(CHUNKS_SRC, /panelFor\(TAB_PANELS, navActive, capabilities\)/, "the panel renders through panelFor");
  assert.equal((CHUNKS_SRC.match(/TAB_PANELS\[/g) ?? []).length, 0, "no direct registry lookup bypasses the lock");
  // Every id owns an entry in the literal (belt and braces over the type).
  const body = CHUNKS_SRC.slice(CHUNKS_SRC.indexOf("const TAB_PANELS"));
  for (const id of WORKSPACE_TAB_IDS) {
    assert.match(body, new RegExp(`\\n  ${id}: `), `TAB_PANELS has an entry for ${id}`);
  }
  // A gated tab's component is named only inside the registry.
  for (const id of Object.keys(TAB_CAPABILITY)) {
    const entry = body.match(new RegExp(`\\n  ${id}: \\(\\) => <([A-Za-z]+)`));
    assert.ok(entry, `${id} has a component entry`);
    const uses = CHUNKS_SRC.match(new RegExp(`<${entry[1]}[ />]`, "g")) ?? [];
    assert.equal(uses.length, 1, `<${entry[1]}> is mounted only from its registry entry`);
  }
});

test("a locked rail row is a lock door, not a disabled row", () => {
  assert.equal(navItemMode("org:manage", false), "lockedDoor");
  assert.equal(navItemMode("org:manage", true), "lockedDoor");
  assert.equal(navItemMode(null, true), "link");
  assert.equal(navItemMode(null, false), "button");
  const item = readFileSync(new URL("./nav/NavPanelItem.tsx", import.meta.url), "utf8");
  assert.equal(item.includes('aria-disabled="true"'), false, "no aria-disabled dead row");
  assert.equal(item.includes("cursor-not-allowed"), false);
  assert.match(item, /navItemMode\(locked, isLink\)/);
});
