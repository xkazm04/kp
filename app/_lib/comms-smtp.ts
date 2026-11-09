import net from "node:net";
import tls from "node:tls";
import { randomUUID } from "node:crypto";

// T6 — a minimal SMTP submission client on node:net + node:tls, no dependency. It does
// exactly what a mailbox provider's submission port needs and nothing more:
//
//   • implicit TLS (port 465) or STARTTLS (port 587). AUTH is NEVER sent over a plain
//     connection: a `starttls` server that does not offer STARTTLS is refused before any
//     credential leaves the process, and so is a `none` connection that was given one.
//     `none` exists only for a credential-less local MTA and for the unit tests' fake
//     server; the config store does not offer it (comms-smtp-store.ts).
//   • EHLO, AUTH PLAIN or AUTH LOGIN (whichever the server advertises, PLAIN first),
//     MAIL FROM / RCPT TO / DATA with dot-stuffing, QUIT.
//   • a timeout on EVERY step (connect, each reply), so a server that accepts the
//     connection and goes quiet cannot hold a send open.
//
// THE HONESTY RULE. `ok: true` means exactly one thing: the server answered 250 after the
// end-of-data dot. Anything else is a failure with the stage it died at, the reply code
// (null when there was no reply: a timeout, a refused connection) and whether it is
// permanent (5xx) or worth a retry (4xx, network). The caller (comms.ts SmtpChannel) maps
// that onto the outbox vocabulary; this module never decides what a status word is.
//
// THE PASSWORD RULE. The password is used to build one AUTH line and is never part of any
// returned text: every reply text and error message passes through `redactSecrets`, which
// strips the password and the base64 forms it travelled in, in case a server echoes them.

export type SmtpSecurity = "tls" | "starttls" | "none";

export type SmtpStage = "connect" | "greeting" | "ehlo" | "starttls" | "auth" | "mail" | "rcpt" | "data" | "quit";

export type SmtpOutcome =
  | { ok: true; code: number; text: string }
  | { ok: false; stage: SmtpStage; code: number | null; text: string; permanent: boolean };

export type SmtpMessage = {
  from: string;
  /** Display name for the From header. Optional. */
  fromName?: string | null;
  to: string;
  subject: string;
  body: string;
  /** The delivery identity (comms-envelope.ts `messageId`); becomes the Message-ID local part. */
  messageId: string;
  date?: Date;
  /** Pre-formatted exactly as the header value (comms-envelope.ts computes both). */
  listUnsubscribe?: string | null;
  listUnsubscribePost?: string | null;
};

export type SmtpSendOptions = {
  host: string;
  port: number;
  security: SmtpSecurity;
  username?: string | null;
  password?: string | null;
  /** Per-step timeout in ms. */
  timeoutMs?: number;
  /** The name this client says in EHLO. */
  clientName?: string;
  /** The address to DIAL, already resolved and vetted by the caller; `host` stays the TLS
   *  server name. Omitted, `host` is dialled directly. */
  dialAddress?: string;
  /** Test seam: extra options for the TLS layer (a fake server's self-signed cert). */
  tlsOptions?: tls.ConnectionOptions;
};

export const SMTP_STEP_TIMEOUT_MS = 10_000;

const CRLF = "\r\n";

/** A reply: the 3-digit code and every line's text joined with a space. */
type Reply = { code: number; text: string; lines: string[] };

class StepError extends Error {
  constructor(
    readonly stage: SmtpStage,
    readonly code: number | null,
    message: string,
    readonly permanent: boolean
  ) {
    super(message);
    this.name = "StepError";
  }
}

// ---- message composition ------------------------------------------------------------

