import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  capabilitiesServerSnapshot,
  capabilitiesSnapshot,
  ensureShellCapabilities,
  primeShellPrincipal,
  resetShellPrincipalForTests,
  resolveShellWorkspace,
  shellWorkspaceId,
} from "./shellPrincipal.ts";
import { lockedTabsFor } from "./navCapabilities.ts";

// challenge-r08 workspace-shell-core/A — the shell's tenant + capability facts
// come from ONE seeded door ('/' resolves them server-side and hands them down),
// with one deduped fetch as the fallback for surfaces mounted without the shell.

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");

type G = { window?: unknown; localStorage?: unknown };
const g = globalThis as unknown as G;

/** A window-like global: enough EventTarget for the modules' change signals. */
function withWindow(): void {
  g.window = new EventTarget();
}
function withoutWindow(): void {
  delete g.window;
}

test("server safety: with no window, priming is a no-op (module scope is shared across requests)", () => {
  withoutWindow();
  resetShellPrincipalForTests();
  primeShellPrincipal({ workspaceId: "team-a", capabilities: ["read"] });
  assert.equal(shellWorkspaceId(), null, "a primed module value on the server would leak request A's tenant into request B");
  assert.equal(capabilitiesSnapshot(null), null);
});

test("primed: the seed answers the tenant question without a request", async () => {
  withWindow();
  resetShellPrincipalForTests();
  let calls = 0;
  primeShellPrincipal({ workspaceId: "team-a", capabilities: ["read"] });
  const id = await resolveShellWorkspace(async () => {
    calls++;
    return { current: "team-z" };
  });
  assert.equal(id, "team-a");
  assert.equal(calls, 0);
});

test("unprimed: three concurrent consumers share ONE /api/workspaces request", async () => {
  withWindow();
  resetShellPrincipalForTests();
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return { current: "team-b" };
  };
  const ids = await Promise.all([resolveShellWorkspace(fetcher), resolveShellWorkspace(fetcher), resolveShellWorkspace(fetcher)]);
  assert.deepEqual(ids, ["team-b", "team-b", "team-b"]);
  assert.equal(calls, 1);
  assert.equal(shellWorkspaceId(), "team-b", "the fetched tenant is remembered for the document");
});

test("a failed resolve answers null and the NEXT call retries", async () => {
  withWindow();
  resetShellPrincipalForTests();
  let calls = 0;
  const failing = async () => {
    calls++;
    throw new Error("offline");
  };
  assert.equal(await resolveShellWorkspace(failing), null);
  assert.equal(await resolveShellWorkspace(async () => ({ current: "" })), null, "a body with no current is a failure too");
  assert.equal(await resolveShellWorkspace(failing), null);
  assert.equal(calls, 2, "one blip must not disable tenant-scoped storage for the document");
  assert.equal(await resolveShellWorkspace(async () => ({ current: "team-c" })), "team-c");
});

test("capabilities first render: the seeded set is the snapshot on BOTH sides of hydration", () => {
  withWindow();
  resetShellPrincipalForTests();
  const seed = { workspaceId: "team-a", capabilities: ["read" as const] };
  primeShellPrincipal(seed);
  const client = capabilitiesSnapshot(seed);
  const server = capabilitiesServerSnapshot(seed);
  assert.deepEqual(client, ["read"]);
  assert.equal(client, server, "same identity, so useSyncExternalStore sees no hydration mismatch");
  const locked = lockedTabsFor(client);
  for (const tab of ["billing", "models", "integrations", "organization", "workspace"] as const) {
    assert.ok(locked.has(tab), `${tab} is locked on the first render`);
  }
  let calls = 0;
  ensureShellCapabilities(async () => {
    calls++;
    return { capabilities: ["read"] };
  });
  assert.equal(calls, 0, "a seeded document never asks GET /api/me/capabilities");
});

test("fallback kept: unprimed, the snapshot is null and ONE GET /api/me/capabilities is issued", async () => {
  withWindow();
  resetShellPrincipalForTests();
  assert.equal(capabilitiesSnapshot(null), null, "unknown locks nothing (fail open)");
  assert.equal(capabilitiesServerSnapshot(null), null);
  let calls = 0;
  let release: (v: unknown) => void = () => {};
  const fetcher = () => {
    calls++;
    return new Promise<unknown>((r) => (release = r));
  };
  ensureShellCapabilities(fetcher);
  ensureShellCapabilities(fetcher);
  assert.equal(calls, 1);
  release({ capabilities: ["read", "not-a-capability"] });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(capabilitiesSnapshot(null), ["read"]);
});

const WORKSPACES_FETCH = /fetch\(\s*["'`]\/api\/workspaces["'`]/;

test("consumers read one door: no module-local /api/workspaces resolver remains", () => {
  // Shape fixture: the probe fires on the text the three resolvers carried.
  assert.ok(WORKSPACES_FETCH.test(`  resolving = fetch("/api/workspaces")\n    .then((r) => r.json())`));
  for (const rel of [
    "app/features/shell/recents.ts",
    "app/features/shell/palette/previewCache.ts",
    "app/features/hiring/pipeline/usePipelineTenant.ts",
  ]) {
    const src = readFileSync(join(root, rel), "utf8");
    assert.ok(!WORKSPACES_FETCH.test(src), `${rel} still fetches /api/workspaces itself`);
    assert.match(src, /from "@\/app\/features\/shell\/shellPrincipal"/, `${rel} reads the shell principal`);
  }
});

test("tenant arrival via the seed still runs each store's own semantics", async () => {
  withWindow();
  resetShellPrincipalForTests();
  const store = new Map<string, string>([
    ["kp.recents", JSON.stringify([{ type: "jd", id: "x", label: "Leaked", href: "/jds/x", at: 1 }])],
    ["kp.recents:team-a", JSON.stringify([{ type: "jd", id: "y", label: "Mine", href: "/jds/y", at: 2 }])],
  ]);
  g.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  primeShellPrincipal({ workspaceId: "team-a", capabilities: ["read"] });
  const { readRecents } = await import("./recents.ts");
  const list = readRecents();
  assert.deepEqual(list.map((r) => r.label), ["Mine"], "the first read is this team's list, no fetch tick");
  assert.equal(store.has("kp.recents"), false, "the legacy browser-wide key is still dropped");

  const { currentPreviewScope, resolvePreviewScope, resetPreviewScopeForTests } = await import("./palette/previewCache.ts");
  resetPreviewScopeForTests();
  assert.equal(currentPreviewScope(), "team-a", "the palette memo adopts the seeded tenant synchronously");
  assert.equal(await resolvePreviewScope(), "team-a");
});
