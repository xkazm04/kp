// The pinned egress transport against a REAL socket. A local http server on 127.0.0.1
// stands in for the receiver; the test-only allowance lets plain http through and moves
// the private/public line so that 127.0.0.1 is "the vetted public answer" and 127.0.0.2
// is "the rebound private one". Everything else — the lookup hook, the one resolution,
// the dial, the redirect and abort handling — is the production code path.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { isPrivateAddress } from "./ats-egress-guard.ts";
import { pinnedRequest } from "./pinned-request.ts";

type Hit = { localAddress: string | undefined; host: string | undefined; method: string | undefined; body: string };
const hits: Hit[] = [];
let connections = 0;
let port = 0;
let answer: { status: number; headers?: Record<string, string> } = { status: 202 };
let holdOpen = false;

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    hits.push({ localAddress: req.socket.localAddress, host: req.headers.host, method: req.method, body });
    if (holdOpen) return; // a receiver that accepts and then goes quiet
    res.writeHead(answer.status, answer.headers);
    res.end("ignored body");
  });
});
server.on("connection", () => connections++);

before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as AddressInfo).port;
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

function reset() {
  hits.length = 0;
  connections = 0;
  answer = { status: 202 };
  holdOpen = false;
}

/** 127.0.0.1 is the one "public" address; every other answer is judged as production does. */
const LOCAL_ONLY_PUBLIC = (ip: string) => ip !== "127.0.0.1" && (ip === "127.0.0.2" || isPrivateAddress(ip));
const TEST_ALLOWANCE = { allowHttp: true, refuseAddress: LOCAL_ONLY_PUBLIC };
const INIT = { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"x":1}' };
const url = () => `http://rebind.example.test:${port}/hook`;

test("(a) a rebinding name is resolved ONCE and the socket goes to the vetted address", async () => {
  reset();
  let calls = 0;
  // Public to the first question, private to the second: the shape of a rebinding attack.
  const rebinding = async () => (++calls === 1 ? [{ address: "127.0.0.1" }] : [{ address: "127.0.0.2" }]);
  const r = await pinnedRequest(url(), INIT, { resolve: rebinding, unsafeTestAllowance: TEST_ALLOWANCE });
  assert.equal(calls, 1, "exactly one resolution — no second lookup a rebind could win");
  assert.deepEqual(r, { ok: true, status: 202 });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].localAddress, "127.0.0.1", "the connection went to the vetted address");
  assert.equal(hits[0].host, `rebind.example.test:${port}`, "the Host header still names the URL's host");
  assert.equal(hits[0].method, "POST");
  assert.equal(hits[0].body, '{"x":1}');
});

test("(b) a host whose only answer is private is refused before any socket opens", async () => {
  reset();
  // Default policy: 127.0.0.1 IS private here, and it is exactly where the server listens.
  await assert.rejects(
    pinnedRequest(url(), INIT, { resolve: async () => [{ address: "127.0.0.1" }], unsafeTestAllowance: { allowHttp: true } }),
    /non-public address \(127\.0\.0\.1\)/,
  );
  assert.equal(connections, 0, "no socket reached the private address");
  await assert.rejects(
    pinnedRequest(url(), INIT, { resolve: async () => [{ address: "169.254.169.254" }], unsafeTestAllowance: { allowHttp: true } }),
    /non-public address \(169\.254\.169\.254\)/,
  );
});

test("(b') one private answer among public ones refuses the whole host", async () => {
  reset();
  await assert.rejects(
    pinnedRequest(url(), INIT, {
      resolve: async () => [{ address: "127.0.0.1" }, { address: "127.0.0.2" }],
      unsafeTestAllowance: TEST_ALLOWANCE,
    }),
    /non-public address \(127\.0\.0\.2\)/,
  );
  assert.equal(connections, 0);
});

test("(c) an IPv4-mapped IPv6 answer is refused (both spellings)", async () => {
  for (const address of ["::ffff:7f00:1", "::ffff:a9fe:a9fe", "::ffff:127.0.0.1"]) {
    reset();
    await assert.rejects(
      pinnedRequest(url(), INIT, { resolve: async () => [{ address }], unsafeTestAllowance: { allowHttp: true } }),
      /non-public address/,
      address,
    );
    assert.equal(connections, 0, `no socket for ${address}`);
  }
});

test("a 3xx is surfaced as a status and never followed", async () => {
  reset();
  answer = { status: 307, headers: { Location: `http://127.0.0.1:${port}/internal` } };
  const r = await pinnedRequest(url(), INIT, { resolve: async () => [{ address: "127.0.0.1" }], unsafeTestAllowance: TEST_ALLOWANCE });
  assert.deepEqual(r, { ok: false, status: 307 });
  assert.equal(hits.length, 1, "the Location target was never requested");
});

test("an abort rejects with the signal's reason (a timeout stays a TimeoutError)", async () => {
  reset();
  holdOpen = true;
  await assert.rejects(
    pinnedRequest(url(), { ...INIT, signal: AbortSignal.timeout(150) }, { resolve: async () => [{ address: "127.0.0.1" }], unsafeTestAllowance: TEST_ALLOWANCE }),
    (err: Error) => err.name === "TimeoutError",
  );
  server.closeAllConnections();
});

test("plain http and private IP literals are refused without the test allowance", async () => {
  reset();
  await assert.rejects(pinnedRequest(url(), INIT, { resolve: async () => [{ address: "127.0.0.1" }] }), /only https/);
  await assert.rejects(pinnedRequest("https://169.254.169.254/latest", INIT), /non-public address/);
  await assert.rejects(pinnedRequest("https://[::ffff:a9fe:a9fe]/latest", INIT), /non-public address/);
  assert.equal(connections, 0);
});
