import { test } from "node:test";
import assert from "node:assert/strict";
import { CAPABILITY_ORDER, countActiveMembers, statusBadge, type MemberStatus, type MembersTranslator } from "@/app/features/shared/memberUi";
import { OVERRIDABLE_CAPABILITIES } from "@/app/_lib/auth/roles";

test("permission rows cover every overridable capability in server order", () => {
  assert.deepEqual(CAPABILITY_ORDER.map(({ cap }) => cap), OVERRIDABLE_CAPABILITIES);
  assert.ok(CAPABILITY_ORDER.every(({ key }) => key), "every row has catalog copy");
});

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

test("an unknown member status is neutral and never masquerades as disabled", () => {
  const t = ((key: string) => key) as MembersTranslator;
  assert.equal(statusBadge("disabled", t).label, "status.disabled");
  assert.deepEqual(statusBadge("unexpected" as MemberStatus, t), {
    tone: "neutral", label: "status.unknown", muted: true,
  });
});
