// The SMTP client against an in-process fake server on node:net. No network: the server
// listens on 127.0.0.1 with an ephemeral port and scripts each reply.
//
// NON-VACUITY: drop the `!conn.encrypted` check in sendSmtp and "credentials are never
// sent over a plain connection" fails (the fake records an AUTH line); drop dotStuff and
// "a body line that starts with a dot is stuffed" fails.
import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import {
  buildSmtpMessage,
  describeSmtpOutcome,
  dotStuff,
  encodeHeaderWord,
  isPermanentRecipientRejection,
  redactSecrets,
  sendSmtp,
  type SmtpMessage,
} from "./comms-smtp.ts";

type Script = {
  ehlo?: string[];
  rcpt?: string;
  data?: string;
  afterData?: string;
  silentAt?: "greeting" | "mail";
};

/** A fake SMTP server. Records every command line and the DATA payload. */
async function fakeServer(script: Script = {}): Promise<{ port: number; lines: string[]; data: () => string; close: () => Promise<void> }> {
  const lines: string[] = [];
  let data = "";
  const server = net.createServer((sock) => {
    let buf = "";
    let inData = false;
    if (script.silentAt !== "greeting") sock.write("220 fake.test ESMTP\r\n");
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf-8");
      if (inData) {
        const end = buf.indexOf("\r\n.\r\n");
        if (end === -1) return;
        data = buf.slice(0, end + 2);
        buf = buf.slice(end + 5);
        inData = false;
        sock.write(`${script.afterData ?? "250 2.0.0 Ok: queued as ABC123"}\r\n`);
      }
      let i: number;
      while (!inData && (i = buf.indexOf("\r\n")) !== -1) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        lines.push(line);
        const verb = line.split(" ")[0].toUpperCase();
        if (verb === "EHLO") {
          const ext = script.ehlo ?? ["SIZE 10240000", "8BITMIME"];
          sock.write(["250-fake.test", ...ext.map((e, k) => (k === ext.length - 1 ? `250 ${e}` : `250-${e}`))].join("\r\n").replace(/^250-fake\.test$/, "250 fake.test") + "\r\n");
        } else if (verb === "MAIL") {
          if (script.silentAt === "mail") continue;
          sock.write("250 2.1.0 Ok\r\n");
        } else if (verb === "RCPT") {
          sock.write(`${script.rcpt ?? "250 2.1.5 Ok"}\r\n`);
        } else if (verb === "DATA") {
          const reply = script.data ?? "354 End data with <CR><LF>.<CR><LF>";
          sock.write(`${reply}\r\n`);
          if (reply.startsWith("354")) {
            inData = true;
            const end = buf.indexOf("\r\n.\r\n");
            if (end !== -1) {
              data = buf.slice(0, end + 2);
              buf = buf.slice(end + 5);
              inData = false;
              sock.write(`${script.afterData ?? "250 2.0.0 Ok: queued as ABC123"}\r\n`);
            }
          }
        } else if (verb === "QUIT") {
          sock.write("221 2.0.0 Bye\r\n");
          sock.end();
        } else if (verb === "AUTH") {
          sock.write("235 2.7.0 Authentication successful\r\n");
        } else {
          sock.write("502 5.5.2 Error: command not recognized\r\n");
        }
      }
    });
    sock.on("error", () => {
      /* the client closing mid-script is fine */
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    lines,
    data: () => data,
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        server.unref();
      }),
  };
}

const MSG: SmtpMessage = {
  from: "owner@example.test",
  to: "jana@example.test",
  subject: "Pohovor: Data Engineer, příští týden",
  body: "Dobrý den,\n.this line starts with a dot\nS pozdravem",
  messageId: "msg_abc123",
  date: new Date("2026-10-22T10:00:00Z"),
  listUnsubscribe: "<https://kp.example.test/api/stop/ob-xyz>",
  listUnsubscribePost: "List-Unsubscribe=One-Click",
};