const ADDRESS_SHAPE = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[^\s@<>()",;:\\[\]]+$/;

/** A bare address safe to put in a header and in MAIL FROM / RCPT TO. No CR/LF, no angle
 *  brackets, one `@` and a dotted domain. Not RFC 5321 validation: it refuses every value
 *  that could inject a header or a command, which is the property that matters here. */
export function isSmtpAddress(value: string): boolean {
  return ADDRESS_SHAPE.test(value);
}

/** A header value with every CR/LF folded to a space: a subject or name can never start a
 *  new header line. */
function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** RFC 2047 encoded-word(s) for a non-ASCII header value, ASCII passes through. Each word
 *  stays within 75 characters and never splits a multi-byte character. */
export function encodeHeaderWord(value: string): string {
  const clean = headerSafe(value);
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  const words: string[] = [];
  let chunk = "";
  for (const ch of clean) {
    // 45 raw bytes -> 60 base64 chars, + "=?UTF-8?B?" and "?=" = 72.
    if (Buffer.byteLength(chunk + ch, "utf-8") > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, "utf-8").toString("base64")}?=`).join(`${CRLF} `);
}

/** RFC 5322 date, e.g. `Wed, 22 Oct 2026 10:00:00 +0000`. */
export function rfc5322Date(d: Date): string {
  return d.toUTCString().replace(/GMT$/, "+0000");
}

/** `<local@domain>` from the delivery identity and the sender's domain. */
export function messageIdHeader(messageId: string, from: string): string {
  const local = messageId.replace(/[^A-Za-z0-9._-]/g, "") || randomUUID();
  const domain = from.split("@")[1]?.replace(/[^A-Za-z0-9.-]/g, "") || "localhost";
  return `<${local}@${domain}>`;
}

function base64Lines(text: string): string {
  const b64 = Buffer.from(text.replace(/\r?\n/g, CRLF), "utf-8").toString("base64");
  return (b64.match(/.{1,76}/g) ?? [""]).join(CRLF);
}

/** The full RFC 5322 message, CRLF line endings, NOT yet dot-stuffed. Throws on an
 *  address that is not header-safe. */
export function buildSmtpMessage(msg: SmtpMessage): string {
  if (!isSmtpAddress(msg.from)) throw new Error("the sender address is not a valid email address");
  if (!isSmtpAddress(msg.to)) throw new Error("the recipient address is not a valid email address");
  const name = msg.fromName ? headerSafe(msg.fromName).replace(/"/g, "") : "";
  const from = name ? `${encodeHeaderWord(name)} <${msg.from}>` : msg.from;
  const headers = [
    `From: ${from}`,
    `To: ${msg.to}`,
    `Subject: ${encodeHeaderWord(msg.subject)}`,
    `Date: ${rfc5322Date(msg.date ?? new Date())}`,
    `Message-ID: ${messageIdHeader(msg.messageId, msg.from)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  const unsubscribe = headerSafe(msg.listUnsubscribe ?? "");
  if (unsubscribe) {
    headers.push(`List-Unsubscribe: ${unsubscribe}`);
    const post = headerSafe(msg.listUnsubscribePost ?? "");
    if (post) headers.push(`List-Unsubscribe-Post: ${post}`);
  }
  return `${headers.join(CRLF)}${CRLF}${CRLF}${base64Lines(msg.body)}${CRLF}`;
}

/** RFC 5321 §4.5.2: a line that begins with "." gets one more. The message must already
 *  use CRLF line endings. */
export function dotStuff(message: string): string {
  return message
    .split(CRLF)
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join(CRLF);
}

// ---- redaction ----------------------------------------------------------------------

/** Remove every given secret, and the base64 forms it would have travelled in on the
 *  wire, from a text. Empty secrets are ignored. */
export function redactSecrets(text: string, secrets: ReadonlyArray<string | null | undefined>): string {
  let out = text;
  for (const s of secrets) {
    if (!s) continue;
    for (const form of [s, Buffer.from(s, "utf-8").toString("base64")]) {
      if (form) out = out.split(form).join("[redacted]");
    }
  }
  return out;
}

function plainToken(username: string, password: string): string {
  return Buffer.from(`\u0000${username}\u0000${password}`, "utf-8").toString("base64");
}

// ---- the connection -----------------------------------------------------------------

class Conn {
  private socket: net.Socket;
  private buf = "";
  private lines: string[] = [];
  private replies: Reply[] = [];
  private waiter: ((r: Reply | Error) => void) | null = null;
  private closedWith: Error | null = null;
  private readonly onData = (d: Buffer) => this.feed(d.toString("utf-8"));
  private readonly onError = (e: Error) => this.fail(e);
  private readonly onClose = () => this.fail(new Error("the server closed the connection"));

  constructor(socket: net.Socket) {
    this.socket = socket;
    this.attach();
  }

  private attach(): void {
    this.socket.on("data", this.onData);
    this.socket.on("error", this.onError);
    this.socket.on("close", this.onClose);
  }

  private detach(): void {
    this.socket.off("data", this.onData);
    this.socket.off("error", this.onError);
    this.socket.off("close", this.onClose);
  }

  private feed(chunk: string): void {
    this.buf += chunk;
    let i: number;
    while ((i = this.buf.indexOf("\n")) !== -1) {
      const line = this.buf.slice(0, i).replace(/\r$/, "");
      this.buf = this.buf.slice(i + 1);
      const m = /^(\d{3})([ -]?)(.*)$/.exec(line);
      if (!m) continue;
      this.lines.push(m[3]);
      if (m[2] !== "-") {
        const reply = { code: Number(m[1]), text: this.lines.join(" ").trim(), lines: this.lines };
        this.lines = [];
        if (this.waiter) {
          const w = this.waiter;
          this.waiter = null;
          w(reply);
        } else {
          this.replies.push(reply);
        }
      }
    }
  }

  private fail(e: Error): void {
    if (!this.closedWith) this.closedWith = e;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(e);
    }
  }

  read(stage: SmtpStage, timeoutMs: number): Promise<Reply> {
    const queued = this.replies.shift();
    if (queued) return Promise.resolve(queued);
    if (this.closedWith) return Promise.reject(new StepError(stage, null, this.closedWith.message, false));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new StepError(stage, null, `no answer within ${timeoutMs}ms`, false));
      }, timeoutMs);
      this.waiter = (r) => {
        clearTimeout(timer);
        if (r instanceof Error) reject(new StepError(stage, null, r.message, false));
        else resolve(r);
      };
    });
  }

  write(line: string): void {
    this.socket.write(line);
  }

  /** Expect a reply in the given class (2 or 3); otherwise throw a StepError. */
  async expect(stage: SmtpStage, timeoutMs: number, ok: (code: number) => boolean): Promise<Reply> {
    const r = await this.read(stage, timeoutMs);
    if (!ok(r.code)) throw new StepError(stage, r.code, r.text, r.code >= 500);
    return r;
  }

  async command(stage: SmtpStage, line: string, timeoutMs: number, ok: (code: number) => boolean = is2xx): Promise<Reply> {
    this.write(`${line}${CRLF}`);
    return this.expect(stage, timeoutMs, ok);
  }

  /** Upgrade the live socket to TLS (STARTTLS). */
  async upgrade(host: string, timeoutMs: number, extra: tls.ConnectionOptions | undefined): Promise<void> {
    this.detach();
    if (this.buf || this.replies.length) throw new StepError("starttls", null, "the server sent data before the TLS handshake", false);
    const plain = this.socket;
    const secure = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const s = tls.connect({ socket: plain, servername: net.isIP(host) ? undefined : host, ...extra });
      const timer = setTimeout(() => {
        s.destroy();
        reject(new StepError("starttls", null, `TLS handshake did not finish within ${timeoutMs}ms`, false));
      }, timeoutMs);
      s.once("secureConnect", () => {
        clearTimeout(timer);
        resolve(s);
      });
      s.once("error", (e) => {
        clearTimeout(timer);
        reject(new StepError("starttls", null, e.message, false));
      });
    });
    this.socket = secure;
    this.attach();
  }

  get encrypted(): boolean {
    return this.socket instanceof tls.TLSSocket && this.socket.encrypted === true;
  }

  close(): void {
    this.detach();
    this.socket.on("error", () => {
      /* closing: a reset after QUIT is not news */
    });
    this.socket.destroy();
  }
}

