// THE RECRUITER BOOK PATH ANSWERS A CODE, NEVER PROSE (/perfect 2026-09-02, schedule-ui-1).
//
// Every refusal on `POST /api/schedule {action:"book"}` used to be a bare English
// sentence with no `code`, so `useErrorMessage()` had nothing to resolve and the
// Schedule tab painted its LOAD banner's copy — "Failed to load." — over an action
// that loaded nothing. The recruiter who just lost the hour to a candidate's own
// self-booking and the one whose candidate was rejected in another tab read the same
// wrong sentence, in English, in all four locales.
//
// These drive the REAL handler. `currentWorkspace()` reads cookies(), which throws
// outside a request and falls back to the default workspace, so "the caller" here is
// always the default tenant.
//
// unit-db.ts MUST be the first project import (it sets KP_DB_PATH before any store
// resolves db-path.ts).
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";

// Point next/server at the test shim BEFORE the route loads (hooks only affect LATER
// resolutions — hence the dynamic imports below). A junction-linked worktree otherwise
// resolves next/server through two module identities, leaving the handler's own
// NextResponse.json undefined and every assertion here unreachable.
register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const { POST } = await import("./route.ts");
const { createPipelineEntry, actOnPipelineEntry } = await import("../../_lib/db/pipeline.ts");
const { createScheduleInvite, confirmScheduleInvite, getScheduleInviteByToken } = await import(
  "../../_lib/schedule-store.ts"
);
const { proposeSlots, isoToDateSlot } = await import("../../_lib/schedule-slots.ts");
const { REFUSAL_ERRORS } = await import("../../_lib/api-response.ts");

after(() => cleanupUnitDb());

let seq = 0;
function entryFixture(): { id: string; candidateLabel: string } {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `book-c${seq}`,
    candidateLabel: `Book Candidate ${seq}`,
    jobId: `book-job-${seq}`,
    jobTitle: "Booking Test Role",
    contact: `book-c${seq}@example.com`,
  });
  return { id: entry.id, candidateLabel: entry.candidateLabel };
}

function book(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/schedule", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${(seq % 250) + 1}` },
    }) as never
  ) as unknown as Promise<Response>;
}

async function refusal(body: unknown): Promise<{ status: number; code: string; error: string }> {
  const res = await book(body);
  const parsed = (await res.json()) as { code?: string; error?: string };
  return { status: res.status, code: parsed.code ?? "", error: parsed.error ?? "" };
}

test("booking an hour another confirmed invite already holds refuses with SCHEDULE_SLOT_TAKEN", async () => {
  // The real collision: a candidate self-books 14:00 through their token while the
  // recruiter's grid — a client-side snapshot taken on mount — still offers the cell.
  const taken = entryFixture();
  const target = proposeSlots()[0];
  const held = createScheduleInvite({
    entryId: taken.id,
    candidateLabel: taken.candidateLabel,
    jobTitle: "Booking Test Role",
    durationMin: 45,
  });
  const confirmed = confirmScheduleInvite(held.token, target.label, target.value);
  assert.equal(confirmed.ok, true, "the fixture booking itself must land");

  const other = entryFixture();
  const r = await refusal({ action: "book", entryId: other.id, dateSlot: isoToDateSlot(target.value) });
  assert.equal(r.status, 409);
  assert.equal(r.code, "SCHEDULE_SLOT_TAKEN", "the hour is spoken for, and the code says which refusal it is");
  // Nothing was written for the second candidate.
  assert.equal(getScheduleInviteByToken(held.token)!.entryId, taken.id, "the held booking is untouched");
});

test("booking a candidate who is closed out refuses with SCHEDULE_CANDIDATE_INACTIVE", async () => {
  const entry = entryFixture();
  actOnPipelineEntry(entry.id, "reject");
  const slot = proposeSlots()[2];
  const r = await refusal({ action: "book", entryId: entry.id, dateSlot: isoToDateSlot(slot.value) });
  assert.equal(r.status, 409);
  assert.equal(r.code, "SCHEDULE_CANDIDATE_INACTIVE");
});

test("booking an unparseable grid cell refuses with SCHEDULE_SLOT_UNRESOLVED", async () => {
  const entry = entryFixture();
  const r = await refusal({ action: "book", entryId: entry.id, dateSlot: "not-a-date 99:99" });
  assert.equal(r.status, 400);
  assert.equal(r.code, "SCHEDULE_SLOT_UNRESOLVED");
});

test("booking an entry this board does not hold refuses with PIPELINE_ENTRY_NOT_FOUND", async () => {
  const slot = proposeSlots()[3];
  const r = await refusal({ action: "book", entryId: "no-such-entry", dateSlot: isoToDateSlot(slot.value) });
  assert.equal(r.status, 404);
  assert.equal(r.code, "PIPELINE_ENTRY_NOT_FOUND", "the board's own code, reused — not a second vocabulary");
});

test("every code the book path can answer resolves in all four catalogs", () => {
  // The half a route test alone cannot prove: a code with no `errors.<CODE>` entry
  // resolves to the caller's generic fallback, which is the exact failure this
  // direction exists to end. i18n:check pins the REGISTRY to the catalogs; this pins
  // the codes this ROUTE actually emits.
  const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  const emitted = [...route.matchAll(/jsonRefusal\("([A-Z_]+)"/g)].map((m) => m[1]);
  assert.ok(emitted.length >= 5, `expected the book path's refusals, found ${emitted.length}`);
  for (const locale of ["en", "cs", "de", "fr"]) {
    const catalog = JSON.parse(readFileSync(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8")) as {
      errors: Record<string, string>;
    };
    for (const code of emitted) {
      assert.ok(code in REFUSAL_ERRORS, `${code} is not a declared refusal`);
      assert.equal(typeof catalog.errors[code], "string", `messages/${locale}.json is missing errors.${code}`);
    }
  }
});
