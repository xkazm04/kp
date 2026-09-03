import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { ensureDb } from "./db/core.ts";
import { DEFAULT_ORG_ID } from "./db/organizations.ts";
import { createWorkspace, DEFAULT_WORKSPACE_ID } from "./db/workspaces.ts";
import { verifyCredentials, getUserByEmail, createUser } from "./db/users.ts";
import { createInvite, getInvite } from "./db/invites.ts";
import {
  listOrgMembers,
  inviteMember,
  acceptInvite,
  changeMemberRole,
  removeMember,
  setMemberPermissions,
  setMemberStatus,
  addMemberToWorkspace,
  removeMemberFromWorkspace,
  type InviteMemberInput,
} from "./org-service.ts";

after(() => cleanupUnitDb());

/** inviteMember returns a result union (it can refuse a cross-org team); every
 *  test below that just wants the happy path goes through here. */
function mintInvite(input: InviteMemberInput) {
  const r = inviteMember(input);
  assert.ok(r.ok, `expected an invite, got ${r.ok ? "" : r.reason}`);
  return r.invite;
}

test("listOrgMembers returns the seeded ČS roster with resolved capabilities", () => {
  const byEmail = new Map(listOrgMembers(DEFAULT_ORG_ID).map((m) => [m.user.email, m]));
  const petra = byEmail.get("petra.novakova@csas.cz")!;
  assert.equal(petra.teams[0].role, "owner");
  assert.ok(petra.teams[0].capabilities.includes("org:manage"));
  const marketa = byEmail.get("marketa.svobodova@csas.cz")!;
  assert.equal(marketa.teams[0].role, "recruiter");
  assert.ok(marketa.teams[0].capabilities.includes("pipeline:write"));
  assert.ok(!marketa.teams[0].capabilities.includes("members:manage"));
});

test("invite → accept creates an active, authenticatable member on the default team", () => {
  const invite = mintInvite({ email: "new.hire@csas.cz", role: "recruiter", invitedBy: "usr-seed-petra" });
  assert.equal(invite.status, "pending");
  assert.deepEqual(acceptInvite({ token: invite.token, password: "short" }), { ok: false, reason: "weak_password" });
  assert.equal(acceptInvite({ token: invite.token, name: "New Hire", password: "a-strong-pw" }).ok, true);
  assert.ok(verifyCredentials("new.hire@csas.cz", "a-strong-pw"));
  // Single-use.
  assert.deepEqual(acceptInvite({ token: invite.token, password: "a-strong-pw" }), { ok: false, reason: "invalid" });
  assert.equal(listOrgMembers().find((m) => m.user.email === "new.hire@csas.cz")!.teams[0].role, "recruiter");
});

test("accepting an invite activates an already-invited seeded user", () => {
  assert.equal(getUserByEmail("lucie.markova@csas.cz")!.status, "invited");
  const invite = mintInvite({ email: "lucie.markova@csas.cz", role: "recruiter" });
  assert.equal(acceptInvite({ token: invite.token, password: "lucie-pw-123" }).ok, true);
  assert.equal(getUserByEmail("lucie.markova@csas.cz")!.status, "active");
  assert.ok(verifyCredentials("lucie.markova@csas.cz", "lucie-pw-123"));
});

test("the org's last owner cannot be demoted, disabled, or removed", () => {
  assert.deepEqual(changeMemberRole("usr-seed-petra", "workspace", "admin"), { ok: false, reason: "last_owner" });
  assert.deepEqual(setMemberStatus("usr-seed-petra", "disabled"), { ok: false, reason: "last_owner" });
  assert.deepEqual(removeMember("usr-seed-petra"), { ok: false, reason: "last_owner" });
  // Promoting a second owner lifts the guard.
  assert.deepEqual(changeMemberRole("usr-seed-jan", "workspace", "owner"), { ok: true });
  assert.deepEqual(changeMemberRole("usr-seed-petra", "workspace", "admin"), { ok: true });
});

