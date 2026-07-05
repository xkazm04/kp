import { ensureDb } from "./core";
import { randomId } from "../random-id";
import { hashPassword, verifyPassword } from "../auth/password";

// Users (P0) — a person in an org. Identity lives here; the password secret lives
// in `user_credentials` (separate table) so the model stays auth-mechanism-
// agnostic. email is globally unique (login resolves email → user → org). Node-
// only (verifyCredentials pulls in node:crypto via ../auth/password).

export type UserStatus = "active" | "invited" | "disabled";

export type User = {
  id: string;
  orgId: string;
  email: string;
  name: string | null;
  status: UserStatus;
  createdAt: string;
};

function rowToUser(r: Record<string, unknown>): User {
  return {
    id: r.id as string,
    orgId: r.org_id as string,
    email: r.email as string,
    name: (r.name as string) ?? null,
    status: (r.status as UserStatus) ?? "active",
    createdAt: r.created_at as string,
  };
}

/** Canonical email form for storage + lookup (the column is UNIQUE on this). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function getUserById(id: string): User | null {
  const db = ensureDb();
  const r = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  return r ? rowToUser(r) : null;
}

export function getUserByEmail(email: string): User | null {
  const db = ensureDb();
  const r = db.prepare(`SELECT * FROM users WHERE email = ?`).get(normalizeEmail(email)) as Record<string, unknown> | undefined;
  return r ? rowToUser(r) : null;
}

export function listUsersByOrg(orgId: string): User[] {
  const db = ensureDb();
  return (db.prepare(`SELECT * FROM users WHERE org_id = ? ORDER BY created_at ASC`).all(orgId) as Record<string, unknown>[]).map(rowToUser);
}

export type CreateUserInput = { orgId: string; email: string; name?: string | null; status?: UserStatus; password?: string | null };

export function createUser(input: CreateUserInput): User {
  const db = ensureDb();
  const id = randomId("usr");
  const email = normalizeEmail(input.email);
  const name = input.name?.trim().slice(0, 120) || null;
  const status: UserStatus = input.status ?? "active";
  const createdAt = new Date().toISOString();
  db.prepare(`INSERT INTO users (id, org_id, email, name, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
    id,
    input.orgId,
    email,
    name,
    status,
    createdAt,
  );
  if (input.password) setUserPassword(id, input.password);
  return { id, orgId: input.orgId, email, name, status, createdAt };
}

export function setUserStatus(id: string, status: UserStatus): boolean {
  const db = ensureDb();
  const info = db.prepare(`UPDATE users SET status = ? WHERE id = ?`).run(status, id);
  return Number(info.changes) > 0;
}

export function updateUserName(id: string, name: string | null): boolean {
  const db = ensureDb();
  const clean = name?.trim().slice(0, 120) || null;
  const info = db.prepare(`UPDATE users SET name = ? WHERE id = ?`).run(clean, id);
  return Number(info.changes) > 0;
}

/** Delete a user + their credential + memberships (no DB-level FKs, so cascade by
 *  hand). Does NOT delete the user's authored data — that stays attributed by id. */
export function deleteUser(id: string): boolean {
  const db = ensureDb();
  db.prepare(`DELETE FROM user_credentials WHERE user_id = ?`).run(id);
  db.prepare(`DELETE FROM memberships WHERE user_id = ?`).run(id);
  const info = db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
  return Number(info.changes) > 0;
}

// ---- Credentials (scrypt, separate table) ---------------------------------

/** Set/replace a user's local password (upsert on user_id). */
export function setUserPassword(userId: string, password: string): void {
  const db = ensureDb();
  const hash = hashPassword(password);
  const updatedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO user_credentials (user_id, password_hash, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET password_hash = excluded.password_hash, updated_at = excluded.updated_at`,
  ).run(userId, hash, updatedAt);
}

/** Whether the user has a local password set (an invited user may not yet). */
export function hasPassword(userId: string): boolean {
  const db = ensureDb();
  return !!db.prepare(`SELECT 1 FROM user_credentials WHERE user_id = ?`).get(userId);
}

/** Verify email+password → the User on success, else null. The single credential
 *  check the login route calls. Rejects disabled users; constant-time on the hash. */
export function verifyCredentials(email: string, password: string): User | null {
  const db = ensureDb();
  const user = getUserByEmail(email);
  if (!user || user.status === "disabled") return null;
  const row = db.prepare(`SELECT password_hash FROM user_credentials WHERE user_id = ?`).get(user.id) as
    | { password_hash?: string }
    | undefined;
  if (!verifyPassword(password, row?.password_hash)) return null;
  return user;
}
