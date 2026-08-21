import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope (E0 Phase 1) — source guard for the dev-case surface (devcase.ts):
// dev_cases, dev_lifecycle, dev_postings, dev_submissions, dev_sessions,
// dev_session_events, dev_session_chat. The RECRUITER enumeration reads (listDevCases /
// listLifecycles / listPostings / listSubmissions) plus every INSERT must carry
// workspace_id so one team can neither see nor accrete into another team's
// cases/postings/submissions. Everything else is exempt because it can't cross tenants:
// a point/child op keyed by a globally-unique id/token/child-key.
//
// WHAT THIS GUARD USED TO MISS (bug-hunt 2026-08-21). Two holes, both of the shape that
// let a genuinely cross-tenant read pass on the db-pipeline surface:
//
//  1. The scoping assertion was a bare `/workspace_id/` test over the whole statement,
//     so naming the column ANYWHERE — a SELECT list, an ORDER BY — counted as scoping.
//     `SELECT id, title FROM dev_cases WHERE title LIKE ? ORDER BY workspace_id` reads
//     every team's cases and passed. The tenant has to be a PREDICATE the query filters
//     on (`workspace_id = ?`), or, on an INSERT, a COLUMN the new row is stamped with.
//  2. A `DERIVE` exemption whitelisted any statement matching `select … workspace_id …
//     from` — meant for the tenant-derivation reads (`SELECT workspace_id FROM
//     dev_postings WHERE token = ?`). But every one of those ALSO matches KEY_OP, so the
//     exemption was doing no work except forgiving unscoped enumerations that happened
//     to name the column in their select list. `SELECT workspace_id, token FROM
//     dev_postings ORDER BY created_at DESC` — every tenant's LIVE apply tokens, the
//     exact credential /api/devcase/publish once handed another team — was exempt.
//
// dev_session_chat was also absent from the table list entirely (`dev_sessions` does not
// match `dev_session_chat`), so nothing watched the captured-prompt table.

const SRC = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "devcase.ts"), "utf8");
const sqlBlocks = [...SRC.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

const DEV_TABLES =
  /\b(from|into|update)\s+(dev_cases|dev_lifecycle|dev_postings|dev_submissions|dev_sessions|dev_session_events|dev_session_chat)\b/i;
// A point/child op on a globally-unique key. `= ?` is load-bearing: `s.posting_id = p.id`
// is a JOIN condition, not a caller-supplied key, and must NOT buy an exemption.
const KEY_OP = /\b(id|token|session_id|posting_id|case_id)\s*=\s*\?/i;
const IS_INSERT = /\binsert\s+into\b/i;
// The tenant as a FILTER (`WHERE workspace_id = ?`, alias-qualified or not).
const TENANT_PREDICATE = /\bworkspace_id\s*=\s*\?/i;
// …and on an INSERT, the tenant as a stamped COLUMN in the column list.
const TENANT_COLUMN = /\(\s*[^)]*\bworkspace_id\b[^)]*\)/i;

/** How one SQL statement stands against the tenant rule. Exported shape is the unit
 *  under test below, so the fixtures exercise the SAME classifier the source scan uses. */
export function tenantVerdict(sql: string): "not-a-dev-table" | "exempt" | "ok" | "unscoped" {
  if (!DEV_TABLES.test(sql)) return "not-a-dev-table";
  if (KEY_OP.test(sql)) return "exempt";
  if (IS_INSERT.test(sql)) return TENANT_COLUMN.test(sql) ? "ok" : "unscoped";
  return TENANT_PREDICATE.test(sql) ? "ok" : "unscoped";
}

test("every dev-case enumeration/insert query is workspace-scoped (by-id/token ops exempt)", () => {
  const touching = sqlBlocks.filter((s) => DEV_TABLES.test(s));
  assert.ok(touching.length >= 12, `expected >=12 dev-case queries, found ${touching.length}`);
  const mustScope = touching.filter((s) => tenantVerdict(s) !== "exempt");
  // The list* enumeration reads + the INSERTs.
  assert.ok(mustScope.length >= 6, `expected the enumeration reads + INSERTs to require scoping, found ${mustScope.length}`);
  for (const sql of mustScope) {
    assert.equal(
      tenantVerdict(sql),
      "ok",
      `a dev-case query does NOT carry the tenant as a predicate (reads) or a stamped column (inserts):\n${sql.trim().slice(0, 220)}`
    );
  }
});