test("setMemberPermissions grants a per-user capability (a recruiter becomes a Writer)", () => {
  assert.deepEqual(setMemberPermissions("usr-seed-marketa", "workspace", { grant: ["members:manage"], revoke: [] }), { ok: true });
  const marketa = listOrgMembers().find((m) => m.user.email === "marketa.svobodova@csas.cz")!;
  assert.ok(marketa.teams[0].capabilities.includes("members:manage"));
  assert.deepEqual(setMemberPermissions("usr-seed-marketa", "team-nope", { grant: ["read"], revoke: [] }), { ok: false, reason: "not_member" });
});

// HIGH (2026-07-09 scan, organizations-members-invites #2): acceptInvite unconditionally
// called setUserPassword on an existing account. Inviting an ACTIVE member is refused at
// POST /api/org/invites, but an invite minted BEFORE the account went active stays pending
// and redeemable — so whoever held that link could reset the member's password and take the
// account over. Redeem is provisioning only.
test("a stale invite cannot reset an ACTIVE member's password", () => {
  const first = mintInvite({ email: "stale.target@csas.cz", role: "recruiter" });
  assert.equal(acceptInvite({ token: first.token, name: "Stale Target", password: "original-pw-123" }).ok, true);
  assert.ok(verifyCredentials("stale.target@csas.cz", "original-pw-123"));

  // A second, still-pending invite for the same address.
  const stale = mintInvite({ email: "stale.target@csas.cz", role: "viewer" });
  assert.deepEqual(acceptInvite({ token: stale.token, name: "Attacker", password: "attacker-pw-999" }), {
    ok: false,
    reason: "already_active",
  });

  // The account is untouched: password, name, and role all survive.
  assert.ok(verifyCredentials("stale.target@csas.cz", "original-pw-123"), "original password still works");
  assert.equal(verifyCredentials("stale.target@csas.cz", "attacker-pw-999"), null, "attacker password rejected");
  const member = listOrgMembers().find((m) => m.user.email === "stale.target@csas.cz")!;
  assert.equal(member.user.name, "Stale Target");
  assert.equal(member.teams[0].role, "recruiter", "role not downgraded by the stale invite");
});

// MEDIUM (2026-07-09 scan, organizations-members-invites #3): the invite route signed
// the session from listMembershipsForUser(...)[0] — the OLDEST membership. A re-invited
// member (already on an older team) landed on that OLD team with the OLD role instead of
// the team/role the invite just granted. acceptInvite now RETURNS the accepted
// workspaceId + role so the route signs the correct claims.
test("accept returns the invite's team/role, not the member's oldest membership", () => {
  // David is seeded disabled with an existing membership on the default team as viewer
  // (the OLDEST membership). Re-invite him to a NEW team as admin.
  assert.equal(getUserByEmail("david.benes@csas.cz")!.status, "disabled");
  const teamB = createWorkspace("Team B");
  const invite = mintInvite({ email: "david.benes@csas.cz", role: "admin", workspaceId: teamB.id });

  const result = acceptInvite({ token: invite.token, password: "david-pw-123" });
  assert.ok(result.ok);
  // The session must be signed for the ACCEPTED team/role…
  assert.equal(result.workspaceId, teamB.id);
  assert.equal(result.role, "admin");
  // …even though the older default-team viewer membership still exists (what [0] returned).
  const teams = listOrgMembers().find((m) => m.user.email === "david.benes@csas.cz")!.teams;
  assert.ok(teams.some((t) => t.workspaceId === "workspace" && t.role === "viewer"), "old membership still present");
});

// ---- Invites are bound by the ORG boundary --------------------------------
// An invite is a deferred membership write, so it must obey the same rule
// addMemberToWorkspace() states outright ("never across orgs"). It didn't: the
// caller-supplied workspaceId went through unchecked and an absent one fell back
// to the GLOBAL DEFAULT_WORKSPACE_ID ("workspace" — the seeded org's team, a
// hard-coded id every deployment shares). With self-serve signup minting real
// second orgs, either path seated the redeemer inside another tenant.

