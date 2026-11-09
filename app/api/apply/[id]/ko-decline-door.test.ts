// A FAILED MUST-HAVE, AS THE CANDIDATE AND THE REVIEWER MEET IT — behavioural, over
// the real handlers at every door that filed an entry-less decline before.
//
// OWNER RULING Q1 (2026-11-09, docs/product/oss-1.0-cut.md): a knockout keeps its
// question but files a HELD entry for a person to confirm — no instant decline. This
// file used to pin the older decision (2026-10-07, ADR 0019: the gate is automatic, says
// so, and emails the decline at once). It now pins the replacement:
//
//   1. a no to a must-have files a REAL entry in the opening's workspace behind the
//      existing `decision` approval, carrying the failed step ids (approval_detail), at
//      the conversational door, the quick door and the lead core (channel webhooks);
//   2. NO letter goes out at intake, and the answer is `held` — it claims no decision;
//   3. a person's reject (the ordinary door, runPipelineEntryAction) sends exactly ONE
//      letter naming the must-have and the review route, sealed like any human reject;
//      a repeat reject is refused and sends nothing more;
//   4. a person's accept CLEARS the hold: no letter, the entry continues as an applicant;
//   5. the edge stays: honeypot and name cap before the gate, no address = an entry with
//      no letter owed, a known applicant is not filed twice.
// Automation leaves a held entry alone: ko-hold-automation.test.ts.
//
// unit-db.ts must stay the first project import (see reapply-capability-gate.test.ts,
// whose shims this file repeats: the two request-scoped i18n modules cannot run
// outside a Next request).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import type { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";

register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const VIRTUAL_INTL = "kp-test:next-intl-server";
const VIRTUAL_I18N = "kp-test:i18n-server";
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next-intl/server") return { url: VIRTUAL_INTL, shortCircuit: true };
    if (specifier === "@/i18n/server") return { url: VIRTUAL_I18N, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === VIRTUAL_INTL) {
      return { format: "module", shortCircuit: true, source: `export async function getTranslations(ns) { return (key) => ns + "." + key; }` };
    }
    if (url === VIRTUAL_I18N) {
      return { format: "module", shortCircuit: true, source: `export async function getServerLocale() { return "en"; }` };
    }
    return nextLoad(url, context);
  },
});

const { POST } = await import("./route.ts");
const { POST: QUICK_POST } = await import("./quick/route.ts");
const { listOutboxFiltered } = await import("../../../_lib/db/devcase.ts");
const { getJob } = await import("../../../_lib/db/jobs.ts");
const { applyKoSteps } = await import("../../../_lib/apply.ts");
const { insertJob } = await import("../../../_lib/job-ingest.ts");
const { listEntriesForJob, getPipelineEntry, listPipelineEventsForEntry } = await import("../../../_lib/db/pipeline.ts");
const { DEFAULT_WORKSPACE_ID } = await import("../../../_lib/db/workspaces.ts");
const { intakeLead } = await import("../../../_lib/lead-intake.ts");
const { parseKnockoutHold } = await import("../../../_lib/knockout-hold.ts");
const { runPipelineEntryAction } = await import("../../../_lib/pipeline-entry-action.ts");
const { listDecisionRecords } = await import("../../../_lib/decision-record-store.ts");

after(() => cleanupUnitDb());

const JOB_ID = "ko-decline-door-job";
const TEAM_JOB_ID = "ko-hold-team-job";
const TEAM = "team-ko-hold";
const params = { params: Promise.resolve({ id: JOB_ID }) };
const teamParams = { params: Promise.resolve({ id: TEAM_JOB_ID }) };
let ip = 0;

before(() => {
  insertJob({ id: JOB_ID, title: "Backend Engineer" } as never, undefined, "published", DEFAULT_WORKSPACE_ID);
  insertJob({ id: TEAM_JOB_ID, title: "Platform Engineer" } as never, undefined, "published", TEAM);
});

function post(jobId: string, path: string, answers: Record<string, unknown>, extra: Record<string, unknown> = {}): NextRequest {
  return new Request(`http://localhost/api/apply/${jobId}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.7.7.${++ip}` },
    body: JSON.stringify({ answers, ...extra }),
  }) as unknown as NextRequest;
}

function allKo(jobId: string, value: boolean): Record<string, boolean> {
  const job = getJob(jobId);
  assert.ok(job);
  return Object.fromEntries(applyKoSteps(job, ((k: string) => k) as never).map((s) => [s.id, value]));
}

const mailsTo = (address: string, ws = DEFAULT_WORKSPACE_ID) =>
  listOutboxFiltered({ limit: 500 }, ws).filter((r) => r.recipient === address);
const koLettersTo = (address: string, ws = DEFAULT_WORKSPACE_ID) => mailsTo(address, ws).filter((r) => r.kind === "ko_decline");

async function quiet(): Promise<void> {
  // Every deferred send (ack, link recovery) runs after the response: give it room to
  // land, so "nothing was sent" is asserted AFTER a send would have happened.
  await new Promise((r) => setTimeout(r, 200));
}

