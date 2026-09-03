// THE CANDIDATE'S OWN DOOR ANSWERS A CODE, NEVER PROSE (/perfect, schedule-door-speaks-
// the-candidates-language).
//
// The recruiter half of scheduling was moved onto codes first (schedule-book-refusals.ts).
// The PUBLIC token route — the one surface whose reader is by construction not an operator
// and may not read English at all — still answered eleven refusals with bare English
// sentences and no `code`, so `useErrorMessage()` had nothing to resolve and the picker
// painted its own generic "Couldn't confirm that slot." over every one of them, in English,
// in all four locales: a Czech candidate whose hour was taken thirty seconds earlier read
// the same wrong sentence as one whose link had been closed by a rejection.
//
// These drive the REAL handler over a real DB. unit-db.ts MUST be the first project import
// (it sets KP_DB_PATH before any store resolves db-path.ts).
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";

// Point next/server at the test shim BEFORE the route loads (hooks only affect LATER
// resolutions — hence the dynamic imports below), exactly as the recruiter-side sibling
// does: a junction-linked worktree otherwise resolves next/server through two module
// identities and the handler's own NextResponse.json comes back undefined.
register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const { GET, POST } = await import("./route.ts");
const { createPipelineEntry, actOnPipelineEntry } = await import("../../../_lib/db/pipeline.ts");
const { createScheduleInvite, confirmScheduleInvite, declineScheduleInvite } = await import(
  "../../../_lib/schedule-store.ts"
);
const { proposeSlots } = await import("../../../_lib/schedule-slots.ts");
const { REFUSAL_ERRORS } = await import("../../../_lib/api-response.ts");

after(() => cleanupUnitDb());

const SLOTS = proposeSlots([], 12);

let seq = 0;
function inviteFixture(): { token: string; entryId: string } {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `tok-c${seq}`,
    candidateLabel: `Token Candidate ${seq}`,
    jobId: `tok-job-${seq}`,
    jobTitle: "Token Test Role",
    contact: `tok-c${seq}@example.com`,
  });
  const invite = createScheduleInvite({
    entryId: entry.id,
    candidateLabel: entry.candidateLabel,
    jobTitle: "Token Test Role",
    durationMin: 45,
  });
  return { token: invite.token, entryId: entry.id };
}

/** Each fixture gets its own client ip AND its own token, so the per-token+ip read
 *  limiter this direction added can never make one test throttle another. */
function ip(): string {
  return `10.1.0.${(seq % 250) + 1}`;
}

function ctx(token: string) {
  return { params: Promise.resolve({ token }) };
}

async function get(token: string): Promise<{ status: number; code: string }> {
  const res = (await GET(
    new Request(`http://localhost/api/schedule/${token}`, { headers: { "x-forwarded-for": ip() } }) as never,
    ctx(token)
  )) as unknown as Response;
  const body = (await res.json()) as { code?: string };
  return { status: res.status, code: body.code ?? "" };
}

async function post(token: string, body: unknown): Promise<{ status: number; code: string }> {
  const res = (await POST(
    new Request(`http://localhost/api/schedule/${token}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-forwarded-for": ip() },
    }) as never,
    ctx(token)
  )) as unknown as Response;
  const parsed = (await res.json()) as { code?: string };
  return { status: res.status, code: parsed.code ?? "" };
}

test("an unknown token is a coded 404 on both the read and the write", async () => {
  assert.deepEqual(await get("no-such-token"), { status: 404, code: "SCHEDULE_LINK_NOT_FOUND" });
  assert.deepEqual(await post("no-such-token", { rsvp: "confirm" }), {
    status: 404,
    code: "SCHEDULE_LINK_NOT_FOUND",
  });
});

test("a closed link refuses every mutation with SCHEDULE_LINK_CLOSED at 410", async () => {
  const { token } = inviteFixture();
  declineScheduleInvite(token);
  const r = await post(token, { slotAt: SLOTS[0].value });
  assert.equal(r.status, 410);
  assert.equal(r.code, "SCHEDULE_LINK_CLOSED", "the stale tab learns WHICH refusal, in its own language");
});

test("booking for a candidate closed out since the link was minted answers SCHEDULE_INTERVIEW_UNAVAILABLE", async () => {
  const { token, entryId } = inviteFixture();
  actOnPipelineEntry(entryId, "reject");
  const r = await post(token, { slotAt: SLOTS[1].value });
  assert.equal(r.status, 409);
  assert.equal(r.code, "SCHEDULE_INTERVIEW_UNAVAILABLE");
});

test("an instant the server would never offer answers SCHEDULE_SLOT_NOT_OFFERED at 400", async () => {
  const { token } = inviteFixture();
  const r = await post(token, { slotAt: "2019-01-06T03:00:00.000Z" });
  assert.equal(r.status, 400);
  assert.equal(r.code, "SCHEDULE_SLOT_NOT_OFFERED");
});

test("an hour another confirmed invite already holds answers SCHEDULE_SLOT_TAKEN — the recruiter path's own code", async () => {
  const target = SLOTS[2];
  const held = inviteFixture();
  assert.equal(confirmScheduleInvite(held.token, target.label, target.value).ok, true);
  const mine = inviteFixture();
  const r = await post(mine.token, { slotAt: target.value });
  assert.equal(r.status, 409);
  assert.equal(r.code, "SCHEDULE_SLOT_TAKEN", "one vocabulary across both halves of the feature, not two");
});

test("an RSVP on an invite with no booking answers SCHEDULE_NO_BOOKING_YET", async () => {
  const { token } = inviteFixture();
  const r = await post(token, { rsvp: "cancel" });
  assert.equal(r.status, 409);
  assert.equal(r.code, "SCHEDULE_NO_BOOKING_YET");
});

test("escalating while the picker still has times answers SCHEDULE_SLOTS_STILL_OPEN", async () => {
  const { token } = inviteFixture();
  const r = await post(token, { propose: [SLOTS[5].value] });
  assert.equal(r.status, 409);
  assert.equal(r.code, "SCHEDULE_SLOTS_STILL_OPEN");
});

test("every code this public door can answer resolves in all four catalogs", () => {
  // The half a handler test cannot prove: a code with no `errors.<CODE>` entry resolves
  // to the client's generic fallback — the exact failure this direction exists to end.
  // i18n:check pins the REGISTRY to the catalogs; this pins the codes this ROUTE emits.
  const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  const emitted = [...new Set([...route.matchAll(/jsonRefusal\("([A-Z_]+)"/g)].map((m) => m[1]))];
  assert.ok(emitted.length >= 9, `expected the token route's refusals, found ${emitted.length}`);
  for (const locale of ["en", "cs", "de", "fr"]) {
    const catalog = JSON.parse(
      readFileSync(new URL(`../../../../messages/${locale}.json`, import.meta.url), "utf8")
    ) as { errors: Record<string, string> };
    for (const code of emitted) {
      assert.ok(code in REFUSAL_ERRORS, `${code} is not a declared refusal`);
      assert.equal(typeof catalog.errors[code], "string", `messages/${locale}.json is missing errors.${code}`);
    }
  }
});

test("no refusal on the public door is bare prose any more", () => {
  const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(
    route,
    /NextResponse\.json\(\s*\{\s*error:\s*"/,
    "an English sentence on the wire is a sentence the candidate's client cannot localize"
  );
});
