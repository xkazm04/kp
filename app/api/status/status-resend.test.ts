// "Send it to my email again" — the status page's resend door, driven through the REAL
// handlers (challenge-r06 application-status-page/B).
//
// What is pinned:
//   • GET /api/status/[token] carries `nextAction`: the three-key projection (kind, sentAt,
//     expiresAt) and never the invite/offer/interview token it describes;
//   • POST /api/status/[token]/resend re-dispatches the EXISTING capability link to the
//     address on file (the outbox row is addressed to entry.contact and carries the link);
//   • at most once per entry per cooldown window, whoever asks;
//   • never to an erased (anonymized) entry, never to an entry with no address — and the
//     answer for those is the SAME sentence a real send gets, chosen from the relay flag
//     alone, so the door cannot probe whether an address is on file;
//   • nothing pending -> a coded 409; an unknown token -> the siblings' STATUS_LINK_INVALID.
//
// unit-db.ts must stay the first project import (isolated throwaway DB). No relay is
// configured here, so a real send is an honest `queued` outbox row.
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

delete process.env.COMMS_WEBHOOK_URL;

const { GET: STATUS_GET } = await import("./[token]/route.ts");
const { POST: RESEND_POST } = await import("./[token]/resend/route.ts");
const { createPipelineEntry, anonymizeEntry } = await import("../../_lib/db/pipeline.ts");
const { createScheduleInvite } = await import("../../_lib/schedule-store.ts");
const { getOrCreateStatusLink } = await import("../../_lib/application-status-store.ts");
const { listOutboxFiltered } = await import("../../_lib/db/devcase.ts");
const { DEFAULT_WORKSPACE_ID } = await import("../../_lib/db/workspaces.ts");

after(() => cleanupUnitDb());

let ip = 0;

function invited(opts: { contact?: string | null; invite?: boolean } = {}) {
  const suffix = Math.random().toString(36).slice(2, 8);
  const { entry } = createPipelineEntry({
    candidateId: `c-rs-${suffix}`,
    candidateLabel: "Resend Candidate",
    jobId: `job-rs-${suffix}`,
    jobTitle: "Backend Engineer",
    stage: "Interview",
    contact: opts.contact === undefined ? `resend-${suffix}@example.invalid` : opts.contact,
  });
  const invite = opts.invite === false ? null : createScheduleInvite({ entryId: entry.id, candidateLabel: "Resend Candidate", jobTitle: "Backend Engineer" });
  return { entry, invite, token: getOrCreateStatusLink(entry.id) };
}

function status(token: string) {
  return STATUS_GET(new NextRequest(`http://localhost/api/status/${token}`, { headers: { "x-forwarded-for": `10.6.0.${++ip}` } }), {
    params: Promise.resolve({ token }),
  });
}

function resend(token: string) {
  return RESEND_POST(
    new NextRequest(`http://localhost/api/status/${token}/resend`, { method: "POST", headers: { "x-forwarded-for": `10.7.${Math.floor(++ip / 250)}.${ip % 250}` } }),
    { params: Promise.resolve({ token }) }
  );
}

const outboxFor = (entryId: string) => listOutboxFiltered({ ref: entryId, limit: 50 }, DEFAULT_WORKSPACE_ID);

test("the status projection names the pending booking and carries no capability", async () => {
  const c = invited();
  const res = await status(c.token);
  assert.equal(res.status, 200);
  const raw = await res.text();
  const body = JSON.parse(raw) as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(body).sort(),
    ["company", "hasInterviewRecording", "jobTitle", "letter", "nextAction", "relayConfigured", "status", "updatedAt"],
    "the candidate projection must not grow silently"
  );
  const next = body.nextAction as Record<string, unknown>;
  assert.deepEqual(Object.keys(next).sort(), ["expiresAt", "kind", "sentAt"]);
  assert.equal(next.kind, "book_interview");
  assert.ok(!raw.includes(c.invite!.token), "the booking token never rides the forwardable page");
  assert.ok(!raw.includes(c.entry.id), "nor the entry id");
});

test("a resend re-delivers the existing link to the address ON FILE, once per cooldown", async () => {
  const c = invited();
  const res = await resend(c.token);
  const raw = await res.text();
  assert.equal(res.status, 200, raw);
  const body = JSON.parse(raw) as Record<string, unknown>;
  assert.deepEqual(body, { ok: true, message: "resentNoRelay" }, "no relay configured: the honest no-relay sentence");
  assert.ok(!raw.includes(c.invite!.token), "the capability goes to the inbox, never the wire");

  const rows = outboxFor(c.entry.id).filter((r) => r.kind === "schedule_invite");
  assert.equal(rows.length, 1, "exactly one re-sent invitation");
  assert.equal(rows[0].recipient, c.entry.contact, "addressed to the contact on file");
  assert.equal(rows[0].status, "queued", "keyless: an honest queued row, never a claimed send");
  assert.ok((rows[0].body ?? "").includes(`/schedule/${c.invite!.token}`), "the letter carries the SAME booking link");

  // A second click (or a stranger holding a forwarded link) inside the window: same
  // sentence, no second letter.
  const again = await resend(c.token);
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), { ok: true, message: "resentNoRelay" });
  assert.equal(outboxFor(c.entry.id).filter((r) => r.kind === "schedule_invite").length, 1, "one resend per entry per cooldown");
});

test("no address, or an erased entry: nothing is sent, and the answer is indistinguishable", async () => {
  const contactless = invited({ contact: null });
  const res = await resend(contactless.token);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, message: "resentNoRelay" });
  assert.equal(outboxFor(contactless.entry.id).length, 0, "no row minted for a recipient that does not exist");

  const erased = invited();
  anonymizeEntry(erased.entry.id, "erasure", DEFAULT_WORKSPACE_ID);
  const before = outboxFor(erased.entry.id).length;
  const r2 = await resend(erased.token);
  // An erased entry has nothing waiting on it; whichever refusal answers, nothing is sent.
  assert.ok(r2.status === 409 || r2.status === 404 || r2.status === 200, `status ${r2.status}`);
  assert.equal(outboxFor(erased.entry.id).length, before, "an erased candidate is never re-contacted");
});

test("nothing pending -> a coded 409; an unknown token -> STATUS_LINK_INVALID", async () => {
  const idle = invited({ invite: false });
  const statusBody = (await (await status(idle.token)).json()) as Record<string, unknown>;
  assert.equal(statusBody.nextAction, null);
  const res = await resend(idle.token);
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { code?: string }).code, "STATUS_NOTHING_TO_RESEND");
  assert.equal(outboxFor(idle.entry.id).length, 0);

  const bad = await resend("not-a-real-status-token");
  assert.equal(bad.status, 404);
  assert.equal(((await bad.json()) as { code?: string }).code, "STATUS_LINK_INVALID");
});