test("inviteMember refuses a team outside the inviting org", () => {
  const other = createWorkspace("Other Co team", "org-invite-elsewhere");
  // The concrete attack: an owner of another org names the seeded default team.
  assert.deepEqual(inviteMember({ orgId: "org-invite-elsewhere", email: "x@evil.test", role: "owner", workspaceId: DEFAULT_WORKSPACE_ID }), {
    ok: false,
    reason: "cross_org",
  });
  // Its own team is fine, and an unknown id is refused too.
  assert.ok(inviteMember({ orgId: "org-invite-elsewhere", email: "ok@evil.test", role: "owner", workspaceId: other.id }).ok);
  assert.deepEqual(inviteMember({ orgId: DEFAULT_ORG_ID, email: "y@csas.cz", role: "viewer", workspaceId: "ws-nope" }), {
    ok: false,
    reason: "cross_org",
  });
});

test("an invite with no team named lands on the INVITING org's team, never the global default", () => {
  const solo = createWorkspace("Solo Co team", "org-invite-solo");
  const invite = mintInvite({ orgId: "org-invite-solo", email: "colleague@solo.test", role: "admin" });
  assert.equal(invite.workspaceId, solo.id, "the org's own team, not 'workspace'");
  // The seeded org still resolves to DEFAULT_WORKSPACE_ID exactly as before.
  assert.equal(mintInvite({ email: "default.org@csas.cz", role: "viewer" }).workspaceId, DEFAULT_WORKSPACE_ID);
  // An org with no team at all cannot seat anyone.
  assert.deepEqual(inviteMember({ orgId: "org-invite-empty", email: "z@empty.test", role: "viewer" }), {
    ok: false,
    reason: "no_workspace",
  });
});

test("acceptInvite refuses a stored invite whose team belongs to another org", () => {
  // A row written before the mint-time guard (or by any other createInvite caller):
  // org A's invite pointing at the seeded org's team. Redeeming it must not create
  // the account, and must not seat anyone on 'workspace'.
  createWorkspace("Legacy Co team", "org-invite-legacy");
  const legacy = createInvite({
    orgId: "org-invite-legacy",
    email: "legacy@evil.test",
    role: "owner",
    workspaceId: DEFAULT_WORKSPACE_ID,
  });
  assert.deepEqual(acceptInvite({ token: legacy.token, name: "Legacy", password: "legacy-pw-123" }), { ok: false, reason: "invalid" });
  const user = getUserByEmail("legacy@evil.test");
  assert.equal(user, null, "no account provisioned by a refused redeem");
  assert.equal(
    listOrgMembers(DEFAULT_ORG_ID).some((m) => m.user.email === "legacy@evil.test"),
    false,
    "nobody seated in the default org",
  );
});

// ---- Per-workspace membership (the Workspaces console's write path) --------
// memberships have always been many-to-many, but nothing could CREATE the second
// seat from the app: invites default to one team and the members route only ever
// re-roled an existing membership. These two are what the console calls.

test("addMemberToWorkspace seats an existing member on a SECOND team without touching the first", () => {
  const teamC = createWorkspace("Team C");
  const before = listOrgMembers().find((m) => m.user.id === "usr-seed-marketa")!;
  assert.equal(before.teams.length, 1, "precondition: one seat");

  assert.deepEqual(addMemberToWorkspace("usr-seed-marketa", teamC.id, "hiring_manager"), { ok: true });

  const after = listOrgMembers().find((m) => m.user.id === "usr-seed-marketa")!;
  assert.equal(after.teams.length, 2);
  assert.equal(after.teams.find((t) => t.workspaceId === "workspace")!.role, "recruiter", "original seat unchanged");
  assert.equal(after.teams.find((t) => t.workspaceId === teamC.id)!.role, "hiring_manager", "new seat holds its own role");
});

