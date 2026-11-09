// The release card's logic: what Approve posts, how a 409 reads, which states can release,
// and that a keyless release reads "queued". The calls run against a stub fetch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { approveLetter, canApprove, canRelease, loadLetter, releaseLetter, RELEASABLE_STATES, type Fetcher } from "./outreachCard.ts";

type Call = { url: string; init?: RequestInit };
function stub(status: number, body: unknown): { fetcher: Fetcher; calls: Call[] } {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as Fetcher;
  return { fetcher, calls };
}

const view = {
  letter: { id: "ol_1", entryId: "e1", state: "drafted", revision: 3, subject: "S", body: "B", approvedBy: null, approvedAt: null, releasedAt: null },
  preview: { locale: "en", subject: "S", body: "B\n\nfooter", recipient: "a@b.cz", forecast: "local", forecastReason: null },
};

test("loadLetter returns the letter with its preview (exact body, footers included)", async () => {
  const { fetcher, calls } = stub(200, view);
  const got = await loadLetter("e1", fetcher);
  assert.equal(got?.preview.body, "B\n\nfooter");
  assert.equal(got?.letter.revision, 3);
  assert.equal(calls[0].url, "/api/outreach-letters/by-entry/e1");
});

test("loadLetter is null when no letter was drafted", async () => {
  assert.equal(await loadLetter("e1", stub(200, { letter: null, preview: null }).fetcher), null);
});

test("Approve posts the revision the card rendered", async () => {
  const { fetcher, calls } = stub(200, { ok: true });
  assert.deepEqual(await approveLetter("ol_1", 3, fetcher), { kind: "none" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/outreach-letters/ol_1/approve");
  assert.equal(calls[0].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { revision: 3 });
});

test("a 409 on Approve is the stale state and is never retried", async () => {
  const { fetcher, calls } = stub(409, { code: "OUTREACH_LETTER_CONFLICT", state: "drafted", revision: 4 });
  assert.deepEqual(await approveLetter("ol_1", 3, fetcher), { kind: "stale" });
  assert.equal(calls.length, 1, "no silent retry");
});

test("Release is live only in RELEASABLE_STATES; Approve only on a draft", () => {
  for (const s of ["drafted", "approved", "released", "delivery_failed", "suppressed", "discarded"] as const) {
    assert.equal(canRelease(s), RELEASABLE_STATES.includes(s), s);
  }
  assert.equal(canRelease("drafted"), false);
  assert.equal(canRelease("released"), false);
  assert.equal(canRelease("approved"), true);
  assert.equal(canRelease("delivery_failed"), true);
  assert.equal(canApprove("drafted"), true);
  assert.equal(canApprove("approved"), false);
});

test("a keyless release reads queued, never sent", async () => {
  const { fetcher, calls } = stub(200, { ok: true, delivery: "queued", letter: { state: "released" } });
  assert.deepEqual(await releaseLetter("ol_1", fetcher), { kind: "queued" });
  assert.equal(calls[0].url, "/api/outreach-letters/ol_1/release");
});

test("release outcomes: sent, failed, and a suppressed 409 each get their own state", async () => {
  assert.deepEqual(await releaseLetter("ol_1", stub(200, { delivery: "sent" }).fetcher), { kind: "sent" });
  assert.deepEqual(await releaseLetter("ol_1", stub(200, { delivery: "failed" }).fetcher), { kind: "failed" });
  assert.deepEqual(await releaseLetter("ol_1", stub(409, { code: "COMMS_SUPPRESSED", suppressed: "consent_expired" }).fetcher), {
    kind: "suppressed",
    reason: "consent_expired",
  });
  const other = await releaseLetter("ol_1", stub(500, { code: "OUTREACH_FAILED" }).fetcher);
  assert.equal(other.kind, "error");
});
