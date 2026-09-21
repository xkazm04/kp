import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { copyInviteUrl, holdsOwnerSeat, teamFor } from "@/app/features/settings/workspace/workspaceAdminHelpers";
import type { OrgMemberDto } from "@/app/features/settings/workspace/useWorkspaceAdmin";

// The Workspaces console shows the same person through two lenses, and the two
// lenses ask different ownership questions. Membership-scoped controls (role,
// seat permissions, remove-from-team) legitimately ask "does she own THIS team".
// Enable/Disable does not: it writes `users.status`, which is org-wide, so it must
// ask "does she own ANY team". The By-workspace roster asked the team-scoped
// question for that account-wide control, so a co-owner holding a plain seat on a
// second team could be disabled out of the entire product from that team's roster
// — while the By-person view, asking the org-wide question, offered no such
// control for the same person.
//
// This pins the disagreement itself: for the member below the two questions give
// OPPOSITE answers, and only `holdsOwnerSeat` is admissible for the account-level
// gate.

/** Owner of "sales", plain recruiter on "engineering". */
const coOwner: OrgMemberDto = {
  user: { id: "u1", email: "dana@example.com", name: "Dana", status: "active", createdAt: "2026-01-01" },
  teams: [
    { workspaceId: "sales", role: "owner", capabilities: ["org:manage", "members:manage", "team:manage", "pipeline:write", "read"] },
    { workspaceId: "engineering", role: "recruiter", capabilities: ["pipeline:write", "read"] },
  ],
};

const plainRecruiter: OrgMemberDto = {
  user: { id: "u2", email: "eva@example.com", name: null, status: "active", createdAt: "2026-01-01" },
  teams: [{ workspaceId: "engineering", role: "recruiter", capabilities: ["pipeline:write", "read"] }],
};

const seatless: OrgMemberDto = {
  user: { id: "u3", email: "nobody@example.com", name: null, status: "invited", createdAt: "2026-01-01" },
  teams: [],
};

test("holdsOwnerSeat is org-wide: an owner seat on another team still counts", () => {
  // The exact drift: on "engineering" the team-scoped test says "not an owner"…
  assert.equal(teamFor(coOwner, "engineering")?.role, "recruiter");
  // …while the account-level question — the only admissible gate for a write to
  // `users.status` — says she is one.
  assert.equal(holdsOwnerSeat(coOwner), true);
});

test("holdsOwnerSeat is false for someone who owns nothing", () => {
  assert.equal(holdsOwnerSeat(plainRecruiter), false);
});

test("holdsOwnerSeat is false for a member with no memberships at all", () => {
  assert.equal(holdsOwnerSeat(seatless), false);
});

// Copy invite link is a candidate-facing capability URL. Concatenating
// window.location.origin shipped localhost / proxy-internal hosts to the
// clipboard; copyInviteUrl routes through publicBaseUrl so the configured
// public origin wins.

const ORIGINAL_APP = process.env.APP_BASE_URL;
const ORIGINAL_PUBLIC = process.env.NEXT_PUBLIC_APP_BASE_URL;
const ORIGINAL_SITE = process.env.NEXT_PUBLIC_SITE_URL;

function setEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  setEnv("APP_BASE_URL", ORIGINAL_APP);
  setEnv("NEXT_PUBLIC_APP_BASE_URL", ORIGINAL_PUBLIC);
  setEnv("NEXT_PUBLIC_SITE_URL", ORIGINAL_SITE);
});

test("copyInviteUrl uses NEXT_PUBLIC_APP_BASE_URL instead of the recruiter origin", () => {
  setEnv("APP_BASE_URL", undefined);
  setEnv("NEXT_PUBLIC_APP_BASE_URL", "https://hire.example");
  assert.equal(copyInviteUrl("http://localhost:3000", "tok_abc"), "https://hire.example/invite/tok_abc");
});
