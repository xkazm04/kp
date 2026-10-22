// The SMTP doors, driven in-process (open mode: no operator password, the single default
// org). What they must never do is hand the password back, in a read, a refusal or a test
// answer; what they must always do is report the real outcome.
//
// unit-db.ts must stay the first project import.
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET, POST } from "./route.ts";
import { POST as TEST } from "./test/route.ts";
import { setSmtpHostLookupForTests, setSmtpSendForTests } from "../../../_lib/comms-smtp-delivery.ts";

const PASSWORD = "route-test-app-password";
process.env.KP_ATS_SECRET_KEY = "unit-test-smtp-key";

after(() => cleanupUnitDb());
afterEach(() => {
  setSmtpSendForTests(undefined);
  setSmtpHostLookupForTests(undefined);
  delete process.env.KP_NO_COMMS_EGRESS;
  delete process.env.COMMS_WEBHOOK_URL;
});

const post = (body: unknown, url = "http://localhost/api/comms/smtp") =>
  new NextRequest(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

test("GET on a fresh install: nothing configured, nothing active", async () => {
  const res = await GET();
  assert.equal(res.status, 200);
  const body = (await res.json()) as { smtp: string; active: string; config: { hasPassword: boolean } };
  assert.equal(body.smtp, "unconfigured");
  assert.equal(body.active, "none");
  assert.equal(body.config.hasPassword, false);
});

test("POST saves; GET shows hasPassword and never the password", async () => {
  const saved = await POST(post({ preset: "office365", address: "owner@contoso.com", password: PASSWORD, expectedVersion: 0 }));
  assert.equal(saved.status, 200);
  const savedText = await saved.text();
  assert.equal(savedText.includes(PASSWORD), false);
  const res = await GET();
  const text = await res.text();
  assert.equal(text.includes(PASSWORD), false);
  const body = JSON.parse(text) as { smtp: string; active: string; config: { host: string; port: number; security: string; hasPassword: boolean; version: number } };
  assert.equal(body.smtp, "configured");
  assert.equal(body.active, "smtp");
  assert.deepEqual([body.config.host, body.config.port, body.config.security, body.config.hasPassword], ["smtp.office365.com", 587, "starttls", true]);
});

test("GET says the relay is the active sender when both are set", async () => {
  process.env.COMMS_WEBHOOK_URL = "https://relay.example.test/hook";
  const body = (await (await GET()).json()) as { active: string };
  assert.equal(body.active, "relay");
});

test("a stale save is 409 with the current config; an invalid one is 400; neither echoes the password", async () => {
  const stale = await POST(post({ preset: "gmail", address: "owner@gmail.com", password: PASSWORD, expectedVersion: 0 }));
  assert.equal(stale.status, 409);
  const staleText = await stale.text();
  assert.match(staleText, /COMMS_SMTP_STALE/);
  assert.equal(staleText.includes(PASSWORD), false);
  const bad = await POST(post({ preset: "nope", address: "owner@gmail.com", password: PASSWORD }));
  assert.equal(bad.status, 400);
  const badText = await bad.text();
  assert.match(badText, /COMMS_SMTP_INVALID/);
  assert.equal(badText.includes(PASSWORD), false);
  const broken = await POST(post(`{"password":"${PASSWORD}"`));
  assert.equal(broken.status, 400);
  assert.equal((await broken.text()).includes(PASSWORD), false, "a JSON syntax error never quotes the body back");
});

test("Send test: the real SMTP outcome with its reply code, to the operator's own address", async () => {
  setSmtpHostLookupForTests(async () => [{ address: "93.184.216.34" }]);
  const seen: string[] = [];
  setSmtpSendForTests(async (_opts, msg) => {
    seen.push(msg.to);
    return { ok: false, stage: "auth", code: 535, text: "5.7.139 Authentication unsuccessful", permanent: true };
  });
  const res = await TEST(post({}, "http://localhost/api/comms/smtp/test"));
  const body = (await res.json()) as { ok: boolean; to: string; stage: string; code: number; text: string };
  assert.deepEqual(seen, ["owner@contoso.com"]);
  assert.equal(body.ok, false);
  assert.equal(body.code, 535);
  assert.equal(body.stage, "auth");
  setSmtpSendForTests(async () => ({ ok: true, code: 250, text: "2.0.0 OK" }));
  const ok = (await (await TEST(post({}, "http://localhost/api/comms/smtp/test"))).json()) as { ok: boolean; code: number };
  assert.deepEqual([ok.ok, ok.code], [true, 250]);
  const view = (await (await GET()).json()) as { config: { attempts: Array<{ kind: string; code: number }> } };
  assert.deepEqual(view.config.attempts.slice(0, 2).map((a) => [a.kind, a.code]), [["test", 250], ["test", 535]]);
});

test("Send test under the seal: 'sealed', and nothing dialled", async () => {
  let calls = 0;
  setSmtpSendForTests(async () => {
    calls++;
    return { ok: true, code: 250, text: "OK" };
  });
  process.env.KP_NO_COMMS_EGRESS = "1";
  const res = await TEST(post({}, "http://localhost/api/comms/smtp/test"));
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { reason: string }).reason, "sealed");
  assert.equal(calls, 0);
});

test("unsuppress takes an address off the list without a version", async () => {
  const { suppressSmtpAddress } = await import("../../../_lib/comms-smtp-store.ts");
  suppressSmtpAddress("jana@example.cz", 550, "5.1.1 unknown");
  const res = await POST(post({ unsuppress: "jana@example.cz" }));
  const body = (await res.json()) as { removed: boolean; config: { suppressed: unknown[] } };
  assert.equal(body.removed, true);
  assert.equal(body.config.suppressed.length, 0);
});

test("unsuppress from an org that does not own the sender: nothing removed, and nothing learned", async () => {
  const { setSmtpConfig, suppressSmtpAddress, smtpSuppressionFor } = await import("../../../_lib/comms-smtp-store.ts");
  // The sender belongs to another org; the caller here is the open-mode default org.
  setSmtpConfig({ preset: "gmail", address: "owner@gmail.com", password: PASSWORD, ownerOrgId: "org-elsewhere" });
  suppressSmtpAddress("jana@example.cz", 550, "5.1.1 unknown");
  const hit = (await (await POST(post({ unsuppress: "jana@example.cz" }))).json()) as { removed: boolean };
  const miss = (await (await POST(post({ unsuppress: "nobody@example.cz" }))).json()) as { removed: boolean };
  assert.ok(smtpSuppressionFor("jana@example.cz"), "the owner's list is untouched");
  assert.deepEqual([hit.removed, miss.removed], [false, false], "a listed and an unlisted address answer alike: no membership oracle");
});