test("plain path: EHLO, MAIL, RCPT, DATA, QUIT; sent only on 250 after the dot", async () => {
  const srv = await fakeServer();
  try {
    const out = await sendSmtp({ host: "127.0.0.1", port: srv.port, security: "none", timeoutMs: 2_000 }, MSG);
    assert.deepEqual(out, { ok: true, code: 250, text: "2.0.0 Ok: queued as ABC123" });
    const verbs = srv.lines.map((l) => l.split(/[ :]/)[0]);
    assert.deepEqual(verbs, ["EHLO", "MAIL", "RCPT", "DATA", "QUIT"]);
    assert.equal(srv.lines[1], "MAIL FROM:<owner@example.test>");
    assert.equal(srv.lines[2], "RCPT TO:<jana@example.test>");
    const data = srv.data();
    assert.match(data, /^From: owner@example\.test\r\n/);
    assert.match(data, /\r\nSubject: =\?UTF-8\?B\?/);
    assert.match(data, /\r\nDate: Thu, 22 Oct 2026 10:00:00 \+0000\r\n/);
    assert.match(data, /\r\nMessage-ID: <msg_abc123@example\.test>\r\n/);
    assert.match(data, /\r\nList-Unsubscribe: <https:\/\/kp\.example\.test\/api\/stop\/ob-xyz>\r\n/);
    assert.match(data, /\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n/);
    assert.match(data, /\r\nContent-Transfer-Encoding: base64\r\n/);
    // The body decodes back to the letter, CRLF-normalized.
    const b64 = data.split("\r\n\r\n")[1].replace(/\r\n/g, "");
    assert.equal(Buffer.from(b64, "base64").toString("utf-8"), MSG.body.replace(/\n/g, "\r\n"));
  } finally {
    await srv.close();
  }
});

test("credentials are never sent over a plain connection", async () => {
  const srv = await fakeServer({ ehlo: ["AUTH PLAIN LOGIN"] });
  try {
    const out = await sendSmtp(
      { host: "127.0.0.1", port: srv.port, security: "none", username: "owner@example.test", password: "hunter2-app-pass", timeoutMs: 2_000 },
      MSG
    );
    assert.equal(out.ok, false);
    assert.equal(!out.ok && out.stage, "auth");
    assert.ok(!srv.lines.some((l) => l.startsWith("AUTH")), `no AUTH on the wire, saw ${srv.lines.join(" | ")}`);
    assert.ok(!srv.lines.some((l) => l.startsWith("MAIL")), "and no mail either");
  } finally {
    await srv.close();
  }
});

test("STARTTLS refusal: a server that does not offer STARTTLS gets no credentials and no mail", async () => {
  const srv = await fakeServer({ ehlo: ["AUTH PLAIN LOGIN", "8BITMIME"] });
  try {
    const out = await sendSmtp(
      { host: "127.0.0.1", port: srv.port, security: "starttls", username: "owner@example.test", password: "hunter2-app-pass", timeoutMs: 2_000 },
      MSG
    );
    assert.equal(out.ok, false);
    if (out.ok) return;
    assert.equal(out.stage, "starttls");
    assert.match(out.text, /does not offer STARTTLS/);
    assert.deepEqual(srv.lines.map((l) => l.split(" ")[0]), ["EHLO"]);
    assert.ok(!out.text.includes("hunter2"));
  } finally {
    await srv.close();
  }
});

