import { test } from "node:test";
import assert from "node:assert/strict";
import { countActiveMembers } from "@/app/features/shared/memberUi";

// LOW (2026-07-09 scan, organizations-members-invites #5): the "Active" stat used
// `status !== "disabled"`, which counted still-`invited` (pending) seats as Active and
// inflated the number. countActiveMembers counts only truly-`active` seats.
test("countActiveMembers counts only active seats (not invited or disabled)", () => {
  const members = [
    { user: { status: "active" as const } },
    { user: { status: "active" as const } },
    { user: { status: "invited" as const } }, // pending — must NOT count
    { user: { status: "disabled" as const } }, // disabled — must NOT count
  ];
  // Pre-fix (`!== "disabled"`) this would be 3, folding the pending invite into Active.
  assert.equal(countActiveMembers(members), 2);
});

test("countActiveMembers is 0 for an all-pending/disabled roster", () => {
  const members = [{ user: { status: "invited" as const } }, { user: { status: "disabled" as const } }];
  assert.equal(countActiveMembers(members), 0);
});