const noAts = { dispatchAtsEvent: async () => {} };

for (const [door, path, call] of [
  ["conversational", "", POST],
  ["quick", "/quick", QUICK_POST],
] as const) {
  test(`${door} door: a KO fail files a HELD entry, sends no letter, and answers held with the must-have as data`, async () => {
    const address = `${door}.held@example.invalid`;
    const res = await call(post(JOB_ID, path, { name: "Jana Podrzena", email: address, ...allKo(JOB_ID, true), ko_auth: false }), params);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.result, "held", "a new result beside 'declined' — and it claims no decision");
    assert.deepEqual(body.failedKo, ["ko_auth"], "the failed must-have travels as data (the KO step id)");
    assert.deepEqual(body.failedKoNames, ["apply.koName.auth"], "…named in plain words by the applicant's translator, not the question");
    assert.equal(body.message, "apply.heldMessage", "the screen says a person will review, not that anything was decided");
    assert.equal("reviewByEmail" in body, false, "no email is on its way, so none is promised");

    await quiet();
    assert.equal(mailsTo(address).length, 0, "NOTHING is mailed at intake: no decline letter, no acknowledgement");

    const entries = listEntriesForJob(JOB_ID).filter((e) => e.contact === address);
    assert.equal(entries.length, 1, "a real entry is filed");
    const entry = entries[0];
    assert.equal(entry.approvalKind, "decision", "held behind the EXISTING decision approval — no new status or queue");
    assert.equal(entry.status, "active");
    assert.deepEqual(parseKnockoutHold(entry.approvalKind, entry.approvalDetail)?.failedKoIds, ["ko_auth"], "the reviewer can read WHICH must-have failed");
    assert.equal(entry.workspaceId, DEFAULT_WORKSPACE_ID);
    assert.equal(entry.intakeDegraded, true, "filed before any profile exists");
    const kinds = listPipelineEventsForEntry(entry.id, 50, DEFAULT_WORKSPACE_ID).map((e) => e.kind);
    assert.ok(!kinds.includes("ko_declined"), "nothing was declined");
  });
}

test("lead core (channel webhooks): a KO fail is held the same way, in the webhook's own workspace", async () => {
  const address = "webhook.held@example.invalid";
  const job = getJob(TEAM_JOB_ID);
  assert.ok(job);
  const outcome = await intakeLead({
    job,
    name: "Webhook Lead",
    email: address,
    locale: "en",
    sourceChannel: "boards",
    channelLabel: "boards webhook",
    failedKoIds: ["ko_auth"],
    notifyDecline: true,
    enrichLink: "http://localhost/apply/x",
  });
  assert.equal(outcome.result, "held");
  await quiet();
  assert.equal(mailsTo(address, TEAM).length, 0, "no letter, even for a webhook lead that used to be declined by email");
  const entry = listEntriesForJob(TEAM_JOB_ID, TEAM).find((e) => e.contact === address);
  assert.ok(entry, "the entry is filed in the OPENING's team, not the default one");
  assert.equal(entry.workspaceId, TEAM);
  assert.equal(entry.approvalKind, "decision");
  assert.deepEqual(parseKnockoutHold(entry.approvalKind, entry.approvalDetail)?.failedKoIds, ["ko_auth"]);
  assert.equal(listEntriesForJob(TEAM_JOB_ID).filter((e) => e.contact === address).length, 0, "and nothing leaked into the default team");
});

