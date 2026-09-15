// The outreach body gate (idea 067ea817): the model's draft is cleaned to plain text
// and length-capped at sendComm, so neither the outbox row nor the relay payload carries
// markup or a runaway body.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { cleanOutreachBody, outreachBodyRefusal, OUTREACH_BODY_MAX_LENGTH } from "./outreach-body.ts";
import { CommsBodyRejectedError, sendComm } from "./comms.ts";
import { createPipelineEntry } from "./db/pipeline.ts";
import { listOutboxFiltered } from "./db/devcase.ts";

after(() => cleanupUnitDb());

test("markup is stripped and its words kept; script/style lose their contents", () => {
  assert.equal(
    cleanOutreachBody('Hi <b>Jana</b>, <a href="https://evil.example">see the role</a><img src="https://t.example/p.gif">.'),
    "Hi Jana, see the role."
  );
  assert.equal(cleanOutreachBody("Hello<script>alert(1)</script><style>p{}</style><!-- x --> there"), "Hello there");
});

test("a tag split by another tag cannot reassemble", () => {
  assert.equal(cleanOutreachBody("a<scr<b>ipt>b"), "ab");
});

test("invisible and bidi code points go; ordinary prose with < survives", () => {
  assert.equal(cleanOutreachBody("pay​ ‮range﻿"), "pay range");
  assert.equal(cleanOutreachBody("budget < 50k and > 30k"), "budget < 50k and > 30k");
});

test("the letter keeps its lines: CRLF normalized, blank runs folded, edges trimmed", () => {
  assert.equal(cleanOutreachBody("  Hi Jana,  \r\n\r\n\r\n\r\nA role.\r\n- remote\n\nBest  \n"), "Hi Jana,\n\nA role.\n- remote\n\nBest");
});

test("cleaning is idempotent", () => {
  const once = cleanOutreachBody("<p>Hi</p>\n\n\n<i>x</i> ​");
  assert.equal(cleanOutreachBody(once), once);
});

test("the cap is inclusive: exactly the limit is accepted, one more is refused", () => {
  assert.equal(outreachBodyRefusal("x".repeat(OUTREACH_BODY_MAX_LENGTH)), null);
  assert.equal(outreachBodyRefusal("x".repeat(OUTREACH_BODY_MAX_LENGTH + 1)), "body_too_long");
});

const mk = (candidateId: string) =>
  createPipelineEntry({ candidateId, candidateLabel: "Jana", jobId: `job-${candidateId}`, jobTitle: "Backend Engineer" }).entry;

test("sendComm stores the CLEANED outreach body", async () => {
  const entry = mk("cand-clean");
  await sendComm({ to: "Jana", subject: "A role", body: "Hi <b>Jana</b>\n\n\n\n<img src=x>Bye", kind: "outreach", ref: entry.id });
  const rows = listOutboxFiltered({ ref: entry.id });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].body, "Hi Jana\n\nBye");
});

test("sendComm refuses an oversized outreach and writes no row", async () => {
  const entry = mk("cand-long");
  await assert.rejects(
    () => sendComm({ to: "Jana", subject: "A role", body: "x".repeat(OUTREACH_BODY_MAX_LENGTH + 1), kind: "outreach", ref: entry.id }),
    (err: unknown) => {
      assert.ok(err instanceof CommsBodyRejectedError);
      assert.equal(err.reason, "body_too_long");
      return true;
    }
  );
  assert.equal(listOutboxFiltered({ ref: entry.id }).length, 0, "a refused letter leaves no outbox row claiming a send");
});

test("markup in an oversized draft does not count against the cap", async () => {
  const entry = mk("cand-markup");
  const body = "<span>" + "x".repeat(OUTREACH_BODY_MAX_LENGTH - 10) + "</span>".repeat(50);
  await sendComm({ to: "Jana", subject: "A role", body, kind: "outreach", ref: entry.id });
  assert.equal(listOutboxFiltered({ ref: entry.id }).length, 1);
});

test("other kinds pass through untouched — the gate binds outreach only", async () => {
  const entry = mk("cand-offer");
  const body = "Offer <terms>\r\nBEGIN:VCALENDAR\r\n\r\n\r\nEND:VCALENDAR";
  await sendComm({ to: "Jana", subject: "Offer", body, kind: "offer", ref: entry.id });
  assert.equal(listOutboxFiltered({ ref: entry.id })[0].body, body);
});
