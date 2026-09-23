// The locked-door view model (challenge-r08 workspace-shell-core/B): what a seat
// sees when it arrives at a tab its capability set cannot open — from any door.
// Pure, so the states and the mailto builder are pinned here rather than under the
// .tsx panel (the unit runner cannot import a component).
import { test } from "node:test";
import assert from "node:assert/strict";
import { askHref, holdersUrl, lockedDoorView, parseHolders, type Holder } from "./lockedDoor.ts";

const OWNER: Holder = { name: "Olga Owner", email: "olga@example.com", role: "owner" };
const ADMIN: Holder = { name: null, email: "ada@example.com", role: "admin" };

test("askHref carries the exact deep link in a mailto to the holder", () => {
  const href = askHref(OWNER, "billing", "https://kp.example", "Access to Billing");
  assert.equal(
    href,
    `mailto:olga@example.com?subject=${encodeURIComponent("Access to Billing")}&body=${encodeURIComponent("https://kp.example/?tab=billing")}`
  );
});

test("askHref: a holder with no usable email gets no Ask link", () => {
  assert.equal(askHref({ ...OWNER, email: null }, "billing", "https://kp.example", "s"), null);
  assert.equal(askHref({ ...OWNER, email: "" }, "billing", "https://kp.example", "s"), null);
  // A header-injection shaped address is refused rather than spliced into the URL.
  assert.equal(askHref({ ...OWNER, email: "a@b.c?cc=evil@x.y" }, "billing", "https://kp.example", "s"), null);
});

test("an empty holder list is a stated state, never an empty list", () => {
  assert.deepEqual(lockedDoorView({ needs: "org:manage", holders: [] }), { kind: "noHolders", needs: "org:manage" });
});

test("a failed holders read still names the capability", () => {
  assert.deepEqual(lockedDoorView({ needs: "org:manage", holders: "failed" }), { kind: "holdersUnknown", needs: "org:manage" });
});

test("holders render in the order the server ranked them; loading is its own state", () => {
  assert.deepEqual(lockedDoorView({ needs: "members:manage", holders: [OWNER, ADMIN] }), {
    kind: "holders",
    needs: "members:manage",
    holders: [OWNER, ADMIN],
  });
  assert.deepEqual(lockedDoorView({ needs: "org:manage", holders: null }), { kind: "loading", needs: "org:manage" });
});

test("parseHolders keeps only the minimal fields and refuses a malformed wire", () => {
  assert.deepEqual(parseHolders({ holders: [{ ...OWNER, id: "usr_1", overrides: {} }] }), [OWNER]);
  assert.equal(parseHolders({ holders: "nope" }), null);
  assert.equal(parseHolders(null), null);
  assert.deepEqual(parseHolders({ holders: [{ name: 1, email: "x@y.z", role: "owner" }, { name: "B", email: "b@y.z", role: "wizard" }] }), [
    { name: null, email: "x@y.z", role: "owner" },
  ]);
});

test("holdersUrl encodes the capability", () => {
  assert.equal(holdersUrl("org:manage"), "/api/me/capability-holders?cap=org%3Amanage");
});