test("a 5xx at RCPT is a permanent recipient rejection; a 4xx is not", async () => {
  const hard = await fakeServer({ rcpt: "550 5.1.1 <jana@example.test>: Recipient address rejected: User unknown" });
  try {
    const out = await sendSmtp({ host: "127.0.0.1", port: hard.port, security: "none", timeoutMs: 2_000 }, MSG);
    assert.equal(out.ok, false);
    assert.equal(!out.ok && out.code, 550);
    assert.equal(!out.ok && out.stage, "rcpt");
    assert.equal(isPermanentRecipientRejection(out), true);
    assert.match(describeSmtpOutcome(out), /^smtp 550 at rcpt: 5\.1\.1/);
  } finally {
    await hard.close();
  }
  const soft = await fakeServer({ rcpt: "451 4.7.1 Greylisted, try again later" });
  try {
    const out = await sendSmtp({ host: "127.0.0.1", port: soft.port, security: "none", timeoutMs: 2_000 }, MSG);
    assert.equal(out.ok, false);
    assert.equal(!out.ok && out.permanent, false);
    assert.equal(isPermanentRecipientRejection(out), false);
  } finally {
    await soft.close();
  }
});

test("a rejection after the dot is a failure, never sent", async () => {
  const srv = await fakeServer({ afterData: "554 5.7.1 Message rejected as spam" });
  try {
    const out = await sendSmtp({ host: "127.0.0.1", port: srv.port, security: "none", timeoutMs: 2_000 }, MSG);
    assert.equal(out.ok, false);
    assert.equal(!out.ok && out.stage, "data");
    assert.equal(isPermanentRecipientRejection(out), true);
  } finally {
    await srv.close();
  }
});

test("every step has a timeout: a silent server is a non-permanent failure, not a hang", async () => {
  const srv = await fakeServer({ silentAt: "mail" });
  try {
    const started = Date.now();
    const out = await sendSmtp({ host: "127.0.0.1", port: srv.port, security: "none", timeoutMs: 300 }, MSG);
    assert.ok(Date.now() - started < 2_000);
    assert.equal(out.ok, false);
    assert.equal(!out.ok && out.stage, "mail");
    assert.equal(!out.ok && out.code, null);
    assert.equal(!out.ok && out.permanent, false);
  } finally {
    await srv.close();
  }
});

test("a refused connection is a returned failure at connect", async () => {
  const srv = await fakeServer();
  const port = srv.port;
  await srv.close();
  const out = await sendSmtp({ host: "127.0.0.1", port, security: "none", timeoutMs: 1_000 }, MSG);
  assert.equal(out.ok, false);
  assert.equal(!out.ok && out.stage, "connect");
});

test("a body line that starts with a dot is stuffed", () => {
  assert.equal(dotStuff("a\r\n.b\r\n..c\r\n"), "a\r\n..b\r\n...c\r\n");
});

test("header injection: CR/LF in a subject cannot start a header; a bad address is refused", () => {
  const out = buildSmtpMessage({ ...MSG, subject: "Hi\r\nBcc: evil@example.test" });
  assert.ok(!/\r\nBcc:/.test(out));
  assert.throws(() => buildSmtpMessage({ ...MSG, to: "jana@example.test\r\nRCPT TO:<x@y.z>" }));
  assert.throws(() => buildSmtpMessage({ ...MSG, to: "Jana Novak" }));
});

test("encoded-words stay within 75 characters and round-trip", () => {
  const long = "Příliš žluťoučký kůň úpěl ďábelské ódy, opakovaně a ještě jednou pro jistotu";
  const enc = encodeHeaderWord(long);
  const words = enc.split("\r\n ");
  for (const w of words) assert.ok(w.length <= 75, w);
  const decoded = words.map((w) => Buffer.from(w.slice(10, -2), "base64").toString("utf-8")).join("");
  assert.equal(decoded, long);
  assert.equal(encodeHeaderWord("Plain subject"), "Plain subject");
});

test("redaction removes the password and its base64 form", () => {
  const pw = "hunter2-app-pass";
  const text = `535 rejected ${pw} and ${Buffer.from(pw).toString("base64")}`;
  const out = redactSecrets(text, [pw, null, ""]);
  assert.ok(!out.includes(pw));
  assert.ok(!out.includes(Buffer.from(pw).toString("base64")));
});