const is2xx = (c: number) => c >= 200 && c < 300;
const is3xx = (c: number) => c >= 300 && c < 400;

function openSocket(opts: SmtpSendOptions, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const tlsNow = opts.security === "tls";
    const dial = opts.dialAddress || opts.host;
    const socket: net.Socket = tlsNow
      ? tls.connect({ host: dial, port: opts.port, servername: net.isIP(opts.host) ? undefined : opts.host, ...opts.tlsOptions })
      : net.connect({ host: dial, port: opts.port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new StepError("connect", null, `could not connect within ${timeoutMs}ms`, false));
    }, timeoutMs);
    socket.once(tlsNow ? "secureConnect" : "connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (e) => {
      clearTimeout(timer);
      reject(new StepError("connect", null, e.message, false));
    });
  });
}

/** The EHLO keywords, upper-cased (first line is the greeting, not a keyword). */
function extensions(r: Reply): Set<string> {
  return new Set(r.lines.slice(1).map((l) => l.trim().toUpperCase()));
}

function authMechanisms(ext: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const e of ext) {
    const m = /^AUTH[ =](.*)$/.exec(e);
    if (m) for (const mech of m[1].split(/\s+/)) if (mech) out.add(mech);
  }
  return out;
}

/**
 * Submit one message. Never throws: every outcome, including a refused connection, is a
 * returned SmtpOutcome. The password appears in no returned text.
 */
