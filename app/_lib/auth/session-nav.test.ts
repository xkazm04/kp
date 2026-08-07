// enterWorkspace must carry the visitor's chosen pricing tier into the entered URL
// (landing-marketing #1). The pricing CTAs used to call it with no argument, so the
// selected plan — the highest-intent signal on the marketing surface — was silently
// discarded. These pin that a plan is persisted as a ?plan= query param on both the
// entered dashboard and the /login fallback, and that no-plan calls are unchanged.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { enterWorkspace } from "./session-nav.ts";

let assigned = "";
const stubWindow = () => {
  (globalThis as { window?: unknown }).window = { location: { assign: (url: string) => { assigned = url; } } };
};
const stubFetch = (ok: boolean) => {
  (globalThis as { fetch?: unknown }).fetch = async () => ({ ok }) as Response;
};

afterEach(() => {
  assigned = "";
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { fetch?: unknown }).fetch;
});

test("a chosen plan is threaded into the entered dashboard URL (open mode → login ok)", async () => {
  stubWindow();
  stubFetch(true);
  await enterWorkspace("growth");
  assert.equal(assigned, "/?plan=growth", "the plan intent survives into the entered URL");
});

test("the plan is preserved on the /login fallback (password mode → 401)", async () => {
  stubWindow();
  stubFetch(false);
  await enterWorkspace("byom");
  assert.equal(assigned, "/login?plan=byom", "the plan intent survives the handoff to the sign-in form");
});

test("a no-plan entry is unchanged (generic sign-in)", async () => {
  stubWindow();
  stubFetch(true);
  await enterWorkspace();
  assert.equal(assigned, "/", "no plan → no query param, exactly the old behavior");
});
