// THE KNOCKOUT DECLINE, AS THE CANDIDATE MEETS IT — behavioural, over both real handlers.
//
// The KO gate is automatic (the owner's decision: keep it, and say so). What the
// gate owes the person it turns away: the must-have(s) they answered no to as DATA on
// the response, and a decline email — at BOTH public doors, whenever an address is in
// hand — that names the must-have and carries the human-review route. Before this the
// two doors answered the fixed `declinedMessage` and only webhook leads were emailed.
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
const { listEntriesForJob } = await import("../../../_lib/db/pipeline.ts");
const { DEFAULT_WORKSPACE_ID } = await import("../../../_lib/db/workspaces.ts");

after(() => cleanupUnitDb());

const JOB_ID = "ko-decline-door-job";
const params = { params: Promise.resolve({ id: JOB_ID }) };
let ip = 0;

before(() => {
  insertJob({ id: JOB_ID, title: "Backend Engineer" } as never, undefined, "published", DEFAULT_WORKSPACE_ID);
});

function post(path: string, answers: Record<string, unknown>): NextRequest {
  return new Request(`http://localhost/api/apply/${JOB_ID}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.7.7.${++ip}` },
    body: JSON.stringify({ answers }),
  }) as unknown as NextRequest;
}

function allKo(value: boolean): Record<string, boolean> {
  const job = getJob(JOB_ID);
  assert.ok(job);
  return Object.fromEntries(applyKoSteps(job, ((k: string) => k) as never).map((s) => [s.id, value]));
}

function declineMailsTo(address: string) {
  return listOutboxFiltered({ limit: 500 }, DEFAULT_WORKSPACE_ID).filter((r) => r.recipient === address && r.kind === "ko_decline");
}

async function settle(until: () => boolean): Promise<void> {
  for (let i = 0; i < 40 && !until(); i++) await new Promise((r) => setTimeout(r, 25));
}

for (const [door, path, call] of [
  ["conversational", "", POST],
  ["quick", "/quick", QUICK_POST],
] as const) {
  test(`${door} door: a KO fail names the failed must-have as data and emails the decline with the review route`, async () => {
    const address = `${door}.decline@example.invalid`;
    const res = await call(post(path, { name: "Jana Odmitnuta", email: address, ...allKo(true), ko_auth: false }), params);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.result, "declined");
    assert.deepEqual(body.failedKo, ["ko_auth"], "the failed must-have travels as data (the KO step id)");
    assert.deepEqual(body.failedKoNames, ["apply.koName.auth"], "…named in plain words by the applicant's translator, not the question");
    assert.equal(typeof body.reviewByEmail, "boolean");

    await settle(() => declineMailsTo(address).length > 0);
    const rows = declineMailsTo(address);
    assert.equal(rows.length, 1, "exactly one decline email, to the address the candidate gave");
    const mail = rows[0].body ?? "";
    assert.match(mail, /Legal authorization to work/, "the letter names the must-have");
    assert.match(mail, /reply to this message and a person will review it/i, "…and carries the human-review route");
    assert.match(mail, /A person did not make this decision/, "…and says the decision was automatic");

    // The audited event stays, and it holds no address.
    assert.equal(listEntriesForJob(JOB_ID).filter((e) => e.contact === address).length, 0, "a declined applicant files no entry");
  });
}

test("conversational door: a KO fail with no usable address sends nothing and says no email is coming", async () => {
  const before = listOutboxFiltered({ limit: 500 }, DEFAULT_WORKSPACE_ID).filter((r) => r.kind === "ko_decline").length;
  const res = await POST(post("", { name: "Bez Adresy", email: "not-an-address", ...allKo(true), ko_auth: false }), params);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.result, "declined");
  assert.equal(body.reviewByEmail, false, "no address, no claim of an email");
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(listOutboxFiltered({ limit: 500 }, DEFAULT_WORKSPACE_ID).filter((r) => r.kind === "ko_decline").length, before);
});