export async function sendSmtp(opts: SmtpSendOptions, msg: SmtpMessage): Promise<SmtpOutcome> {
  const secrets = [opts.password];
  const step = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : SMTP_STEP_TIMEOUT_MS;
  const clientName = (opts.clientName ?? "kp.localhost").replace(/[^A-Za-z0-9.-]/g, "") || "kp.localhost";
  let data: string;
  try {
    data = dotStuff(buildSmtpMessage(msg));
  } catch (e) {
    return { ok: false, stage: "mail", code: null, text: e instanceof Error ? e.message : "the message could not be built", permanent: true };
  }
  let conn: Conn | null = null;
  try {
    conn = new Conn(await openSocket(opts, step));
    await conn.expect("greeting", step, is2xx);
    let ehlo = await conn.command("ehlo", `EHLO ${clientName}`, step);
    if (opts.security === "starttls") {
      if (!extensions(ehlo).has("STARTTLS")) {
        throw new StepError("starttls", null, "the server does not offer STARTTLS, so nothing was sent (credentials are never sent over a plain connection)", true);
      }
      await conn.command("starttls", "STARTTLS", step);
      await conn.upgrade(opts.host, step, opts.tlsOptions);
      ehlo = await conn.command("ehlo", `EHLO ${clientName}`, step);
    }
    const username = opts.username ?? "";
    const password = opts.password ?? "";
    if (username || password) {
      // The rule that makes STARTTLS worth having: no TLS, no AUTH.
      if (!conn.encrypted) {
        throw new StepError("auth", null, "refused to send credentials over a plain connection", true);
      }
      const mechs = authMechanisms(extensions(ehlo));
      if (mechs.has("PLAIN")) {
        await conn.command("auth", `AUTH PLAIN ${plainToken(username, password)}`, step);
      } else if (mechs.has("LOGIN")) {
        await conn.command("auth", "AUTH LOGIN", step, is3xx);
        await conn.command("auth", Buffer.from(username, "utf-8").toString("base64"), step, is3xx);
        await conn.command("auth", Buffer.from(password, "utf-8").toString("base64"), step);
      } else {
        throw new StepError("auth", null, "the server offers neither AUTH PLAIN nor AUTH LOGIN", true);
      }
    }
    await conn.command("mail", `MAIL FROM:<${msg.from}>`, step);
    await conn.command("rcpt", `RCPT TO:<${msg.to}>`, step);
    await conn.command("data", "DATA", step, is3xx);
    conn.write(`${data}.${CRLF}`);
    const accepted = await conn.expect("data", step, (c) => c === 250);
    try {
      await conn.command("quit", "QUIT", Math.min(step, 2_000), () => true);
    } catch {
      /* the message is already accepted; a server that drops instead of answering QUIT changes nothing */
    }
    return { ok: true, code: accepted.code, text: clip(redactSecrets(accepted.text, secrets)) };
  } catch (e) {
    if (e instanceof StepError) {
      return { ok: false, stage: e.stage, code: e.code, text: clip(redactSecrets(e.message, secrets)), permanent: e.permanent };
    }
    return { ok: false, stage: "connect", code: null, text: clip(redactSecrets(e instanceof Error ? e.message : String(e), secrets)), permanent: false };
  } finally {
    conn?.close();
  }
}

function clip(text: string): string {
  const one = text.replace(/[\r\n]+/g, " ").trim();
  return one.length > 240 ? `${one.slice(0, 239)}…` : one;
}

/** The one-line, operator-facing description of an outcome: `smtp 550 at rcpt: <text>`.
 *  Contains no password (the outcome text is already redacted). */
export function describeSmtpOutcome(o: SmtpOutcome): string {
  if (o.ok) return `smtp ${o.code}: ${o.text}`;
  return `smtp ${o.code ?? "no reply"} at ${o.stage}: ${o.text}`;
}

/** Whether a failure is the RECIPIENT's address being permanently refused: a 5xx at RCPT
 *  or at DATA. This is what puts an address on the suppression list. A 5xx at AUTH is the
 *  operator's credentials, not the candidate's address. */
export function isPermanentRecipientRejection(o: SmtpOutcome): boolean {
  return !o.ok && o.permanent && o.code !== null && o.code >= 500 && (o.stage === "rcpt" || o.stage === "data");
}
