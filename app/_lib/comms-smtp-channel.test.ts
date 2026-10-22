// The SMTP transport through the REAL send path (sendComm → getCommsChannel → SmtpChannel
// → deliverOverSmtp), with the client stubbed per test or pointed at an in-process fake
// server. No network.
//
// What it pins: `sent` only on the server's 250; a 4xx is retried under COMMS_RELAY_RETRY;
// a 5xx at RCPT is `failed`, puts the address on the suppression list and refuses the next
// letter by name; the password reaches no row, no log; the List-Unsubscribe headers ride
// the real wire; and with SMTP unset the letter is the same `queued` outbox row as before.
//
// unit-db.ts MUST be the first project import.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { sendComm } from "./comms.ts";
import { sendSmtp, type SmtpOutcome, type SmtpSendOptions, type SmtpMessage } from "./comms-smtp.ts";
import { setSmtpHostLookupForTests, setSmtpSendForTests } from "./comms-smtp-delivery.ts";
import { getSmtpConfig, setSmtpConfig, unsuppressSmtpAddress } from "./comms-smtp-store.ts";

const PASSWORD = "zz-unit-app-password-zz";
process.env.KP_ATS_SECRET_KEY = "unit-test-smtp-key";

after(() => cleanupUnitDb());
afterEach(() => {
  setSmtpSendForTests(undefined);
  setSmtpHostLookupForTests(undefined);
  delete process.env.COMMS_WEBHOOK_URL;
});

const PUBLIC_LOOKUP = async () => [{ address: "93.184.216.34" }];

function configure(): void {
  setSmtpConfig({ preset: "seznam", address: "owner@seznam.cz", password: PASSWORD });
  setSmtpHostLookupForTests(PUBLIC_LOOKUP);
}

function stub(script: SmtpOutcome[]): Array<{ opts: SmtpSendOptions; msg: SmtpMessage }> {
  const calls: Array<{ opts: SmtpSendOptions; msg: SmtpMessage }> = [];
  setSmtpSendForTests(async (opts, msg) => {
    calls.push({ opts, msg });
    return script[Math.min(calls.length - 1, script.length - 1)];
  });
  return calls;
}

async function captureConsole<T>(fn: () => Promise<T>): Promise<{ value: T; out: string }> {
  const out: string[] = [];
  const saved = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = (...a: unknown[]) => void out.push(a.map(String).join(" "));
  try {
    return { value: await fn(), out: out.join("\n") };
  } finally {
    Object.assign(console, saved);
  }
}

const MSG = { to: "jana@example.cz", subject: "Your interview", body: "Dear Jana,\nsee you Tuesday.", kind: "interview_invite" };

test("SMTP unset: exactly today's behaviour, a queued local outbox row", async () => {
  const row = await sendComm(MSG);
  assert.equal(row.status, "queued");
  assert.equal(row.channel, "outbox");
});

test("sent only on 250: the row is `sent` over channel smtp, the attempt keeps the reply", async () => {
  configure();
  const calls = stub([{ ok: true, code: 250, text: "2.0.0 Ok: queued as X1" }]);
  const row = await sendComm(MSG);
  assert.equal(row.status, "sent");
  assert.equal(row.channel, "smtp");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.host, "smtp.seznam.cz");
  assert.equal(calls[0].opts.security, "tls");
  assert.equal(calls[0].opts.dialAddress, "93.184.216.34", "the vetted address is pinned");
  assert.equal(calls[0].msg.from, "owner@seznam.cz");
  assert.equal(calls[0].msg.to, "jana@example.cz");
  assert.equal(calls[0].msg.messageId, row.messageId);
  const last = getSmtpConfig().attempts[0];
  assert.deepEqual([last.outcome, last.code, last.text], ["sent", 250, "2.0.0 Ok: queued as X1"]);
});

test("a 4xx is retried; the retry that gets 250 is sent", async () => {
  configure();
  const calls = stub([
    { ok: false, stage: "rcpt", code: 451, text: "4.7.1 Greylisted", permanent: false },
    { ok: true, code: 250, text: "Ok" },
  ]);
  const row = await sendComm(MSG);
  assert.equal(calls.length, 2);
  assert.equal(row.status, "sent");
  assert.deepEqual(getSmtpConfig().attempts.slice(0, 2).map((a) => a.outcome), ["sent", "retry"]);
});

test("a 4xx that never clears is failed after the retry budget, with the code on the row", async () => {
  configure();
  const calls = stub([{ ok: false, stage: "mail", code: 421, text: "4.3.2 Try again later", permanent: false }]);
  const row = await sendComm(MSG);
  assert.equal(calls.length, 3);
  assert.equal(row.status, "failed");
  assert.match(row.failureDetail ?? "", /^smtp 421 at mail: 4\.3\.2/);
});

