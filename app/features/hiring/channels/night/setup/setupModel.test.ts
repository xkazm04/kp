// Level 1's pure half: masking a receiver's credential, its endpoint, a generated secret, and the
// worst-first order of receivers and feeds. Samples are the contest's staged tokens and a real-length one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { feedState, generateSecret, maskIn, maskToken, MASK, rankFeeds, rankReceivers, receiverEndpoint } from "./setupModel.ts";

const REAL = "hook-NilGrUPaWpeWajaOYg7xeKlCGB6UHDjZ";

test("a token keeps a short head and tail, and hides the middle", () => {
  assert.equal(maskToken(REAL), `hook-Ni${MASK}jZ`);
  assert.equal(maskToken("hook-9abb25c32f"), `hoo${MASK}2f`);
  assert.ok(!maskToken(REAL).includes("GrUPaWpe"));
});

test("a short token shows nothing at all", () => {
  assert.equal(maskToken("abc123"), MASK);
  assert.equal(maskToken(""), MASK);
});

test("masking inside a URL or an address replaces every occurrence and nothing else", () => {
  const url = `https://kp.example.com/api/channels/inbound/${REAL}`;
  assert.equal(maskIn(url, REAL), `https://kp.example.com/api/channels/inbound/hook-Ni${MASK}jZ`);
  assert.equal(maskIn(`${REAL}@in.example.com`, REAL), `hook-Ni${MASK}jZ@in.example.com`);
  assert.equal(maskIn("no token here", ""), "no token here");
});

test("email with an inbound domain forwards to an address; without one, and for ads, the HTTP receiver", () => {
  const base = "https://kp.example.com";
  const wired = receiverEndpoint(REAL, "email", "in.example.com", base);
  assert.equal(wired.value, `${REAL}@in.example.com`);
  assert.equal(wired.http, `${base}/api/channels/inbound/${REAL}`);
  assert.equal(wired.wired, true);
  assert.ok(!wired.masked.includes(REAL) && !wired.httpMasked.includes(REAL));
  const unwired = receiverEndpoint(REAL, "email", null, base);
  assert.equal(unwired.value, unwired.http);
  assert.equal(unwired.wired, false);
  const ads = receiverEndpoint(REAL, "ads", "in.example.com", base);
  assert.equal(ads.value, ads.http);
  assert.equal(ads.wired, true);
});

test("a generated secret is 32 hex characters from the CSPRNG, never the same twice", () => {
  const a = generateSecret();
  const b = generateSecret();
  assert.match(a, /^whsec_[0-9a-f]{32}$/);
  assert.notEqual(a, b);
});

const hook = (over: Record<string, unknown>) => ({
  token: "t", jobId: "job", jobTitle: "Role", receivedCount: 0, acceptedCount: 0, firstReceivedAt: null, pullUrl: null, lastPullError: null, lastPullAt: null,
  ...over,
});

test("receivers read worst first: failing pull, reached with no lead, waiting, delivering; then by name", () => {
  const list = [
    hook({ token: "d", jobTitle: "Zeta", receivedCount: 9, acceptedCount: 3 }),
    hook({ token: "w2", jobTitle: "Čtenář" }),
    hook({ token: "w1", jobTitle: "Beta" }),
    hook({ token: "r", jobTitle: "Alpha", receivedCount: 4 }),
    hook({ token: "f", jobTitle: "Omega", receivedCount: 9, acceptedCount: 3, pullUrl: "https://f", lastPullError: "HTTP 502" }),
  ];
  assert.deepEqual(rankReceivers(list, "cs").map((w) => w.token), ["f", "r", "w1", "w2", "d"]);
  // A plain sort would put Č after Z; the reader's collation puts it after C.
  assert.deepEqual(rankReceivers([hook({ token: "z", jobTitle: "Zeta" }), hook({ token: "c", jobTitle: "Čtenář" })], "cs").map((w) => w.token), ["c", "z"]);
});

test("a feed is off without a URL, failing with an error, waiting until its first pull, live after", () => {
  assert.equal(feedState({ pullUrl: null, lastPullAt: "2026-09-29T10:00:00Z", lastPullError: "x" }), "off");
  assert.equal(feedState({ pullUrl: "https://f", lastPullAt: "2026-09-29T10:00:00Z", lastPullError: "HTTP 401" }), "fail");
  assert.equal(feedState({ pullUrl: "https://f", lastPullAt: null, lastPullError: null }), "wait");
  assert.equal(feedState({ pullUrl: "https://f", lastPullAt: "2026-09-29T10:00:00Z", lastPullError: null }), "live");
});

test("feeds read failing first, then never pulled, pulling, push only", () => {
  const list = [
    hook({ token: "off", jobTitle: "A" }),
    hook({ token: "live", jobTitle: "B", pullUrl: "https://f", lastPullAt: "2026-09-29T10:00:00Z" }),
    hook({ token: "wait", jobTitle: "C", pullUrl: "https://f" }),
    hook({ token: "fail", jobTitle: "D", pullUrl: "https://f", lastPullError: "HTTP 401" }),
  ];
  assert.deepEqual(rankFeeds(list, "en").map((w) => w.token), ["fail", "wait", "live", "off"]);
});
