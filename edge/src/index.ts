/**
 * KP edge — a store-and-forward answering machine for a local-first install.
 *
 * WHAT THIS IS FOR. KP runs on a machine you own, and that machine is off most of
 * the day. Three things cannot wait for it to be switched on: a webhook from a job
 * board (the sender retries a few times, then gives up), a candidate email, and a
 * delivery receipt for a message that bounced. This Worker accepts those on your
 * behalf, holds them in order, and hands them to your install the next time it wakes.
 *
 * WHAT THIS IS NOT. It holds no truth and no secrets:
 *   · no database of candidates — an append-only log that is emptied as it drains;
 *   · no provider keys, no calendar tokens, no session secrets — ONE shared HMAC
 *     key, whose entire power is "may talk to this queue";
 *   · no ability to read what it stores, once your install has published a sealing
 *     key: bodies are sealed with AES-256-GCM under a key wrapped to your public
 *     RSA key, and the private half never leaves your machine.
 *
 * Deploy it to YOUR OWN Cloudflare account (see ../README.md). It fits the free
 * plan; nothing here is billed by KP, and KP cannot see it.
 *
 * The mirror image of this protocol lives in app/_lib/edge-drain.ts and
 * app/_lib/edge-crypto.ts. A change to either side is a change to both.
 */

export interface Env {
  DB: D1Database;
  /** Shared HMAC secret; the same value your install holds as KP_EDGE_SECRET.
   *  Set with `wrangler secret put KP_EDGE_SECRET`. */
  KP_EDGE_SECRET: string;
  /** Public JWK your install published (POST /pair). Kept in D1, not here — this
   *  binding exists only so a fully static deployment can pin it if it prefers. */
  KP_PUBLIC_JWK?: string;
  /** Minutes of silence from the install before a nudge may be sent. Default 60. */
  KP_NUDGE_AFTER_MIN?: string;
}

const SKEW_MS = 5 * 60_000;
const MAX_BODY_BYTES = 128 * 1024;
/** A mail event stores HEADERS ONLY (see email() below), so this is generous. */
const MAX_SUBJECT = 300;

// ---- signing (mirror of app/_lib/edge-crypto.ts) ----------------------------

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time compare — a byte-by-byte early return leaks the signature. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Verify a signed call from the install. `signed` is the request BODY for a POST
 *  and the PATH+QUERY for a GET — see edge-drain.ts, which signs exactly that. */
async function verify(req: Request, env: Env, signed: string): Promise<boolean> {
  const ts = req.headers.get("x-kp-timestamp");
  const sig = req.headers.get("x-kp-signature");
  if (!ts || !sig) return false;
  const at = Number(ts);
  if (!Number.isFinite(at) || Math.abs(Date.now() - at) > SKEW_MS) return false;
  return safeEqual(await hmacHex(env.KP_EDGE_SECRET, `${ts}.${signed}`), sig);
}

// ---- sealing (mirror of app/_lib/edge-crypto.ts sealBody) -------------------

function b64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

/** Seal a body to the install's public key. Returns null when no key is published
 *  yet — the caller then stores cleartext, and the install's Channels tab says so
 *  rather than implying a protection that is not there. */
async function seal(publicJwk: string | null, plaintext: string): Promise<string | null> {
  if (!publicJwk) return null;
  const pub = await crypto.subtle.importKey(
    "jwk",
    JSON.parse(publicJwk) as JsonWebKey,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );
  const aes = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, new TextEncoder().encode(plaintext));
  const raw = await crypto.subtle.exportKey("raw", aes);
  const wrapped = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, pub, raw);
  return JSON.stringify({ v: 1, key: b64(wrapped), iv: b64(iv.buffer), data: b64(data) });
}

// ---- storage ----------------------------------------------------------------