test("CONFIRM: a person's reject sends exactly ONE letter naming the must-have, sealed like any human reject", async () => {
  const address = "confirm.me@example.invalid";
  await POST(post(JOB_ID, "", { name: "Karel Potvrzeny", email: address, ...allKo(JOB_ID, true), ko_auth: false }), params);
  const held = listEntriesForJob(JOB_ID).find((e) => e.contact === address);
  assert.ok(held);
  assert.equal(koLettersTo(address).length, 0, "nothing before the person acts");

  const res = await runPipelineEntryAction(
    { id: held.id, action: "reject", expectedStage: held.stage, origin: "http://localhost:3000", workspaceId: DEFAULT_WORKSPACE_ID },
    noAts
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.commsFailed, undefined, "the letter was queued without failure");
  const letters = koLettersTo(address);
  assert.equal(letters.length, 1, "exactly one letter");
  const mail = letters[0].body ?? "";
  assert.match(mail, /Legal authorization to work/, "the letter names the must-have");
  // Owner ruling Q7: no review address is set on this workspace, so the letter must not promise
  // that a reply reaches anyone (C6 is out) — it points at the hiring team instead.
  assert.match(mail, /ask the hiring team for this role to have a person review it again/i, "…and says how to ask for a review, without promising a reply door");
  assert.doesNotMatch(mail, /reply to this message/i, "…and does not tell the candidate to reply");
  assert.match(mail, /A person reviewed your application and confirmed/, "…and says a PERSON decided");
  assert.doesNotMatch(mail, /automatically|A person did not make this decision/i, "…and claims no automatic decision");
  assert.equal(letters[0].ref, held.id, "the letter belongs to the entry, so its erasure and expiry reach it");

  const after = getPipelineEntry(held.id, DEFAULT_WORKSPACE_ID)!;
  assert.equal(after.status, "rejected");
  assert.equal(after.approvalKind, null);
  const records = listDecisionRecords({ candidateRef: held.id, workspaceId: DEFAULT_WORKSPACE_ID });
  assert.equal(records.length, 1, "the rejection is sealed in the decision chain");
  const sealed = JSON.parse(records[0].payloadJson) as { kind?: string; inputs: Record<string, unknown> };
  assert.equal(sealed.kind ?? records[0].kind, "rejected");
  assert.deepEqual(sealed.inputs.knockoutFailedIds, ["ko_auth"], "the sealed reasons block names the must-have");
  assert.equal(sealed.inputs.aiReasonCode, "knockout");

  // Once: a second confirm is refused on the closed entry and mails nothing more.
  const again = await runPipelineEntryAction(
    { id: held.id, action: "reject", origin: "http://localhost:3000", workspaceId: DEFAULT_WORKSPACE_ID },
    noAts
  );
  assert.notEqual(again.status, 200, "a repeat reject is refused");
  assert.equal(koLettersTo(address).length, 1, "still exactly one letter");
});

test("CLEAR: a person's accept lifts the hold — no letter, and the entry continues as an ordinary applicant", async () => {
  const address = "clear.me@example.invalid";
  await QUICK_POST(post(JOB_ID, "/quick", { name: "Lenka Uvolnena", email: address, ...allKo(JOB_ID, true), ko_auth: false }), params);
  const held = listEntriesForJob(JOB_ID).find((e) => e.contact === address);
  assert.ok(held);

  const res = await runPipelineEntryAction(
    { id: held.id, action: "accept", expectedStage: held.stage, origin: "http://localhost:3000", workspaceId: DEFAULT_WORKSPACE_ID },
    noAts
  );
  assert.equal(res.status, 200);
  const after = getPipelineEntry(held.id, DEFAULT_WORKSPACE_ID)!;
  assert.equal(after.status, "active", "still a live applicant");
  assert.equal(after.approvalKind, null, "the hold is gone");
  assert.notEqual(after.stage, held.stage, "the person's accept moved them on, like any decision-gate accept");
  await quiet();
  assert.equal(mailsTo(address).length, 0, "clearing sends nothing");
});

test("a held entry with no address on file owes no letter — confirming it succeeds without one", async () => {
  const res = await POST(post(JOB_ID, "", { name: "Bez Adresy", email: "not-an-address", ...allKo(JOB_ID, true), ko_auth: false }), params);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.result, "held", "a bad address is no reason to refuse or to skip the hold");
  const held = listEntriesForJob(JOB_ID).find((e) => e.candidateLabel === "Bez Adresy");
  assert.ok(held, "the entry is filed, contactless");
  assert.equal(held.contact ?? null, null, "the junk address was never stored");

  const before = listOutboxFiltered({ limit: 500 }, DEFAULT_WORKSPACE_ID).filter((r) => r.kind === "ko_decline").length;
  const confirm = await runPipelineEntryAction(
    { id: held.id, action: "reject", origin: "http://localhost:3000", workspaceId: DEFAULT_WORKSPACE_ID },
    noAts
  );
  assert.equal(confirm.status, 200);
  assert.equal(confirm.body.commsFailed, undefined, "no letter owed is not a failed letter");
  assert.equal(listOutboxFiltered({ limit: 500 }, DEFAULT_WORKSPACE_ID).filter((r) => r.kind === "ko_decline").length, before);
});

test("the edge is unchanged: honeypot answers held-shaped with no entry, and a known applicant is not filed twice", async () => {
  const before = listEntriesForJob(JOB_ID).length;
  const bot = await POST(post(JOB_ID, "", { name: "Bot", email: "bot@example.invalid", ...allKo(JOB_ID, false) }, { company_url: "http://spam" }), params);
  const botBody = (await bot.json()) as Record<string, unknown>;
  assert.equal(botBody.result, "held", "indistinguishable from a real KO outcome");
  assert.equal(listEntriesForJob(JOB_ID).length, before, "…and files nothing");

  const address = "twice@example.invalid";
  const answers = { name: "Dvakrat Podal", email: address, ...allKo(JOB_ID, true), ko_auth: false };
  await POST(post(JOB_ID, "", answers), params);
  const second = await POST(post(JOB_ID, "", answers), params);
  assert.equal(second.status, 200);
  assert.equal(listEntriesForJob(JOB_ID).filter((e) => e.contact === address).length, 1, "one application per applicant per role still holds");
  await quiet();
  assert.equal(mailsTo(address).length, 0, "and the repeat mails nothing either");
});