test("addMemberToWorkspace is an upsert: re-adding changes the role on that team only", () => {
  const teamD = createWorkspace("Team D");
  addMemberToWorkspace("usr-seed-marketa", teamD.id, "viewer");
  addMemberToWorkspace("usr-seed-marketa", teamD.id, "admin");
  const teams = listOrgMembers().find((m) => m.user.id === "usr-seed-marketa")!.teams;
  assert.equal(teams.filter((t) => t.workspaceId === teamD.id).length, 1, "no duplicate membership");
  assert.equal(teams.find((t) => t.workspaceId === teamD.id)!.role, "admin");
  assert.equal(teams.find((t) => t.workspaceId === "workspace")!.role, "recruiter", "other seats untouched");
});

test("addMemberToWorkspace refuses a workspace outside the user's org, and an unknown one", () => {
  const foreign = createWorkspace("Other Co team", "org-elsewhere");
  assert.deepEqual(addMemberToWorkspace("usr-seed-marketa", foreign.id, "recruiter"), { ok: false, reason: "cross_org" });
  assert.deepEqual(addMemberToWorkspace("usr-seed-marketa", "ws-does-not-exist", "recruiter"), { ok: false, reason: "no_workspace" });
  assert.deepEqual(addMemberToWorkspace("usr-nobody", "workspace", "recruiter"), { ok: false, reason: "no_user" });
});

test("removeMemberFromWorkspace drops ONE seat and keeps the account", () => {
  const teamE = createWorkspace("Team E");
  addMemberToWorkspace("usr-seed-marketa", teamE.id, "recruiter");
  assert.deepEqual(removeMemberFromWorkspace("usr-seed-marketa", teamE.id), { ok: true });

  const member = listOrgMembers().find((m) => m.user.id === "usr-seed-marketa");
  assert.ok(member, "the account survives — this is not removeMember()");
  assert.ok(!member!.teams.some((t) => t.workspaceId === teamE.id), "the seat is gone");
  assert.ok(member!.teams.some((t) => t.workspaceId === "workspace"), "every other seat stays");
  // Not a member any more, so a second removal is a 404-shaped refusal.
  assert.deepEqual(removeMemberFromWorkspace("usr-seed-marketa", teamE.id), { ok: false, reason: "not_member" });
});

// Built in its OWN org so the assertion can't be perturbed by whatever earlier
// tests in this file did to the seeded ČS roster's owner set — the guard is
// org-wide by definition, so it needs an org it fully controls.
test("removeMemberFromWorkspace refuses to strip the org's last owner seat", () => {
  const orgId = "org-lastowner";
  const teamA = createWorkspace("Solo team A", orgId);
  const owner = createUser({ orgId, email: "solo.owner@example.test", name: "Solo Owner", status: "active", password: "solo-pw-1234" });
  addMemberToWorkspace(owner.id, teamA.id, "owner");

  // One owner, one seat: the org would be left unadministerable.
  assert.deepEqual(removeMemberFromWorkspace(owner.id, teamA.id), { ok: false, reason: "last_owner" });

  // A sole owner who owns TWO teams may give one up — the org keeps an owner.
  const teamB = createWorkspace("Solo team B", orgId);
  addMemberToWorkspace(owner.id, teamB.id, "owner");
  assert.deepEqual(removeMemberFromWorkspace(owner.id, teamB.id), { ok: true });
  assert.deepEqual(removeMemberFromWorkspace(owner.id, teamA.id), { ok: false, reason: "last_owner" }, "back to one owner seat");

  // A NON-owner seat held by that same sole owner is freely removable.
  const teamC = createWorkspace("Solo team C", orgId);
  addMemberToWorkspace(owner.id, teamC.id, "viewer");
  assert.deepEqual(removeMemberFromWorkspace(owner.id, teamC.id), { ok: true });
});

