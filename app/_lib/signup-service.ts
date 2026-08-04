import { ensureDb } from "./db/core";
import { createOrganization } from "./db/organizations";
import { createWorkspace } from "./db/workspaces";
import { createUser, getUserByEmail, normalizeEmail, type User } from "./db/users";
import { upsertMembership } from "./db/memberships";
import { MIN_PASSWORD_LENGTH } from "./org-service";
import type { MemberRole } from "./auth/roles";

// Self-serve signup (org-plan: the public funnel behind KP_SIGNUP_ENABLED).
// One registration provisions the WHOLE tenant shape the rest of the app
// expects — org → team (workspace, type='team', org_id linked) → user (active,
// scrypt credential via createUser) → owner membership — in ONE better-sqlite3
// transaction, so a half-created account can never exist (every store here uses
// the shared ensureDb() connection, the sync.ts transaction precedent).
//
// This is provisioning only. The ROUTE (POST /api/auth/register) owns the
// KP_SIGNUP_ENABLED gate, the per-IP throttle, and the session mint — mirroring
// the acceptInvite / invite-route split in org-service.ts.

/** Same address shape the candidate surfaces accept (apply-intake's
 *  APPLY_EMAIL_RE; lead-payload keeps its own copy by the same convention —
 *  deliberately duplicated so the auth layer never imports candidate-intake
 *  code). Loose on purpose: the real authority is the verification email a
 *  future flow sends; this only rejects obvious garbage. */
export const SIGNUP_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type RegisterInput = {
  email: string;
  password: string;
  /** The person's display name (optional — users.name is nullable). */
  name?: string | null;
  /** The company name; blank falls back to the email's domain so the org row
   *  never lands on the "Untitled organization" placeholder. */
  orgName?: string | null;
};

export type RegisterResult =
  | { ok: true; user: User; orgId: string; workspaceId: string; role: MemberRole }
  | { ok: false; reason: "invalid_email" | "weak_password" | "email_taken" };

/** The org name when the signup form left it blank: the email's domain (sans
 *  TLD dot-noise it keeps as-is — "acme.io" is an honest default label). */
export function defaultOrgName(email: string): string {
  const at = email.lastIndexOf("@");
  const domain = at >= 0 ? email.slice(at + 1).trim() : "";
  return domain || "My organization";
}

/** Provision a brand-new tenant from a public registration. Validation is pure
 *  and runs BEFORE the transaction; the email-uniqueness check runs INSIDE it
 *  (better-sqlite3 is synchronous, so no interleaved insert can slip between
 *  check and create), with the users.email UNIQUE constraint as the backstop. */
export function registerAccount(input: RegisterInput): RegisterResult {
  const email = normalizeEmail(input.email ?? "");
  if (!SIGNUP_EMAIL_RE.test(email)) return { ok: false, reason: "invalid_email" };
  if (!input.password || input.password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: "weak_password" };
  }
  const orgName = input.orgName?.trim().slice(0, 120) || defaultOrgName(email);

  const db = ensureDb();
  try {
    return db.transaction((): RegisterResult => {
      // Signup never attaches to an existing account — an existing address signs
      // in (or is invited) instead. Uniform reason regardless of the account's
      // status, so the response can't distinguish active from invited.
      if (getUserByEmail(email)) return { ok: false, reason: "email_taken" };
      const org = createOrganization(orgName);
      // The org's first team, in the exact shape the workspace switcher and the
      // members console expect (org_id linked, type='team' — createWorkspace's
      // contract). Named after the org: one team is the whole org on day one.
      const workspace = createWorkspace(orgName, org.id);
      const user = createUser({ orgId: org.id, email, name: input.name ?? null, status: "active", password: input.password });
      // The registrant owns what they created — `owner` carries org:manage, the
      // only role that can administer members/billing (roles.ts).
      upsertMembership(user.id, workspace.id, "owner");
      return { ok: true, user, orgId: org.id, workspaceId: workspace.id, role: "owner" };
    })();
  } catch (error) {
    // The UNIQUE(users.email) backstop: a concurrent insert between processes
    // (multi-instance deploy) rolls the whole tenant back — report it as taken.
    if (error instanceof Error && /UNIQUE/i.test(error.message)) return { ok: false, reason: "email_taken" };
    throw error;
  }
}
