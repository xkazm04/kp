import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope (E0 Phase 1) — source guard for rediscovery_alerts (the standing
// silver-medalist feed). recordRediscoveryAlerts stamps workspace_id, and
// listRediscoveryAlerts / dismissRediscoveryAlert both filter it, so one team's
// rejected-then-eligible candidates never surface in — nor are suppressed from —
// another team's feed.
//
// This guard USED to strip every statement containing `id = ?` before asserting
// ("dismiss is by id"). That blanket carve-out is what let dismissRediscoveryAlert
// ship as an unscoped cross-tenant write: a by-id exemption is sound only when the
// id IS the authorization (an unguessable candidate capability token) or the row is
// globally unique by construction — and an alert id is NEITHER. It is handed to
// every recruiter by listRediscoveryAlerts, and dismissal is sticky, so any holder
// could permanently suppress another team's alert. Worse, the same blanket filter
// would have excused any FUTURE unscoped write to this table.
//
// So exemptions are now an EXPLICIT ALLOWLIST of literal statements, each with its
// reason — widening it is a visible diff on a specific query, never a category.
// It holds exactly the two RETENTION deletes, joined deliberately (see EXEMPT):
// every other statement touching rediscovery_alerts is scoped.
const dir = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(dir, "rediscovery-alert-store.ts"), "utf8");
// Strip SQL line comments so a `-- workspace_id` note can never satisfy the scoping
// assertion (the hollow-guard failure mode: a guard a COMMENT passes).
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1].replace(/--.*$/gm, ""));

const TOUCHING = /\b(from|into|update|delete\s+from)\s+rediscovery_alerts\b/i;

/** Statements deliberately allowed to skip the workspace predicate. Each entry
 *  pins ONE literal statement plus the reason it is safe. */
const EXEMPT: { why: string; match: RegExp }[] = [
  {
    why:
      "pruneRediscoveryAlerts' dismissed-retention DELETE. Cross-tenant BY DESIGN and safe " +
      "in the one direction that matters: it runs from the process clock (instrumentation-node), " +
      "which has no session workspace to bind, and its ONLY predicate is age — so unlike the " +
      "dismiss UPDATE it can neither surface nor suppress one team's alert inside another's " +
      "feed. It is data minimisation on a row carrying a candidate name, not an authorization " +
      "decision. A REQUEST-scoped caller must never reuse it.",
    match: /DELETE\s+FROM\s+rediscovery_alerts\s+WHERE\s+dismissed_at\s+IS\s+NOT\s+NULL\s+AND\s+dismissed_at\s*<\s*\?/i,
  },
  {
    why: "pruneRediscoveryAlerts' stale-undismissed DELETE — same clock-scoped, age-only retention sweep.",
    match: /DELETE\s+FROM\s+rediscovery_alerts\s+WHERE\s+dismissed_at\s+IS\s+NULL\s+AND\s+created_at\s*<\s*\?/i,
  },
];

/** A read/update/delete must FILTER on workspace_id with a real bound comparison —
 *  not merely mention the column somewhere (a SELECT-list column, a comment, an
 *  INSERT this regex isn't looking at). */
const filtersWorkspace = (sql: string) => /\bworkspace_id\s*=\s*[?@:$]/i.test(sql);
/** An INSERT must STAMP the tenant: the column named AND a bound `workspaceId`
 *  value supplied for it. A positional-bind insert would have to be added here
 *  deliberately — that is the point. */
const stampsWorkspace = (sql: string) => /\bworkspace_id\b/i.test(sql) && /[@:$]workspaceId\b/.test(sql);

test("every rediscovery_alerts statement is workspace-scoped (exemptions are an explicit allowlist)", () => {
  const touching = sqlBlocks.filter((s) => TOUCHING.test(s));
  // record INSERT + list SELECT + dismiss UPDATE + the two retention DELETEs.
  assert.equal(touching.length, 5, `expected exactly 5 rediscovery_alerts statements, found ${touching.length}`);

  // A stale exemption (one that no longer matches any statement) is itself a failure —
  // it would silently widen the guard for whatever query drifts into its shape next.
  for (const ex of EXEMPT) {
    assert.ok(touching.some((s) => ex.match.test(s)), `EXEMPT entry matches nothing: ${ex.why}`);
  }

  for (const sql of touching) {
    if (EXEMPT.some((ex) => ex.match.test(sql))) continue;
    const ok = /\binto\s+rediscovery_alerts\b/i.test(sql) ? stampsWorkspace(sql) : filtersWorkspace(sql);
    assert.ok(ok, `a rediscovery_alerts statement is NOT workspace-scoped:\n${sql.trim().slice(0, 220)}`);
  }
});

test("the DISMISS write is scoped by workspace, not by id alone", () => {
  // Pinned by name, not by shape: dismissal is a sticky suppression of another team's
  // visible alert, so this specific statement must never regress to a bare by-id write.
  const dismiss = sqlBlocks.find((s) => /\bupdate\s+rediscovery_alerts\b/i.test(s));
  assert.ok(dismiss, "expected the dismiss UPDATE");
  assert.match(dismiss!, /\bid\s*=\s*\?/i, "still a point op on one alert");
  assert.ok(filtersWorkspace(dismiss!), "the dismiss UPDATE must also filter workspace_id");
  assert.match(dismiss!, /dismissed_at\s+IS\s+NULL/i, "still guarded to a still-active row (idempotent)");
  // …and the exported signature must actually take the tenant to bind.
  assert.match(
    src,
    /export function dismissRediscoveryAlert\([^)]*workspaceId[^)]*\)/,
    "dismissRediscoveryAlert must accept a workspaceId"
  );
});