// Wave3 item 4 — docs/specs/2026-08-30-member-removal-blast-radius.md. The
// removal preview runs the SAME deletes in a rolled-back transaction (registry:
// entity-lifecycle/blast-radius-computation), so the counts it shows are the
// counts the act produces — asserted here by running both against one state.
test("removeMember dry-run enumerates the blast radius and destroys nothing", () => {
  const orgId = "org-blast";
  const teamA = createWorkspace("Blast team A", orgId);
  const teamB = createWorkspace("Blast team B", orgId);
  const owner = createUser({ orgId, email: "blast.owner@example.test", status: "active", password: "owner-pw-1234" });
  addMemberToWorkspace(owner.id, teamA.id, "owner");
  const victim = createUser({ orgId, email: "blast.victim@example.test", status: "active", password: "victim-pw-1234" });
  addMemberToWorkspace(victim.id, teamA.id, "recruiter");
  addMemberToWorkspace(victim.id, teamB.id, "viewer");
  const invite = createInvite({ orgId, email: "invitee@example.test", role: "recruiter", invitedBy: victim.id });

  const preview = removeMember(victim.id, { dryRun: true });
  assert.ok(preview.ok && preview.impact, "dry-run succeeds with an impact");
  assert.deepEqual(preview.impact, {
    casualties: { users: 1, credentials: 1, memberships: 2 },
    survivors: { invitesAttributed: 1 },
  });
  // Destroyed nothing: account, credential, and both seats are intact.
  assert.ok(verifyCredentials("blast.victim@example.test", "victim-pw-1234"), "credential survives the dry run");
  const member = listOrgMembers(orgId).find((m) => m.user.id === victim.id);
  assert.ok(member, "the account survives the dry run");
  assert.equal(member!.teams.length, 2, "both seats survive the dry run");

  // The real run returns the SAME accounting the preview promised.
  const receipt = removeMember(victim.id);
  assert.ok(receipt.ok, "removal succeeds");
  assert.deepEqual(receipt.impact, preview.impact, "receipt matches the preview");
  assert.ok(!listOrgMembers(orgId).some((m) => m.user.id === victim.id), "the account is gone");
  assert.equal(verifyCredentials("blast.victim@example.test", "victim-pw-1234"), null, "the credential is gone");
  // Survivor by design: the invite they sent stays, attribution retained.
  const survived = getInvite(invite.token);
  assert.ok(survived, "the invite survives its sender");
  assert.equal(survived!.invitedBy, victim.id, "invited_by is retained by design (a dangling id reads as a removed user)");
});

test("removeMember dry-run reports the last-owner blocker instead of counts", () => {
  const orgId = "org-blast-blocker";
  const team = createWorkspace("Blocker team", orgId);
  const owner = createUser({ orgId, email: "blast.blocker@example.test", status: "active", password: "owner-pw-1234" });
  addMemberToWorkspace(owner.id, team.id, "owner");
  assert.deepEqual(removeMember(owner.id, { dryRun: true }), { ok: false, reason: "last_owner" });
});

// ---- Redeeming the same invite twice ------------------------------------------
// acceptInvite is a read→compute→write across four stores (invite → user →
// credential → membership → invite) and it ran unlocked: two callers redeeming one
// link both read a pending invite, both wrote a password, and only the loser's
// markInviteAccepted no-op'd. It now runs inside db.transaction(...).immediate()
// with the redeemable read re-asserted under the lock.