// The captured-prompt table is watched too — it was invisible to the old table regex.
test("dev_session_chat is inside the guarded set", () => {
  const chat = sqlBlocks.filter((s) => /\bdev_session_chat\b/i.test(s));
  assert.ok(chat.length >= 3, `expected the chat append + reads, found ${chat.length}`);
  assert.ok(
    chat.some((s) => IS_INSERT.test(s)),
    "the chat INSERT should be among the scanned statements"
  );
  for (const sql of chat) {
    assert.notEqual(tenantVerdict(sql), "unscoped", `an unscoped dev_session_chat query:\n${sql.trim().slice(0, 220)}`);
  }
});

// NON-VACUITY. The scan above only proves today's source is clean — it cannot show the
// classifier would REJECT anything. These fixtures are the statements the pre-2026-08-21
// matcher waved through: each one reads or writes across every tenant, and each one was
// green (1) because it named workspace_id somewhere without filtering on it, (2) because
// the redundant DERIVE exemption forgave it, or (3) because its table was not listed.
test("NON-VACUITY: the classifier rejects the cross-tenant shapes the old matcher passed", () => {
  const crossTenant: Array<[string, string]> = [
    [
      "select-list mention, no filter — the ninth-hollow-guard shape",
      "SELECT id, title FROM dev_cases WHERE title LIKE ? ORDER BY workspace_id",
    ],
    [
      "every tenant's LIVE apply tokens — was exempted by DERIVE",
      "SELECT workspace_id, token FROM dev_postings ORDER BY created_at DESC LIMIT ?",
    ],
    [
      "every tenant's submissions — was exempted by DERIVE",
      "SELECT id, workspace_id FROM dev_submissions ORDER BY received_at DESC LIMIT ?",
    ],
    ["a cross-tenant bulk UPDATE", "UPDATE dev_postings SET status = ? WHERE channel = ?"],
    [
      "a captured-prompt INSERT with no tenant — the table was not even scanned",
      "INSERT INTO dev_session_chat (session_id, seq, channel, role, text, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ],
    ["a JOIN condition is not a caller-supplied key", "SELECT s.* FROM dev_submissions s WHERE s.posting_id = p.id"],
  ];
  for (const [why, sql] of crossTenant) {
    assert.equal(tenantVerdict(sql), "unscoped", `${why} — should be reported, got "${tenantVerdict(sql)}":\n${sql}`);
  }
});

test("NON-VACUITY: the classifier still accepts the real scoped/exempt statements", () => {
  const fine: Array<[string, string, "ok" | "exempt"]> = [
    ["the enumeration read", "SELECT * FROM dev_cases WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?", "ok"],
    [
      "the alias-qualified postings list",
      "SELECT p.*, (SELECT COUNT(*) FROM dev_submissions s WHERE s.posting_id = p.id) AS n FROM dev_postings p WHERE p.workspace_id = ?",
      "ok",
    ],
    ["a stamped INSERT", "INSERT INTO dev_cases (id, title, created_at, workspace_id) VALUES (?, ?, ?, ?)", "ok"],
    ["the tenant-derivation read", "SELECT workspace_id FROM dev_postings WHERE token = ?", "exempt"],
    ["the session status+tenant read", "SELECT status, workspace_id FROM dev_sessions WHERE id = ?", "exempt"],
    ["a child read on a globally-unique parent key", "SELECT t, kind FROM dev_session_events WHERE session_id = ?", "exempt"],
  ];
  for (const [why, sql, expected] of fine) {
    assert.equal(tenantVerdict(sql), expected, `${why} — should be "${expected}":\n${sql}`);
  }
});