test("a permanent RCPT rejection is failed, suppresses the address, and the next letter is refused by name", async () => {
  configure();
  unsuppressSmtpAddress("jana@example.cz");
  const calls = stub([{ ok: false, stage: "rcpt", code: 550, text: "5.1.1 User unknown", permanent: true }]);
  const row = await sendComm(MSG);
  assert.equal(calls.length, 1, "a 5xx is not retried");
  assert.equal(row.status, "failed");
  assert.match(row.failureDetail ?? "", /^bounced: smtp 550 at rcpt: 5\.1\.1 User unknown; jana@example\.cz is now on the suppression list$/);
  assert.equal(getSmtpConfig().suppressed[0].address, "jana@example.cz");
  const again = await sendComm({ ...MSG, to: "Jana@Example.cz" });
  assert.equal(calls.length, 1, "no connection for a suppressed address");
  assert.equal(again.status, "failed");
  assert.match(again.failureDetail ?? "", /^refused: suppressed/);
  unsuppressSmtpAddress("jana@example.cz");
});

test("an AUTH 535 is failed but does not suppress the candidate", async () => {
  configure();
  stub([{ ok: false, stage: "auth", code: 535, text: "5.7.8 Authentication failed", permanent: true }]);
  const row = await sendComm({ ...MSG, to: "petr@example.cz" });
  assert.equal(row.status, "failed");
  assert.equal(getSmtpConfig().suppressed.some((s) => s.address === "petr@example.cz"), false);
});

test("no address on record is refused before any connection", async () => {
  configure();
  const calls = stub([{ ok: true, code: 250, text: "Ok" }]);
  const row = await sendComm({ ...MSG, to: "Jana Novak" });
  assert.equal(calls.length, 0);
  assert.equal(row.status, "failed");
  assert.match(row.failureDetail ?? "", /^refused: no_address/);
});

test("a host that resolves privately is refused, nothing dialled", async () => {
  configure();
  setSmtpHostLookupForTests(async () => [{ address: "10.0.0.5" }]);
  const calls = stub([{ ok: true, code: 250, text: "Ok" }]);
  const row = await sendComm(MSG);
  assert.equal(calls.length, 0);
  assert.equal(row.status, "failed");
  assert.match(row.failureDetail ?? "", /non-public address/);
});

test("the password is on no row, in no attempt and in no log, even when a server echoes it", async () => {
  configure();
  // A client that does NOT redact, behind a server that echoes the secret back: the
  // channel must still keep it off the row, the attempt list and the log.
  setSmtpSendForTests(async (opts) => ({ ok: false, stage: "auth", code: 535, text: `rejected ${opts.password} ${Buffer.from(opts.password ?? "").toString("base64")}`, permanent: true }));
  const { value: row, out } = await captureConsole(() => sendComm({ ...MSG, to: "eva@example.cz" }));
  assert.equal(row.status, "failed");
  assert.equal((row.failureDetail ?? "").includes(PASSWORD), false);
  assert.equal(out.includes(PASSWORD), false);
  assert.equal(JSON.stringify(getSmtpConfig()).includes(PASSWORD), false);
});

test("the relay keeps precedence: with both configured, nothing goes over SMTP", async () => {
  configure();
  const calls = stub([{ ok: true, code: 250, text: "Ok" }]);
  process.env.COMMS_WEBHOOK_URL = "https://relay.example.test/hook";
  const row = await sendComm(MSG);
  assert.equal(calls.length, 0);
  assert.equal(row.channel, "webhook");
});

test("end to end on a fake server: the List-Unsubscribe headers reach the wire", async () => {
  configure();
  let data = "";
  const server = net.createServer((sock) => {
    let buf = "";
    let inData = false;
    sock.write("220 fake ESMTP\r\n");
    sock.on("data", (c) => {
      buf += c.toString();
      for (;;) {
        if (inData) {
          const end = buf.indexOf("\r\n.\r\n");
          if (end === -1) return;
          data = buf.slice(0, end);
          buf = buf.slice(end + 5);
          inData = false;
          sock.write("250 2.0.0 Ok: queued\r\n");
          continue;
        }
        const i = buf.indexOf("\r\n");
        if (i === -1) return;
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (line.startsWith("DATA")) {
          inData = true;
          sock.write("354 go\r\n");
        } else if (line.startsWith("QUIT")) {
          sock.end("221 bye\r\n");
        } else {
          sock.write("250 ok\r\n");
        }
      }
    });
    sock.on("error", () => {
      /* the client closing is fine */
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as net.AddressInfo).port;
  // The fake has no TLS, so this one test dials it plainly WITHOUT credentials; the
  // composition and the channel are the real ones.
  setSmtpSendForTests((opts, msg) => sendSmtp({ ...opts, host: "127.0.0.1", dialAddress: undefined, port, security: "none", username: null, password: null, timeoutMs: 2_000 }, msg));
  try {
    const row = await sendComm({ ...MSG, to: "olga@example.cz", unsubscribeUrl: "https://kp.example.test/api/stop/ob-123" });
    assert.equal(row.status, "sent");
    assert.match(data, /\r\nList-Unsubscribe: <https:\/\/kp\.example\.test\/api\/stop\/ob-123>\r\n/);
    assert.match(data, /\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n/);
    assert.match(data, new RegExp(`\\r\\nMessage-ID: <${row.messageId}@seznam\\.cz>\\r\\n`));
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