test("the second caller on one link is refused and writes NOTHING", () => {
  const orgId = "org-race";
  const team = createWorkspace("Race team", orgId);
  const invite = mintInvite({ orgId, email: "race.one@example.test", role: "recruiter", workspaceId: team.id });

  const first = acceptInvite({ token: invite.token, name: "First Caller", password: "first-pw-1234" });
  assert.ok(first.ok);
  const accepted = getInvite(invite.token)!;

  // The loser: same token, its own name and password.
  assert.deepEqual(acceptInvite({ token: invite.token, name: "Second Caller", password: "second-pw-999" }), {
    ok: false,
    reason: "invalid",
  });
  const user = getUserByEmail("race.one@example.test")!;
  assert.equal(user.name, "First Caller", "the winner's name stands");
  assert.ok(verifyCredentials("race.one@example.test", "first-pw-1234"), "and the winner's credential still opens the account");
  assert.equal(verifyCredentials("race.one@example.test", "second-pw-999"), null, "the loser's password was never written");
  assert.equal(getInvite(invite.token)!.acceptedAt, accepted.acceptedAt, "the consumption record is the winner's");
});

test("a redeem interrupted after the membership write leaves nothing behind", () => {
  // A rival consuming the token mid-flight, forced deterministically: a trigger on
  // the membership insert marks the invite accepted, exactly as a second process
  // committing between our read and our write would. The guarded markInviteAccepted
  // then finds nothing pending, and the whole redeem must roll back — without the
  // transaction the user, the credential and the seat would all have survived under
  // somebody else's acceptance.
  const orgId = "org-race-2";
  const team = createWorkspace("Race team 2", orgId);
  const invite = mintInvite({ orgId, email: "race.two@example.test", role: "recruiter", workspaceId: team.id });
  const db = ensureDb();
  db.exec(
    `CREATE TRIGGER kp_test_rival_redeem BEFORE INSERT ON memberships BEGIN
       UPDATE invites SET status = 'accepted' WHERE token = '${invite.token}';
     END;`
  );
  try {
    assert.throws(() => acceptInvite({ token: invite.token, name: "Interrupted", password: "interrupt-pw-1" }));
  } finally {
    db.exec("DROP TRIGGER kp_test_rival_redeem");
  }
  assert.equal(getUserByEmail("race.two@example.test"), null, "no half-provisioned account");
  assert.equal(listOrgMembers(orgId).length, 0, "and no seat on the team");
});

// ---- The last-owner guard under concurrency -----------------------------------
// changeMemberRole / removeMemberFromWorkspace / setMemberStatus / removeMember are
// each a read→compute→write over `memberships` (read the owner set → decide → write)
// and every one of them ran UNLOCKED, while acceptInvite beside them has taken
// db.transaction(...).immediate() since the double-redeem fix. Two operators
// demoting the org's TWO owners at the same moment therefore both read a two-seat
// owner set, both concluded "not the last one", and both committed — an org nobody
// can administer, which is the one invariant the guard exists to protect.
//
// better-sqlite3 is synchronous, so a second writer cannot interleave inside a
// transaction from a single-threaded test. The tests below pin the invariant from
// the two angles that ARE observable here, in this repo's own idiom: a rival write
// forced deterministically by a trigger (the acceptInvite race tests above), and a
// source-level assertion that the lock and the in-lock read are present
// (db/pipeline-close-guard.test.ts).

test("a write that would leave the org ownerless is rolled back, not committed", () => {
  // The rival, forced deterministically: a trigger that demotes the OTHER owner as
  // our demotion lands — exactly the net effect of two concurrent demotions of two
  // owners. Unguarded, both writes stick and the org is left with zero owners.
  const orgId = "org-owner-race";
  const team = createWorkspace("Owner race team", orgId);
  const a = createUser({ orgId, email: "owner.a@example.test", status: "active", password: "owner-a-pw-12" });
  const b = createUser({ orgId, email: "owner.b@example.test", status: "active", password: "owner-b-pw-12" });
  addMemberToWorkspace(a.id, team.id, "owner");
  addMemberToWorkspace(b.id, team.id, "owner");

  const db = ensureDb();
  db.exec(
    `CREATE TRIGGER kp_test_rival_demote AFTER UPDATE ON memberships
       WHEN new.user_id = '${a.id}' AND new.role <> 'owner'
     BEGIN
       UPDATE memberships SET role = 'recruiter' WHERE user_id = '${b.id}';
     END;`
  );
  let result;
  try {
    result = changeMemberRole(a.id, team.id, "recruiter");
  } finally {
    db.exec("DROP TRIGGER kp_test_rival_demote");
  }
  assert.deepEqual(result, { ok: false, reason: "last_owner" }, "the ownerless outcome must be refused");
  const owners = listOrgMembers(orgId).flatMap((m) => m.teams.filter((t) => t.role === "owner"));
  assert.ok(owners.length > 0, "the org must never be left without an owner");
});