async function meta(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT value FROM meta WHERE key = ?`).bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

async function setMeta(env: Env, key: string, value: string | null): Promise<void> {
  await env.DB.prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .bind(key, value)
    .run();
}

/** Append one event. `body` is sealed when a public key is published; the sealed and
 *  cleartext columns are mutually exclusive so the install can tell which it got. */
async function append(env: Env, kind: string, token: string | null, payload: unknown): Promise<void> {
  const plaintext = JSON.stringify(payload ?? null);
  const sealed = await seal(await meta(env, "public_jwk"), plaintext);
  await env.DB.prepare(
    `INSERT INTO events (kind, token, body, sealed, received_at) VALUES (?, ?, ?, ?, ?)`
  )
    .bind(kind, token, sealed ? null : plaintext, sealed, new Date().toISOString())
    .run();
}

// ---- HTTP -------------------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function handleInbound(req: Request, env: Env, token: string): Promise<Response> {
  // NOT signed: this is the PUBLIC face, and its auth is the receiver token itself —
  // the same CSPRNG capability the direct receiver uses (channel_webhooks doctrine).
  // The edge does not know which tokens are valid (that is install state), so it
  // accepts and lets the install refuse: a bogus token costs one queued row, which
  // the drain discards as "unknown webhook" without filing anything.
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "Payload too large." }, 413);
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }
  await append(env, "lead", token, payload);
  // 202, not 200: "held", never "accepted". The eligibility decision belongs to the
  // install and has not happened yet, and an integrator's log must not read as if a
  // candidate was filed. This is the wire form of the held-at-edge state.
  return json({ result: "held", deferred: true }, 202);
}

async function handleReceipt(req: Request, env: Env): Promise<Response> {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "Payload too large." }, 413);
  try {
    await append(env, "receipt", null, JSON.parse(raw));
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }
  return json({ recorded: false, held: true }, 202);
}

async function handleDrain(req: Request, env: Env, url: URL): Promise<Response> {
  const signed = `${url.pathname}${url.search}`;
  if (!(await verify(req, env, signed))) return json({ error: "Unauthorized." }, 401);
  const since = Number(url.searchParams.get("since") ?? 0) || 0;
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200);
  const { results } = await env.DB.prepare(
    `SELECT seq, kind, token, body, sealed, received_at FROM events WHERE seq > ? ORDER BY seq ASC LIMIT ?`
  )
    .bind(since, limit)
    .all<{ seq: number; kind: string; token: string | null; body: string | null; sealed: string | null; received_at: string }>();
  const pending = await env.DB.prepare(`SELECT COUNT(*) AS n FROM events WHERE seq > ?`).bind(since).first<{ n: number }>();
  // The install is awake and talking to us, so the nudge clock resets here as well
  // as on the heartbeat — a drain IS presence.
  await setMeta(env, "last_seen_at", new Date().toISOString());
  return json({
    events: (results ?? []).map((r) => ({
      seq: r.seq,
      kind: r.kind,
      token: r.token,
      body: r.body ? (JSON.parse(r.body) as unknown) : undefined,
      sealed: r.sealed ? (JSON.parse(r.sealed) as unknown) : undefined,
      receivedAt: r.received_at,
    })),
    pending: pending?.n ?? 0,
  });
}

async function handleAck(req: Request, env: Env): Promise<Response> {
  const raw = await req.text();
  if (!(await verify(req, env, raw))) return json({ error: "Unauthorized." }, 401);
  const { upto } = JSON.parse(raw) as { upto?: number };
  if (typeof upto !== "number") return json({ error: "upto is required." }, 400);
  // DELETE, not a flag: an acked event has been applied to the real database on the
  // install, and keeping candidate data here after that would make this a shadow
  // copy of the pipeline — exactly what "the edge holds no truth" forbids.
  await env.DB.prepare(`DELETE FROM events WHERE seq <= ?`).bind(upto).run();
  await setMeta(env, "last_seen_at", new Date().toISOString());
  return json({ ok: true, acked: upto });
}

async function handleHeartbeat(req: Request, env: Env): Promise<Response> {
  const raw = await req.text();
  if (!(await verify(req, env, raw))) return json({ error: "Unauthorized." }, 401);
  const beat = JSON.parse(raw) as { at?: string; nudgeTarget?: string | null };
  await setMeta(env, "last_seen_at", new Date().toISOString());
  // The install owns its nudge target; re-published every beat so changing it there
  // is enough. Clearing it (null) turns nudges off.
  if ("nudgeTarget" in beat) await setMeta(env, "nudge_target", beat.nudgeTarget ?? null);
  // A beat means somebody is draining, so the "you have mail" state is stale.
  await setMeta(env, "nudged_at", null);
  return json({ ok: true, at: beat.at ?? null });
}

async function handlePair(req: Request, env: Env): Promise<Response> {
  const raw = await req.text();
  if (!(await verify(req, env, raw))) return json({ error: "Unauthorized." }, 401);
  const { publicJwk } = JSON.parse(raw) as { publicJwk?: string };
  if (!publicJwk) return json({ error: "publicJwk is required." }, 400);
  // Publishing a key seals everything from here on. Events already stored in
  // cleartext stay cleartext — re-sealing them would be theatre (they have already
  // been at rest unsealed) and the install can read both forms.
  await setMeta(env, "public_jwk", publicJwk);
  return json({ ok: true, sealed: true });
}

/** The public projection of which tokens the install serves is NOT published here
 *  (that is L2). Until then this endpoint exists purely so an operator can confirm
 *  the Worker is alive and how much is waiting — no candidate data in the answer. */
async function handleStatus(env: Env): Promise<Response> {
  const pending = await env.DB.prepare(`SELECT COUNT(*) AS n FROM events`).first<{ n: number }>();
  return json({
    ok: true,
    pending: pending?.n ?? 0,
    lastSeenAt: await meta(env, "last_seen_at"),
    sealed: Boolean(await meta(env, "public_jwk")),
  });
}

// Named rather than an anonymous object literal: wrangler only cares about the
// default export's shape, and a name is what a stack trace prints.
const worker = {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    if (req.method === "POST" && path.startsWith("/in/")) return handleInbound(req, env, path.slice(4));
    if (req.method === "POST" && path === "/relay/callback") return handleReceipt(req, env);
    if (req.method === "GET" && path === "/drain") return handleDrain(req, env, url);
    if (req.method === "POST" && path === "/ack") return handleAck(req, env);
    if (req.method === "POST" && path === "/heartbeat") return handleHeartbeat(req, env);
    if (req.method === "POST" && path === "/pair") return handlePair(req, env);
    if (req.method === "GET" && path === "/status") return handleStatus(env);
    return json({ error: "Not found." }, 404);
  },

  /**
   * Inbound mail (Cloudflare Email Routing → this Worker).
   *
   * HEADERS ONLY, deliberately. The sender and the subject are enough to file a
   * reachable lead, and they are all this Worker keeps: the message body and its
   * attachments are never written to storage, so a dump of the edge yields no CVs.
   * The cost is stated where it is felt (edge-drain.ts): an emailed CV arrives as a
   * lead with a subject line, and the acknowledgement's enrichment link is what
   * turns it into a candidate.
   *
   * Route `<receiver-token>@your-domain` to this Worker and the local part becomes
   * the receiver token, so one mailbox pattern serves every role.
   */
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const to = message.to ?? "";
    const token = to.split("@")[0] ?? "";
    const subject = (message.headers.get("subject") ?? "").slice(0, MAX_SUBJECT);
    // "Name <addr@host>" → the two halves, without pulling in a MIME parser.
    const rawFrom = message.headers.get("from") ?? message.from ?? "";
    const angled = /<([^>]+)>/.exec(rawFrom);
    const from = (angled ? angled[1] : rawFrom).trim();
    const name = angled ? rawFrom.slice(0, angled.index).replace(/["']/g, "").trim() : "";
    await append(env, "mail", token, { from, name, subject });
  },

  /**
   * The nudge (cron). This is the answer to "how do I know my studio needs to run?"
   * and it lives HERE for one reason: the machine that is switched off cannot be the
   * machine that notices it is switched off.
   *
   * One nudge per quiet period, never a stream — `nudged_at` is cleared by the next
   * heartbeat, so the next nudge can only follow a period of the install actually
   * being awake. The payload carries COUNTS, never names: "3 events waiting" tells
   * you everything you need in order to act, and tells an interceptor nothing about
   * who applied.
   */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const target = await meta(env, "nudge_target");
    if (!target) return;
    const pending = await env.DB.prepare(`SELECT COUNT(*) AS n FROM events`).first<{ n: number }>();
    if (!pending?.n) return;
    if (await meta(env, "nudged_at")) return; // already told them; wait for a beat
    const lastSeen = await meta(env, "last_seen_at");
    const quietMin = Number(env.KP_NUDGE_AFTER_MIN ?? "60") || 60;
    if (lastSeen && Date.now() - Date.parse(lastSeen) < quietMin * 60_000) return;
    // ntfy.sh (or any endpoint that accepts a POST body) — free, self-hostable, and
    // no account needed on either side.
    await fetch(target, {
      method: "POST",
      headers: { title: "KP has mail", tags: "inbox_tray" },
      body: `${pending.n} inbound event${pending.n === 1 ? "" : "s"} waiting. Start your KP studio to file them.`,
    }).catch(() => {});
    await setMeta(env, "nudged_at", new Date().toISOString());
  },
};

export default worker;
