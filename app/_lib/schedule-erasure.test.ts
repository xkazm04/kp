// Erasure closes the schedule door: anonymizeEntry overwrites the capability token of every
// schedule_invites row of the erased entry, and the token route refuses an invite whose
// linked entry is anonymized even if the old token were somehow still stored. Driven through
// the REAL handler, pending and confirmed. unit-db.ts stays the first project import.
import { cleanupUnitDb, UNIT_DB_PATH } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import Database from "better-sqlite3";

register(new URL("./testing/next-server-hooks.mjs", import.meta.url));

const { GET, POST } = await import("../api/schedule/[token]/route.ts");
const { anonymizeEntry, createPipelineEntry, getPipelineEntry } = await import("./db/pipeline.ts");
const { createScheduleInvite, confirmScheduleInvite, dueReminders, getScheduleInviteByToken, listScheduleInvitesForEntry } = await import(
  "./schedule-store.ts"
);
const { proposeSlots } = await import("./schedule-slots.ts");

after(() => cleanupUnitDb());

const SLOTS = proposeSlots([], 12);

let seq = 0;
function fixture(confirmed: boolean) {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `serase-c${seq}`,
    candidateLabel: `Schedule Erase ${seq}`,
    jobId: `serase-job-${seq}`,
    jobTitle: "Erase Role",
    contact: `serase-c${seq}@example.com`,
  });
  const invite = createScheduleInvite({ entryId: entry.id, candidateLabel: entry.candidateLabel, jobTitle: "Erase Role", durationMin: 45 });
  if (confirmed) {
    const slot = SLOTS[seq % SLOTS.length];
    const res = confirmScheduleInvite(invite.token, slot.label, slot.value);
    assert.ok(res.ok, "fixture booking");
  }
  return { entryId: entry.id, token: invite.token, ip: `10.9.0.${(seq % 250) + 1}` };
}

const ctx = (token: string) => ({ params: Promise.resolve({ token }) });

async function get(token: string, ip: string) {
  const res = (await GET(new Request(`http://localhost/api/schedule/${token}`, { headers: { "x-forwarded-for": ip } }) as never, ctx(token))) as unknown as Response;
  return { status: res.status, code: ((await res.json()) as { code?: string }).code ?? "" };
}

async function post(token: string, ip: string, body: unknown) {
  const res = (await POST(
    new Request(`http://localhost/api/schedule/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }) as never,
    ctx(token)
  )) as unknown as Response;
  return { status: res.status, code: ((await res.json()) as { code?: string }).code ?? "" };
}

const ACTIONS: [string, unknown][] = [
  ["book", { slotAt: SLOTS[0].value }],
  ["withdraw", { withdraw: true }],
  ["propose", { propose: [SLOTS[1].value] }],
];

for (const confirmed of [false, true]) {
  const kind = confirmed ? "confirmed" : "pending";

  test(`an erased candidate's ${kind} schedule link is dead: GET and every POST are refused`, async () => {
    const f = fixture(confirmed);
    const before = getPipelineEntry(f.entryId)!;
    assert.ok(anonymizeEntry(f.entryId, "erasure"));

    assert.equal(getScheduleInviteByToken(f.token), null, "the old token resolves to nothing");
    const g = await get(f.token, f.ip);
    assert.equal(g.status, 404);
    assert.equal(g.code, "SCHEDULE_LINK_NOT_FOUND");
    for (const [name, body] of ACTIONS) {
      const r = await post(f.token, f.ip, body);
      assert.equal(r.status, 404, `${name} is refused`);
      assert.equal(r.code, "SCHEDULE_LINK_NOT_FOUND", name);
    }

    const after_ = getPipelineEntry(f.entryId)!;
    assert.equal(after_.stage, before.stage, "no stage advance");
    const [row] = listScheduleInvitesForEntry(f.entryId);
    assert.equal(row.status, kind, "no withdrawal, booking or proposal was written");
    assert.equal(row.calendarEventState, null, "no calendar write was attempted");
    assert.equal(row.proposals, null);
    assert.notEqual(row.token, f.token, "the stored token is not the one that was sent");
  });

  test(`the route alone refuses a ${kind} invite of an anonymized entry, token column notwithstanding`, async () => {
    const f = fixture(confirmed);
    anonymizeEntry(f.entryId, "erasure");
    // Put the old token back by hand: the revocation is gone, the entry is still erased.
    const raw = new Database(UNIT_DB_PATH);
    try {
      raw.prepare(`UPDATE schedule_invites SET token = ? WHERE entry_id = ?`).run(f.token, f.entryId);
    } finally {
      raw.close();
    }
    assert.ok(getScheduleInviteByToken(f.token), "the token resolves again");
    assert.equal((await get(f.token, f.ip)).status, 404);
    for (const [name, body] of ACTIONS) {
      assert.equal((await post(f.token, f.ip, body)).status, 404, `${name} is refused by the route`);
    }
    assert.equal(listScheduleInvitesForEntry(f.entryId)[0].calendarEventState, null);
  });
}

test("the reminder sweep skips an erased entry's confirmed invite and keeps its neighbour's", () => {
  const gone = fixture(true);
  const kept = fixture(true);
  anonymizeEntry(gone.entryId, "erasure");
  const due = dueReminders(365 * 86_400_000);
  assert.equal(due.some((i) => i.entryId === gone.entryId), false);
  assert.equal(due.some((i) => i.entryId === kept.entryId), true);
});

test("another entry's schedule link is untouched by the erasure", async () => {
  const gone = fixture(false);
  const kept = fixture(false);
  anonymizeEntry(gone.entryId, "erasure");
  assert.ok(getScheduleInviteByToken(kept.token));
  assert.equal((await get(kept.token, kept.ip)).status, 200);
});