test("two demotions of two owners leave exactly one owner", () => {
  const orgId = "org-owner-pair";
  const team = createWorkspace("Owner pair team", orgId);
  const a = createUser({ orgId, email: "pair.a@example.test", status: "active", password: "pair-a-pw-123" });
  const b = createUser({ orgId, email: "pair.b@example.test", status: "active", password: "pair-b-pw-123" });
  addMemberToWorkspace(a.id, team.id, "owner");
  addMemberToWorkspace(b.id, team.id, "owner");

  assert.equal(changeMemberRole(a.id, team.id, "recruiter").ok, true, "the first demotion is allowed");
  assert.deepEqual(changeMemberRole(b.id, team.id, "recruiter"), { ok: false, reason: "last_owner" });
  const owners = listOrgMembers(orgId).filter((m) => m.teams.some((t) => t.role === "owner"));
  assert.equal(owners.length, 1, "exactly one owner survives the pair");
  assert.equal(owners[0].user.id, b.id);
});

test("every last-owner-guarded write takes the IMMEDIATE lock with the owner read inside it", () => {
  const src = readFileSync(fileURLToPath(new URL("./org-service.ts", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
  // ONE seam, so a fifth guarded operation cannot be added with its own unlocked shape.
  assert.match(
    src,
    /function underOwnerLock\([\s\S]*?\.transaction\([\s\S]*?\.immediate\(\)/,
    "underOwnerLock must take the write lock at BEGIN (.immediate())"
  );
  for (const name of ["changeMemberRole", "removeMemberFromWorkspace", "setMemberStatus", "removeMember"]) {
    const start = src.indexOf(`export function ${name}(`);
    assert.notEqual(start, -1, `${name} not found — did it get renamed?`);
    const rest = src.slice(start + 1);
    const end = rest.indexOf("\nexport ");
    const body = end === -1 ? rest : rest.slice(0, end);
    assert.match(body, /underOwnerLock\(/, `${name} must run through the shared lock`);
    // The owner-set read must be INSIDE the callback, never hoisted above it —
    // a decision computed before BEGIN is exactly the stale read this fixes.
    const lockAt = body.indexOf("underOwnerLock(");
    const readAt = body.search(/isSoleOwner\(|ownerSeatCount\(/);
    assert.ok(readAt === -1 || readAt > lockAt, `${name} reads the owner set before taking the lock`);
  }
});

// ---- Removal closes the way back in -------------------------------------------
// An invite is a DEFERRED ACCOUNT: redeeming one activates (or re-creates) the user
// with the invited role and whatever password the link-holder types. So a removal or
// a disable that left the invites addressed to that email pending was reversible by
// the person it was applied to — the roster showed the seat gone while an old mail
// still opened the tenant.

test("removing a member revokes the pending invites addressed to them", () => {
  const orgId = "org-resurrect";
  const team = createWorkspace("Resurrect team", orgId);
  const owner = createUser({ orgId, email: "res.owner@example.test", status: "active", password: "res-owner-pw1" });
  addMemberToWorkspace(owner.id, team.id, "owner");
  const victim = createUser({ orgId, email: "res.victim@example.test", status: "active", password: "res-victim-p1" });
  addMemberToWorkspace(victim.id, team.id, "recruiter");
  // The link that invited them in the first place, still pending in their inbox.
  const stale = mintInvite({ orgId, email: "res.victim@example.test", role: "owner", workspaceId: team.id });

  assert.equal(removeMember(victim.id).ok, true);
  assert.equal(getInvite(stale.token)!.status, "revoked", "the old link must not survive the account");
  // …and it no longer redeems: without this the removed person re-creates their
  // account with a password only they know, at the role the invite granted.
  assert.deepEqual(acceptInvite({ token: stale.token, password: "resurrection-1" }), { ok: false, reason: "invalid" });
  assert.equal(getUserByEmail("res.victim@example.test"), null, "the account stays removed");
});

test("disabling a member revokes their pending invites too", () => {
  const orgId = "org-disable-link";
  const team = createWorkspace("Disable team", orgId);
  const owner = createUser({ orgId, email: "dis.owner@example.test", status: "active", password: "dis-owner-pw1" });
  addMemberToWorkspace(owner.id, team.id, "owner");
  const victim = createUser({ orgId, email: "dis.victim@example.test", status: "active", password: "dis-victim-p1" });
  addMemberToWorkspace(victim.id, team.id, "recruiter");
  const stale = mintInvite({ orgId, email: "dis.victim@example.test", role: "recruiter", workspaceId: team.id });

  assert.equal(setMemberStatus(victim.id, "disabled").ok, true);
  assert.equal(getInvite(stale.token)!.status, "revoked");
  // Redeem would have flipped the account back to active with a fresh password.
  assert.deepEqual(acceptInvite({ token: stale.token, password: "undisable-me-1" }), { ok: false, reason: "invalid" });
  assert.equal(getUserByEmail("dis.victim@example.test")!.status, "disabled", "the lockout holds");
});

test("a removal PREVIEW revokes nothing — a dry run destroys nothing at all", () => {
  const orgId = "org-preview-link";
  const team = createWorkspace("Preview team", orgId);
  const owner = createUser({ orgId, email: "prev.owner@example.test", status: "active", password: "prev-owner-p1" });
  addMemberToWorkspace(owner.id, team.id, "owner");
  const victim = createUser({ orgId, email: "prev.victim@example.test", status: "active", password: "prev-victim-1" });
  addMemberToWorkspace(victim.id, team.id, "recruiter");
  const pending = mintInvite({ orgId, email: "prev.victim@example.test", role: "recruiter", workspaceId: team.id });

  assert.equal(removeMember(victim.id, { dryRun: true }).ok, true);
  assert.equal(getInvite(pending.token)!.status, "pending", "the preview must leave the invite alone");
});

test("another org's pending invite to the same person is none of this org's business", () => {
  const orgA = "org-scope-a";
  const orgB = "org-scope-b";
  const teamA = createWorkspace("Scope A team", orgA);
  const teamB = createWorkspace("Scope B team", orgB);
  const ownerA = createUser({ orgId: orgA, email: "scope.owner@example.test", status: "active", password: "scope-owner1" });
  addMemberToWorkspace(ownerA.id, teamA.id, "owner");
  const person = createUser({ orgId: orgA, email: "scope.person@example.test", status: "active", password: "scope-person1" });
  addMemberToWorkspace(person.id, teamA.id, "recruiter");
  const fromA = mintInvite({ orgId: orgA, email: "scope.person@example.test", role: "recruiter", workspaceId: teamA.id });
  const fromB = mintInvite({ orgId: orgB, email: "scope.person@example.test", role: "recruiter", workspaceId: teamB.id });

  assert.equal(removeMember(person.id).ok, true);
  assert.equal(getInvite(fromA.token)!.status, "revoked", "org A closes its own door");
  assert.equal(getInvite(fromB.token)!.status, "pending", "…and leaves org B's invitation standing");
});
