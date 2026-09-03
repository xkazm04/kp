// POST /api/devcase/publish must be IDEMPOTENT per (case, channel) — and must SAY so.
//
// The store has deduped since bug-ui-scan-2026-07-09 (createPosting reuses the
// case+channel's open posting), but the route reported every call as a fresh publish:
// two tabs racing, or a reload mid-request, each got a 200 carrying "here is your new
// posting" with the SAME apply token. The only thing naming that harm was the
// client-side single-flight guard in useDevTabActions, which covers one tab.
//
// This drives the REAL handler on a throwaway SQLite file.
// Import the REAL native better-sqlite3 first (never a shim).
import "better-sqlite3";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
// IMPORT ORDER IS LOAD-BEARING: unit-db sets KP_DB_PATH to a throwaway file at
// module-eval time and must run BEFORE any module that transitively touches db-path.
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { getDevCase, saveDevCase, setPostingStatus } from "../../../_lib/db/devcase.ts";

// Point next/server at the shared test shim BEFORE the route loads (hooks only affect
// later resolutions — hence the dynamic import below).
register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

type PublishBody = { posting?: { id?: string; token?: string }; alreadyPublished?: boolean };

async function publish(caseId: string): Promise<{ status: number; body: PublishBody }> {
  const { POST } = await import("./route.ts");
  const request = new Request("http://localhost/api/devcase/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ caseId }),
  });
  const res = await POST(request as never);
  return { status: res.status, body: (await res.json()) as PublishBody };
}

before(() => {
  // Force the full ensureDb() init (creates dev_cases / dev_postings + the dedup index).
  getDevCase("__init__");
});
after(() => cleanupUnitDb());

test("a second publish answers the EXISTING posting, flagged alreadyPublished", async () => {
  const { id: caseId } = saveDevCase({
    need: { title: "idempotent" },
    analysis: {},
    role: { title: "Backend Engineer" },
    case: { title: "Billing migration" },
  });

  const first = await publish(caseId);
  assert.equal(first.status, 200);
  assert.ok(first.body.posting?.id, "the first publish mints a posting");
  // NON-VACUITY: pre-fix the route answered `{ posting }` with no such field, so this
  // assertion failed as `undefined !== false` on the very first call.
  assert.equal(first.body.alreadyPublished, false, "the first publish is a genuine mint");

  const second = await publish(caseId);
  assert.equal(second.status, 200, "a re-publish is not an error — the case IS live");
  assert.equal(second.body.posting?.id, first.body.posting?.id, "the same posting, never a duplicate");
  assert.equal(
    second.body.posting?.token,
    first.body.posting?.token,
    "and the ORIGINAL apply token — a second live token splits the case's submissions",
  );
  // The whole point: the second caller is TOLD nothing was minted, instead of being
  // shown a publish that never happened.
  assert.equal(second.body.alreadyPublished, true);
});

test("a re-publish AFTER a close-out is a genuine new posting, and does not claim otherwise", async () => {
  const { id: caseId } = saveDevCase({
    need: { title: "reopen" },
    analysis: {},
    role: { title: "Data Engineer" },
    case: { title: "Warehouse audit" },
  });
  const first = await publish(caseId);
  // Closing the intake is the deliberate act that makes a fresh posting legitimate
  // (the dedup excludes closed postings), so `alreadyPublished` must go back to false —
  // a flag derived from "was there ever a posting" would wrongly stay true here.
  setPostingStatus(first.body.posting!.id!, "closed");

  const reopened = await publish(caseId);
  assert.notEqual(reopened.body.posting?.id, first.body.posting?.id, "a closed posting is not reused");
  assert.equal(reopened.body.alreadyPublished, false);
});
